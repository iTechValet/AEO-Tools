/**
 * prompts/parser-prompt.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Owns the Claude Haiku parser prompt. Strict JSON schema enforcement,
 *   three few-shot examples (clear positive, clear negative, ambiguous/mixed),
 *   and explicit enum lists for every enum field. Zero conversational filler
 *   permitted in output. JSON mode enforced.
 *
 *   Fields extracted (per run):
 *     brand_mentioned: boolean
 *     brand_recommended: boolean
 *     brand_position: "first" | "second" | "third" | "other" | "not_mentioned"
 *     competitor_mentioned: boolean
 *     competitor_recommended: boolean
 *     sentiment_signal: "positive" | "neutral" | "negative" | "mixed"
 *     cited_urls: string[]
 *     authority_figure_named: boolean   (Run 3 only)
 *     parser_status: "llm" | "heuristic"
 *
 * WHAT CALLS THIS FILE:
 *   - parser.js  (loads the system + few-shot prompt for every Haiku call).
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure data module (prompt strings + schema).
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
