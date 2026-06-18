/**
 * Declarative definition of the procurement & inventory structure.
 *
 * THIS IS THE ONE FILE YOU EDIT to change what gets built. It is just data —
 * rename things, add/remove rows, then re-run the seeder (idempotent: it only
 * creates what's missing).
 *
 * Decisions baked in (from setup):
 *   - Single company, two locations: Main Office + Contract Manufacturer (CM)
 *   - CM works via subcontracting → it is both a warehouse location AND a Supplier
 *   - Item tracking supports batch / serial / expiry (set per-item at import time)
 *   - Material Requests always need approval; POs need approval above a threshold
 */

/** Company name exactly as it appears in ERPNext (override via FRAPPE_COMPANY). */
export const COMPANY = process.env.FRAPPE_COMPANY || 'My Company';

/** PO value (in company currency) at or below which POs auto-flow without approval. */
export const PO_APPROVAL_THRESHOLD = Number(
  process.env.PO_APPROVAL_THRESHOLD || 25000
);

/** Units of measure to ensure exist. ERPNext ships many already — dupes are skipped. */
export const uoms = [
  'Nos',
  'Unit',
  'Kg',
  'Gram',
  'Litre',
  'Millilitre',
  'Metre',
  'Box',
  'Pack',
  'Set',
  'Dozen',
];

/** Top-level item categories. Items are assigned to these at import time.
 *  (Extended for the MOMA tracker's Part Categories — see data-sources CATEGORY.) */
export const itemGroups = [
  'Raw Materials',
  'Spares & Maintenance',
  'Finished Goods',
  'Sub-Assemblies',
  'Fabricated Parts',
  'Purchased Parts',
  'Fasteners',
  'Consumables',
  'Packing Material',
];

/** Supplier categories. "Subcontractor" is used for the contract manufacturer. */
export const supplierGroups = ['Local', 'Import', 'Services', 'Subcontractor'];

/**
 * Physical locations. Each becomes a GROUP warehouse holding the sections below.
 * `name` is what shows in ERPNext; rename freely.
 */
export const locations = [
  { name: 'Main Office' },
  { name: 'Contract Manufacturer' },
];

/**
 * Warehouse sections created under EVERY location.
 * For the CM, "Stores" doubles as the supplier warehouse for subcontracting
 * (where your raw materials sit while they're being worked on).
 */
export const warehouseSections = ['Stores', 'In-Process', 'Rejected'];

/**
 * Suppliers created as part of the structure. Only structurally-significant
 * suppliers belong here (the CM); bulk suppliers come via CSV import.
 */
export const suppliers = [
  { supplier_name: 'Contract Manufacturer', supplier_group: 'Subcontractor' },
];

/**
 * Approval workflows. States map to ERPNext docstatus:
 *   "0" = Draft/editable, "1" = Submitted/approved, "2" = Cancelled.
 *
 * Roles used (standard ERPNext roles): "Purchase User" raises documents,
 * "Purchase Manager" approves. Adjust `allowed` / `allow_edit` to your roles.
 */
export const workflows = [
  {
    workflow_name: 'Material Request Approval',
    document_type: 'Material Request',
    states: [
      { state: 'Draft', doc_status: '0', allow_edit: 'Purchase User' },
      { state: 'Pending Approval', doc_status: '0', allow_edit: 'Purchase Manager' },
      { state: 'Approved', doc_status: '1', allow_edit: 'Purchase Manager' },
      { state: 'Rejected', doc_status: '0', allow_edit: 'Purchase User' },
    ],
    transitions: [
      { state: 'Draft', action: 'Submit for Approval', next_state: 'Pending Approval', allowed: 'Purchase User' },
      { state: 'Pending Approval', action: 'Approve', next_state: 'Approved', allowed: 'Purchase Manager' },
      { state: 'Pending Approval', action: 'Reject', next_state: 'Rejected', allowed: 'Purchase Manager' },
    ],
  },
  {
    workflow_name: 'Purchase Order Approval',
    document_type: 'Purchase Order',
    states: [
      { state: 'Draft', doc_status: '0', allow_edit: 'Purchase User' },
      { state: 'Pending Approval', doc_status: '0', allow_edit: 'Purchase Manager' },
      { state: 'Approved', doc_status: '1', allow_edit: 'Purchase Manager' },
      { state: 'Rejected', doc_status: '0', allow_edit: 'Purchase User' },
    ],
    transitions: [
      // Small POs (<= threshold) can be approved directly by the Purchase User.
      { state: 'Draft', action: 'Approve', next_state: 'Approved', allowed: 'Purchase User', condition: `doc.grand_total <= ${PO_APPROVAL_THRESHOLD}` },
      // Larger POs must go to the Purchase Manager.
      { state: 'Draft', action: 'Submit for Approval', next_state: 'Pending Approval', allowed: 'Purchase User', condition: `doc.grand_total > ${PO_APPROVAL_THRESHOLD}` },
      { state: 'Pending Approval', action: 'Approve', next_state: 'Approved', allowed: 'Purchase Manager' },
      { state: 'Pending Approval', action: 'Reject', next_state: 'Rejected', allowed: 'Purchase Manager' },
    ],
  },
];

/** Distinct workflow state / action master names referenced above (auto-derived). */
export const workflowStateNames = [
  ...new Set(workflows.flatMap((w) => w.states.map((s) => s.state))),
];
export const workflowActionNames = [
  ...new Set(workflows.flatMap((w) => w.transitions.map((t) => t.action))),
];
