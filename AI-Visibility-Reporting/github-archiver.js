/**
 * github-archiver.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Writes a monthly raw JSON backup of every run to the repo at
 *   /archive/[YYYY-MM]/[client_id]_raw.json. This is the durable backup of
 *   all 12 raw platform responses + parsed fields + the calculated score for
 *   the month. GitHub is the backup; PDFs go to Drive; Sheets hold the
 *   structured rows. If a Sheet is ever lost, the archive can rebuild it.
 *   The file is committed via the Actions workflow's GITHUB_TOKEN.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (once per run, after sheet-writer.js succeeds and before
 *                 narrative-engine.js / pdf-builder.js fire).
 *
 * WHAT THIS FILE CALLS:
 *   - Node.js fs/promises  (writes the JSON file to /archive/[YYYY-MM]/).
 *   - git (via the Actions runner) to commit + push the archive file using
 *     GITHUB_TOKEN supplied by the workflow.
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
