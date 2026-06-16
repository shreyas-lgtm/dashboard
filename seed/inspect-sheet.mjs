/**
 * Prints the column headers and first few rows of a data source (Excel/CSV/URL),
 * so we can design or check the mapping to ERPNext fields.
 *
 * Usage:
 *   node seed/inspect-sheet.mjs "C:\\path\\to\\parts.xlsx"
 *   node seed/inspect-sheet.mjs "https://docs.google.com/.../export?format=csv"
 *   node --env-file=.env seed/inspect-sheet.mjs        # uses SHEET_PARTS_FILE/URL
 */

import { readRows } from './sheets.mjs';

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const source = arg || process.env.SHEET_PARTS_FILE || process.env.SHEET_PARTS_URL;

if (!source) {
  console.error(
    'Provide an Excel/CSV file path or a CSV URL:\n  node seed/inspect-sheet.mjs "path\\to\\parts.xlsx"'
  );
  process.exit(1);
}

const rows = await readRows(source);
console.log(`\nRows: ${rows.length}`);
console.log('\nColumns:');
for (const h of Object.keys(rows[0] || {})) console.log(`  - ${h}`);
console.log('\nFirst 3 rows:');
console.log(JSON.stringify(rows.slice(0, 3), null, 2));
