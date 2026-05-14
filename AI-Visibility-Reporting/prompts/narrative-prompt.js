/**
 * prompts/narrative-prompt.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Builds the Claude Sonnet payload that produces the monthly client
 *   report. The most important file in this tool — the score is just a
 *   number until this prompt turns it into a story the client can read.
 *
 *   buildNarrativePrompt(context) returns { system, messages } shaped for
 *   the Anthropic Messages API. The system prompt locks voice and data
 *   rules; the user prompt is a single message that:
 *     - states the run's pre-calculated facts (Claude never recomputes them)
 *     - INCLUDES THE STRATEGIC BRIEF from analysis-engine.js when present
 *       (Session 5 — two-call architecture; the brief is the writer's
 *       primary guide for wins, tone, opening thread, and concerns)
 *     - dumps the 12 narrative-eligible runs (Run 6 already stripped by
 *       the runner)
 *     - dumps the prior AI_Visibility_Summary history
 *     - dumps repeatedCitations across all prior months
 *     - dumps the current AEO content inventory
 *     - dumps 4.3A (voice) and 4.3B (locked client identity)
 *     - issues section-by-section instructions for the 8 locked sections
 *
 *   The output is plain text with the 8 section names ("OPENING", "WHAT WE
 *   PUBLISHED THIS MONTH", "WHAT THE AI PLATFORMS SAID", "A WIN WORTH
 *   NOTING", "WHERE WE STAND", "ON OUR RADAR", "THE BIGGER PICTURE",
 *   "CLOSING") used as literal headers — pdf-builder.js splits on those
 *   exact strings to populate templates/report.html.
 *
 * WHAT CALLS THIS FILE:
 *   - narrative-engine.js (calls buildNarrativePrompt(context); forwards
 *     { system, messages } as the Anthropic body).
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure data module.
 *
 * STATUS: Implemented in Session 4. Extended in Session 5 to consume the
 *   analysisResult (Strategic Brief) and repeatedCitations context fields.
 */

'use strict';

const SECTION_NAMES = [
  'OPENING',
  'WHAT WE PUBLISHED THIS MONTH',
  'WHAT THE AI PLATFORMS SAID',
  'A WIN WORTH NOTING',
  'WHERE WE STAND',
  'ON OUR RADAR',
  'THE BIGGER PICTURE',
  'CLOSING'
];

const FORBIDDEN_WORDS = [
  'deployed', 'clusters', 'intent layers', 'pillars', 'semantic',
  'entity', 'trunk', 'branch', 'schema', 'backlink', 'keyword',
  'SEO', 'Tier 1', 'Tier 2', 'Tier 3', 'synergy', 'leverage',
  'optimize', 'utilize'
];

