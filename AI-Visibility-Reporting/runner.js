/**
 * runner.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Main Node.js orchestrator. Runs inside a GitHub Actions workflow.
 *   Accepts a --client=[client_id] argument, loads that client's JSON config,
 *   then drives the full monthly run end-to-end:
 *     fetch 4.3A + 4.3B from Drive → read prior Sheet history →
 *     execute 12 platform runs serially (ChatGPT, Gemini, Perplexity/sonar, Grok)
 *     with exponential backoff retry → parse each response via parser.js →
 *     calculate score via score-engine.js → write AI_Visibility_Raw +
 *     AI_Visibility_Summary tabs → archive raw JSON to /archive/ →
 *     generate narrative via narrative-engine.js → build PDF via pdf-builder.js →
 *     upload PDF to client's Drive folder via drive-writer.js.
 *
 * WHAT CALLS THIS FILE:
 *   - GitHub Actions workflow (.github/workflows/) triggered by either
 *     workflow_dispatch (manual) or repository_dispatch (fired by the Cloudflare
 *     Worker /trigger-report endpoint when the VA hits "Run Report" in index.html).
 *
 * WHAT THIS FILE CALLS:
 *   - runner.config.js          (platform endpoints, retry settings, timeouts)
 *   - clients/[client_id].json  (per-client config loaded at runtime)
 *   - prompts/prompt-templates.js  (getPrompt(runId, clientConfig))
 *   - parser.js                 (Claude Haiku parser + heuristic fallback)
 *   - score-engine.js           (composite AI Visibility Score)
 *   - sheet-reader.js           (prior AI_Visibility_Summary history)
 *   - sheet-writer.js           (AI_Visibility_Raw + AI_Visibility_Summary writes)
 *   - github-archiver.js        (raw JSON archive per run)
 *   - narrative-engine.js       (Claude Sonnet narrative call)
 *   - pdf-builder.js            (Puppeteer HTML → PDF)
 *   - drive-writer.js           (PDF upload to client Drive folder)
 *   - Google Drive API (for 4.3A + 4.3B fetch — same key pattern as AEO tool)
 *   - OpenAI, Gemini, Perplexity (sonar), xAI Grok APIs (12 platform runs)
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
