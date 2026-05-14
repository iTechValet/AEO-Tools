/**
 * analysis-engine.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Runs the FIRST of two Claude Sonnet calls per monthly report.
 *
 *   Architectural law (Session 5): analysis and writing are two separate
 *   cognitive jobs. This file produces a Strategic Brief — a structured
 *   JSON document describing what the data says, what the wins are, what
 *   the concerns are, what the multi-month patterns are, and what tone /
 *   thread the writer should use. narrative-engine.js then reads that
 *   brief and writes the report from it. Never mix the two — the analysis
 *   call uses low temperature (0.3) and a strict JSON schema; the narrative
 *   call uses higher temperature (0.7) and free-form prose.
 *
 *   Inputs (one context object, assembled by runner.js):
 *     clientConfig (full), doc43A, doc43B, runDate, reportPeriod (label),
 *     clientMonth, progressionPhase, isFirstMonth, isQuarterlyMonth,
 *     napCleanupComplete, scoreResult (full), summaryHistory, runs (all
 *     13 including Run 6 — analysis sees Run 6, narrative does not),
 *     aeoData, repeatedCitations.
 *
 *   Output: a single JSON object matching the Strategic Brief schema in
 *   the build plan. On parse failure or API error: returns null and logs
 *   — the runner forwards null to narrative-engine, which falls back to
 *   writing from raw data.
 *
 *   Auth: process.env.ANTHROPIC_API_KEY. Direct call to
 *   api.anthropic.com — NOT through the Cloudflare Worker (same pattern
 *   as narrative-engine.js; this is server-side execution in GitHub
 *   Actions, no browser to protect).
 *
 *   Model: claude-sonnet-4-20250514
 *   Max tokens: 3000
 *   Temperature: 0.3  (LOW — this is analysis, not creative writing)
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (step 9 of 13, after archive, before narrative).
 *
 * WHAT THIS FILE CALLS:
 *   - Anthropic Messages API (https://api.anthropic.com/v1/messages).
 *
 * STATUS: Implemented in Session 5.
 */

'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANALYSIS_MODEL = 'claude-sonnet-4-20250514';
const ANALYSIS_MAX_TOKENS = 3000;
const ANALYSIS_TEMPERATURE = 0.3;
const ANALYSIS_TIMEOUT_MS = 90000;

const REQUIRED_TOP_KEYS = [
  'strategic_header',
  'primary_insight',
  'wins',
  'recommended_wow_moment',
  'concerns',
  'pattern_analysis',
  'competitor_intelligence',
  'narrative_directives',
  'forward_bridge'
];

const ANALYSIS_SYSTEM_PROMPT =
  'You are a senior data analyst for iTech Valet, an AI authority agency. ' +
  'Your job is to analyze AI visibility data for a client and produce a structured ' +
  'Strategic Brief that a report writer will use to write the monthly client report.\n\n' +
  'You are NOT writing the report. You are producing the analysis that feeds the report.\n\n' +
  'Your output must be a single valid JSON object. No preamble. No explanation. ' +
  'No markdown fences. Just the JSON.\n\n' +
  'Your analysis must be honest. Do not manufacture wins. Do not hide problems. ' +
  "Frame everything accurately — the writer will handle the tone.\n\n" +
  "You have access to the full history of this client's data going back to Month 1. " +
  'Use it. Single-month snapshots miss patterns. Patterns tell the real story.';

function summarizeRun(run) {
  return [
    `run_id=${run.run_id}`,
    `platform=${run.platform}`,
    `signal=${run.signal}`,
    `brand_mentioned=${run.brand_mentioned}`,
    `brand_recommended=${run.brand_recommended}`,
    `brand_position=${run.brand_position}`,
    `competitor_mentioned=${run.competitor_mentioned}`,
    `competitor_recommended=${run.competitor_recommended}`,
    `sentiment_signal=${run.sentiment_signal}`,
    `cited_urls=[${Array.isArray(run.cited_urls) ? run.cited_urls.join(' | ') : ''}]`,
    `authority_figure_named=${run.authority_figure_named}`,
    `response_length=${run.response_length}`,
    `platform_available=${run.platform_available}`
  ].join(', ');
}

function rawResponseBlock(run) {
  const text = (run.raw_response || '').slice(0, 2500);
  return `--- ${run.run_id} (${run.platform}) ---\n${text}`;
}

function summarizeHistoryRow(row) {
  return [
    row.report_period,
    `score=${row.ai_visibility_score}`,
    `trend=${row.trend_direction}`,
    `delta=${row.score_delta}`,
    `mention_rate=${row.mention_rate}`,
    `recommendation_rate=${row.recommendation_rate}`,
    `sentiment_score=${row.sentiment_score}`,
    `platforms_available=${row.platforms_available}`,
    `heuristic_fallback_count=${row.heuristic_fallback_count}`
  ].join(' | ');
}

