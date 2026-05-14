/**
 * narrative-engine.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Makes the single Claude Sonnet call that produces the monthly client
 *   narrative. Claude writes prose only — every number, date, trend, and
 *   benchmark arrives as a pre-calculated fact. Claude NEVER calculates the
 *   score, NEVER calculates dates, NEVER sees Run 6 (competitor intelligence,
 *   internal only).
 *
 *   Inputs assembled and passed to Claude Sonnet:
 *     1. Raw responses from the current month's 12 runs (labeled by run_id —
 *        Run 6 is stripped before the call)
 *     2. Full AI_Visibility_Summary history (all prior months, no cutoff)
 *     3. Current AI Visibility Score (pre-calculated by score-engine.js)
 *     4. Prior month score (read by sheet-reader.js)
 *     5. Trend direction — UP / DOWN / FLAT (pre-calculated by score-engine.js)
 *     6. Benchmark range for this client_month (pre-calculated)
 *     7. client_month integer
 *     8. run_date and report_period (facts, never computed by Claude)
 *     9. 4.3A content (fetched from Drive at runtime)
 *    10. 4.3B content (fetched from Drive at runtime)
 *
 *   Output: 7-section narrative — Executive Summary, What We Did This Month,
 *   What the AI Platforms Said, Where We Stand, What's Coming Next,
 *   On Our Radar, Closing (Gerek Allen, Founder — iTech Valet signature).
 *
 *   Voice rules enforced by the prompt (5th grade, casual, direct, warm,
 *   forbidden terms list, no competitor names by name, drift detection).
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (after score is calculated and Sheet writes succeed; output
 *                 is passed to pdf-builder.js for rendering).
 *
 * WHAT THIS FILE CALLS:
 *   - prompts/narrative-prompt.js  (system + user prompt construction)
 *   - runner.config.js             (Claude Sonnet model ID + endpoint)
 *   - Anthropic Claude API (Sonnet) — single structured call
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