function buildSystemPrompt(context) {
  const { clientConfig, doc43A } = context;
  const business = clientConfig.business_name;
  const authority = clientConfig.authority_figure;
  const competitor = clientConfig.top_competitor;

  return [
    `You are writing the monthly AI Visibility Report for ${business}. The report is signed by ${authority || 'Gerek Allen'}, Founder of iTech Valet. It goes to one client. It must read like a founder who gives a damn, not like a software report.`,
    '',
    'CLIENT VOICE & IDENTITY — 4.3A (anchor for every sentence):',
    doc43A && doc43A.trim().length > 0
      ? doc43A.trim()
      : '(4.3A not provided for this client — fall back to: warm, direct, 5th-grade reading level, never corporate, never salesy, sounds like a founder talking to a client he respects.)',
    '',
    'VOICE RULES — non-negotiable:',
    '- 5th grade reading level. Casual, direct, warm. Never corporate.',
    '- Short paragraphs. One idea per paragraph. No sentence over 20 words.',
    '- Active voice only. Never passive.',
    '- Write like a founder who gives a damn, not like a software report.',
    `- Forbidden words: ${FORBIDDEN_WORDS.join(', ')}.`,
    `- Never name the competitor directly. The competitor for this client is "${competitor}" — refer to them ONLY as "the top name in your market" or similar generic phrasing.`,
    '- Never say "Month X" of the report system. Use the calendar month only (e.g., "May 2026").',
    '',
    'DATA RULES — non-negotiable:',
    '- All scores, dates, node counts, and trend directions are provided as facts in the user message. Never calculate or infer them.',
    '- Never present a naked number without framing. Context always accompanies data.',
    '- Score is always shown with benchmark range, in this shape: "Your score this month is [X] — right in the expected range for Month [N] ([benchmark_low]–[benchmark_high])." Adjust the phrasing if the score is above or below the range, but always pair the score with the range.',
    '',
    'FORBIDDEN PHRASES & FRAMES:',
    '- No "just wait" framing. Every section must give the client something specific and true to hold onto right now.',
    '- No "as expected" without immediately explaining why "as expected" is actually good news for this phase.',
    '- Drift Detection: if a sentence could apply to any client without modification, rewrite it. If you replace the business name with a competitor and the sentence still reads accurate, it is too generic.',
    '',
    'STRUCTURAL RULES — non-negotiable:',
    `- Produce exactly these 8 sections, in this order, each labeled with its name as a header on its own line, in ALL CAPS, with no other text on the header line: ${SECTION_NAMES.join(' | ')}.`,
    '- Do NOT add any preamble before OPENING. Do NOT add any commentary after CLOSING.',
    '- Do NOT use markdown headers (no #, ##, etc.). Just the all-caps section name on its own line.',
    '- The body of each section is plain prose. Use blank lines between paragraphs. No bullet lists unless the section instructions explicitly say so.'
  ].join('\n');
}

function formatRunSummary(run) {
  const fields = [
    `run_id=${run.run_id}`,
    `platform=${run.platform}`,
    `signal=${run.signal}`,
    `platform_available=${run.platform_available}`,
    `brand_mentioned=${run.brand_mentioned}`,
    `brand_recommended=${run.brand_recommended}`,
    `brand_position=${run.brand_position}`,
    `competitor_mentioned=${run.competitor_mentioned}`,
    `competitor_recommended=${run.competitor_recommended}`,
    `sentiment_signal=${run.sentiment_signal}`,
    `authority_figure_named=${run.authority_figure_named}`,
    `cited_urls=${Array.isArray(run.cited_urls) ? run.cited_urls.join(' | ') : ''}`,
    `parser_status=${run.parser_status}`
  ].join(', ');
  const raw = (run.raw_response || '').slice(0, 2000);
  return `--- Run ${run.run_id} ---\n${fields}\nRAW RESPONSE (truncated to 2000 chars):\n${raw}\n`;
}

function formatHistoryRow(row) {
  return [
    row.report_period, `score=${row.ai_visibility_score}`,
    `trend=${row.trend_direction}`, `delta=${row.score_delta}`,
    `mention_rate=${row.mention_rate}`, `recommendation_rate=${row.recommendation_rate}`,
    `sentiment_score=${row.sentiment_score}`,
    `platforms_available=${row.platforms_available}`
  ].join(' | ');
}

function formatAEOData(aeo) {
  if (!aeo) return '(AEO inventory not available)';
  const cur = aeo.currentCluster || {};
  const next = aeo.nextCluster || {};
  return [
    `total_live_nodes=${aeo.totalLiveNodes}`,
    '',
    'CURRENT CLUSTER (highest CLUSTER_NUMBER where STATUS=Live):',
    `  name: ${cur.name || '(none)'}`,
    `  number: ${cur.number != null ? cur.number : '(none)'}`,
    `  articleCount: ${cur.articleCount != null ? cur.articleCount : '(unknown)'}`,
    `  strategicObjective: ${cur.strategicObjective || '(null)'}`,
    '',
    'NEXT CLUSTER (lowest CLUSTER_NUMBER not yet Live):',
    `  name: ${next.name || '(none)'}`,
    `  number: ${next.number != null ? next.number : '(none)'}`,
    `  strategicObjective: ${next.strategicObjective || '(null)'}`
  ].join('\n');
}

