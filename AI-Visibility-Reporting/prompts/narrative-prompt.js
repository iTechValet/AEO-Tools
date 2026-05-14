/**
 * prompts/narrative-prompt.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Owns the Claude Sonnet narrative prompt. Encodes the 7-section report
 *   structure (Executive Summary, What We Did This Month, What the AI
 *   Platforms Said, Where We Stand, What's Coming Next, On Our Radar,
 *   Closing) and the voice rules from 4.3A + the 5.1 Master Prompt:
 *
 *     - 5th grade reading level. Casual, direct, warm. Never corporate.
 *     - Short paragraphs. One idea per paragraph. No sentence over 20 words.
 *     - Active voice only.
 *     - Forbidden terms: deployed, clusters, intent layers, pillars, semantic,
 *       entity, trunk, branch, schema, backlink, keyword, SEO, Tier 1/2/3.
 *     - No competitor names by name — "the top name in your market" only.
 *     - Drift Detection: replace {business_name} with a competitor; if it
 *       still reads accurate, rewrite.
 *
 *   Run 6 (competitor intelligence) is stripped before assembly — never
 *   passed to Claude. All numbers, dates, and benchmarks arrive as
 *   pre-calculated facts.
 *
 * WHAT CALLS THIS FILE:
 *   - narrative-engine.js  (assembles the full message + context for Sonnet).
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure data module (prompt strings + section schema).
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
