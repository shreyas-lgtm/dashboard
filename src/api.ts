/**
 * Data source for the dashboard.
 *
 * IMPORTANT: Verizon does not offer a public consumer API, so there is no way
 * to log in and pull your account automatically. This dashboard therefore has
 * two supported modes:
 *
 *   1. Mock mode (default, VITE_USE_MOCK=true) — renders src/mockData.ts.
 *      Replace those values with the numbers from your own bill and the whole
 *      dashboard updates. This is the recommended way to use it.
 *
 *   2. Proxy mode (VITE_USE_MOCK=false) — fetches /api/verizon, a serverless
 *      endpoint you point at your own data store (a JSON file, a Google Sheet,
 *      a personal export, etc.). See api/verizon.js for the stub.
 */

import type { VerizonAccount } from './types';
import { MOCK_ACCOUNT } from './mockData';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

export async function fetchAccount(): Promise<VerizonAccount> {
  if (USE_MOCK) {
    // Simulate a tiny bit of latency so loading states are exercised locally.
    return new Promise((resolve) => setTimeout(() => resolve(MOCK_ACCOUNT), 150));
  }

  const res = await fetch('/api/verizon');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Account API error (${res.status}): ${body}`);
  }
  return (await res.json()) as VerizonAccount;
}
