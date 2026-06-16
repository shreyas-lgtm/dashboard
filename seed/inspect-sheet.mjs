/**
 * Prints the column headers and first few rows of a Google Sheet, so we can
 * design the mapping to ERPNext fields.
 *
 * Usage:
 *   node seed/inspect-sheet.mjs "<published-csv-url>"
 *   node --env-file=.env seed/inspect-sheet.mjs        # uses SHEET_ITEMS_URL
 */

import { fetchSheet } from './sheets.mjs';

const url = process.argv.find((a) => a.startsWith('http')) || process.env.SHEET_ITEMS_URL;

if (!url) {
  console.error(
    'Provide a published-CSV sheet URL:\n  node seed/inspect-sheet.mjs "https://docs.google.com/.../export?format=csv&gid=0"'
  );
  process.exit(1);
}

const rows = await fetchSheet(url);
console.log(`\nRows: ${rows.length}`);
console.log('\nColumns:');
for (const h of Object.keys(rows[0] || {})) console.log(`  - ${h}`);
console.log('\nFirst 3 rows:');
console.log(JSON.stringify(rows.slice(0, 3), null, 2));
