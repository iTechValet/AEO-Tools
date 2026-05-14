/**
 * sheet-writer.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Writes the run's data to the client's Google Sheet after all 13 platform
 *   runs complete and score-engine.js has produced the summary. Two tabs,
 *   both targeted by NAME (never by position): AI_Visibility_Raw (13 rows
 *   per monthly run) and AI_Visibility_Summary (1 row per monthly run).
 *
 *   Auth: Google service account JSON parsed at runtime from
 *   process.env.GOOGLE_SERVICE_ACCOUNT_JSON. Never hardcoded, never read
 *   from the client config.
 *
 *   Tab existence: if either tab is missing, the writer throws a clear
 *   error — it does NOT auto-create the tab. The master Sheet template is
 *   the only acceptable origin for client sheets.
 *
 *   Duplicate-month protection: before any writes, the writer reads the
 *   existing AI_Visibility_Raw tab and looks for rows whose report_period
 *   AND client_id match this run. If any exist, BOTH writes are skipped
 *   (Raw and Summary) and a clear warning is logged — never write duplicate
 *   month data.
 *
 *   Row formatting rules (per build plan):
 *     - cited_urls serialized as comma-separated string
 *     - raw_response truncated to 50,000 characters if longer
 *     - Booleans written as the literal strings "TRUE" / "FALSE" (the Sheet
 *       renders them as native booleans because valueInputOption is
 *       USER_ENTERED), not 1/0
 *     - Run 6 rows ARE written to AI_Visibility_Raw (internal data only;
 *       Run 6 is stripped only when narrative-engine.js builds Claude's
 *       context — not at the Sheet boundary)
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (step 4 of 8, after score-engine.js produces the summary).
 *
 * WHAT THIS FILE CALLS:
 *   - googleapis  (Sheets v4, service-account auth).
 *
 * STATUS: Implemented in Session 3.
 */

'use strict';

const { google } = require('googleapis');

const RAW_TAB = 'AI_Visibility_Raw';
const SUMMARY_TAB = 'AI_Visibility_Summary';
const RAW_RANGE = `${RAW_TAB}!A:S`;       // 19 columns
const SUMMARY_RANGE = `${SUMMARY_TAB}!A:Q`; // 17 columns
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const MAX_RAW_RESPONSE_CHARS = 50000;

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

async function listTabTitles(sheets, sheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets(properties(title))'
  });
  return (meta.data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
}

function requireTab(titles, tabName, sheetId) {
  if (!titles.includes(tabName)) {
    throw new Error(
      `Tab "${tabName}" not found in sheet ${sheetId}. Ensure this sheet was created from the master template.`
    );
  }
}

function bool(v) {
  return v === true ? 'TRUE' : 'FALSE';
}

function joinUrls(urls) {
  if (!Array.isArray(urls)) return '';
  return urls.filter(u => typeof u === 'string' && u.length > 0).join(', ');
}

function truncate(s, limit) {
  if (typeof s !== 'string') return '';
  return s.length > limit ? s.slice(0, limit) : s;
}

function rawRow(run) {
  return [
    run.run_id,
    run.client_id,
    run.platform,
    run.signal,
    run.run_date,
    run.report_period,
    run.client_month,
    bool(run.brand_mentioned),
    bool(run.brand_recommended),
    run.brand_position,
    bool(run.competitor_mentioned),
    bool(run.competitor_recommended),
    run.sentiment_signal,
    joinUrls(run.cited_urls),
    bool(run.authority_figure_named),
    truncate(run.raw_response, MAX_RAW_RESPONSE_CHARS),
    run.response_length,
    bool(run.platform_available),
    run.parser_status
  ];
}

function summaryRow(clientConfig, scoreResult, reportPeriod, runDate, clientMonth) {
  const benchmark = scoreResult.benchmark || { low: '', high: '', label: '' };
  const heuristicWarning = (scoreResult.heuristic_fallback_count || 0) >= 4;
  return [
    reportPeriod,
    clientConfig.client_id,
    clientMonth,
    runDate,
    scoreResult.ai_visibility_score === null || scoreResult.ai_visibility_score === undefined
      ? ''
      : scoreResult.ai_visibility_score,
    scoreResult.prior_score === null || scoreResult.prior_score === undefined
      ? ''
      : scoreResult.prior_score,
    scoreResult.score_delta === null || scoreResult.score_delta === undefined
      ? ''
      : scoreResult.score_delta,
    scoreResult.trend_direction || '',
    benchmark.low,
    benchmark.high,
    benchmark.label,
    scoreResult.mention_rate,
    scoreResult.recommendation_rate,
    scoreResult.sentiment_score,
    scoreResult.platforms_available,
    scoreResult.heuristic_fallback_count,
    bool(heuristicWarning)
  ];
}

async function hasDuplicate(sheets, sheetId, reportPeriod, clientId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: RAW_RANGE
  });
  const values = res.data.values || [];
  if (values.length <= 1) return false;
  // Column A = run_id, Column B = client_id, Column F = report_period.
  // values[0] is the header row; data starts at index 1.
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    if (row[1] === clientId && row[5] === reportPeriod) return true;
  }
  return false;
}

async function appendRows(sheets, sheetId, range, rows) {
  return sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
}

async function writeToSheet(clientConfig, runs, scoreResult, reportPeriod, runDate, clientMonth) {
  if (!clientConfig || !clientConfig.sheet_id) {
    throw new Error('clientConfig.sheet_id is required');
  }
  const sheetId = clientConfig.sheet_id;
  const clientId = clientConfig.client_id;

  const sheets = await getSheetsClient();

  const titles = await listTabTitles(sheets, sheetId);
  requireTab(titles, RAW_TAB, sheetId);
  requireTab(titles, SUMMARY_TAB, sheetId);

  // Duplicate-month protection: skip both writes if Raw already has rows
  // for this client + report_period.
  const duplicate = await hasDuplicate(sheets, sheetId, reportPeriod, clientId);
  if (duplicate) {
    console.warn(
      `[sheet-writer] Duplicate month detected for client_id=${clientId} report_period=${reportPeriod} ` +
      `— rows already exist in ${RAW_TAB}. Skipping both writes.`
    );
    return { skipped: true, reason: 'duplicate-month', rawAppended: 0, summaryAppended: 0 };
  }

  const rawRows = runs.map(rawRow);
  await appendRows(sheets, sheetId, RAW_RANGE, rawRows);

  const summary = [summaryRow(clientConfig, scoreResult, reportPeriod, runDate, clientMonth)];
  await appendRows(sheets, sheetId, SUMMARY_RANGE, summary);

  return {
    skipped: false,
    rawAppended: rawRows.length,
    summaryAppended: summary.length
  };
}

module.exports = {
  writeToSheet,
  // exported for unit testing
  rawRow,
  summaryRow,
  RAW_TAB,
  SUMMARY_TAB,
  MAX_RAW_RESPONSE_CHARS
};
