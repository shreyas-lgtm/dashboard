/**
 * Synthetic data for local development (VITE_USE_MOCK=true).
 * Values are plausible but entirely fictional.
 */

import type { PurchaseRequest, PurchaseOrder, PurchaseReceive, Bill, Vendor } from './types';

const today = new Date();
const d = (offsetDays: number) => {
  const dt = new Date(today);
  dt.setDate(dt.getDate() + offsetDays);
  return dt.toISOString().split('T')[0];
};

export const MOCK_DATA = {
  purchaseRequests: [
    { purchase_request_id: 'pr1', purchase_request_number: 'PR-001', status: 'pending_approval', date: d(-5), total: 4200, currency_code: 'USD', vendor_name: 'Acme Supplies', purchase_orders: [] },
    { purchase_request_id: 'pr2', purchase_request_number: 'PR-002', status: 'pending_approval', date: d(-3), total: 1800, currency_code: 'USD', vendor_name: 'TechParts Ltd', purchase_orders: [] },
    { purchase_request_id: 'pr3', purchase_request_number: 'PR-003', status: 'pending_approval', date: d(-1), total: 650, currency_code: 'USD', vendor_name: 'OfficeHub', purchase_orders: [] },
    { purchase_request_id: 'pr4', purchase_request_number: 'PR-004', status: 'approved', date: d(-10), total: 9500, currency_code: 'USD', vendor_name: 'Acme Supplies', purchase_orders: [] },
    { purchase_request_id: 'pr5', purchase_request_number: 'PR-005', status: 'approved', date: d(-8), total: 3100, currency_code: 'USD', vendor_name: 'SafetyFirst', purchase_orders: [] },
    { purchase_request_id: 'pr6', purchase_request_number: 'PR-006', status: 'approved', date: d(-7), total: 720, currency_code: 'USD', vendor_name: 'OfficeHub', purchase_orders: [] },
    { purchase_request_id: 'pr7', purchase_request_number: 'PR-007', status: 'approved', date: d(-6), total: 2400, currency_code: 'USD', vendor_name: 'TechParts Ltd', purchase_orders: [{ purchaseorder_id: 'po1' }] },
    { purchase_request_id: 'pr8', purchase_request_number: 'PR-008', status: 'rejected', date: d(-15), total: 500, currency_code: 'USD', vendor_name: 'Cheap Goods Inc', purchase_orders: [] },
  ] as PurchaseRequest[],

  purchaseOrders: [
    { purchaseorder_id: 'po1', purchaseorder_number: 'PO-001', status: 'issued', date: d(-5), delivery_date: d(-1), total: 2400, currency_code: 'USD', vendor_id: 'v1', vendor_name: 'TechParts Ltd' },
    { purchaseorder_id: 'po2', purchaseorder_number: 'PO-002', status: 'issued', date: d(-8), delivery_date: d(3), total: 5800, currency_code: 'USD', vendor_id: 'v2', vendor_name: 'Acme Supplies' },
    { purchaseorder_id: 'po3', purchaseorder_number: 'PO-003', status: 'issued', date: d(-12), delivery_date: d(-3), total: 1200, currency_code: 'USD', vendor_id: 'v3', vendor_name: 'OfficeHub' },
    { purchaseorder_id: 'po4', purchaseorder_number: 'PO-004', status: 'pending_approval', date: d(-2), total: 7300, currency_code: 'USD', vendor_id: 'v4', vendor_name: 'SafetyFirst' },
    { purchaseorder_id: 'po5', purchaseorder_number: 'PO-005', status: 'pending_approval', date: d(-1), total: 3600, currency_code: 'USD', vendor_id: 'v1', vendor_name: 'TechParts Ltd' },
    { purchaseorder_id: 'po6', purchaseorder_number: 'PO-006', status: 'issued', date: d(-20), delivery_date: d(-10), total: 4100, currency_code: 'USD', vendor_id: 'v5', vendor_name: 'Global Logistics' },
    { purchaseorder_id: 'po7', purchaseorder_number: 'PO-007', status: 'received', date: d(-14), total: 890, currency_code: 'USD', vendor_id: 'v3', vendor_name: 'OfficeHub' },
    { purchaseorder_id: 'po8', purchaseorder_number: 'PO-008', status: 'billed', date: d(-18), total: 6200, currency_code: 'USD', vendor_id: 'v2', vendor_name: 'Acme Supplies' },
  ] as PurchaseOrder[],

  purchaseReceives: [
    { receive_id: 'rcv1', receive_number: 'RCV-001', date: d(-3), purchaseorder_id: 'po7', purchaseorder_number: 'PO-007', vendor_id: 'v3', vendor_name: 'OfficeHub', billing_status: 'not_billed' },
    { receive_id: 'rcv2', receive_number: 'RCV-002', date: d(-5), purchaseorder_id: 'po8', purchaseorder_number: 'PO-008', vendor_id: 'v2', vendor_name: 'Acme Supplies', billing_status: 'billed' },
    { receive_id: 'rcv3', receive_number: 'RCV-003', date: d(-1), purchaseorder_id: 'po7', purchaseorder_number: 'PO-007', vendor_id: 'v3', vendor_name: 'OfficeHub', billing_status: 'not_billed' },
  ] as PurchaseReceive[],

  bills: [
    { bill_id: 'b1', bill_number: 'BILL-001', status: 'paid', date: d(-4), total: 6200, currency_code: 'USD', vendor_id: 'v2', vendor_name: 'Acme Supplies', purchaseorder_id: 'po8' },
    { bill_id: 'b2', bill_number: 'BILL-002', status: 'approved', date: d(-2), total: 1500, currency_code: 'USD', vendor_id: 'v1', vendor_name: 'TechParts Ltd' },
  ] as Bill[],

  vendors: [
    { contact_id: 'v1', contact_name: 'TechParts Ltd', contact_type: 'vendor' },
    { contact_id: 'v2', contact_name: 'Acme Supplies', contact_type: 'vendor' },
    { contact_id: 'v3', contact_name: 'OfficeHub', contact_type: 'vendor' },
    { contact_id: 'v4', contact_name: 'SafetyFirst', contact_type: 'vendor' },
    { contact_id: 'v5', contact_name: 'Global Logistics', contact_type: 'vendor' },
  ] as Vendor[],
};
