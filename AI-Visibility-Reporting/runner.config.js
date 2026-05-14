/**
 * runner.config.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Platform-level configuration constants for the orchestrator.
 *   Holds API endpoint URLs, model identifiers (e.g., Perplexity sonar,
 *   Claude Haiku 4.5, Claude Sonnet 4.6), per-platform timeouts,
 *   and the exponential backoff retry schedule (30s → 60s → 120s → 240s → 480s,
 *   5 attempts total). Per-client values (sheet_id, drive folder, authority figure,
 *   etc.) live in clients/[client_id].json, NEVER here.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js   (loads platform endpoints + retry schedule at startup)
 *   - parser.js   (Claude Haiku model ID + endpoint)
 *   - narrative-engine.js  (Claude Sonnet model ID + endpoint)
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure constants module.
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
