/**
 * Zoho Procurement field & status configuration.
 *
 * If your Zoho instance returns different status strings, change them here.
 * The Phase 1 checklist asks you to document the status fields — once you
 * have live API responses, update the arrays below to match exactly.
 */

export const PR_STATUS = {
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DRAFT: 'draft',
  CANCELLED: 'cancelled',
} as const;

export const PO_STATUS = {
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  ISSUED: 'issued',
  PARTIALLY_RECEIVED: 'partially_received',
  RECEIVED: 'received',
  BILLED: 'billed',
  CANCELLED: 'cancelled',
  DRAFT: 'draft',
} as const;

/**
 * The field on a PurchaseReceive that indicates billing status.
 * Possible Zoho field names: "billing_status" | "billed_status"
 */
export const RECEIVE_BILLING_STATUS_FIELD = 'billing_status' as const;

/**
 * Values of the billing status field that mean "fully billed".
 * Receives NOT in this list are shown as "pending bill".
 */
export const RECEIVE_BILLED_VALUES = ['billed'] as const;

/** How many vendors to show in the Top Vendors chart */
export const TOP_VENDORS_COUNT = 5;

/** Auto-refresh interval in milliseconds (5 minutes) */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
