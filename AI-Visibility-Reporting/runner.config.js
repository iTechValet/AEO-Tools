/**
 * runner.config.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Platform-level configuration constants for the orchestrator.
 *   Holds API endpoint URLs, model identifiers (Perplexity uses `sonar`
 *   specifically — non-negotiable), the per-request timeout, and the
 *   exponential backoff retry schedule (30s → 60s → 120s → 240s → 480s,
 *   5 attempts total). Per-client values (sheet_id, drive folder,
 *   authority figure, etc.) live in clients/[client_id].json, NEVER here.
 *   `secretKey` is the NAME of the env var holding the key — actual key
 *   values are read from process.env inside runner.js at runtime, never
 *   stored in config or in the client JSON.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js   (loads platform endpoints + retry schedule at startup)
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure constants module.
 *
 * STATUS: Implemented in Session 2.
 */

module.exports = {
  platforms: {
    openai: {
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      secretKey: 'OPENAI_API_KEY'   // GitHub Secret name — never hardcode the value
    },
    gemini: {
      model: 'gemini-1.5-pro',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent',
      secretKey: 'GEMINI_API_KEY'
    },
    perplexity: {
      model: 'sonar',               // sonar model specifically — non-negotiable
      endpoint: 'https://api.perplexity.ai/chat/completions',
      secretKey: 'PERPLEXITY_API_KEY'
    },
    grok: {
      model: 'grok-3',
      endpoint: 'https://api.x.ai/v1/chat/completions',
      secretKey: 'GROK_API_KEY'
    }
  },
  retry: {
    maxAttempts: 5,
    backoff: [30000, 60000, 120000, 240000, 480000]  // exponential — ms between attempts
  },
  timeoutMs: 30000   // per request timeout
};
