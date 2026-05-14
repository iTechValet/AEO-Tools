/**
 * sheet-reader.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Reads the client's Google Sheet BEFORE the run starts. Three exported
 *   functions:
 *
 *   1. readSheetHistory(clientConfig)
 *      Reads the AI_Visibility_Summary tab and returns:
 *        { priorScore, summaryHistory }
 *      priorScore = last appended row's ai_visibility_score, parsed as
 *      Number (null if blank or non-numeric). summaryHistory is the full
 *      chronological array of row objects.
 *
 *   2. readAEOInventory(clientConfig)   (added Session 4)
 *      Reads the AEO_Inventory tab (the AEO Article Creation Tool writes
 *      this tab; this tool reads it). Resolves columns BY NAME from the
 *      header row — never by index. Returns:
 *        {
 *          totalLiveNodes,
 *          currentCluster: { name, number, articleCount, strategicObjective },
 *          nextCluster:    { name, number, strategicObjective }
 *        }
 *      "Current cluster" = the cluster with the highest CLUSTER_NUMBER
 *      that has at least one row where STATUS = "Live". articleCount on
 *      currentCluster = count of all rows in that cluster regardless of
 *      status. "Next cluster" = the cluster with the lowest CLUSTER_NUMBER
 *      that has no Live rows and a non-blank CLUSTER_NUMBER. STRATEGIC_
 *      OBJECTIVE is optional — older sheets may not have the column, in
 *      which case the field reads null.
 *
 *   3. readCitationHistory(clientConfig)  (added Session 5)
 *      Reads the AI_Visibility_Raw tab in full and returns URLs that have
 *      been cited in TWO OR MORE distinct months. Used by the analysis
 *      engine to detect citation echoes (a URL AI cites once is noise; a
 *      URL AI cites repeatedly across months is a locked-in citation).
 *      Resolves columns BY NAME via RAW_COLUMN_ALIASES (cited_urls,
 *      report_period, platform). Returns:
 *        [
 *          { url, months_cited: ["May 2026", "June 2026", ...],
 *            times_cited: integer, platforms: ["gemini", "perplexity"] }
 *        ]
 *      Filters out empty strings + dedupes per-row. months_cited is
 *      human-readable ("May 2026") via the same labelizer the runner uses.
 *
 *   Auth: Google service account JSON parsed at runtime from
 *   process.env.GOOGLE_SERVICE_ACCOUNT_JSON. Never hardcoded, never read
 *   from the client config.
 *
 *   Tab target: "AI_Visibility_Summary" and "AEO_Inventory", by NAME —
 *   never by position.
 *
 *   Failure modes (never crash, always return safe defaults):
 *     - Tab missing or empty                       → defaults
 *     - GOOGLE_SERVICE_ACCOUNT_JSON missing         → defaults + logged error
 *     - Network / auth error                       → defaults + logged error
 *
 *   Row layout for AI_Visibility_Summary (matches sheet-writer.js):
 *     report_period | client_id | client_month | run_date | ai_visibility_score
 *     | prior_score | score_delta | trend_direction | benchmark_low
 *     | benchmark_high | benchmark_label | mention_rate | recommendation_rate
 *     | sentiment_score | platforms_available | heuristic_fallback_count
 *     | heuristic_warning
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (once per run, before the 13 platform calls begin).
 *
 * WHAT THIS FILE CALLS:
 *   - googleapis  (Sheets v4, service-account auth).
 *
 * STATUS: Implemented in Session 3 (readSheetHistory) + Session 4
 *   (readAEOInventory) + Session 5 (readCitationHistory).
 */

'use strict';

const { google } = require('googleapis');

const SUMMARY_TAB = 'AI_Visibility_Summary';
const SUMMARY_RANGE = `${SUMMARY_TAB}!A:Q`;       // 17 columns
const RAW_TAB = 'AI_Visibility_Raw';
const RAW_RANGE = `${RAW_TAB}!A:S`;               // 19 columns
const AEO_INVENTORY_TAB = 'AEO_Inventory';
const AEO_INVENTORY_RANGE = `${AEO_INVENTORY_TAB}!A:ZZ`; // read everything; column count varies per client
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const AEO_COLUMN_ALIASES = {
  status: ['STATUS', 'Status', 'status'],
  cluster_number: ['CLUSTER_NUMBER', 'Cluster_Number', 'Cluster Number', 'cluster_number'],
  cluster_name: ['CLUSTER_NAME', 'Cluster_Name', 'Cluster Name', 'cluster_name', 'CLUSTER', 'Cluster'],
  strategic_objective: ['STRATEGIC_OBJECTIVE', 'Strategic_Objective', 'Strategic Objective', 'strategic_objective']
};