function formatScore(scoreResult) {
  const b = scoreResult.benchmark || {};
  return [
    `ai_visibility_score: ${scoreResult.ai_visibility_score}`,
    `prior_score: ${scoreResult.prior_score}`,
    `score_delta: ${scoreResult.score_delta}`,
    `trend_direction: ${scoreResult.trend_direction}`,
    `mention_rate: ${scoreResult.mention_rate}`,
    `recommendation_rate: ${scoreResult.recommendation_rate}`,
    `sentiment_score: ${scoreResult.sentiment_score}`,
    `platforms_available: ${scoreResult.platforms_available}`,
    `heuristic_fallback_count: ${scoreResult.heuristic_fallback_count}`,
    `insufficient_data: ${scoreResult.insufficient_data}`,
    `benchmark_low: ${b.low}`,
    `benchmark_high: ${b.high}`,
    `benchmark_label: ${b.label}`
  ].join('\n');
}

function buildSectionInstructions(context) {
  const {
    clientConfig, clientMonth, reportPeriod, isFirstMonth,
    isQuarterlyMonth, napCleanupComplete, progressionPhase,
    scoreResult
  } = context;
  const business = clientConfig.business_name;
  const authority = clientConfig.authority_figure || 'Gerek Allen';
  const isMonth1 = isFirstMonth || clientMonth === 1;

  const quarterlyNote = isQuarterlyMonth
    ? `IMPORTANT: This is a quarterly month (Month ${clientMonth}). Add ONE sentence in OPENING noting that next month includes the full AI Authority Quarterly Report.`
    : 'Not a quarterly month — do not mention any quarterly report.';

  const trend = scoreResult.trend_direction;
  const score = scoreResult.ai_visibility_score;

  return [
    '',
    '==================== SECTION-BY-SECTION INSTRUCTIONS ====================',
    `Progression phase for this run: ${progressionPhase} (Month ${clientMonth}).`,
    `Report period to use in prose: "${reportPeriod}".`,
    `isFirstMonth=${isFirstMonth}, isQuarterlyMonth=${isQuarterlyMonth}, napCleanupComplete=${!!napCleanupComplete}.`,
    '',
    '--- OPENING (2-3 short paragraphs) ---',
    isMonth1
      ? '- This is Month 1. Set the starting line. Acknowledge the program is new and that this report is the beginning of a measurement system, not a report card. Make the client feel the team is already at work.'
      : (clientMonth <= 5
          ? '- Reference what was established last month and what this month builds on. One thread connecting to the prior report. Never repeat the same opening twice (the prior summaryHistory rows are above — use their period names if useful, but do not echo their language verbatim).'
          : '- Month 6+. The tone shifts. This is no longer about building — it is about watching the verdict change. Frame the opening accordingly.'),
    `- ${quarterlyNote}`,
    '',
    '--- WHAT WE PUBLISHED THIS MONTH ---',
    '- Lead with total live nodes as the headline number.',
    '- Describe the current cluster by topic territory — what questions it answers, what it makes possible. NEVER describe a cluster by its article count.',
    '- If a next cluster exists: use its strategicObjective if available. If null, use the cluster name to write one sentence about what is coming next. Sell the dream — territory and topics, not article counts.',
    '- Tense rule: current cluster articles are "going live this month" or "live now" — never past tense unless STATUS=Live is already confirmed (which it is, since they are counted in total_live_nodes). The next cluster is always future tense.',
    '',
    '--- WHAT THE AI PLATFORMS SAID ---',
    '- One paragraph per signal, not per platform.',
    '- Signal 1 (runs 1A-1D, 5A, 5B): the recommendation verdict. Was the brand recommended? Where did it appear? Frame honestly — if not recommended, frame as expected for Month ' + clientMonth + '.',
    '- Run 2 (head-to-head): what did AI say about the comparison? Even a partial win is significant.',
    '- Run 3 (authority figure): was ' + authority + ' named correctly? This is the Identity Resolution signal. If improving, name it as progress. If wrong, frame as "we know exactly what to fix."',
    '- Runs 4A and 4B (sentiment): how is the brand being described? Is the description getting more specific, more detailed, longer than last month?',
    '- ALIGNMENT SIGNAL: scan every raw response for cases where AI describes the ideal provider in language that matches the locked identity from 4.3B — even without naming the client. If you find one, call it out explicitly: "AI is starting to describe the ideal [service type] using language that sounds exactly like ' + business + '. That is not a coincidence. That is the content working."',
    '- Never say "not mentioned" flatly. Frame absence as a starting line, not a failure.',
    '',
    '--- A WIN WORTH NOTING (callout block, kept short — 2 to 4 sentences max) ---',
    'Primary source: the Strategic Brief\'s recommended_wow_moment.',
    '- If the brief is present and recommended_wow_moment.callout_text is non-null: rewrite that draft in Gerek\'s voice — casual, direct, specific. Keep every data point. Drop any jargon.',
    '- If the brief is present but the wins[] array is empty (or recommended_wow_moment.win_index is null): do NOT manufacture a win. Write exactly: "This month\'s numbers are building the foundation. Next month we\'ll have more to show." Then move on.',
    '- If the brief is null (analysis engine unavailable this run): apply the priority order below.',
    'Fallback priority order (when no Strategic Brief is available):',
    isMonth1
      ? (napCleanupComplete
          ? '  1. NAP cleanup IS complete. The win is exactly this: "Your business identity is now consistent across the internet. AI reads consistency as trust. We fixed the foundation." Adapt the phrasing but keep the meaning.'
          : '  2. Month 1, NAP not done. Find the win in the data: first citation, head-to-head comparison result, identity recognition, or alignment signal.')
      : '  3. Month 2+. Pick the most specific, data-supported, genuine finding from this month\'s runs. Options in priority order: first-time URL citation by an AI platform; authority figure correctly named for the first time; brand appearing in second or third position on a short list for the first time; alignment signal detected; score moving UP for the first time; sentiment shifting from neutral to positive; response length growing.',
    '  4. If truly nothing qualifies: do NOT manufacture a win. Write one honest sentence about what the data shows and move on. A missing win callout is better than a fake one.',
    'Begin this section with the literal line "A WIN WORTH NOTING" — the PDF builder splits on that exact string to render this section as a visual callout.',
    '',
    '--- WHERE WE STAND ---',
    score === null
      ? `- The score is null this month (insufficient platform coverage — ${scoreResult.platforms_available}/13 platforms available). Acknowledge this honestly: explain that not enough platforms returned data for a meaningful composite, and frame what we WILL see next month.`
      : `- Lead with the score: "${score} out of 100 this month."`,
    `- Immediately follow with benchmark context. The benchmark for Month ${clientMonth} is ${scoreResult.benchmark && scoreResult.benchmark.low} to ${scoreResult.benchmark && scoreResult.benchmark.high} ("${scoreResult.benchmark && scoreResult.benchmark.label}"). State whether the score is above, within, or below that range.`,
    trend === 'UP'
      ? '- Trend is UP. Frame as momentum building. Tie it to a specific thing in the data when possible.'
      : (trend === 'DOWN'
          ? '- Trend is DOWN. Flag it honestly and explain why it does not mean the strategy is not working (e.g. score is a lagging indicator of months-old content, an unavailable platform skewed the math, etc).'
          : (trend === 'FLAT'
              ? '- Trend is FLAT. Expected for this phase. Explain why FLAT is the right reading here, not a stall.'
              : '- Trend is BASELINE (no prior month yet). This is the starting line everything else gets measured from.')),
    clientMonth <= 3
      ? '- For Months 1-3 specifically: explicitly reframe the score as a lagging indicator. "This number reflects what was built months ago, not what went live this month. The content going live now is what moves this number in months 3-6."'
      : (clientMonth <= 6
          ? '- For Months 4-6 specifically: connect the score trend to content volume. Show the relationship between nodes live and score direction.'
          : '- For Months 7+: the score is now lapping the content. Frame in terms of compounding signal, not building.'),
    '- Never end this section with "just wait." End with something specific that is being watched next month.',
    '',
    '--- ON OUR RADAR ---',
    '- One or two specific signals to watch next month. Must be data-derived from THIS month\'s runs.',
    '- If authority figure was wrong this month: "We are watching the identity correction as new content indexes."',
    '- If cited URLs appeared this month: "We are watching to see which content gets cited again — that is the signal that AI has locked it in."',
    '- If Run 2 named a specific gap with the top name in the market: name that gap and note that the content going live this month addresses it.',
    napCleanupComplete && isMonth1
      ? '- napCleanupComplete is true AND this is Month 1: include "We are watching to see how AI responds to the cleaner identity signals as they propagate."'
      : '- (Skip the NAP-watch line — only used in Month 1 when napCleanupComplete just flipped true.)',
    '',
    '--- THE BIGGER PICTURE ---',
    '- The market context section. Why this matters NOW, not eventually.',
    '- Anchor every sentence in the specific industry (use 4.3B identity language and ' + business + '\'s service). Generic statements are forbidden in this section.',
    '- The window argument: competitors who move now lock in advantage that gets more expensive to replicate every month.',
    '- End with forward momentum — not a call to action, but a sense that the machine is running.',
    '',
    '--- CLOSING (3 to 5 sentences) ---',
    `- Voice: ${authority}, Founder — iTech Valet. Warm, direct, confident. Not salesy.`,
    '- One specific forward-looking sentence about what comes next month.',
    `- Sign off exactly: "${authority}, Founder — iTech Valet / gerek@itechvalet.com"`,
    `- After the sign-off, add a final footer line exactly: "${reportPeriod} | Prepared exclusively for ${business} | Confidential"`,
    ''
  ].join('\n');
}

