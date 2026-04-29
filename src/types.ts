// ---------------------------------------------------------------------------
// Zoho Procurement entity types
// Status strings match what the Zoho API returns — update src/config.ts
// if your Zoho instance uses different values.
// ---------------------------------------------------------------------------

export interface PurchaseRequest {
  purchase_request_id: string;
  purchase_request_number: string;
  /** e.g. "draft" | "pending_approval" | "approved" | "rejected" | "cancelled" */
  status: string;
  date: string;
  total: number;
  currency_code: string;
  vendor_id?: string;
  vendor_name?: string;
  /** Non-empty when the PR has been converted to one or more POs */
  purchase_orders?: Array<{ purchaseorder_id: string }>;
}

export interface PurchaseOrder {
  purchaseorder_id: string;
  purchaseorder_number: string;
  /** e.g. "draft" | "pending_approval" | "approved" | "issued" | "partially_received" | "received" | "billed" | "cancelled" */
  status: string;
  date: string;
  /** Expected delivery date — ISO date string */
  delivery_date?: string;
  total: number;
  currency_code: string;
  vendor_id: string;
  vendor_name: string;
}

export interface PurchaseReceive {
  receive_id: string;
  receive_number: string;
  date: string;
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_id: string;
  vendor_name: string;
  /**
   * Zoho uses various field names for bill linkage depending on plan/version.
   * See src/config.ts → RECEIVE_BILLING_STATUS_FIELD.
   * Typical values: "not_billed" | "partially_billed" | "billed"
   */
  billing_status?: string;
  bill_id?: string;
}

export interface Bill {
  bill_id: string;
  bill_number: string;
  status: string;
  date: string;
  due_date?: string;
  total: number;
  currency_code: string;
  vendor_id: string;
  vendor_name: string;
  purchaseorder_id?: string;
}

export interface Vendor {
  contact_id: string;
  contact_name: string;
  contact_type: string;
}

// ---------------------------------------------------------------------------
// Computed KPIs used by the dashboard
// ---------------------------------------------------------------------------

export interface PipelineKPIs {
  prsAwaitingApproval: number;
  approvedPrsNoPO: number;
  posPendingApproval: number;
  openPOs: number;
  receivedPendingBill: number;
  overduePOs: number;
}

export interface SpendStats {
  totalThisMonth: number;
  currency: string;
}

export interface VendorSpend {
  vendor_name: string;
  total: number;
}

export interface DashboardData {
  kpis: PipelineKPIs;
  spend: SpendStats;
  topVendors: VendorSpend[];
  overduePOList: PurchaseOrder[];
  stuckPRList: PurchaseRequest[];
}
