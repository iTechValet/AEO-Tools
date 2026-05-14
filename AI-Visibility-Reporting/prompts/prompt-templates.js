/**
 * prompts/prompt-templates.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Owns the 13 platform-run prompt templates for the monthly AI Visibility
 *   audit. All variables are injected at runtime from a clientConfig object
 *   passed as a parameter — zero hardcoded client data anywhere in this file.
 *
 *   Three signals, thirteen run IDs:
 *
 *     Signal 1 — "Are they being recommended?"  (the money signal)
 *       1A  ChatGPT
 *       1B  Gemini       (same prompt, fresh session)
 *       1C  Perplexity   (sonar, same prompt, fresh session)
 *       1D  Grok         (same prompt, fresh session)
 *       5A  ChatGPT      (intent-stage variant)
 *       5B  Grok         (intent-stage variant, same prompt as 5A)
 *
 *     Signal 1 + 3 — Head-to-head
 *       2   ChatGPT
 *
 *     Signal 2 — "How are they being described?"
 *       3   Gemini
 *       4A  ChatGPT
 *       4B  Perplexity   (review-aggregator-leaning — different signal)
 *
 *     Signal 3 — "What is blocking the recommendation?"
 *       6   ChatGPT   ⚠️ INTERNAL ONLY — never included in client deliverables.
 *                       Never passed to narrative-engine.js / Claude Sonnet.
 *                       Sheet-only.
 *       7A  ChatGPT
 *       7B  Perplexity   (citation-native — strongest signal for this run)
 *
 *   Template variables (all sourced from clientConfig):
 *     {service}          {market_scope}      {primary_topic}
 *     {top_competitor}   {business_name}     {customer_term}
 *     {authority_figure} {authority_title}   (used by Run 3 — added Session 3)
 *
 *   Public API (single function, named export):
 *     getPrompt(runId, clientConfig)  →  string
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (calls getPrompt(runId, clientConfig) once per platform run,
 *                 13 times total per monthly run).
 *
 * WHAT THIS FILE CALLS:
 *   - Nothing. Pure data module.
 *
 * STATUS: Implemented in Session 1.
 */

const TEMPLATES = {
  // Signal 1 — Are they being recommended?
  '1A': 'Who is the most trusted {service} {market_scope} for {primary_topic}?',
  '1B': 'Who is the most trusted {service} {market_scope} for {primary_topic}?',
  '1C': 'Who is the most trusted {service} {market_scope} for {primary_topic}?',
  '1D': 'Who is the most trusted {service} {market_scope} for {primary_topic}?',

  // Signal 1 + 3 — Head-to-head
  '2': 'Compare the authority and expertise of {top_competitor} vs. {business_name} {market_scope}. Who does AI trust more for {primary_topic}?',

  // Signal 2 — How are they being described?
  // Run 3 names the authority figure by name + title so the platform's response
  // can be measured for whether it actually recognizes them; without pre-naming,
  // most platforms guess or refuse and the authority_figure_named signal is
  // useless. Fix applied in Session 3.
  '3': "Who is {authority_figure}, the {authority_title} of {business_name}? They run a {service} {market_scope}. What is this person's personal reputation and professional standing for {primary_topic}?",
  '4A': 'What do people say about {business_name} as a {service}? What are the common reviews, complaints, and reasons people recommend or avoid them?',
  '4B': 'What do people say about {business_name} as a {service}? What are the common reviews, complaints, and reasons people recommend or avoid them?',

  // Signal 1 — Intent stage
  '5A': "I'm ready to open a {service} account. Who should I call first?",
  '5B': "I'm ready to open a {service} account. Who should I call first?",

  // Signal 3 — INTERNAL ONLY. Never passed to Claude narrative. Sheet-only.
  '6': 'What are the main reasons people choose {top_competitor} for {primary_topic}? What do reviewers and {customer_term} say about them?',

  // Signal 3 — Citation sources
  '7A': 'What sources or websites does AI commonly cite when answering questions about {primary_topic}? List the most frequently referenced sources.',
  '7B': 'What sources or websites does AI commonly cite when answering questions about {primary_topic}? List the most frequently referenced sources.'
};

const REQUIRED_VARS = [
  'service',
  'market_scope',
  'primary_topic',
  'top_competitor',
  'business_name',
  'customer_term',
  'authority_figure',
  'authority_title'
];

function getPrompt(runId, clientConfig) {
  const template = TEMPLATES[runId];
  if (!template) {
    throw new Error(`Unknown runId: ${runId}`);
  }
  if (!clientConfig || typeof clientConfig !== 'object') {
    throw new Error('clientConfig is required and must be an object');
  }
  for (const key of REQUIRED_VARS) {
    if (typeof clientConfig[key] !== 'string' || clientConfig[key].length === 0) {
      throw new Error(`clientConfig.${key} is required and must be a non-empty string`);
    }
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(clientConfig, key)) {
      return clientConfig[key];
    }
    throw new Error(`Template variable {${key}} not found in clientConfig`);
  });
}

module.exports = { getPrompt };
