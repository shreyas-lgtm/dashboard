/**
 * Reads a Google Sheet (or any CSV URL) into an array of row objects.
 *
 * No Google login required: publish the sheet/tab as CSV and use that link.
 *   In Google Sheets:  File → Share → Publish to web → choose the tab →
 *   "Comma-separated values (.csv)" → Publish, then copy the link.
 * (Or, for a shared sheet, a link of the form:
 *   https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<TAB_GID> )
 *
 * Returns: [{ "Header A": "val", "Header B": "val", ... }, ...]
 */

/** Minimal RFC-4180 CSV parser: handles quotes, embedded commas and newlines. */
function parseCSV(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export async function fetchSheet(csvUrl) {
  if (!csvUrl) throw new Error('No sheet URL provided.');
  const res = await fetch(csvUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch sheet (${res.status}). Is it published to the web as CSV?\n  ${csvUrl}`
    );
  }
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => (c ?? '').trim() !== '')) // drop blank rows
    .map((r) =>
      Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()]))
    );
}
