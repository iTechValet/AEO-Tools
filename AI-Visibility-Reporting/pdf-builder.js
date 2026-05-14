/**
 * pdf-builder.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Renders the final monthly client report as a PDF via Puppeteer.
 *
 *   Process:
 *     1. Load templates/report.html.
 *     2. Split Claude Sonnet's narrative on the 8 LITERAL section names
 *        ("OPENING", "WHAT WE PUBLISHED THIS MONTH", ...). The narrative
 *        engine is instructed to use those exact strings as headers; this
 *        module is the consumer of that contract.
 *     3. Escape each section body for HTML and wrap blank-line-separated
 *        paragraphs in <p> tags.
 *     4. Substitute the {{TOKEN}} placeholders in the template (business
 *        name, report period, author line, footer line, 8 section bodies).
 *     5. Launch Puppeteer (headless Chromium), set the populated HTML as
 *        the page content, print to PDF (Letter, 1" margins, prints
 *        backgrounds so the WIN callout's grey background renders).
 *     6. Write the PDF to outputs/[client_id]_AI_Visibility_[YYYY-MM].pdf
 *        — outputs/ is created if missing.
 *
 *   Failure modes:
 *     - narrative is null/empty                          → returns null, logs error
 *     - any section name missing from the narrative      → fills that slot with "(Section not produced this month.)" and continues
 *     - Puppeteer fails to launch (missing Chromium)     → returns null, logs error
 *     - filesystem write fails                           → returns null, logs error
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (step 7 of 8, after narrative-engine.js).
 *
 * WHAT THIS FILE CALLS:
 *   - puppeteer (headless Chromium → PDF).
 *   - Node.js fs/promises + path (template read, output write).
 *
 * STATUS: Implemented in Session 4.
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'report.html');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

const SECTION_NAMES = [
  'OPENING',
  'WHAT WE PUBLISHED THIS MONTH',
  'WHAT THE AI PLATFORMS SAID',
  'A WIN WORTH NOTING',
  'WHERE WE STAND',
  'ON OUR RADAR',
  'THE BIGGER PICTURE',
  'CLOSING'
];

const TOKEN_BY_SECTION = {
  'OPENING':                     'SECTION_OPENING',
  'WHAT WE PUBLISHED THIS MONTH':'SECTION_PUBLISHED',
  'WHAT THE AI PLATFORMS SAID':  'SECTION_PLATFORMS',
  'A WIN WORTH NOTING':          'SECTION_WIN',
  'WHERE WE STAND':              'SECTION_WHERE_STAND',
  'ON OUR RADAR':                'SECTION_RADAR',
  'THE BIGGER PICTURE':          'SECTION_BIGGER',
  'CLOSING':                     'SECTION_CLOSING'
};

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphize(rawBody) {
  // Split on blank lines (one or more newlines surrounded by whitespace).
  // Trim each block; drop empties. Escape HTML, then wrap each block in <p>.
  // Inside a paragraph, single line breaks become <br> so Claude's natural
  // soft-wrapping is preserved.
  const blocks = String(rawBody || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map(b => b.trim())
    .filter(b => b.length > 0);
  if (blocks.length === 0) return '<p>(Section not produced this month.)</p>';
  return blocks
    .map(b => '<p>' + escapeHtml(b).replace(/\n/g, '<br>') + '</p>')
    .join('\n');
}

/**
 * splitSections(narrative)
 *   Splits Claude's narrative on the 8 literal section headers. Returns an
 *   object keyed by section name with the raw body text per section. Any
 *   section that didn't appear in the output gets an empty string.
 */
