/**
 * prompts/parser-prompt.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Owns the Claude Haiku parser prompt. Builds the { system, messages }
 *   payload for an Anthropic Messages API call (proxied through the
 *   Cloudflare Worker by parser.js). Encodes:
 *     - the strict-JSON system prompt (schema + enum lists + "no preamble"
 *       rules)
 *     - three few-shot examples encoded as alternating user/assistant turns
 *       in the messages array (Anthropic convention for in-context
 *       examples): one clear positive, one clear negative, one
 *       ambiguous/mixed
 *     - the per-call user prompt structure exactly as specified in the
 *       Session 2 build prompt
 *
 *   Schema (fields extracted per run):
 *     brand_mentioned          boolean
 *     brand_recommended        boolean
 *     brand_position           "first" | "second" | "third" | "other" | "not_mentioned"
 *     competitor_mentioned     boolean
 *     competitor_recommended   boolean
 *     sentiment_signal         "positive" | "neutral" | "negative" | "mixed"
 *     cited_urls               string[]
 *     authority_figure_named   boolean   (set true only for Run 3 in practice)
 *
 * WHAT CALLS THIS FILE:
 *   - parser.js  (calls buildMessages(rawResponse, clientConfig) once per
 *                 Haiku attempt; result is sent to the Cloudflare Worker
 *                 proxy as the Messages API body).
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure data module.
 *
 * STATUS: Implemented in Session 2.
 */

const ENUMS = {
  brand_position: ['first', 'second', 'third', 'other', 'not_mentioned'],
  sentiment_signal: ['positive', 'neutral', 'negative', 'mixed']
};

const SYSTEM_PROMPT = `You are a strict JSON extractor for AI platform responses.
Your only job is to extract structured signal fields from a single AI platform response about a business.

Hard rules:
- Output ONLY a single JSON object. No preamble. No explanation. No markdown fences. No code blocks.
- Every field below must be present. No omissions. No extra fields.
- Enum fields accept ONLY the listed values. If unsure, pick the closest valid value.
- Booleans must be true or false (not strings).
- "cited_urls" must be a list of explicit URLs that appear in the response. Empty list if none.

Schema:
{
  "brand_mentioned": boolean,
  "brand_recommended": boolean,
  "brand_position": "first" | "second" | "third" | "other" | "not_mentioned",
  "competitor_mentioned": boolean,
  "competitor_recommended": boolean,
  "sentiment_signal": "positive" | "neutral" | "negative" | "mixed",
  "cited_urls": string[],
  "authority_figure_named": boolean
}

Field guidance:
- brand_mentioned: the business name appears anywhere in the response (case-insensitive).
- brand_recommended: the response actively recommends the business — not merely lists it.
- brand_position: where the business is ranked if the response gives an ordered list;
  "not_mentioned" if absent; "other" if mentioned but no clear rank.
- competitor_mentioned / competitor_recommended: same logic, applied to the named competitor.
- sentiment_signal: overall tone toward the business. Use "mixed" only when clearly conflicting.
- cited_urls: any explicit URLs in the response. Do not invent or reconstruct URLs.
- authority_figure_named: true only when a specific named individual is associated with the
  business in the response. Default false unless clearly named.`;

function buildUserPrompt(rawResponse, clientConfig) {
  return `Extract the following fields from this AI platform response.
Business name being tracked: ${clientConfig.business_name}
Competitor being tracked: ${clientConfig.top_competitor}

Response to analyze:
${rawResponse}

Return ONLY this JSON object with no other text:
{
  "brand_mentioned": boolean,
  "brand_recommended": boolean,
  "brand_position": "first" | "second" | "third" | "other" | "not_mentioned",
  "competitor_mentioned": boolean,
  "competitor_recommended": boolean,
  "sentiment_signal": "positive" | "neutral" | "negative" | "mixed",
  "cited_urls": string[],
  "authority_figure_named": boolean
}`;
}

