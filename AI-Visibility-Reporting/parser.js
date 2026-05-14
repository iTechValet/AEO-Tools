/**
 * parser.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Two-tier parser for a single raw platform response.
 *
 *   Primary path — Claude Haiku (claude-haiku-4-5-20251001) via the
 *   existing Cloudflare Worker proxy at anthropic-proxy.gerek.workers.dev.
 *   The Worker is a pass-through proxy — it does NOT inject the Anthropic
 *   key. The runner must send `x-api-key: <ANTHROPIC_API_KEY>` from
 *   GitHub Secrets (Session 4 fix — Session 3 smoke testing surfaced HTTP
 *   400 "Missing x-api-key header" because parser.js was assuming
 *   injection). System prompt + 3 few-shot examples (positive / negative
 *   / mixed) come from prompts/parser-prompt.js. Strict JSON output is
 *   enforced by prompt; the parser also strips stray markdown fences and
 *   extracts the largest {...} block as a last-resort recovery before
 *   declaring the LLM output malformed.
 *
 *   Fallback path — heuristic regex over the three score-critical fields
 *   only (per build plan): brand_mentioned, brand_recommended,
 *   sentiment_signal. Every other field defaults to a safe value
 *   (false / "not_mentioned" / []). Fires whenever the Haiku call fails
 *   for any reason — network error, timeout, non-2xx response, empty
 *   content, malformed JSON, or invalid schema.
 *
 *   parser_status is "llm" on the primary path and "heuristic" on the
 *   fallback. The 4+ heuristic-runs-per-month threshold check is the
 *   orchestrator's responsibility (runner.js), not this module's — this
 *   module simply tags each call.
 *
 *   Citations override: parseResponse accepts an optional third argument
 *   `citations` (string[]). Perplexity returns its sources in a top-level
 *   `citations` array on the response object, separate from the prose, so
 *   the runner captures that array and forwards it here. When citations is
 *   non-empty, it REPLACES whatever cited_urls the Haiku or heuristic path
 *   produced — the platform's own citations are authoritative. When citations
 *   is empty or omitted (every non-Perplexity run), the parser falls back
 *   to URLs the Haiku call extracted from the prose. Wired in Session 3.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (one call per platform run, immediately after the raw
 *                 response returns from ChatGPT / Gemini / Perplexity / Grok).
 *
 * WHAT THIS FILE CALLS:
 *   - prompts/parser-prompt.js  (builds the { system, messages } payload)
 *   - Anthropic Messages API via the Cloudflare Worker proxy
 *     https://anthropic-proxy.gerek.workers.dev/v1/messages
 *
 * STATUS: Implemented in Session 2.
 */

const parserPrompt = require('./prompts/parser-prompt.js');

const PROXY_URL = 'https://anthropic-proxy.gerek.workers.dev/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const HAIKU_TIMEOUT_MS = 30000;
const HAIKU_MAX_TOKENS = 1024;

const ENUMS = {
  brand_position: ['first', 'second', 'third', 'other', 'not_mentioned'],
  sentiment_signal: ['positive', 'neutral', 'negative', 'mixed']
};

const POSITIVE_WORDS = [
  'best', 'great', 'excellent', 'trusted', 'reliable', 'top',
  'leading', 'recommended', 'outstanding', 'strong', 'recommend', 'trust'
];
const NEGATIVE_WORDS = [
  'avoid', 'scam', 'complaint', 'warning', 'poor', 'bad', 'worst',
  'fraud', 'lawsuit', 'negative', 'concern'
];
const RECOMMENDATION_WORDS = ['recommend', 'call', 'contact', 'choose', 'trust', 'best'];

function safeDefaults() {
  return {
    brand_mentioned: false,
    brand_recommended: false,
    brand_position: 'not_mentioned',
    competitor_mentioned: false,
    competitor_recommended: false,
    sentiment_signal: 'neutral',
    cited_urls: [],
    authority_figure_named: false
  };
}

function normalizeBool(v) { return v === true; }
function normalizeEnum(v, list, fallback) { return list.includes(v) ? v : fallback; }
function normalizeStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'string' && x.length > 0);
}

