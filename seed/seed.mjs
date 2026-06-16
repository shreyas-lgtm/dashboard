/**
 * Procurement & Inventory structure seeder for ERPNext (Frappe Cloud).
 *
 * Idempotent: creates only what's missing, so it's safe to re-run and to point
 * at a fresh site to replicate the structure.
 *
 * Usage:
 *   node seed/seed.mjs --dry-run     # preview, makes no changes
 *   node seed/seed.mjs               # apply against the site in your .env
 *
 * Requires FRAPPE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET (+ optionally
 * FRAPPE_COMPANY, PO_APPROVAL_THRESHOLD). See .env.example.
 */

import { upsert, companyAbbr, createDoc, findName, DRY_RUN } from './frappe.mjs';
import {
  COMPANY,
  uoms,
  itemGroups,
  supplierGroups,
  locations,
  warehouseSections,
  suppliers,
  workflows,
  workflowStateNames,
  workflowActionNames,
} from './structure.mjs';

const tally = { created: 0, exists: 0, updated: 0 };

function log(doctype, label, action) {
  const icon = action === 'created' ? '+' : action === 'updated' ? '~' : '=';
  tally[action] = (tally[action] || 0) + 1;
  console.log(`  ${icon} ${doctype.padEnd(16)} ${label}`);
}

async function step(title, fn) {
  console.log(`\n▸ ${title}`);
  await fn();
}

async function main() {
  console.log(
    DRY_RUN
      ? '\n=== DRY RUN — no changes will be made ===\n'
      : '\n=== Seeding ERPNext structure ===\n'
  );
  console.log(`Company: ${COMPANY}`);

  // Company abbreviation is needed to build warehouse names like "Stores - ABC".
  const abbr = await companyAbbr(COMPANY);
  const root = `All Warehouses - ${abbr}`;
  console.log(`Abbr:    ${abbr}`);

  await step('Units of Measure', async () => {
    for (const name of uoms) {
      const r = await upsert('UOM', { uom_name: name }, [['uom_name', '=', name]]);
      log('UOM', name, r.action);
    }
  });

  await step('Item Groups', async () => {
    for (const name of itemGroups) {
      const r = await upsert(
        'Item Group',
        { item_group_name: name, parent_item_group: 'All Item Groups', is_group: 0 },
        [['item_group_name', '=', name]]
      );
      log('Item Group', name, r.action);
    }
  });

  await step('Supplier Groups', async () => {
    for (const name of supplierGroups) {
      const r = await upsert(
        'Supplier Group',
        { supplier_group_name: name, parent_supplier_group: 'All Supplier Groups', is_group: 0 },
        [['supplier_group_name', '=', name]]
      );
      log('Supplier Group', name, r.action);
    }
  });

  await step('Warehouses', async () => {
    for (const loc of locations) {
      // Location group warehouse, e.g. "Main Office" → "Main Office - ABC"
      const grp = await upsert(
        'Warehouse',
        { warehouse_name: loc.name, company: COMPANY, is_group: 1, parent_warehouse: root },
        [['warehouse_name', '=', loc.name]]
      );
      log('Warehouse', `${loc.name} (group)`, grp.action);

      const parent = `${loc.name} - ${abbr}`;
      for (const section of warehouseSections) {
        const whName = `${loc.name} - ${section}`;
        const r = await upsert(
          'Warehouse',
          { warehouse_name: whName, company: COMPANY, is_group: 0, parent_warehouse: parent },
          [['warehouse_name', '=', whName]]
        );
        log('Warehouse', whName, r.action);
      }
    }
  });

  await step('Suppliers', async () => {
    for (const s of suppliers) {
      const r = await upsert('Supplier', s, [['supplier_name', '=', s.supplier_name]]);
      log('Supplier', s.supplier_name, r.action);
    }
  });

  await step('Workflow states & actions', async () => {
    for (const name of workflowStateNames) {
      const r = await upsert(
        'Workflow State',
        { workflow_state_name: name },
        [['workflow_state_name', '=', name]]
      );
      log('Workflow State', name, r.action);
    }
    for (const name of workflowActionNames) {
      const r = await upsert(
        'Workflow Action Master',
        { workflow_action_name: name },
        [['workflow_action_name', '=', name]]
      );
      log('Workflow Action', name, r.action);
    }
  });

  await step('Workflows', async () => {
    for (const wf of workflows) {
      const existing = await findName('Workflow', [['workflow_name', '=', wf.workflow_name]]);
      if (existing) {
        log('Workflow', `${wf.workflow_name} (skipped — exists)`, 'exists');
        continue;
      }
      const doc = {
        doctype: 'Workflow',
        workflow_name: wf.workflow_name,
        document_type: wf.document_type,
        is_active: 1,
        override_status: 1,
        workflow_state_field: 'workflow_state',
        states: wf.states.map((s) => ({
          state: s.state,
          doc_status: s.doc_status,
          allow_edit: s.allow_edit,
        })),
        transitions: wf.transitions.map((t) => ({
          state: t.state,
          action: t.action,
          next_state: t.next_state,
          allowed: t.allowed,
          ...(t.condition ? { condition: t.condition } : {}),
        })),
      };
      await createDoc('Workflow', doc);
      log('Workflow', wf.workflow_name, 'created');
    }
  });

  console.log(
    `\n=== Done — created ${tally.created}, updated ${tally.updated}, already present ${tally.exists} ===`
  );
  if (DRY_RUN) console.log('(dry run — nothing was actually written)\n');
}

main().catch((err) => {
  console.error(`\n✗ Seeding failed: ${err.message}`);
  if (err.data) console.error(JSON.stringify(err.data, null, 2));
  process.exit(1);
});
