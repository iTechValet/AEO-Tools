/**
 * sheet-reader.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Reads the client's Google Sheet BEFORE the run starts. Pulls the full
 *   AI_Visibility_Summary tab history (all prior months, no arbitrary cutoff)
 *   so score-engine.js can compute the trend arrow vs. last month and so
 *   narrative-engine.js receives the full history as context for Claude Sonnet.
 *   Targets tabs by NAME (`AI_Visibility_Summary`), never by position.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (once per run, immediately after loading the client config
 *                 and before the 12 platform calls begin).
 *
 * WHAT THIS FILE CALLS:
 *   - Google Sheets API (via the service account credentials stored in
 *     GitHub Secrets as GOOGLE_SERVICE_ACCOUNT_JSON).
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