function summarizeCitation(c) {
  return [
    `url=${c.url}`,
    `times_cited=${c.times_cited}`,
    `months=[${(c.months_cited || []).join(', ')}]`,
    `platforms=[${(c.platforms || []).join(', ')}]`
  ].join(', ');
}

function buildAnalysisUserPrompt(context) {
  const {
    clientConfig, runDate, reportPeriod, clientMonth, progressionPhase,
    napCleanupComplete, scoreResult, summaryHistory, runs, aeoData,
    repeatedCitations
  } = context;
  const score = scoreResult || {};
  const benchmark = score.benchmark || {};
  const cur = (aeoData && aeoData.currentCluster) || {};
  const next = (aeoData && aeoData.nextCluster) || {};

  const headerBlock = [
    `CLIENT: ${clientConfig.business_name} | Month ${clientMonth} | Phase: ${progressionPhase}`,
    `CONTRACT START: ${clientConfig.contract_start}`,
    `REPORT PERIOD: ${reportPeriod}`,
    `RUN DATE: ${runDate}`,
    `AUTHORITY FIGURE: ${clientConfig.authority_figure}, ${clientConfig.authority_title}`,
    `TOP COMPETITOR: ${clientConfig.top_competitor}  (referenced as "the top name in the market" in client deliverables)`,
    `CUSTOMER TERM: ${clientConfig.customer_term}`
  ].join('\n');

  const scoreBlock = [
    `SCORE THIS MONTH: ${score.ai_visibility_score === null || score.ai_visibility_score === undefined ? 'null (insufficient data)' : score.ai_visibility_score + ' / 100'}`,
    `SCORE LAST MONTH: ${score.prior_score === null || score.prior_score === undefined ? 'null (first run)' : score.prior_score}`,
    `TREND: ${score.trend_direction}`,
    `SCORE DELTA: ${score.score_delta}`,
    `BENCHMARK FOR MONTH ${clientMonth}: ${benchmark.low}-${benchmark.high} (${benchmark.label})`,
    `MENTION RATE: ${score.mention_rate}%`,
    `RECOMMENDATION RATE: ${score.recommendation_rate}%`,
    `SENTIMENT SCORE: ${score.sentiment_score}%`,
    `PLATFORMS AVAILABLE: ${score.platforms_available} of 13 runs`,
    `HEURISTIC FALLBACK COUNT: ${score.heuristic_fallback_count}`
  ].join('\n');

  const aeoBlock = [
    'CONTENT INVENTORY:',
    `- Total live nodes: ${aeoData ? aeoData.totalLiveNodes : 0}`,
    `- Current cluster: ${cur.name || '(none)'} — ${cur.strategicObjective || 'no strategic objective on file'}`,
    `- Next cluster: ${next.name || '(none)'} — ${next.strategicObjective || 'no strategic objective on file'}`
  ].join('\n');

  const napBlock = `NAP CLEANUP COMPLETE: ${!!napCleanupComplete}`;

  const runsBlock = [
    "THIS MONTH'S RUN RESULTS (one line per run):",
    ...((runs || []).map(summarizeRun))
  ].join('\n');

  const rawBlock = [
    "THIS MONTH'S RAW RESPONSES (for alignment signal detection — each truncated to 2500 chars):",
    ...((runs || []).filter(r => r.platform_available && r.raw_response).map(rawResponseBlock))
  ].join('\n');

  const historyBlock = [
    'FULL HISTORY (all prior monthly AI_Visibility_Summary rows, oldest first):',
    (summaryHistory && summaryHistory.length > 0)
      ? summaryHistory.map(summarizeHistoryRow).join('\n')
      : '(none — this is the first run)'
  ].join('\n');

  const citationsBlock = [
    'CITATION HISTORY (URLs cited in 2+ distinct months across full history):',
    (repeatedCitations && repeatedCitations.length > 0)
      ? repeatedCitations.map(summarizeCitation).join('\n')
      : '(none — no repeated citations yet)'
  ].join('\n');

  const schemaBlock = [
    'STRATEGIC BRIEF SCHEMA (return EXACTLY this JSON object, every field required; use null when there is no meaningful data, never invent data):',
    '{',
    '  "strategic_header": {',
    '    "client_id": string,',
    '    "engagement_month": integer,',
    '    "progression_phase": "Foundation" | "Building" | "Authority",',
    '    "benchmark_alignment": "underperforming" | "on-track" | "outperforming",',
    '    "benchmark_note": string (one sentence)',
    '  },',
    '  "primary_insight": {',
    '    "headline": string,',
    '    "supporting_data": string[],',
    '    "why_it_matters": string',
    '  },',
    '  "wins": [',
    '    {',
    '      "win_type": "citation_echo" | "identity_resolution" | "alignment_signal" | "score_movement" | "sentiment_shift" | "response_length_growth" | "competitive_proximity" | "first_mention" | "nap_cleanup",',
    '      "description": string,',
    '      "data_points": string[],',
    '      "wow_factor": "high" | "medium" | "low",',
    '      "client_facing_frame": string',
    '    }',
    '  ],',
    '  "recommended_wow_moment": {',
    '    "win_index": integer | null,',
    '    "callout_text": string | null  // 3-5 sentence draft of the WIN callout, casual voice, specific data, no jargon',
    '  },',
    '  "concerns": [',
    '    {',
    '      "concern_type": "score_drop" | "platform_unavailable" | "authority_confusion" | "competitor_surge" | "no_citations" | "sentiment_decline",',
    '      "description": string,',
    '      "severity": "high" | "medium" | "low",',
    '      "reframe_instruction": string',
    '    }',
    '  ],',
    '  "pattern_analysis": {',
    '    "score_trajectory": "Improving" | "Stable" | "Declining" | "Baseline",',
    '    "months_of_data": integer,',
    '    "trajectory_note": string | null,',
    '    "citation_concentration": [',
    '      { "url": string, "times_cited": integer, "platforms": string[], "significance": string }',
    '    ],',
    '    "response_length_delta": {',
    '      "current_avg_length": integer,',
    '      "prior_avg_length": integer | null,',
    '      "direction": "growing" | "shrinking" | "stable" | "no_prior_data",',
    '      "interpretation": string',
    '    },',
    '    "platform_divergence": { "detected": boolean, "description": string | null },',
    '    "alignment_signal": { "detected": boolean, "description": string | null }',
    '  },',
    '  "competitor_intelligence": {',
    '    "competitor_mention_rate": number,',
    '    "competitor_recommendation_rate": number,',
    '    "gap_this_month": number,',
    '    "gap_vs_last_month": string | null,',
    '    "vulnerability_signal": string | null',
    '  },',
    '  "narrative_directives": {',
    '    "recommended_tone": "Aggressive Proof" | "Patient Foundation" | "Competitive Friction" | "Victory Lap" | "Honest Reset",',
    '    "opening_thread": string,',
    '    "sections_to_emphasize": string[],',
    '    "sections_to_handle_carefully": string[],',
    '    "valley_of_death_active": boolean,  // true if score is flat or declining AND client_month is 2-5',
    '    "valley_reframe": string | null',
    '  },',
    '  "forward_bridge": {',
    '    "next_cluster_relevance": string,',
    '    "watch_signal": string,',
    '    "momentum_statement": string',
    '  }',
    '}',
    'Return ONLY the JSON object. No preamble, no markdown fences, no commentary.'
  ].join('\n');

  return [
    headerBlock, '', scoreBlock, '', aeoBlock, '', napBlock, '',
    runsBlock, '', rawBlock, '', historyBlock, '', citationsBlock, '',
    schemaBlock
  ].join('\n');
}

