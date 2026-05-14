/**
 * narrative-engine.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Makes the single Claude Sonnet call that produces the monthly client
 *   narrative. Claude writes prose only — every number, date, trend, and
 *   benchmark arrives as a pre-calculated fact in the context object
 *   (assembled by runner.js). Claude NEVER calculates the score, NEVER
 *   calculates dates, NEVER sees Run 6 (the runner strips it before
 *   building the context).
 *
 *   Auth: process.env.ANTHROPIC_API_KEY (GitHub Secret). The narrative
 *   call goes DIRECT to api.anthropic.com — NOT through the Cloudflare
 *   Worker. The Worker exists for browser-side use (the AEO tool); the
 *   reporting runner runs server-side in GitHub Actions and there is no
 *   browser to protect, so the direct path is simpler and avoids the
 *   Worker round trip.
 *
 *   Output: the raw text returned by Sonnet, with the 8 section names as
 *   literal headers ("OPENING", "WHAT WE PUBLISHED THIS MONTH", etc.).
 *   pdf-builder.js splits on those exact strings to populate the HTML
 *   template.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (step 6 of 8, after sheet-writer.js + github-archiver.js;
 *                 result is passed to pdf-builder.js).
 *
 * WHAT THIS FILE CALLS:
 *   - prompts/narrative-prompt.js  (buildNarrativePrompt(context))
 *   - Anthropic Messages API (https://api.anthropic.com/v1/messages)
 *
 * STATUS: Implemented in Session 4.
 */

'use strict';

const { buildNarrativePrompt } = require('./prompts/narrative-prompt.js');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SONNET_MODEL = 'claude-sonnet-4-20250514';
const SONNET_MAX_TOKENS = 4000;
const SONNET_TEMPERATURE = 0.7;
const SONNET_TIMEOUT_MS = 90000;

async function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); }
  finally { clearTimeout(t); }
}

async function generateNarrative(context) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('[narrative-engine] ANTHROPIC_API_KEY env var is not set — returning null.');
    return null;
  }

  let payload;
  try {
    payload = buildNarrativePrompt(context);
  } catch (err) {
    console.error(`[narrative-engine] buildNarrativePrompt failed: ${err.message} — returning null.`);
    return null;
  }

  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': anthropicKey
        },
        body: JSON.stringify({
          model: SONNET_MODEL,
          max_tokens: SONNET_MAX_TOKENS,
          temperature: SONNET_TEMPERATURE,
          system: payload.system,
          messages: payload.messages
        }),
        signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const text = data && Array.isArray(data.content)
        ? data.content
            .filter(b => b && b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text)
            .join('')
        : '';
      if (!text || !text.trim()) {
        throw new Error('Anthropic response had no text content');
      }
      return text;
    }, SONNET_TIMEOUT_MS);
  } catch (err) {
    console.error(`[narrative-engine] generateNarrative failed: ${err.message} — returning null.`);
    return null;
  }
}

module.exports = {
  generateNarrative,
  SONNET_MODEL,
  SONNET_MAX_TOKENS,
  SONNET_TEMPERATURE
};
