/**
 * parser.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Extracts the structured signal fields from each raw platform response.
 *   Primary path: Claude Haiku (claude-haiku-4-5-20251001) with strict JSON
 *   schema enforcement, three few-shot examples (clear positive, clear negative,
 *   ambiguous/mixed), and explicit enum lists for every enum field.
 *   Fallback: heuristic regex covers the three score-critical fields only —
 *   brand_mentioned, brand_recommended, sentiment_signal. When the fallback
 *   fires, parser_status is set to "heuristic" so sheet-writer.js can mark the row.
 *   If 4+ runs in a month go heuristic, the run still completes (threshold rule).
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (one parser call per platform run, immediately after the raw
 *                 response returns from ChatGPT / Gemini / Perplexity / Grok).
 *
 * WHAT THIS FILE CALLS:
 *   - prompts/parser-prompt.js  (Claude Haiku system + few-shot prompt)
 *   - runner.config.js          (Haiku model ID + Claude API endpoint)
 *   - Anthropic Claude API (Haiku) for the primary parser path
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