function stripCodeFences(s) {
  return String(s || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function parseStrategicBrief(text) {
  const cleaned = stripCodeFences(text);
  // Try direct parse first.
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }
  // Last-resort: slice from first '{' to last '}'.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) { /* nope */ }
  }
  return null;
}

function validateStrategicBrief(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  for (const key of REQUIRED_TOP_KEYS) {
    if (!(key in obj)) return false;
  }
  return true;
}

async function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); }
  finally { clearTimeout(t); }
}

async function generateAnalysis(context) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('[analysis-engine] ANTHROPIC_API_KEY env var is not set — returning null.');
    return null;
  }
  if (!context || !context.clientConfig || !context.scoreResult) {
    console.error('[analysis-engine] context.clientConfig and context.scoreResult are required — returning null.');
    return null;
  }

  let userPrompt;
  try {
    userPrompt = buildAnalysisUserPrompt(context);
  } catch (err) {
    console.error(`[analysis-engine] buildAnalysisUserPrompt failed: ${err.message} — returning null.`);
    return null;
  }

  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': anthropicKey
        },
        body: JSON.stringify({
          model: ANALYSIS_MODEL,
          max_tokens: ANALYSIS_MAX_TOKENS,
          temperature: ANALYSIS_TEMPERATURE,
          system: ANALYSIS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const text = data && Array.isArray(data.content)
        ? data.content
            .filter(b => b && b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text)
            .join('')
        : '';
      if (!text || !text.trim()) {
        throw new Error('Anthropic response had no text content');
      }
      const parsed = parseStrategicBrief(text);
      if (!parsed) {
        throw new Error('Strategic Brief was not valid JSON');
      }
      if (!validateStrategicBrief(parsed)) {
        throw new Error('Strategic Brief is missing required top-level keys');
      }
      return parsed;
    }, ANALYSIS_TIMEOUT_MS);
  } catch (err) {
    console.error(`[analysis-engine] generateAnalysis failed: ${err.message} — returning null.`);
    return null;
  }
}

module.exports = {
  generateAnalysis,
  // exported for unit testing
  buildAnalysisUserPrompt,
  parseStrategicBrief,
  validateStrategicBrief,
  REQUIRED_TOP_KEYS,
  ANALYSIS_MODEL,
  ANALYSIS_MAX_TOKENS,
  ANALYSIS_TEMPERATURE,
  ANALYSIS_SYSTEM_PROMPT
};
