/**
 * Frontend API client.
 *
 * In production (Vercel) all calls go to /api/zoho which proxies to Zoho and
 * handles token refresh server-side.
 *
 * In local development with VITE_USE_MOCK=true, synthetic data is returned so
 * you can iterate on the UI without Zoho credentials.
 */

import type {
  PurchaseRequest,
  PurchaseOrder,
  PurchaseReceive,
  Bill,
  Vendor,
} from './types';
import { MOCK_DATA } from './mockData';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

async function zohoGet<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const qs = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`/api/zoho?${qs}`);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho API error (${res.status}): ${body}`);
  }

  const json = await res.json();

  // Zoho wraps lists under a key matching the path name (with minor variations)
  const KEY_MAP: Record<string, string> = {
    purchaserequests: 'purchase_requests',
    purchaseorders: 'purchaseorders',
    purchasereceives: 'purchasereceives',
    bills: 'bills',
    contacts: 'contacts',
  };

  const key = KEY_MAP[path] ?? path;
  return (json[key] as T[]) ?? [];
}

// ---------------------------------------------------------------------------
// Paginated fetch — follows has_more_page automatically
// ---------------------------------------------------------------------------
async function fetchAll<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const allItems: T[] = [];
  let page = 1;

  while (true) {
    const qs = new URLSearchParams({
      path,
      ...params,
      page: String(page),
      per_page: '200',
    }).toString();

    const res = await fetch(`/api/zoho?${qs}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zoho API error (${res.status}): ${body}`);
    }

    const json = await res.json();

    const KEY_MAP: Record<string, string> = {
      purchaserequests: 'purchase_requests',
      purchaseorders: 'purchaseorders',
      purchasereceives: 'purchasereceives',
      bills: 'bills',
      contacts: 'contacts',
    };

    const key = KEY_MAP[path] ?? path;
    const items = (json[key] as T[]) ?? [];
    allItems.push(...items);

    const ctx = json.page_context ?? {};
    if (!ctx.has_more_page) break;
    page += 1;
  }

  return allItems;
}

// ---------------------------------------------------------------------------
// Public fetch functions
// ---------------------------------------------------------------------------

export async function fetchPurchaseRequests(): Promise<PurchaseRequest[]> {
  if (USE_MOCK) return MOCK_DATA.purchaseRequests;
  return fetchAll<PurchaseRequest>('purchaserequests');
}

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  if (USE_MOCK) return MOCK_DATA.purchaseOrders;
  return fetchAll<PurchaseOrder>('purchaseorders');
}

export async function fetchPurchaseReceives(): Promise<PurchaseReceive[]> {
  if (USE_MOCK) return MOCK_DATA.purchaseReceives;
  return fetchAll<PurchaseReceive>('purchasereceives');
}

export async function fetchBills(): Promise<Bill[]> {
  if (USE_MOCK) return MOCK_DATA.bills;
  return fetchAll<Bill>('bills');
}

export async function fetchVendors(): Promise<Vendor[]> {
  if (USE_MOCK) return MOCK_DATA.vendors;
  return zohoGet<Vendor>('contacts', { contact_type: 'vendor' });
}
