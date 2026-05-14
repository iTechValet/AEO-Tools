/**
 * drive-writer.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Uploads the rendered monthly PDF into the client's Google Drive
 *   "Monthly Reports" folder. Folder ID comes from clients/[client_id].json
 *   field `drive_reports_folder_id`. Uses the same Google service account
 *   credentials as sheet-writer.js. The PDF is the final deliverable for
 *   Phase 1 — the VA downloads it from Drive and sends it to the client.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (final step before run completion; pdf-builder.js hands the
 *                 PDF buffer/path to this module).
 *
 * WHAT THIS FILE CALLS:
 *   - Google Drive API (service account credentials from
 *     GOOGLE_SERVICE_ACCOUNT_JSON in GitHub Secrets).
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
