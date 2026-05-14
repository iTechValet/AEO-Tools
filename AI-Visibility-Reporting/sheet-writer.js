/**
 * sheet-writer.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Writes results back to the client's Google Sheet at the end of a run.
 *   Two writes per monthly run, both targeted by tab NAME (never by position):
 *
 *     1. AI_Visibility_Raw      — appends 12 rows (one per platform run).
 *        Columns: run_id, client_id, platform, signal, run_date, report_period,
 *                 client_month, brand_mentioned, brand_recommended,
 *                 brand_position, competitor_mentioned, competitor_recommended,
 *                 sentiment_signal, cited_urls, authority_figure_named,
 *                 raw_response, response_length, platform_available, parser_status.
 *
 *     2. AI_Visibility_Summary  — appends 1 row for the month.
 *        Columns: report_period, client_month, run_date, ai_visibility_score,
 *                 prior_score, score_delta, trend_direction, benchmark_range,
 *                 mention_rate, recommendation_rate, sentiment_score,
 *                 platforms_available, heuristic_fallback_count.
 *
 *   If heuristic_fallback_count >= 4, the Summary row is marked with ⚠️ and a
 *   maintenance alert is surfaced — but the run still completes.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (after score-engine.js produces the final score and trend).
 *
 * WHAT THIS FILE CALLS:
 *   - Google Sheets API (service account credentials from
 *     GOOGLE_SERVICE_ACCOUNT_JSON in GitHub Secrets).
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