function formatStrategicBrief(analysisResult) {
  if (!analysisResult) {
    return [
      '==================== STRATEGIC BRIEF FROM ANALYSIS ENGINE ====================',
      'Note: Analysis engine unavailable this run. Write from raw data directly.',
      'Apply the win priority order from the original A WIN WORTH NOTING instructions ' +
        'below: NAP cleanup (Month 1) > citation echo > identity resolution > ' +
        'competitive proximity > alignment signal > score movement > sentiment shift > ' +
        'response length growth. If nothing qualifies, do NOT manufacture a win.'
    ].join('\n');
  }
  let json;
  try {
    json = JSON.stringify(analysisResult, null, 2);
  } catch (_) {
    json = '(analysisResult could not be serialized)';
  }
  return [
    '==================== STRATEGIC BRIEF FROM ANALYSIS ENGINE ====================',
    json,
    '',
    'How to use this brief:',
    '- primary_insight tells you what the most important finding is and why it matters — open the report around it.',
    '- recommended_wow_moment.win_index points at the win in wins[] you should feature in A WIN WORTH NOTING. recommended_wow_moment.callout_text is a DRAFT — rewrite it in Gerek\'s voice. Keep the specific data.',
    '- concerns[] tells you what to acknowledge and how to reframe each one. Do not skip concerns — reframe them honestly.',
    '- narrative_directives.recommended_tone sets the overall posture (Aggressive Proof | Patient Foundation | Competitive Friction | Victory Lap | Honest Reset).',
    '- narrative_directives.opening_thread is the specific thread connecting last month to this month. Use it in OPENING.',
    '- narrative_directives.valley_of_death_active + valley_reframe: if true, the score is flat or down in Months 2-5 — frame honestly per the reframe instruction. Never use "just wait" framing.',
    '- forward_bridge.watch_signal is the one specific thing to monitor next month — use it in ON OUR RADAR.',
    '- pattern_analysis.alignment_signal.detected: if true, feature the description in WHAT THE AI PLATFORMS SAID.',
    'Do not repeat the brief back. Use it to write better. The client never sees this document.'
  ].join('\n');
}

