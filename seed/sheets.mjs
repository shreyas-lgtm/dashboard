/**
 * Reads tabular data into an array of row objects, from any of:
 *   - a local Excel file   (.xlsx / .xls)   ← needs the `xlsx` package
 *   - a local CSV file     (.csv)
 *   - a URL to CSV         (e.g. a published Google Sheet)
 *
 * Returns: [{ "Header A": "val", "Header B": "val", ... }, ...]
 * (headers trimmed, values trimmed to strings, blank rows dropped)
 */

import { readFile } from 'node:fs/promises';

/** Minimal RFC-4180 CSV parser → array of arrays. Handles quotes/commas/newlines. */
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

/** Turn a matrix (array of arrays) into row objects, headers at `headerRow`. */
function rowsFromMatrix(matrix, headerRow = 0) {
  if (matrix.length <= headerRow) return [];
  const headers = matrix[headerRow].map((h) => String(h ?? '').trim());
  return matrix
    .slice(headerRow + 1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()]))
    );
}

async function readExcel(path, { sheet, headerRow = 0 } = {}) {
  let XLSX;
  try {
    const mod = await import('xlsx');
    XLSX = mod.default ?? mod;
  } catch {
    throw new Error(
      "Reading Excel files needs the 'xlsx' package. Run:  npm install"
    );
  }
  const wb = XLSX.readFile(path);
  const name = sheet && wb.Sheets[sheet] ? sheet : wb.SheetNames[0];
  if (sheet && !wb.Sheets[sheet]) {
    throw new Error(`Tab "${sheet}" not found. Tabs: ${wb.SheetNames.join(', ')}`);
  }
  const ws = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return rowsFromMatrix(matrix, headerRow);
}

/** Main entry: read rows from an Excel/CSV file path or a CSV URL.
 *  opts: { sheet }  — Excel tab name (default first)
 *        { headerRow } — 0-based row index holding column headers (default 0) */
export async function readRows(source, opts = {}) {
  if (!source) throw new Error('No data source provided (set the *_FILE or *_URL in .env).');

  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Failed to fetch (${res.status}). Published as CSV?\n  ${source}`);
    }
    return rowsFromMatrix(parseCSV(await res.text()), opts.headerRow ?? 0);
  }

  if (/\.(xlsx|xls)$/i.test(source)) return readExcel(source, opts);

  // assume a local CSV/text file
  return rowsFromMatrix(parseCSV(await readFile(source, 'utf8')), opts.headerRow ?? 0);
}

// Backwards-compatible alias.
export const fetchSheet = readRows;
