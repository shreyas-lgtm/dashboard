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
 *   - Supplier bills (Purchase Invoice) need finance approval
 *   - RFQ → Supplier Quotation is OPTIONAL (ad-hoc, native tools — not enforced)
 *   - Strict 3-way match: no bill without a PO and a GRN, and never beyond them
 *   - Every received item passes Incoming Quality Inspection before Stores
 *
 * Full procure-to-pay chain this builds:
 *   Material Request → (RFQ → Supplier Quotation, optional) → Purchase Order
 *     → Purchase Receipt (GRN) → Quality Inspection → Stores / Rejected
 *     → Purchase Invoice (3-way matched) → Payment
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
  {
    // Finance sign-off on supplier bills, on top of the 3-way match enforced by
    // Buying/Accounts settings (a bill cannot exceed what was ordered AND received).
    workflow_name: 'Purchase Invoice Approval',
    document_type: 'Purchase Invoice',
    states: [
      { state: 'Draft', doc_status: '0', allow_edit: 'Accounts User' },
      { state: 'Pending Approval', doc_status: '0', allow_edit: 'Accounts Manager' },
      { state: 'Approved', doc_status: '1', allow_edit: 'Accounts Manager' },
      { state: 'Rejected', doc_status: '0', allow_edit: 'Accounts User' },
    ],
    transitions: [
      { state: 'Draft', action: 'Submit for Approval', next_state: 'Pending Approval', allowed: 'Accounts User' },
      { state: 'Pending Approval', action: 'Approve', next_state: 'Approved', allowed: 'Accounts Manager' },
      { state: 'Pending Approval', action: 'Reject', next_state: 'Rejected', allowed: 'Accounts Manager' },
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

/**
 * Incoming Quality Inspection (IQC).
 *
 * Policy: EVERY received item must pass inspection before it lands in Stores
 * (set per-item at import time via `inspection_required_before_purchase`, see
 * seed/data-sources.mjs). These are the reusable templates the receiver picks
 * on the Purchase Receipt; accepted qty → Stores, rejected qty → Rejected WH.
 *
 * `quality_inspection_parameters` are the master checks; `templates` group them
 * per part type. Add/rename freely.
 */
export const qualityInspectionParameters = [
  'Visual Inspection',
  'Dimensional Check',
  'Surface Finish',
  'Functional Test',
];

export const qualityInspectionTemplates = [
  // General catch-all — safe default for any received item.
  { name: 'Incoming - General', parameters: ['Visual Inspection'] },
  // Mechanical / fabricated (sheet metal, CNC, machined parts).
  { name: 'Incoming - Mechanical', parameters: ['Visual Inspection', 'Dimensional Check', 'Surface Finish'] },
  // Electronics (PCB-A, harnesses) — visual + powered functional check.
  { name: 'Incoming - Electronics', parameters: ['Visual Inspection', 'Functional Test'] },
];

/**
 * Procure-to-pay policy switches applied to ERPNext "Single" settings doctypes.
 * Together these enforce a strict 3-way match: a bill cannot be raised without a
 * Purchase Order AND a Purchase Receipt behind it, and cannot exceed either.
 *
 * RFQ is intentionally left OPTIONAL (ad-hoc) — RFQ and Supplier Quotation are
 * native ERPNext docs available as tools; no setting forces them.
 */
export const procurementPolicy = {
  'Buying Settings': {
    po_required: 'Yes', // a Purchase Order must precede a receipt/invoice
    pr_required: 'Yes', // a Purchase Receipt (GRN) must precede the invoice
    maintain_same_rate: 1, // PO ↔ receipt ↔ invoice rates must agree
    bill_for_rejected_qty_in_purchase_invoice: 0, // never bill QC-rejected qty
  },
  'Stock Settings': {
    over_delivery_receipt_allowance: 0, // cannot receive more than ordered
  },
  'Accounts Settings': {
    over_billing_allowance: 0, // cannot bill more than received
  },
};
