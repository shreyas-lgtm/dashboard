/**
 * Loads Items & Suppliers from Google Sheets into ERPNext via the REST API.
 *
 * Idempotent: re-running only creates what's missing (or updates, if a source
 * has `update: true`). Point it at the same sheets any time to sync.
 *
 * Usage:
 *   node --env-file=.env seed/load-data.mjs --dry-run   # preview
 *   node --env-file=.env seed/load-data.mjs             # apply
 */

import { readRows } from './sheets.mjs';
import { upsert, DRY_RUN } from './frappe.mjs';
import { sources } from './data-sources.mjs';

const tally = { created: 0, exists: 0, updated: 0, skipped: 0, failed: 0 };

async function loadSource(src) {
  console.log(`\n▸ ${src.name}`);
  if (!src.source) {
    console.log(`  (no source set — set SHEET_PARTS_FILE or SHEET_PARTS_URL in .env)`);
    return;
  }

  const rows = await readRows(src.source, { sheet: src.sheet, headerRow: src.headerRow });
  console.log(`  read ${rows.length} rows`);

  for (const row of rows) {
    let doc;
    try {
      doc = src.mapRow(row);
    } catch (err) {
      tally.failed++;
      console.log(`  ! map error: ${err.message}`);
      continue;
    }
    if (!doc) { tally.skipped++; continue; }

    try {
      const r = await upsert(src.doctype, doc, src.match(doc), { update: src.update });
      tally[r.action]++;
      const icon = r.action === 'created' ? '+' : r.action === 'updated' ? '~' : '=';
      const label = doc.item_code || doc.supplier_name || r.name;
      console.log(`  ${icon} ${label}`);
    } catch (err) {
      tally.failed++;
      const label = doc.item_code || doc.supplier_name || '(unknown)';
      console.log(`  ✗ ${label}: ${err.message}`);
    }
  }
}

console.log(
  DRY_RUN
    ? '\n=== DRY RUN — no changes will be made ===\n'
    : '\n=== Loading data into ERPNext ===\n'
);

for (const src of sources) {
  await loadSource(src);
}

console.log(
  `\n=== Done — created ${tally.created}, updated ${tally.updated}, ` +
    `already present ${tally.exists}, skipped ${tally.skipped}, failed ${tally.failed} ===`
);
if (DRY_RUN) console.log('(dry run — nothing was actually written)\n');
if (tally.failed > 0) process.exitCode = 1;
