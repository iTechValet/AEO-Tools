/**
 * sheet-reader.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Reads the client's Google Sheet BEFORE the run starts. Returns the prior
 *   month's AI Visibility Score (so score-engine.js can compute the trend
 *   arrow) plus the full AI_Visibility_Summary history (so narrative-engine.js
 *   can pass the full history to Claude Sonnet as context — never an
 *   arbitrary cutoff).
 *
 *   Auth: Google service account JSON parsed at runtime from
 *   process.env.GOOGLE_SERVICE_ACCOUNT_JSON. Never hardcoded, never read
 *   from the client config.
 *
 *   Tab target: "AI_Visibility_Summary", by NAME — never by position.
 *
 *   Failure modes (never crash, always return defaults):
 *     - Tab missing or empty                       → { priorScore: null, summaryHistory: [] }
 *     - GOOGLE_SERVICE_ACCOUNT_JSON missing         → { priorScore: null, summaryHistory: [] } + logged error
 *     - Network / auth error                       → { priorScore: null, summaryHistory: [] } + logged error
 *
 *   Row layout (matches sheet-writer.js, set by the master Sheet template):
 *     report_period | client_id | client_month | run_date | ai_visibility_score
 *     | prior_score | score_delta | trend_direction | benchmark_low
 *     | benchmark_high | benchmark_label | mention_rate | recommendation_rate
 *     | sentiment_score | platforms_available | heuristic_fallback_count
 *     | heuristic_warning
 *
 *   "Prior" is the LAST appended row (the runner appends one summary row per
 *   monthly run, in chronological order). If that row's ai_visibility_score
 *   is blank or non-numeric (e.g. an insufficient_data run), priorScore is
 *   null and trend_direction will read "baseline" in score-engine.js.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (once per run, before the 13 platform calls begin).
 *
 * WHAT THIS FILE CALLS:
 *   - googleapis  (Sheets v4, service-account auth).
 *
 * STATUS: Implemented in Session 3.
 */

'use strict';

const { google } = require('googleapis');

const SUMMARY_TAB = 'AI_Visibility_Summary';
const SUMMARY_RANGE = `${SUMMARY_TAB}!A:Q`;       // 17 columns
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

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

module.exports = { readSheetHistory, SUMMARY_TAB, HEADER_KEYS };
