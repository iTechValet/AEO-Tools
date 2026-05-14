/**
 * score-engine.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Calculates the monthly AI Visibility Score (0–100) entirely in JavaScript.
 *   Claude NEVER calculates or interprets the score — architectural law.
 *
 *   Formula:
 *     Mention Rate    (40%) = brand_mentioned runs / brand-trackable runs × 100
 *     Recommendation  (35%) = brand_recommended runs / all runs × 100
 *     Sentiment Score (25%) = positive sentiment runs / all runs × 100
 *     Final Score = (mention_rate × 0.40) + (recommendation_rate × 0.35)
 *                 + (sentiment_score × 0.25)
 *
 *   Also computes:
 *     - score_delta = current score − prior month score (from Sheet history)
 *     - trend_direction = UP / DOWN / FLAT
 *     - benchmark_range based on client_month (Months 1–3: 10–25,
 *       Months 4–6: 20–40, Months 7–12: 35–60+)
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (after all 12 platform runs have been parsed; the resulting
 *                 score is then passed to sheet-writer.js and narrative-engine.js
 *                 as a pre-calculated fact).
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure JS math. No network, no Claude, no external dependencies.
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