function splitSections(narrative) {
  const result = {};
  for (const name of SECTION_NAMES) result[name] = '';
  if (typeof narrative !== 'string' || !narrative.trim()) return result;

  // Build a regex that finds each section header as a line by itself
  // (allowing leading/trailing whitespace), capturing the body until the
  // next header or end-of-string. Case-sensitive — the prompt instructs
  // Claude to use ALL CAPS section names verbatim.
  const escaped = SECTION_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const headerPattern = new RegExp(
    `^[ \\t]*(${escaped.join('|')})[ \\t]*\\r?\\n`,
    'gm'
  );

  const matches = [];
  let m;
  while ((m = headerPattern.exec(narrative)) !== null) {
    matches.push({ name: m[1], headerEnd: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].headerEnd;
    const end = i + 1 < matches.length ? matches[i + 1].headerEnd - (matches[i + 1].name.length) - 1 : narrative.length;
    const slice = narrative.slice(start, end).trim();
    if (slice) result[matches[i].name] = slice;
  }
  return result;
}

function reportPeriodLabel(reportPeriod) {
  // Accept both "May 2026" (already-labeled) and "2026-05" (internal form).
  if (typeof reportPeriod === 'string' && /^\d{4}-\d{2}$/.test(reportPeriod)) {
    const [yyyy, mm] = reportPeriod.split('-');
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const idx = parseInt(mm, 10) - 1;
    if (idx >= 0 && idx < 12) return `${monthNames[idx]} ${yyyy}`;
  }
  return reportPeriod || '';
}

function outputFilename(clientId, periodInternal) {
  // periodInternal expected as "YYYY-MM". If only the label form is passed,
  // do the inverse mapping so the filename stays date-sortable.
  let yyyymm = periodInternal;
  if (typeof periodInternal === 'string' && !/^\d{4}-\d{2}$/.test(periodInternal)) {
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const m = periodInternal.toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
    if (m) {
      const idx = monthNames.indexOf(m[1]);
      if (idx >= 0) yyyymm = `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
    }
  }
  return `${clientId}_AI_Visibility_${yyyymm}.pdf`;
}

async function loadTemplate() {
  return fs.readFile(TEMPLATE_PATH, 'utf8');
}

function populateTemplate(template, replacements) {
  let out = template;
  for (const [token, value] of Object.entries(replacements)) {
    const re = new RegExp(`{{${token}}}`, 'g');
    out = out.replace(re, value);
  }
  return out;
}

async function renderPdf(html, outputPath) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="font-family: Helvetica, Arial, sans-serif; font-size: 9pt; color: #888; width: 100%; padding: 0 0.75in; text-align: right;">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    });
  } finally {
    await browser.close();
  }
}

async function buildPDF(narrative, context) {
  if (!narrative || typeof narrative !== 'string' || !narrative.trim()) {
    console.error('[pdf-builder] narrative is empty — skipping PDF generation.');
    return null;
  }
  if (!context || !context.clientConfig) {
    console.error('[pdf-builder] context.clientConfig is required — skipping PDF generation.');
    return null;
  }

  const business = context.clientConfig.business_name || '';
  const clientId = context.clientConfig.client_id || 'client';
  const labelPeriod = reportPeriodLabel(context.reportPeriod);
  const periodInternal = typeof context.period === 'string' && /^\d{4}-\d{2}$/.test(context.period)
    ? context.period
    : (typeof context.reportPeriod === 'string' && /^\d{4}-\d{2}$/.test(context.reportPeriod)
        ? context.reportPeriod
        : labelPeriod);

  const sections = splitSections(narrative);

  const replacements = {
    BUSINESS_NAME: escapeHtml(business),
    REPORT_PERIOD: escapeHtml(labelPeriod),
    AUTHOR_LINE: 'Prepared by ' + escapeHtml(context.clientConfig.authority_figure || 'Gerek Allen') + ', Founder &mdash; iTech Valet',
    FOOTER_LINE: escapeHtml(labelPeriod + ' | Prepared exclusively for ' + business + ' | Confidential')
  };
  for (const sectionName of SECTION_NAMES) {
    const token = TOKEN_BY_SECTION[sectionName];
    replacements[token] = paragraphize(sections[sectionName]);
  }

  let template;
  try {
    template = await loadTemplate();
  } catch (err) {
    console.error(`[pdf-builder] Failed to read template: ${err.message}`);
    return null;
  }
  const html = populateTemplate(template, replacements);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, outputFilename(clientId, periodInternal));

  try {
    await renderPdf(html, outputPath);
  } catch (err) {
    console.error(`[pdf-builder] Puppeteer render failed: ${err.message}`);
    return null;
  }

  try {
    const stat = await fs.stat(outputPath);
    return { path: outputPath, bytes: stat.size, filename: path.basename(outputPath) };
  } catch (err) {
    console.error(`[pdf-builder] PDF stat failed: ${err.message}`);
    return { path: outputPath, bytes: null, filename: path.basename(outputPath) };
  }
}

module.exports = {
  buildPDF,
  // exported for unit testing
  splitSections,
  paragraphize,
  reportPeriodLabel,
  outputFilename,
  populateTemplate,
  SECTION_NAMES,
  TOKEN_BY_SECTION,
  TEMPLATE_PATH,
  OUTPUT_DIR
};
