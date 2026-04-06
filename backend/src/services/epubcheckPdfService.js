import puppeteer from 'puppeteer';

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLocations(locations) {
  if (!Array.isArray(locations) || locations.length === 0) return '—';
  return locations
    .map((loc) => {
      if (!loc || typeof loc !== 'object') return '';
      const p = loc.path != null ? String(loc.path) : '';
      const line = loc.line != null ? `:${loc.line}` : '';
      const col = loc.column != null ? `:${loc.column}` : '';
      return `${p}${line}${col}`.trim() || JSON.stringify(loc);
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {{
 *   valid: boolean,
 *   summary?: { fatalCount?: number, errorCount?: number, warningCount?: number, infoCount?: number },
 *   messages?: Array,
 *   publicationTitle?: string | null,
 *   checkerVersion?: string | null,
 *   engine?: string | null,
 *   sourceFileName?: string | null
 * }} data
 */
function buildReportHtml(data) {
  const title = data.publicationTitle
    ? escapeHtml(data.publicationTitle)
    : 'EPUBCheck report';
  const generatedAt = new Date().toISOString();
  const summary = data.summary || {};
  const messages = Array.isArray(data.messages) ? data.messages : [];

  const rows = messages
    .map((msg, idx) => {
      const sev = escapeHtml(msg?.severity ?? '—');
      const id = escapeHtml(msg?.ID ?? msg?.id ?? '');
      const text = escapeHtml(msg?.message ?? '');
      const loc = escapeHtml(formatLocations(msg?.locations));
      return `<tr>
        <td>${idx + 1}</td>
        <td><span class="sev sev-${String(msg?.severity || '').toLowerCase()}">${sev}</span></td>
        <td class="mono">${id}</td>
        <td class="msg">${text}</td>
        <td class="mono loc">${loc.replace(/\n/g, '<br/>')}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 8px 0; }
    .meta { color: #555; margin-bottom: 16px; font-size: 10px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 11px; }
    .badge.ok { background: #d1fae5; color: #065f46; }
    .badge.bad { background: #fee2e2; color: #991b1b; }
    .lbl { font-size: 9px; text-transform: uppercase; color: #6b7280; }
    .num { font-size: 16px; font-weight: 700; }
    table.messages { width: 100%; border-collapse: collapse; font-size: 9px; }
    table.messages th, table.messages td { border: 1px solid #e5e7eb; padding: 6px 8px; vertical-align: top; }
    table.messages th { background: #f3f4f6; text-align: left; }
    td.msg { word-break: break-word; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 8px; }
    .sev { font-weight: 700; }
    .sev-fatal, .sev-error { color: #991b1b; }
    .sev-warning { color: #92400e; }
    .sev-info { color: #3730a3; }
    .foot { margin-top: 16px; font-size: 9px; color: #6b7280; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">
    <div>Generated: ${escapeHtml(generatedAt)}</div>
    ${data.sourceFileName ? `<div>File: ${escapeHtml(data.sourceFileName)}</div>` : ''}
    ${data.checkerVersion ? `<div>EPUBCheck: ${escapeHtml(String(data.checkerVersion))}</div>` : ''}
    ${data.engine ? `<div>${escapeHtml(String(data.engine))}</div>` : ''}
  </div>
  <p><span class="badge ${data.valid ? 'ok' : 'bad'}">${data.valid ? 'Valid (no fatal/error messages)' : 'Not valid (fatal or error messages present)'}</span></p>
  <table class="summary" style="width:100%; border-collapse:collapse; margin:12px 0 20px 0;">
    <tr>
      <td style="border:1px solid #e5e7eb; padding:8px 10px; text-align:center;"><div class="lbl">Fatal</div><div class="num">${escapeHtml(String(summary.fatalCount ?? 0))}</div></td>
      <td style="border:1px solid #e5e7eb; padding:8px 10px; text-align:center;"><div class="lbl">Errors</div><div class="num">${escapeHtml(String(summary.errorCount ?? 0))}</div></td>
      <td style="border:1px solid #e5e7eb; padding:8px 10px; text-align:center;"><div class="lbl">Warnings</div><div class="num">${escapeHtml(String(summary.warningCount ?? 0))}</div></td>
      <td style="border:1px solid #e5e7eb; padding:8px 10px; text-align:center;"><div class="lbl">Infos</div><div class="num">${escapeHtml(String(summary.infoCount ?? 0))}</div></td>
    </tr>
  </table>
  <h2 style="font-size: 14px; margin: 16px 0 8px 0;">Messages (${messages.length})</h2>
  <table class="messages">
    <thead>
      <tr>
        <th>#</th>
        <th>Severity</th>
        <th>ID</th>
        <th>Message</th>
        <th>Location</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5">No messages.</td></tr>'}
    </tbody>
  </table>
  <div class="foot">W3C EPUBCheck report</div>
</body>
</html>`;
}

/**
 * Render EPUBCheck-style report data to a PDF buffer.
 * @param {object} data Same shape as POST /epubcheck/pdf body
 * @returns {Promise<Buffer>}
 */
export async function renderEpubcheckReportPdf(data) {
  const html = buildReportHtml(data);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfUint8 = await page.pdf({
      format: 'A4',
      landscape: messagesLandscape(data),
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' }
    });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}

function messagesLandscape(data) {
  const n = Array.isArray(data?.messages) ? data.messages.length : 0;
  return n > 8;
}
