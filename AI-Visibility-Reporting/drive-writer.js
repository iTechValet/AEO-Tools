/**
 * drive-writer.js — AI Visibility Reporting Tool
 *
 * WHAT THIS FILE DOES:
 *   Uploads the rendered monthly PDF into the client's Google Drive
 *   "Monthly Reports" folder. Same Google service-account credentials as
 *   sheet-reader.js / sheet-writer.js (process.env.GOOGLE_SERVICE_ACCOUNT_JSON).
 *
 *   File name on Drive: [client_id]_AI_Visibility_[YYYY-MM].pdf — derived
 *   from the local PDF filename so a rerun against the same month
 *   overwrites cleanly. The function checks whether a file with the
 *   target name already exists in the folder; if yes it UPDATES the
 *   existing file (via files.update with new media) instead of creating
 *   a duplicate. If no it creates a new file.
 *
 *   Folder target: clientConfig.drive_reports_folder_id. When that value
 *   is missing OR starts with "PLACEHOLDER", the function logs a clear
 *   "skipping upload" message and returns null — never crashes the
 *   pipeline.
 *
 *   Returns on success:
 *     {
 *       fileId: "...",
 *       fileName: "[client_id]_AI_Visibility_[YYYY-MM].pdf",
 *       webViewLink: "https://drive.google.com/file/d/.../view",
 *       updated: boolean   // true if we replaced an existing file
 *     }
 *   Returns null on any failure (missing PDF path, missing env vars,
 *   network or auth error, file open failure) — never crashes the runner.
 *
 * WHAT CALLS THIS FILE:
 *   - runner.js  (step 12 of 13, after pdf-builder.js writes the PDF).
 *
 * WHAT THIS FILE CALLS:
 *   - googleapis (Drive v3) — same library + auth pattern as the Sheet
 *     read/write modules.
 *   - Node.js fs (reads the PDF as a Buffer).
 *
 * STATUS: Implemented in Session 5.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const PDF_MIME = 'application/pdf';

function getServiceAccountCreds() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}`);
  }
}

async function getDriveClient() {
  const creds = getServiceAccountCreds();
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: DRIVE_SCOPES });
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
}

function escapeQueryString(s) {
  // Drive query language uses backslash escaping for ' and \ inside string literals.
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findExisting(drive, folderId, fileName) {
  // Case-sensitive name match within the target folder, excluding trashed files.
  const q = [
    `name = '${escapeQueryString(fileName)}'`,
    `'${escapeQueryString(folderId)}' in parents`,
    'trashed = false'
  ].join(' and ');
  const res = await drive.files.list({
    q,
    fields: 'files(id, name, webViewLink)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    spaces: 'drive'
  });
  const files = (res.data && res.data.files) || [];
  return files.length > 0 ? files[0] : null;
}

async function uploadPDF(pdfPath, clientConfig) {
  if (!pdfPath || typeof pdfPath !== 'string') {
    console.error('[drive-writer] pdfPath is required — skipping upload.');
    return null;
  }
  if (!clientConfig || !clientConfig.client_id) {
    console.error('[drive-writer] clientConfig.client_id is required — skipping upload.');
    return null;
  }
  const folderId = clientConfig.drive_reports_folder_id;
  if (!folderId || typeof folderId !== 'string' || folderId.startsWith('PLACEHOLDER')) {
    console.error(
      `[drive-writer] drive_reports_folder_id is a placeholder or missing ` +
      `(value: ${folderId || 'null'}) — Drive folder not configured, skipping upload.`
    );
    return null;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(pdfPath);
  } catch (err) {
    console.error(`[drive-writer] Failed to read PDF at ${pdfPath}: ${err.message}`);
    return null;
  }

  const fileName = path.basename(pdfPath);

  let drive;
  try {
    drive = await getDriveClient();
  } catch (err) {
    console.error(`[drive-writer] Auth failed: ${err.message}`);
    return null;
  }

  // Drive's files API requires a readable stream for the upload body. Build
  // one from the buffer we already read so we don't open the file twice.
  const { Readable } = require('stream');
  const streamFromBuffer = () => Readable.from(buffer);

  try {
    const existing = await findExisting(drive, folderId, fileName);

    if (existing) {
      const updated = await drive.files.update({
        fileId: existing.id,
        media: { mimeType: PDF_MIME, body: streamFromBuffer() },
        fields: 'id, name, webViewLink',
        supportsAllDrives: true
      });
      const data = updated.data || {};
      return {
        fileId: data.id || existing.id,
        fileName: data.name || fileName,
        webViewLink: data.webViewLink || existing.webViewLink || null,
        updated: true
      };
    }

    const created = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType: PDF_MIME
      },
      media: { mimeType: PDF_MIME, body: streamFromBuffer() },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true
    });
    const data = created.data || {};
    return {
      fileId: data.id,
      fileName: data.name || fileName,
      webViewLink: data.webViewLink || null,
      updated: false
    };
  } catch (err) {
    console.error(`[drive-writer] Drive upload failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  uploadPDF,
  // exported for unit testing
  escapeQueryString,
  findExisting,
  DRIVE_SCOPES,
  PDF_MIME
};