function normalizeFields(parsed) {
  const d = safeDefaults();
  return {
    brand_mentioned: normalizeBool(parsed.brand_mentioned),
    brand_recommended: normalizeBool(parsed.brand_recommended),
    brand_position: normalizeEnum(parsed.brand_position, ENUMS.brand_position, d.brand_position),
    competitor_mentioned: normalizeBool(parsed.competitor_mentioned),
    competitor_recommended: normalizeBool(parsed.competitor_recommended),
    sentiment_signal: normalizeEnum(parsed.sentiment_signal, ENUMS.sentiment_signal, d.sentiment_signal),
    cited_urls: normalizeStringArray(parsed.cited_urls),
    authority_figure_named: normalizeBool(parsed.authority_figure_named)
  };
}

function stripCodeFences(s) {
  return String(s || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractJson(s) {
  const t = stripCodeFences(s).trim();
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  // Last-resort: find the first '{' and the last '}' and try that span.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { /* nope */ }
  }
  return null;
}

async function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); }
  finally { clearTimeout(t); }
}

async function callHaiku(rawResponse, clientConfig) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY env var is not set');
  }
  const { system, messages } = parserPrompt.buildMessages(rawResponse, clientConfig);
  return withTimeout(async (signal) => {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': anthropicKey
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: HAIKU_MAX_TOKENS,
        system,
        messages
      }),
      signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Haiku proxy HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data && Array.isArray(data.content) && data.content[0] && data.content[0].text;
    if (!text) throw new Error('Haiku proxy returned empty content');
    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Haiku output was not valid JSON');
    }
    return parsed;
  }, HAIKU_TIMEOUT_MS);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function heuristicParse(rawResponse, clientConfig) {
  const fields = safeDefaults();
  const text = String(rawResponse || '');
  if (!text) return fields;

  const lower = text.toLowerCase();
  const brandName = String(clientConfig.business_name || '').toLowerCase();

  // brand_mentioned: business name present (case-insensitive)
  fields.brand_mentioned = brandName.length > 0 && lower.includes(brandName);

  // brand_recommended: any recommendation word within ±80 chars of a brand mention
  if (fields.brand_mentioned) {
    const re = new RegExp(escapeRegex(brandName), 'gi');
    let m;
    while ((m = re.exec(lower)) !== null) {
      const start = Math.max(0, m.index - 80);
      const end = Math.min(lower.length, m.index + brandName.length + 80);
      const window = lower.slice(start, end);
      if (RECOMMENDATION_WORDS.some(w => window.includes(w))) {
        fields.brand_recommended = true;
        break;
      }
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }

  // sentiment_signal: positive vs negative keyword counts
  const pos = POSITIVE_WORDS.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  const neg = NEGATIVE_WORDS.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  if (pos > 0 && neg > 0) fields.sentiment_signal = 'mixed';
  else if (pos > 0) fields.sentiment_signal = 'positive';
  else if (neg > 0) fields.sentiment_signal = 'negative';
  else fields.sentiment_signal = 'neutral';

  return fields;
}

/**
 * parseResponse(rawResponse, clientConfig, citations?)
 *
 *   citations — optional array of URL strings supplied directly by the
 *   platform (Perplexity returns a top-level `citations` array on the
 *   response object, separate from the prose). When provided and non-empty,
 *   it OVERRIDES whatever cited_urls the Haiku or heuristic path produced,
 *   because the platform's own citations are authoritative. When omitted or
 *   empty, the parser falls back to whatever URLs were extracted from the
 *   prose (Haiku) or to the safe default [] (heuristic). Wired in Session 3.
 */
async function parseResponse(rawResponse, clientConfig, citations) {
  let fields;
  let status;
  try {
    fields = normalizeFields(await callHaiku(rawResponse, clientConfig));
    status = 'llm';
  } catch (err) {
    console.error(`[parser] Haiku failed, using heuristic fallback: ${err.message}`);
    fields = heuristicParse(rawResponse, clientConfig);
    status = 'heuristic';
  }
  const platformCitations = normalizeStringArray(citations);
  if (platformCitations.length > 0) {
    fields.cited_urls = platformCitations;
  }
  return { ...fields, parser_status: status };
}

module.exports = { parseResponse, heuristicParse, normalizeFields };
