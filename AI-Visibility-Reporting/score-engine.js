/**
 * score-engine.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Calculates the monthly AI Visibility Score (0–100) entirely in JavaScript.
 *   Claude NEVER calculates or interprets the score — architectural law.
 *
 *   Formula (every percentage uses the same denominator: count of runs where
 *   platform_available is true — runs that didn't return data are excluded):
 *     mention_rate         (40%) = brand_mentioned:true       / available × 100
 *     recommendation_rate  (35%) = brand_recommended:true     / available × 100
 *     sentiment_score      (25%) = sentiment_signal:positive  / available × 100
 *     ai_visibility_score  = mention × 0.40 + recommendation × 0.35
 *                          + sentiment × 0.25
 *   Rounded to 1 decimal place. Range 0–100.
 *
 *   If platforms_available is 0, ai_visibility_score is null and the result
 *   carries insufficient_data: true — never divide by zero, never crash.
 *
 *   Trend (vs. prior month, read by sheet-reader.js before the run):
 *     priorScore null  → trend_direction "baseline", score_delta null
 *     current > prior  → "UP",   score_delta = current − prior (positive)
 *     current < prior  → "DOWN", score_delta = current − prior (negative)
 *     equal            → "FLAT", score_delta = 0
 *
 *   Benchmark range by client_month (read from runs[0].client_month — every
 *   row is stamped with the same client_month by the runner):
 *     Months 1–3   { low: 10, high: 25, label: "Foundation building phase" }
 *     Months 4–6   { low: 20, high: 40, label: "Content compounding" }
 *     Months 7+    { low: 35, high: 60, label: "Recommendation territory" }
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (after all 13 platform runs have been parsed; the resulting
 *                 score object is passed to sheet-writer.js and on to
 *                 narrative-engine.js as a set of pre-calculated facts).
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure JS math. No network, no Claude, no external dependencies.
 *
 * STATUS: Implemented in Session 3.
 */

'use strict';

function round1(n) {
  return Math.round(n * 10) / 10;
}

function getBenchmark(clientMonth) {
  if (clientMonth <= 3) return { low: 10, high: 25, label: 'Foundation building phase' };
  if (clientMonth <= 6) return { low: 20, high: 40, label: 'Content compounding' };
  return { low: 35, high: 60, label: 'Recommendation territory' };
}

function calcTrend(currentScore, priorScore) {
  if (priorScore === null || priorScore === undefined || Number.isNaN(priorScore)) {
    return { trend_direction: 'baseline', score_delta: null };
  }
  if (currentScore === null) {
    return { trend_direction: 'baseline', score_delta: null };
  }
  const delta = round1(currentScore - priorScore);
  if (delta > 0) return { trend_direction: 'UP', score_delta: delta };
  if (delta < 0) return { trend_direction: 'DOWN', score_delta: delta };
  return { trend_direction: 'FLAT', score_delta: 0 };
}

function calculateScore(runs, priorScore) {
  const safeRuns = Array.isArray(runs) ? runs : [];
  const available = safeRuns.filter(r => r && r.platform_available === true);
  const platforms_available = available.length;

  const heuristic_fallback_count = safeRuns.filter(
    r => r && r.parser_status === 'heuristic'
  ).length;

  // client_month is stamped on every row by the runner — pull from the first
  // row that has it (placeholder rows include it too).
  const clientMonthRow = safeRuns.find(r => r && Number.isInteger(r.client_month));
  const clientMonth = clientMonthRow ? clientMonthRow.client_month : 1;
  const benchmark = getBenchmark(clientMonth);

  if (platforms_available === 0) {
    return {
      ai_visibility_score: null,
      mention_rate: 0,
      recommendation_rate: 0,
      sentiment_score: 0,
      score_delta: null,
      trend_direction: 'baseline',
      benchmark,
      insufficient_data: true,
      platforms_available,
      heuristic_fallback_count,
      prior_score: priorScore == null ? null : priorScore
    };
  }

  const mentioned = available.filter(r => r.brand_mentioned === true).length;
  const recommended = available.filter(r => r.brand_recommended === true).length;
  const positive = available.filter(r => r.sentiment_signal === 'positive').length;

  const mention_rate = round1((mentioned / platforms_available) * 100);
  const recommendation_rate = round1((recommended / platforms_available) * 100);
  const sentiment_score = round1((positive / platforms_available) * 100);

  const ai_visibility_score = round1(
    mention_rate * 0.40 + recommendation_rate * 0.35 + sentiment_score * 0.25
  );

  const { trend_direction, score_delta } = calcTrend(ai_visibility_score, priorScore);

  return {
    ai_visibility_score,
    mention_rate,
    recommendation_rate,
    sentiment_score,
    score_delta,
    trend_direction,
    benchmark,
    insufficient_data: false,
    platforms_available,
    heuristic_fallback_count,
    prior_score: priorScore == null ? null : priorScore
  };
}

module.exports = { calculateScore, getBenchmark };
