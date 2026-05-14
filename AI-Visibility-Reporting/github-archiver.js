/**
 * github-archiver.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Writes a raw JSON backup of the full monthly run to the local filesystem
 *   at archive/[YYYY-MM]/[client_id]_raw.json. The YYYY-MM partition is
 *   derived FROM the reportPeriod string (never from new Date()) so a run
 *   that triggers across a UTC midnight boundary still lands in the right
 *   month. The GitHub Actions workflow handles the eventual git commit +
 *   push — this module performs only the filesystem write.
 *
 *   File contents:
 *     {
 *       client_id,
 *       report_period,
 *       archived_at,     // ISO timestamp at write time
 *       score_summary,   // full scoreResult from score-engine.js
 *       runs             // full 13-row array including raw_response,
 *                        // cited_urls, parsed fields, and Run 6
 *     }
 *
 *   Failure mode: log the error and return — never crash the pipeline over
 *   a backup failure. GitHub is the backup of last resort; the Sheet and
 *   the Drive PDF are the primary deliverables.
 *
 *   If archive/[YYYY-MM]/ does not exist, it is created (recursive mkdir).
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (step 5 of 8, after sheet-writer.js).
 *
 * WHAT THIS FILE CALLS:
 *   - Node.js built-in fs/promises and path modules. No network. No git.
 *
 * STATUS: Implemented in Session 3.
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');

const ARCHIVE_ROOT = path.join(__dirname, 'archive');

function deriveYearMonth(reportPeriod) {
  if (typeof reportPeriod !== 'string' || !/^\d{4}-\d{2}/.test(reportPeriod)) {
    throw new Error(`reportPeriod must be a "YYYY-MM" string, got: ${reportPeriod}`);
  }
  return reportPeriod.slice(0, 7);
}

async function archiveRun(clientId, reportPeriod, runs, scoreResult) {
  if (!clientId || typeof clientId !== 'string') {
    console.error('[github-archiver] Invalid clientId — skipping archive.');
    return { written: false, reason: 'invalid-client-id' };
  }
  let yearMonth;
  try {
    yearMonth = deriveYearMonth(reportPeriod);
  } catch (err) {
    console.error(`[github-archiver] ${err.message} — skipping archive.`);
    return { written: false, reason: 'invalid-report-period' };
  }

  const dir = path.join(ARCHIVE_ROOT, yearMonth);
  const file = path.join(dir, `${clientId}_raw.json`);

  const payload = {
    client_id: clientId,
    report_period: reportPeriod,
    archived_at: new Date().toISOString(),
    score_summary: scoreResult || null,
    runs: Array.isArray(runs) ? runs : []
  };

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return { written: true, path: file, bytes: Buffer.byteLength(JSON.stringify(payload)) };
  } catch (err) {
    console.error(`[github-archiver] Failed to write ${file}: ${err.message} — continuing.`);
    return { written: false, reason: 'fs-write-failed', error: err.message };
  }
}

module.exports = { archiveRun, deriveYearMonth, ARCHIVE_ROOT };
