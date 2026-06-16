/**
 * Sets OPENING STOCK in ERPNext from the sheet's "Stock-in-Hand" column.
 *
 * Builds a single Stock Reconciliation (purpose "Opening Stock") listing each
 * item's on-hand qty in one warehouse. Items must already exist (run the data
 * loader first). No cost data in the sheet → posted at zero valuation
 * (allow_zero_valuation_rate); revalue later if needed.
 *
 * Usage:
 *   node --env-file=.env seed/load-opening-stock.mjs --dry-run
 *   node --env-file=.env seed/load-opening-stock.mjs
 *
 * Config (.env):
 *   SHEET_PARTS_FILE / SHEET_PARTS_URL   the same source as the data loader
 *   OPENING_STOCK_WAREHOUSE              default "Main Office - Stores"
 *
 * NOTE: this creates the reconciliation as a DRAFT. Review it in ERPNext and
 * click Submit to actually post the stock (safer for a one-time opening balance).
 */

import { readRows } from './sheets.mjs';
import { createDoc, companyAbbr, DRY_RUN } from './frappe.mjs';
import { COMPANY } from './structure.mjs';

const SOURCE = process.env.SHEET_PARTS_FILE || process.env.SHEET_PARTS_URL;
const WAREHOUSE_BASE = process.env.OPENING_STOCK_WAREHOUSE || 'Main Office - Stores';

const clean = (v) => String(v ?? '').trim();
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

if (!SOURCE) {
  console.error('No source set — set SHEET_PARTS_FILE or SHEET_PARTS_URL in .env');
  process.exit(1);
}

const rows = await readRows(SOURCE);

// Dedupe by item code (UID, falling back to Part Number); keep first qty seen.
const byCode = new Map();
for (const row of rows) {
  const code = clean(row['UID']) || clean(row['Part Number']);
  if (!code) continue;
  const qty = num(row['Stock-in-Hand']);
  if (qty === undefined || qty <= 0) continue;
  if (!byCode.has(code)) byCode.set(code, qty);
}

const abbr = await companyAbbr(COMPANY);
const warehouse = `${WAREHOUSE_BASE} - ${abbr}`;

const items = [...byCode.entries()].map(([item_code, qty]) => ({
  item_code,
  warehouse,
  qty,
  valuation_rate: 0,
  allow_zero_valuation_rate: 1,
}));

console.log(
  DRY_RUN
    ? '\n=== DRY RUN — no changes will be made ===\n'
    : '\n=== Creating Opening Stock reconciliation ===\n'
);
console.log(`Company:   ${COMPANY}`);
console.log(`Warehouse: ${warehouse}`);
console.log(`Items with stock: ${items.length}\n`);
for (const it of items) console.log(`  ${it.item_code.padEnd(10)} qty ${it.qty}`);

if (DRY_RUN) {
  console.log('\n(dry run — nothing was written)\n');
  process.exit(0);
}

const doc = await createDoc('Stock Reconciliation', {
  doctype: 'Stock Reconciliation',
  purpose: 'Opening Stock',
  company: COMPANY,
  items,
});

console.log(`\n✓ Created DRAFT Stock Reconciliation: ${doc?.name}`);
console.log(
  'Review it in ERPNext and click Submit to post the stock:\n' +
    `  ${(process.env.FRAPPE_URL || '').replace(/\/+$/, '')}/app/stock-reconciliation/${doc?.name}\n`
);
