#!/usr/bin/env node
/**
 * runner.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Main Node.js orchestrator. Runs inside a GitHub Actions workflow.
 *   Accepts a --client=[client_id] argument, loads that client's JSON config,
 *   then drives the full monthly run end-to-end:
 *     read prior AI_Visibility_Summary history → execute 13 platform runs
 *     SERIALLY (ChatGPT, Gemini, Perplexity/sonar, Grok) with exponential
 *     backoff retry (5 attempts: 30s → 60s → 120s → 240s → 480s) →
 *     parse each response via parser.js (Haiku + heuristic fallback) →
 *     calculate composite score via score-engine.js → write
 *     AI_Visibility_Raw + AI_Visibility_Summary tabs → archive raw JSON →
 *     generate narrative via narrative-engine.js (Run 6 stripped) →
 *     build PDF via pdf-builder.js → upload PDF to client's Drive folder
 *     via drive-writer.js.
 *
 *   Hard rules enforced here:
 *     - Serial execution only. No Promise.all. No parallelism.
 *     - API keys come from process.env only — never from config files,
 *       never hardcoded. ANTHROPIC_API_KEY is now used by parser.js
 *       (sent as x-api-key to the Cloudflare Worker proxy — Session 4
 *       fix) and by narrative-engine.js (sent direct to api.anthropic.com).
 *     - Per-step failures are caught + logged + the pipeline continues.
 *     - 5-attempt retry with exponential backoff per platform call;
 *       on full failure the run is recorded with platform_available:false
 *       and the pipeline continues — never crashes.
 *     - Threshold check: if 4+ runs in this month went heuristic in the
 *       parser, the run still completes but a heuristic_warning flag is
 *       set on the summary row.
 *     - Run 6 is INTERNAL ONLY — stripped from the dataset passed to
 *       narrative-engine.js (and therefore never reaches Claude Sonnet).
 *
 * WHAT CALLS THIS FILE:
 *   - GitHub Actions workflow triggered by workflow_dispatch (manual) or
 *     repository_dispatch (fired by the Cloudflare Worker /trigger-report
 *     endpoint when the VA hits "Run Report" in index.html).
 *
 * WHAT THIS FILE CALLS:
 *   - runner.config.js              (platform endpoints, retry, timeout)
 *   - clients/[client_id].json      (per-client config loaded at runtime)
 *   - prompts/prompt-templates.js   (getPrompt(runId, clientConfig))
 *   - parser.js                     (parseResponse — Haiku + heuristic)
 *   - score-engine.js               (composite AI Visibility Score)
 *   - sheet-reader.js               (Summary history + AEO inventory + citations)
 *   - sheet-writer.js               (Raw + Summary writes)
 *   - github-archiver.js            (raw JSON archive per run)
 *   - analysis-engine.js            (Claude Sonnet Strategic Brief, temp 0.3)
 *   - narrative-engine.js           (Claude Sonnet narrative, temp 0.7)
 *   - pdf-builder.js                (Puppeteer HTML → PDF)
 *   - drive-writer.js               (PDF upload to client Drive folder)
 *   - OpenAI, Gemini, Perplexity (sonar), xAI Grok APIs — direct calls
 *     here, serially, with the 5-attempt exponential-backoff retry loop.
 *
 * STATUS: Updated in Session 5. Pipeline is now feature-complete end-to-end
 *   from --client argument to PDF on Google Drive. Re-numbered to the
 *   13-step architecture:
 *     Step  1  Load client config
 *     Step  2  Fetch 4.3A + 4.3B from Google Drive
 *     Step  3  readSheetHistory + readAEOInventory + readCitationHistory
 *     Step  4  Fire 13 platform runs (serial, exponential-backoff retry)
 *     Step  5  Parse each response (fused per-run with Step 4)
 *     Step  6  calculateScore
 *     Step  7  writeToSheet  (Raw + Summary)
 *     Step  8  archiveRun    (archive/[YYYY-MM]/[client_id]_raw.json)
 *     Step  9  generateAnalysis  → Strategic Brief (Sonnet @ temp 0.3)
 *     Step 10  generateNarrative → 8-section prose (Sonnet @ temp 0.7,
 *              Run 6 stripped from the writer's view)
 *     Step 11  buildPDF      → outputs/<client_id>_AI_Visibility_<YYYY-MM>.pdf
 *     Step 12  uploadPDF     → client Drive "Monthly Reports" folder
 *     Step 13  Completion log line (client, period, score, PDF, link, elapsed)
 *   Two-call architecture for Claude: analysis runs FIRST and produces a
 *   structured Strategic Brief; narrative reads the brief and writes the
 *   client-facing prose. Analysis sees ALL 13 runs (including Run 6);
 *   narrative only sees the 12 client-eligible runs.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./runner.config.js');
const { getPrompt } = require('./prompts/prompt-templates.js');
const parser = require('./parser.js');
const scoreEngine = require('./score-engine.js');
const sheetReader = require('./sheet-reader.js');
const sheetWriter = require('./sheet-writer.js');
const archiver = require('./github-archiver.js');
const analysisEngine = require('./analysis-engine.js');
const narrativeEngine = require('./narrative-engine.js');
const pdfBuilder = require('./pdf-builder.js');
const driveWriter = require('./drive-writer.js');

// --- Run inventory --------------------------------------------------------

const RUN_IDS = ['1A', '1B', '1C', '1D', '2', '3', '4A', '4B', '5A', '5B', '6', '7A', '7B'];

const RUN_TO_PLATFORM = {
  '1A': 'openai',     '1B': 'gemini',     '1C': 'perplexity', '1D': 'grok',
  '2':  'openai',
  '3':  'gemini',     '4A': 'openai',     '4B': 'perplexity',
  '5A': 'openai',     '5B': 'grok',
  '6':  'openai',     '7A': 'openai',     '7B': 'perplexity'
};

const RUN_TO_SIGNAL = {
  '1A': '1', '1B': '1', '1C': '1', '1D': '1', '5A': '1', '5B': '1',
  '2':  '1+3',
  '3':  '2', '4A': '2', '4B': '2',
  '6':  '3', '7A': '3', '7B': '3'
};

// --- Logging --------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
function logErr(label, err) {
  const detail = err && (err.stack || err.message || String(err));
  console.error(`[${new Date().toISOString()}] ERROR ${label}: ${detail}`);
}

// --- CLI + config loading -------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.match(/^--client=(.+)$/);
    if (eq) return eq[1];
    if (a === '--client' && i + 1 < args.length) return args[i + 1];
  }
  return null;
}

function loadClientConfig(clientId) {
  const p = path.join(__dirname, 'clients', `${clientId}.json`);
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

// --- Date helpers (Claude never calculates dates — JS owns this) ---------

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function reportPeriod(runDate) {
  return runDate.slice(0, 7);
}
function reportPeriodLabel(runDate) {
  // Human-readable form for the narrative + PDF cover (e.g. "May 2026").
  // The sheet write / archive path still use the YYYY-MM internal form.
  const yyyy = runDate.slice(0, 4);
  const mm = parseInt(runDate.slice(5, 7), 10);
  if (!Number.isFinite(mm) || mm < 1 || mm > 12) return runDate;
  return `${MONTH_NAMES[mm - 1]} ${yyyy}`;
}
function calcClientMonth(contractStart, runDate) {
  const a = new Date(`${contractStart}T00:00:00Z`);
  const b = new Date(`${runDate}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}
function progressionPhaseFor(clientMonth) {
  if (clientMonth <= 3) return 'Foundation';
  if (clientMonth <= 6) return 'Building';
  return 'Authority';
}

// --- Drive doc fetch (4.3A + 4.3B) ---------------------------------------
// Lightweight inline helper. Uses the same GOOGLE_SERVICE_ACCOUNT_JSON
// service account as sheet-reader/sheet-writer. Google Docs export to
// text/plain; binary text files use files.get?alt=media. Returns the
// document body as a single string. Empty string on any failure or when
// the docId is missing/PLACEHOLDER — the narrative prompt has a graceful
// fallback for either case.
async function fetchDriveDocText(docId) {
  if (!docId || typeof docId !== 'string' || docId.startsWith('PLACEHOLDER')) {
    return '';
  }
  let google;
  try {
    google = require('googleapis').google;
  } catch (err) {
    console.error(`[runner] googleapis unavailable for Drive doc fetch: ${err.message}`);
    return '';
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error('[runner] GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping Drive doc fetch.');
    return '';
  }
  let creds;
  try { creds = JSON.parse(raw); }
  catch (err) {
    console.error(`[runner] GOOGLE_SERVICE_ACCOUNT_JSON parse error: ${err.message}`);
    return '';
  }
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    const client = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: client });

    // First check the mimeType so we know whether to export or read media.
    const meta = await drive.files.get({
      fileId: docId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true
    });
    const mimeType = meta.data && meta.data.mimeType;

    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await drive.files.export(
        { fileId: docId, mimeType: 'text/plain' },
        { responseType: 'text' }
      );
      return typeof res.data === 'string' ? res.data : String(res.data || '');
    }
    // Plain text / markdown / etc.
    const res = await drive.files.get(
      { fileId: docId, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );
    return typeof res.data === 'string' ? res.data : String(res.data || '');
  } catch (err) {
    console.error(`[runner] Drive doc fetch failed for ${docId}: ${err.message}`);
    return '';
  }
}

// --- API key preflight ----------------------------------------------------

function preflightKeys() {
  const available = new Set();
  for (const [platformId, p] of Object.entries(config.platforms)) {
    const val = process.env[p.secretKey];
    if (typeof val === 'string' && val.length > 0) {
      available.add(platformId);
      log(`Preflight: ${platformId} key present (${p.secretKey})`);
    } else {
      log(`Preflight: ${platformId} key MISSING (${p.secretKey}) — runs on this platform will be marked unavailable.`);
    }
  }
  return available;
}

// --- Platform call --------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); }
  finally { clearTimeout(t); }
}

function extractCitationsArray(data) {
  // Perplexity (sonar) returns citations as a top-level array of URL strings
  // separate from the message content. Defensive: accept either the
  // top-level field or one nested under choices[0] (some sonar variants).
  const fromTop = Array.isArray(data && data.citations) ? data.citations : null;
  if (fromTop) return fromTop.filter(u => typeof u === 'string' && u.length > 0);
  const fromChoice = data && data.choices && data.choices[0] && Array.isArray(data.choices[0].citations)
    ? data.choices[0].citations
    : null;
  if (fromChoice) return fromChoice.filter(u => typeof u === 'string' && u.length > 0);
  return [];
}

async function callPlatform(platformId, prompt, timeoutMs) {
  const platform = config.platforms[platformId];
  if (!platform) throw new Error(`Unknown platform: ${platformId}`);
  const apiKey = process.env[platform.secretKey];
  if (!apiKey) throw new Error(`Missing env var ${platform.secretKey}`);

  return withTimeout(async (signal) => {
    if (platformId === 'gemini') {
      const url = `${platform.endpoint}?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const text =
        data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) throw new Error('gemini returned empty response');
      return { text, citations: [] };
    }

    // openai-compatible (OpenAI, Perplexity sonar, xAI Grok)
    const res = await fetch(platform.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: platform.model,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${platformId} HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text =
      data && data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    if (!text) throw new Error(`${platformId} returned empty response`);
    // Perplexity is the only platform that ships a top-level citations array
    // today; for openai/grok this returns [] and parser.js falls back to URL
    // extraction from the prose.
    const citations = platformId === 'perplexity' ? extractCitationsArray(data) : [];
    return { text, citations };
  }, timeoutMs);
}

async function callWithRetry(runId, platformId, prompt) {
  const { maxAttempts, backoff } = config.retry;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      const platformTimeout = config.platforms[platformId].timeoutMs || config.timeoutMs;
      const result = await callPlatform(platformId, prompt, platformTimeout);
      const citationsLog = result.citations.length > 0 ? `, ${result.citations.length} citations` : '';
      log(`  ✓ ${runId} ${platformId} attempt ${attempt}/${maxAttempts} succeeded in ${Date.now() - t0}ms (${result.text.length} chars${citationsLog})`);
      return result;
    } catch (err) {
      lastErr = err;
      log(`  ✗ ${runId} ${platformId} attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        const wait = backoff[attempt - 1];
        log(`  ⏳ backing off ${Math.round(wait / 1000)}s before attempt ${attempt + 1}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr || new Error(`${platformId} failed all ${maxAttempts} attempts`);
}

// --- Row helpers ----------------------------------------------------------

function placeholderRow(runId, platform, signal, ctx, parserStatus) {
  return {
    run_id: runId,
    client_id: ctx.clientConfig.client_id,
    platform,
    signal,
    run_date: ctx.runDate,
    report_period: ctx.reportPeriod,
    client_month: ctx.clientMonth,
    brand_mentioned: false,
    brand_recommended: false,
    brand_position: 'not_mentioned',
    competitor_mentioned: false,
    competitor_recommended: false,
    sentiment_signal: 'neutral',
    cited_urls: [],
    authority_figure_named: false,
    raw_response: '',
    response_length: 0,
    platform_available: false,
    parser_status: parserStatus
  };
}

function builtRow(runId, platform, signal, ctx, rawResponse, parsed) {
  return {
    run_id: runId,
    client_id: ctx.clientConfig.client_id,
    platform,
    signal,
    run_date: ctx.runDate,
    report_period: ctx.reportPeriod,
    client_month: ctx.clientMonth,
    brand_mentioned: parsed.brand_mentioned,
    brand_recommended: parsed.brand_recommended,
    brand_position: parsed.brand_position,
    competitor_mentioned: parsed.competitor_mentioned,
    competitor_recommended: parsed.competitor_recommended,
    sentiment_signal: parsed.sentiment_signal,
    cited_urls: parsed.cited_urls,
    authority_figure_named: parsed.authority_figure_named,
    raw_response: rawResponse,
    response_length: rawResponse.length,
    platform_available: true,
    parser_status: parsed.parser_status
  };
}

// --- Pipeline -------------------------------------------------------------

async function main() {
  const clientId = parseArgs(process.argv);
  if (!clientId) {
    console.error('Usage: node runner.js --client=<client_id>');
    process.exit(1);
  }

  log(`Starting run for client: ${clientId}`);
  let clientConfig;
  try {
    clientConfig = loadClientConfig(clientId);
  } catch (err) {
    logErr('loadClientConfig', err);
    process.exit(1);
  }

  const runDate = todayISO();
  const period = reportPeriod(runDate);                  // internal "YYYY-MM"
  const periodLabel = reportPeriodLabel(runDate);        // human-readable "May 2026"
  const clientMonth = calcClientMonth(clientConfig.contract_start, runDate);
  const progressionPhase = progressionPhaseFor(clientMonth);
  const isFirstMonth = clientMonth === 1;
  const isQuarterlyMonth = clientMonth % 3 === 0;
  const napCleanupComplete = clientConfig.napCleanupComplete === true;
  log(`run_date=${runDate} report_period=${period} (${periodLabel}) client_month=${clientMonth} phase=${progressionPhase} quarterly=${isQuarterlyMonth} nap_clean=${napCleanupComplete}`);
  // ctx is the local row-builder context (compact). The full narrative
  // context is assembled later (step 6) and includes everything below.
  const ctx = { clientConfig, runDate, reportPeriod: period, clientMonth };

  const availablePlatforms = preflightKeys();
  const t0 = Date.now();

  // Step 1: client config loaded (above). Just announce.
  log('Step 1/13: Client config loaded');

  // Step 2: fetch 4.3A + 4.3B from Google Drive
  log('Step 2/13: Fetching 4.3A + 4.3B from Google Drive');
  let doc43A = '';
  let doc43B = '';
  try {
    doc43A = await fetchDriveDocText(clientConfig.doc_43A_id);
    log(`  4.3A: ${doc43A.length} chars${doc43A.length === 0 ? ' (missing or placeholder)' : ''}`);
  } catch (err) {
    logErr('fetchDriveDocText(4.3A)', err);
  }
  try {
    doc43B = await fetchDriveDocText(clientConfig.doc_43B_id);
    log(`  4.3B: ${doc43B.length} chars${doc43B.length === 0 ? ' (missing or placeholder)' : ''}`);
  } catch (err) {
    logErr('fetchDriveDocText(4.3B)', err);
  }

  // Step 3: read prior Summary history + AEO inventory + citation history
  log('Step 3/13: Reading Sheet history + AEO inventory + citation history');
  let priorScore = null;
  let summaryHistory = [];
  try {
    const history = (await sheetReader.readSheetHistory(clientConfig)) || {};
    priorScore = history.priorScore == null ? null : history.priorScore;
    summaryHistory = Array.isArray(history.summaryHistory) ? history.summaryHistory : [];
    log(`  summary history: ${summaryHistory.length} prior monthly rows; priorScore=${priorScore === null ? 'null' : priorScore}`);
  } catch (err) {
    logErr('sheet-reader.readSheetHistory', err);
  }

  let aeoData = {
    totalLiveNodes: 0,
    currentCluster: { name: null, number: null, articleCount: 0, strategicObjective: null },
    nextCluster: { name: null, number: null, strategicObjective: null }
  };
  try {
    aeoData = (await sheetReader.readAEOInventory(clientConfig)) || aeoData;
    log(`  AEO inventory: total_live=${aeoData.totalLiveNodes} current=${aeoData.currentCluster.name || '(none)'} next=${aeoData.nextCluster.name || '(none)'}`);
  } catch (err) {
    logErr('sheet-reader.readAEOInventory', err);
  }

  let repeatedCitations = [];
  try {
    repeatedCitations = (await sheetReader.readCitationHistory(clientConfig)) || [];
    log(`  citation history: ${repeatedCitations.length} URL${repeatedCitations.length === 1 ? '' : 's'} cited in 2+ months`);
  } catch (err) {
    logErr('sheet-reader.readCitationHistory', err);
  }

  // Step 4 + Step 5: 13 platform runs (serial) + per-run parse
  log(`Step 4/13: Executing ${RUN_IDS.length} platform runs serially (Step 5 parses each response inline)`);
  const rows = [];
  for (const runId of RUN_IDS) {
    const platform = RUN_TO_PLATFORM[runId];
    const signal = RUN_TO_SIGNAL[runId];
    log(`Run ${runId} (${platform}, signal ${signal}) START`);

    // Skip platforms without an env key — straight to placeholder row.
    if (!availablePlatforms.has(platform)) {
      log(`  ⊘ ${runId} ${platform} skipped — no API key in env`);
      rows.push(placeholderRow(runId, platform, signal, ctx, 'n/a'));
      log(`Run ${runId} END (unavailable)`);
      continue;
    }

    let prompt;
    try {
      prompt = getPrompt(runId, clientConfig);
    } catch (err) {
      logErr(`prompt assembly ${runId}`, err);
      rows.push(placeholderRow(runId, platform, signal, ctx, 'n/a'));
      log(`Run ${runId} END (prompt error)`);
      continue;
    }

    let rawResponse;
    let citations = [];
    try {
      const result = await callWithRetry(runId, platform, prompt);
      rawResponse = result.text;
      citations = result.citations;
    } catch (err) {
      logErr(`Run ${runId} all attempts failed`, err);
      rows.push(placeholderRow(runId, platform, signal, ctx, 'n/a'));
      log(`Run ${runId} END (unavailable after retries)`);
      continue;
    }

    let parsed;
    try {
      parsed = await parser.parseResponse(rawResponse, clientConfig, citations);
    } catch (err) {
      logErr(`parser ${runId}`, err);
      const fallback = { ...parser.heuristicParse(rawResponse, clientConfig), parser_status: 'heuristic' };
      if (citations.length > 0) fallback.cited_urls = citations;
      parsed = fallback;
    }
    log(`Run ${runId} parsed (parser_status=${parsed.parser_status}${citations.length > 0 ? `, citations:${citations.length}` : ''})`);
    rows.push(builtRow(runId, platform, signal, ctx, rawResponse, parsed));
    log(`Run ${runId} END (ok)`);
  }

  // Threshold check — 4+ heuristic runs flips a warning bit, but never stops the run.
  const heuristicCount = rows.filter(r => r.parser_status === 'heuristic').length;
  const heuristicWarning = heuristicCount >= 4;
  log(`Parser heuristic count: ${heuristicCount}/${rows.length}${heuristicWarning ? ' ⚠ THRESHOLD EXCEEDED' : ''}`);

  // Step 6: score (pure JS — score-engine.js owns the formula)
  log('Step 6/13: Calculating AI Visibility Score');
  let scoreResult;
  try {
    scoreResult = scoreEngine.calculateScore(rows, priorScore);
  } catch (err) {
    logErr('score-engine.calculateScore', err);
    scoreResult = {
      ai_visibility_score: null,
      mention_rate: 0, recommendation_rate: 0, sentiment_score: 0,
      score_delta: null, trend_direction: 'baseline',
      benchmark: { low: '', high: '', label: '' },
      insufficient_data: true,
      platforms_available: 0,
      heuristic_fallback_count: heuristicCount,
      prior_score: priorScore
    };
  }
  log(`  score=${scoreResult.ai_visibility_score} trend=${scoreResult.trend_direction} delta=${scoreResult.score_delta} platforms_available=${scoreResult.platforms_available} heuristic=${scoreResult.heuristic_fallback_count}`);

  // Step 7: sheet write (Raw + Summary, by tab name, duplicate-month protected)
  log('Step 7/13: Writing Sheet rows (AI_Visibility_Raw + AI_Visibility_Summary)');
  try {
    const result = await sheetWriter.writeToSheet(
      clientConfig, rows, scoreResult, period, runDate, clientMonth
    );
    if (result && result.skipped) {
      log(`  sheet-writer skipped (${result.reason})`);
    } else if (result) {
      log(`  sheet-writer wrote ${result.rawAppended} Raw rows + ${result.summaryAppended} Summary row`);
    }
  } catch (err) {
    logErr('sheet-writer.writeToSheet', err);
  }

  // Step 8: archive raw JSON to /archive/[YYYY-MM]/[client_id]_raw.json
  log('Step 8/13: Archiving raw JSON');
  try {
    const archiveResult = await archiver.archiveRun(
      clientConfig.client_id, period, rows, scoreResult
    );
    if (archiveResult && archiveResult.written) {
      log(`  archive written: ${archiveResult.path} (${archiveResult.bytes} bytes)`);
    } else if (archiveResult) {
      log(`  archive skipped: ${archiveResult.reason}`);
    }
  } catch (err) {
    logErr('github-archiver.archiveRun', err);
  }

  // --- Assemble the analysis + narrative + PDF context ---
  // Run 6 is INTERNAL ONLY — strip it before the narrative call so the
  // client-facing prose never references it. The analysis engine still
  // sees Run 6 (the strategic-brief author needs every data point) but
  // narrative-engine.js receives the stripped list via narrativeContext.
  const narrativeRuns = rows.filter(r => r.run_id !== '6');
  const analysisContext = {
    clientConfig,
    doc43A,
    doc43B,
    runDate,
    period,                      // internal "YYYY-MM"
    reportPeriod: periodLabel,   // human-readable "May 2026"
    clientMonth,
    scoreResult,
    summaryHistory,
    repeatedCitations,
    runs: rows,                  // analysis sees ALL 13 runs incl. Run 6
    aeoData,
    napCleanupComplete,
    progressionPhase,
    isFirstMonth,
    isQuarterlyMonth
  };

  // Step 9: analysis — Strategic Brief from Claude Sonnet @ temp 0.3.
  log('Step 9/13: Generating Strategic Brief (analysis engine)');
  let analysisResult = null;
  try {
    analysisResult = await analysisEngine.generateAnalysis(analysisContext);
    if (analysisResult) {
      log(`  analysis OK — wins=${(analysisResult.wins || []).length} concerns=${(analysisResult.concerns || []).length} tone=${analysisResult.narrative_directives && analysisResult.narrative_directives.recommended_tone}`);
    } else {
      log('  analysis-engine returned null — narrative will be written from raw data');
    }
  } catch (err) {
    logErr('analysis-engine.generateAnalysis', err);
  }

  const narrativeContext = {
    ...analysisContext,
    runs: narrativeRuns,         // Run 6 stripped from the writer's view
    analysisResult
  };

  // Step 10: narrative — Claude Sonnet @ temp 0.7, direct to api.anthropic.com.
  log('Step 10/13: Generating Claude Sonnet narrative (Run 6 excluded)');
  let narrative = null;
  try {
    narrative = await narrativeEngine.generateNarrative(narrativeContext);
    if (narrative) {
      log(`  narrative generated: ${narrative.length} chars`);
    } else {
      log('  narrative-engine returned null — PDF will use empty section bodies');
    }
  } catch (err) {
    logErr('narrative-engine.generateNarrative', err);
  }

  // Step 11: PDF — Puppeteer renders templates/report.html populated with
  // narrative sections + cover metadata.
  log('Step 11/13: Building PDF');
  let pdfResult = null;
  try {
    pdfResult = await pdfBuilder.buildPDF(narrative, narrativeContext);
    if (pdfResult) {
      log(`  PDF written: ${pdfResult.path} (${pdfResult.bytes != null ? pdfResult.bytes + ' bytes' : 'size unknown'})`);
    } else {
      log('  pdf-builder returned null — no PDF produced this run');
    }
  } catch (err) {
    logErr('pdf-builder.buildPDF', err);
  }

  // Step 12: Drive upload — drive-writer.uploadPDF(pdfPath, clientConfig).
  log('Step 12/13: Uploading PDF to client Drive folder');
  let driveResult = null;
  try {
    if (pdfResult && pdfResult.path) {
      driveResult = await driveWriter.uploadPDF(pdfResult.path, clientConfig);
      if (driveResult) {
        log(`  Drive ${driveResult.updated ? 'replaced existing file' : 'created new file'}: id=${driveResult.fileId} link=${driveResult.webViewLink || 'N/A'}`);
      } else {
        log('  drive-writer returned null — see prior log lines for the reason');
      }
    } else {
      log('  No PDF on disk — skipping Drive upload');
    }
  } catch (err) {
    logErr('drive-writer.uploadPDF', err);
  }

  // Step 13: completion log — single line with all the things the operator
  // wants to see at a glance.
  const elapsedMs = Date.now() - t0;
  const driveLink = driveResult && driveResult.webViewLink ? driveResult.webViewLink : 'N/A';
  log(
    `Step 13/13: COMPLETE | client=${clientConfig.client_id} ` +
    `period=${periodLabel} score=${scoreResult.ai_visibility_score} ` +
    `pdf=${(pdfResult && pdfResult.path) || 'N/A'} drive=${driveLink} ` +
    `elapsed=${Math.round(elapsedMs / 1000)}s`
  );
}

if (require.main === module) {
  main().catch(err => {
    logErr('FATAL', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  RUN_IDS,
  RUN_TO_PLATFORM,
  RUN_TO_SIGNAL,
  // exported for unit testing
  parseArgs,
  calcClientMonth,
  reportPeriod,
  reportPeriodLabel,
  progressionPhaseFor,
  todayISO,
  fetchDriveDocText
};
