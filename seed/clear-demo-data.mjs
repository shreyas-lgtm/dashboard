/**
 * Removes ERPNext's built-in DEMO data (SKU001–SKU010 sample items like
 * T-shirt/Laptop/Camera and their demo transactions).
 *
 * This calls ERPNext's own `erpnext.setup.demo.clear_demo_data`, which only
 * removes what the demo generator created — your real items (P0473…), suppliers,
 * warehouses and stock are NOT touched.
 *
 * It's destructive (of demo data), so it requires an explicit flag:
 *   node --env-file=.env seed/clear-demo-data.mjs --confirm
 */

import { callMethod } from './frappe.mjs';

if (!process.argv.includes('--confirm')) {
  console.log(
    'This will clear ERPNext demo data (SKU001–SKU010 etc.).\n' +
      'Your real data is unaffected. Re-run with --confirm to proceed:\n' +
      '  node --env-file=.env seed/clear-demo-data.mjs --confirm\n'
  );
  process.exit(0);
}

console.log('Clearing ERPNext demo data…');
try {
  await callMethod('erpnext.setup.demo.clear_demo_data');
  console.log('✓ Demo data cleared. Refresh the Stock Summary to confirm.');
} catch (err) {
  console.error(`✗ Failed: ${err.message}`);
  console.error(
    '\nIf the method is not available on your version, clear it from the UI instead:\n' +
      '  Search bar → "Demo Company" / Home page banner → "Clear Demo Data".'
  );
  process.exit(1);
}