function formatRepeatedCitations(repeatedCitations) {
  if (!Array.isArray(repeatedCitations) || repeatedCitations.length === 0) {
    return '(no repeated citations yet — this is the first appearance, or no URL has yet appeared in 2+ distinct months)';
  }
  return repeatedCitations.map(c => {
    const months = Array.isArray(c.months_cited) ? c.months_cited.join(', ') : '';
    const plats = Array.isArray(c.platforms) ? c.platforms.join(', ') : '';
    return `- ${c.url}  (cited ${c.times_cited}x across [${months}] by [${plats}])`;
  }).join('\n');
}

function buildUserPrompt(context) {
  const {
    clientConfig, doc43A, doc43B,
    runDate, reportPeriod, clientMonth,
    scoreResult, summaryHistory, runs,
    aeoData, napCleanupComplete,
    progressionPhase, isFirstMonth, isQuarterlyMonth,
    analysisResult, repeatedCitations
  } = context;

  const histLines = (summaryHistory || []).length === 0
    ? '(none — this is the first run)'
    : summaryHistory.map(formatHistoryRow).join('\n');

  const runsText = (runs || []).map(formatRunSummary).join('\n');

  const facts = [
    '==================== PRE-CALCULATED FACTS ====================',
    `client_id: ${clientConfig.client_id}`,
    `business_name: ${clientConfig.business_name}`,
    `service: ${clientConfig.service}`,
    `primary_topic: ${clientConfig.primary_topic}`,
    `market_scope: ${clientConfig.market_scope}`,
    `top_competitor: ${clientConfig.top_competitor}  (NEVER name this directly — see voice rules)`,
    `authority_figure: ${clientConfig.authority_figure}`,
    `authority_title: ${clientConfig.authority_title}`,
    `customer_term: ${clientConfig.customer_term}`,
    `contract_start: ${clientConfig.contract_start}`,
    '',
    `run_date: ${runDate}`,
    `reportPeriod (use this exact string in prose): ${reportPeriod}`,
    `clientMonth: ${clientMonth}`,
    `progressionPhase: ${progressionPhase}`,
    `isFirstMonth: ${isFirstMonth}`,
    `isQuarterlyMonth: ${isQuarterlyMonth}`,
    `napCleanupComplete: ${!!napCleanupComplete}`,
    '',
    '---- SCORE (do not recalculate; treat as facts) ----',
    formatScore(scoreResult),
    '',
    '---- AI_VISIBILITY_SUMMARY HISTORY (oldest first) ----',
    histLines,
    '',
    '---- REPEATED CITATIONS (URLs cited in 2+ distinct months across full history) ----',
    formatRepeatedCitations(repeatedCitations),
    '',
    '---- AEO CONTENT INVENTORY (this is what was published / is going live / is next) ----',
    formatAEOData(aeoData),
    '',
    '---- 4.3B LOCKED CLIENT IDENTITY (use this language for the ALIGNMENT SIGNAL detection) ----',
    doc43B && doc43B.trim().length > 0
      ? doc43B.trim()
      : '(4.3B not provided — skip the formal ALIGNMENT SIGNAL detection but still scan responses for any organic match to ' + clientConfig.business_name + '\'s service description.)',
    '',
    '---- THIS MONTH\'S 12 NARRATIVE-ELIGIBLE RUNS (Run 6 already stripped — internal only) ----',
    runsText,
    '',
    formatStrategicBrief(analysisResult)
  ].join('\n');

  const sectionInstructions = buildSectionInstructions(context);

  return facts + sectionInstructions + '\n\nNow write the full 8-section report. Begin with the literal line "OPENING" and end with the footer line under CLOSING. No preamble. No commentary.';
}

function buildNarrativePrompt(context) {
  if (!context || typeof context !== 'object') {
    throw new Error('buildNarrativePrompt requires a context object');
  }
  if (!context.clientConfig || !context.scoreResult) {
    throw new Error('context.clientConfig and context.scoreResult are required');
  }
  const system = buildSystemPrompt(context);
  const user = buildUserPrompt(context);
  return {
    system,
    messages: [{ role: 'user', content: user }]
  };
}

module.exports = {
  buildNarrativePrompt,
  SECTION_NAMES,
  FORBIDDEN_WORDS,
  // exported for unit testing
  buildSystemPrompt,
  buildUserPrompt,
  formatStrategicBrief,
  formatRepeatedCitations
};