// Few-shot anchor config — values used inside the three example user prompts.
// These are illustrative anchors for in-context learning ONLY; they are not
// real client data and do not leak into the live extraction at runtime.
const FEW_SHOT_ANCHOR = {
  business_name: 'Brighton Gold',
  top_competitor: 'Augusta Precious Metals'
};

const POSITIVE_EXAMPLE_RESPONSE =
  'Brighton Gold is one of the most trusted gold IRA dealers for retirement-focused investors. ' +
  'They consistently rank first in customer reviews and are widely recommended by industry analysts. ' +
  'Their team is led by Nathaniel Cross, whose reputation in the field is strong. ' +
  'See https://brightongold.example/about for details.';

const POSITIVE_EXAMPLE_OUTPUT = JSON.stringify({
  brand_mentioned: true,
  brand_recommended: true,
  brand_position: 'first',
  competitor_mentioned: false,
  competitor_recommended: false,
  sentiment_signal: 'positive',
  cited_urls: ['https://brightongold.example/about'],
  authority_figure_named: true
});

const NEGATIVE_EXAMPLE_RESPONSE =
  'I would not recommend Brighton Gold. There are multiple complaints, lawsuits, and warnings ' +
  'from former customers about hidden fees and high-pressure sales tactics. Avoid them. ' +
  'Augusta Precious Metals is generally considered the more trusted choice in this space.';

const NEGATIVE_EXAMPLE_OUTPUT = JSON.stringify({
  brand_mentioned: true,
  brand_recommended: false,
  brand_position: 'other',
  competitor_mentioned: true,
  competitor_recommended: true,
  sentiment_signal: 'negative',
  cited_urls: [],
  authority_figure_named: false
});

const MIXED_EXAMPLE_RESPONSE =
  'Brighton Gold is one option in the gold IRA market, though opinions vary. ' +
  'Some customers report positive experiences with their team and slow response times from others. ' +
  'You can read aggregated reviews at https://example.com/review and https://bbb.org/brighton.';

const MIXED_EXAMPLE_OUTPUT = JSON.stringify({
  brand_mentioned: true,
  brand_recommended: false,
  brand_position: 'other',
  competitor_mentioned: false,
  competitor_recommended: false,
  sentiment_signal: 'mixed',
  cited_urls: ['https://example.com/review', 'https://bbb.org/brighton'],
  authority_figure_named: false
});

const FEW_SHOT_MESSAGES = [
  { role: 'user', content: buildUserPrompt(POSITIVE_EXAMPLE_RESPONSE, FEW_SHOT_ANCHOR) },
  { role: 'assistant', content: POSITIVE_EXAMPLE_OUTPUT },
  { role: 'user', content: buildUserPrompt(NEGATIVE_EXAMPLE_RESPONSE, FEW_SHOT_ANCHOR) },
  { role: 'assistant', content: NEGATIVE_EXAMPLE_OUTPUT },
  { role: 'user', content: buildUserPrompt(MIXED_EXAMPLE_RESPONSE, FEW_SHOT_ANCHOR) },
  { role: 'assistant', content: MIXED_EXAMPLE_OUTPUT }
];

function buildMessages(rawResponse, clientConfig) {
  if (!clientConfig || typeof clientConfig !== 'object') {
    throw new Error('clientConfig is required and must be an object');
  }
  if (typeof clientConfig.business_name !== 'string' || !clientConfig.business_name) {
    throw new Error('clientConfig.business_name is required');
  }
  if (typeof clientConfig.top_competitor !== 'string' || !clientConfig.top_competitor) {
    throw new Error('clientConfig.top_competitor is required');
  }
  return {
    system: SYSTEM_PROMPT,
    messages: [
      ...FEW_SHOT_MESSAGES,
      { role: 'user', content: buildUserPrompt(rawResponse, clientConfig) }
    ]
  };
}

module.exports = {
  SYSTEM_PROMPT,
  ENUMS,
  buildMessages,
  buildUserPrompt
};