const RAW_COLUMN_ALIASES = {
  cited_urls: ['cited_urls', 'CITED_URLS', 'Cited Urls', 'Cited URLs'],
  report_period: ['report_period', 'REPORT_PERIOD', 'Report Period'],
  platform: ['platform', 'PLATFORM', 'Platform']
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
function periodToLabel(period) {
  // "YYYY-MM" → "Month YYYY". Falls through to the raw string if anything is off.
  if (typeof period !== 'string') return String(period || '');
  const m = period.match(/^(\d{4})-(\d{2})/);
  if (!m) return period;
  const idx = parseInt(m[2], 10) - 1;
  if (idx < 0 || idx > 11) return period;
  return `${MONTH_NAMES[idx]} ${m[1]}`;
}

const HEADER_KEYS = [
  'report_period', 'client_id', 'client_month', 'run_date',
  'ai_visibility_score', 'prior_score', 'score_delta', 'trend_direction',
  'benchmark_low', 'benchmark_high', 'benchmark_label',
  'mention_rate', 'recommendation_rate', 'sentiment_score',
  'platforms_available', 'heuristic_fallback_count', 'heuristic_warning'
];

function getServiceAccountCreds() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`);
  }
}

async function getSheetsClient() {
  const creds = getServiceAccountCreds();
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

function rowToObject(row) {
  const obj = {};
  for (let i = 0; i < HEADER_KEYS.length; i++) {
    obj[HEADER_KEYS[i]] = row[i] !== undefined ? row[i] : '';
  }
  return obj;
}

function parseScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function readSheetHistory(clientConfig) {
  const empty = { priorScore: null, summaryHistory: [] };
  if (!clientConfig || !clientConfig.sheet_id) {
    console.error('[sheet-reader] Missing clientConfig.sheet_id — returning empty history.');
    return empty;
  }
  const sheetId = clientConfig.sheet_id;

  let sheets;
  try {
    sheets = await getSheetsClient();
  } catch (err) {
    console.error(`[sheet-reader] Auth failed: ${err.message} — returning empty history.`);
    return empty;
  }

  // Confirm the tab exists (by name) before attempting to read.
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets(properties(title))'
    });
    const titles = (meta.data.sheets || []).map(s => s.properties && s.properties.title);
    if (!titles.includes(SUMMARY_TAB)) {
      console.error(`[sheet-reader] Tab "${SUMMARY_TAB}" not found in sheet ${sheetId} — returning empty history.`);
      return empty;
    }
  } catch (err) {
    console.error(`[sheet-reader] spreadsheets.get failed: ${err.message} — returning empty history.`);
    return empty;
  }

  let values;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: SUMMARY_RANGE
    });
    values = res.data.values || [];
  } catch (err) {
    console.error(`[sheet-reader] values.get failed: ${err.message} — returning empty history.`);
    return empty;
  }

  // Drop the header row (row 1) — anything below is data.
  if (values.length <= 1) return empty;
  const dataRows = values.slice(1).filter(row => Array.isArray(row) && row.length > 0);
  if (dataRows.length === 0) return empty;

  const summaryHistory = dataRows.map(rowToObject);
  const lastRow = summaryHistory[summaryHistory.length - 1];
  const priorScore = parseScore(lastRow.ai_visibility_score);

  return { priorScore, summaryHistory };
}

// --- AEO_Inventory reader (Session 4) -------------------------------------

function normalizeHeader(s) {
  return String(s || '').trim();
}

function buildColumnIndex(headerRow) {
  const idx = {};
  for (const [logicalKey, aliases] of Object.entries(AEO_COLUMN_ALIASES)) {
    for (let i = 0; i < headerRow.length; i++) {
      const h = normalizeHeader(headerRow[i]);
      if (aliases.indexOf(h) !== -1) {
        idx[logicalKey] = i;
        break;
      }
    }
  }
  return idx;
}

function cellAt(row, idx) {
  if (idx == null) return '';
  const v = row[idx];
  return v === undefined ? '' : v;
}

function parseClusterNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function emptyAEOInventory() {
  return {
    totalLiveNodes: 0,
    currentCluster: { name: null, number: null, articleCount: 0, strategicObjective: null },
    nextCluster: { name: null, number: null, strategicObjective: null }
  };
}

async function readAEOInventory(clientConfig) {
  const empty = emptyAEOInventory();
  if (!clientConfig || !clientConfig.sheet_id) {
    console.error('[sheet-reader] Missing clientConfig.sheet_id for AEO read — returning empty inventory.');
    return empty;
  }
  const sheetId = clientConfig.sheet_id;

  let sheets;
  try {
    sheets = await getSheetsClient();
  } catch (err) {
    console.error(`[sheet-reader] AEO auth failed: ${err.message} — returning empty inventory.`);
    return empty;
  }

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets(properties(title))'
    });
    const titles = (meta.data.sheets || []).map(s => s.properties && s.properties.title);
    if (!titles.includes(AEO_INVENTORY_TAB)) {
      console.error(`[sheet-reader] Tab "${AEO_INVENTORY_TAB}" not found in sheet ${sheetId} — returning empty inventory.`);
      return empty;
    }
  } catch (err) {
    console.error(`[sheet-reader] AEO spreadsheets.get failed: ${err.message} — returning empty inventory.`);
    return empty;
  }

  let values;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: AEO_INVENTORY_RANGE
    });
    values = res.data.values || [];
  } catch (err) {
    console.error(`[sheet-reader] AEO values.get failed: ${err.message} — returning empty inventory.`);
    return empty;
  }

  if (values.length <= 1) return empty;

  const header = values[0] || [];
  const col = buildColumnIndex(header);

  if (col.status === undefined || col.cluster_number === undefined) {
    console.error(
      `[sheet-reader] AEO_Inventory missing required columns ` +
      `(found status=${col.status}, cluster_number=${col.cluster_number}). ` +
      `Returning empty inventory.`
    );
    return empty;
  }

  const dataRows = values.slice(1).filter(r => Array.isArray(r) && r.length > 0);

  // Group rows by cluster number.
  const clusters = new Map();   // clusterNumber → { number, name, strategicObjective, rows: [], hasLive }

  for (const row of dataRows) {
    const num = parseClusterNumber(cellAt(row, col.cluster_number));
    if (num === null) continue;
    let bucket = clusters.get(num);
    if (!bucket) {
      bucket = {
        number: num,
        name: null,
        strategicObjective: null,
        rows: [],
        hasLive: false
      };
      clusters.set(num, bucket);
    }
    bucket.rows.push(row);

    const status = String(cellAt(row, col.status) || '').trim().toLowerCase();
    if (status === 'live') bucket.hasLive = true;

    // Stamp the cluster's name + strategic objective from any row that has them.
    // If different rows disagree, last-write-wins — the inventory column should
    // be consistent within a cluster in practice.
    if (col.cluster_name !== undefined) {
      const n = String(cellAt(row, col.cluster_name) || '').trim();
      if (n) bucket.name = n;
    }
    if (col.strategic_objective !== undefined) {
      const s = String(cellAt(row, col.strategic_objective) || '').trim();
      if (s) bucket.strategicObjective = s;
    }
  }

  const totalLiveNodes = dataRows.reduce((n, row) => {
    const status = String(cellAt(row, col.status) || '').trim().toLowerCase();
    return n + (status === 'live' ? 1 : 0);
  }, 0);

  const sortedNumbers = Array.from(clusters.keys()).sort((a, b) => a - b);

  let currentCluster = { name: null, number: null, articleCount: 0, strategicObjective: null };
  for (let i = sortedNumbers.length - 1; i >= 0; i--) {
    const bucket = clusters.get(sortedNumbers[i]);
    if (bucket.hasLive) {
      currentCluster = {
        name: bucket.name,
        number: bucket.number,
        articleCount: bucket.rows.length,
        strategicObjective: bucket.strategicObjective
      };
      break;
    }
  }

  let nextCluster = { name: null, number: null, strategicObjective: null };
  for (const num of sortedNumbers) {
    const bucket = clusters.get(num);
    if (!bucket.hasLive) {
      nextCluster = {
        name: bucket.name,
        number: bucket.number,
        strategicObjective: bucket.strategicObjective
      };
      break;
    }
  }

  return { totalLiveNodes, currentCluster, nextCluster };
}

// --- Citation history reader (Session 5) ----------------------------------

function buildRawColumnIndex(headerRow) {
  const idx = {};
  for (const [logicalKey, aliases] of Object.entries(RAW_COLUMN_ALIASES)) {
    for (let i = 0; i < headerRow.length; i++) {
      const h = normalizeHeader(headerRow[i]);
      if (aliases.indexOf(h) !== -1) {
        idx[logicalKey] = i;
        break;
      }
    }
  }
  return idx;
}

function splitCitedUrls(raw) {
  if (raw === undefined || raw === null) return [];
  // sheet-writer.js writes cited_urls as ", "-joined. Be forgiving on
  // whitespace and accept either commas or semicolons.
  return String(raw)
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && /^https?:\/\//i.test(s));
}

async function readCitationHistory(clientConfig) {
  if (!clientConfig || !clientConfig.sheet_id) {
    console.error('[sheet-reader] Missing clientConfig.sheet_id for citation history — returning [].');
    return [];
  }
  const sheetId = clientConfig.sheet_id;

  let sheets;
  try {
    sheets = await getSheetsClient();
  } catch (err) {
    console.error(`[sheet-reader] Citation history auth failed: ${err.message} — returning [].`);
    return [];
  }

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'sheets(properties(title))'
    });
    const titles = (meta.data.sheets || []).map(s => s.properties && s.properties.title);
    if (!titles.includes(RAW_TAB)) {
      console.error(`[sheet-reader] Tab "${RAW_TAB}" not found in sheet ${sheetId} — returning [].`);
      return [];
    }
  } catch (err) {
    console.error(`[sheet-reader] Citation history spreadsheets.get failed: ${err.message} — returning [].`);
    return [];
  }

  let values;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: RAW_RANGE
    });
    values = res.data.values || [];
  } catch (err) {
    console.error(`[sheet-reader] Citation history values.get failed: ${err.message} — returning [].`);
    return [];
  }

  if (values.length <= 1) return [];

  const header = values[0] || [];
  const col = buildRawColumnIndex(header);
  if (col.cited_urls === undefined || col.report_period === undefined) {
    console.error(
      `[sheet-reader] AI_Visibility_Raw missing required columns ` +
      `(cited_urls=${col.cited_urls}, report_period=${col.report_period}) — returning [].`
    );
    return [];
  }

  const map = new Map(); // url → { months: Set<period>, platforms: Set<platform>, total: int }
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const period = String(row[col.report_period] || '').trim();
    const platform = col.platform !== undefined ? String(row[col.platform] || '').trim() : '';
    const urls = splitCitedUrls(row[col.cited_urls]);
    const uniqueUrls = Array.from(new Set(urls));
    for (const url of uniqueUrls) {
      let bucket = map.get(url);
      if (!bucket) {
        bucket = { months: new Set(), platforms: new Set(), total: 0 };
        map.set(url, bucket);
      }
      if (period) bucket.months.add(period);
      if (platform) bucket.platforms.add(platform);
      bucket.total += 1;
    }
  }

  const result = [];
  for (const [url, b] of map.entries()) {
    if (b.months.size < 2) continue;
    const months = Array.from(b.months).sort();
    result.push({
      url,
      months_cited: months.map(periodToLabel),
      times_cited: b.total,
      platforms: Array.from(b.platforms).sort()
    });
  }
  // Sort by times_cited desc then url asc for stable ordering.
  result.sort((a, b) => (b.times_cited - a.times_cited) || a.url.localeCompare(b.url));
  return result;
}

module.exports = {
  readSheetHistory,
  readAEOInventory,
  readCitationHistory,
  SUMMARY_TAB,
  AEO_INVENTORY_TAB,
  RAW_TAB,
  HEADER_KEYS,
  AEO_COLUMN_ALIASES,
  RAW_COLUMN_ALIASES,
  // exported for unit testing
  periodToLabel,
  splitCitedUrls
};
