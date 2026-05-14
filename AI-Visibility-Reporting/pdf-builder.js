/**
 * pdf-builder.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Renders the final monthly client report as a PDF via Puppeteer.
 *   Populates templates/report.html with Claude's narrative text + the
 *   pre-calculated score, trend, and benchmark, then prints the page to PDF.
 *   Output filename: [client_id]_AI_Visibility_[YYYY-MM].pdf.
 *   Claude outputs text only — HTML structure and styling are owned by the
 *   template. Design reference: Brighton Gold April 2026 Report (4-page).
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (immediately after narrative-engine.js returns; the resulting
 *                 PDF is then handed to drive-writer.js for upload).
 *
 * WHAT THIS FILE CALLS:
 *   - templates/report.html  (HTML template populated at render time)
 *   - puppeteer              (headless Chromium → PDF)
 *   - Node.js fs/promises    (writes the PDF to a temp path on the runner)
 *
 * STATUS: Scaffold only — no logic yet. Implementation in Phase 1 build session.
 */
