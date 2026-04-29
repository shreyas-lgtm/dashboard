/**
 * Core data-fetching hook.
 *
 * Fetches all Zoho Procurement modules in parallel, computes KPIs, and
 * auto-refreshes every REFRESH_INTERVAL_MS (5 min).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { isAfter, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';

import {
  fetchPurchaseRequests,
  fetchPurchaseOrders,
  fetchPurchaseReceives,
} from './api';
import {
  PR_STATUS,
  PO_STATUS,
  RECEIVE_BILLING_STATUS_FIELD,
  RECEIVE_BILLED_VALUES,
  TOP_VENDORS_COUNT,
  REFRESH_INTERVAL_MS,
} from './config';
import type {
  DashboardData,
  PurchaseOrder,
  PurchaseRequest,
  VendorSpend,
} from './types';

interface State {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

function computeDashboardData(
  prs: PurchaseRequest[],
  pos: PurchaseOrder[],
): DashboardData {
  const now = new Date();

  // --- Pipeline KPIs ---
  const prsAwaitingApproval = prs.filter(
    (pr) => pr.status === PR_STATUS.PENDING_APPROVAL,
  ).length;

  const approvedPrsNoPO = prs.filter(
    (pr) =>
      pr.status === PR_STATUS.APPROVED &&
      (!pr.purchase_orders || pr.purchase_orders.length === 0),
  ).length;

  const posPendingApproval = pos.filter(
    (po) => po.status === PO_STATUS.PENDING_APPROVAL,
  ).length;

  const openPOs = pos.filter((po) => po.status === PO_STATUS.ISSUED).length;

  // Receives pending bill — fetched separately but we compute from POs
  // (see note: billing comes from the receive endpoint; this is a placeholder)
  const receivedPendingBill = 0; // overwritten below after receive fetch

  const overduePOList = pos.filter(
    (po) =>
      po.status === PO_STATUS.ISSUED &&
      po.delivery_date &&
      isAfter(now, parseISO(po.delivery_date)),
  );

  // --- Spend this month ---
  const monthInterval = { start: startOfMonth(now), end: endOfMonth(now) };
  const totalThisMonth = pos
    .filter(
      (po) =>
        [PO_STATUS.ISSUED, PO_STATUS.PARTIALLY_RECEIVED, PO_STATUS.RECEIVED, PO_STATUS.BILLED].includes(
          po.status as (typeof PO_STATUS)[keyof typeof PO_STATUS],
        ) &&
        isWithinInterval(parseISO(po.date), monthInterval),
    )
    .reduce((sum, po) => sum + (po.total ?? 0), 0);

  const currency = pos.find((po) => po.currency_code)?.currency_code ?? 'USD';

  // --- Top vendors by PO value ---
  const vendorTotals: Record<string, number> = {};
  pos.forEach((po) => {
    if (!po.vendor_name) return;
    vendorTotals[po.vendor_name] = (vendorTotals[po.vendor_name] ?? 0) + (po.total ?? 0);
  });

  const topVendors: VendorSpend[] = Object.entries(vendorTotals)
    .map(([vendor_name, total]) => ({ vendor_name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_VENDORS_COUNT);

  // --- Stuck PR list (approved, no PO) ---
  const stuckPRList = prs.filter(
    (pr) =>
      pr.status === PR_STATUS.APPROVED &&
      (!pr.purchase_orders || pr.purchase_orders.length === 0),
  );

  return {
    kpis: {
      prsAwaitingApproval,
      approvedPrsNoPO,
      posPendingApproval,
      openPOs,
      receivedPendingBill,
      overduePOs: overduePOList.length,
    },
    spend: { totalThisMonth, currency },
    topVendors,
    overduePOList,
    stuckPRList,
  };
}

export function useProcurementData() {
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const [prs, pos, receives] = await Promise.all([
        fetchPurchaseRequests(),
        fetchPurchaseOrders(),
        fetchPurchaseReceives(),
      ]);

      const data = computeDashboardData(prs, pos);

      // Patch in real receive billing count
      const billedValues: readonly string[] = RECEIVE_BILLED_VALUES;
      const pendingBill = receives.filter((r) => {
        const status = (r as Record<string, unknown>)[RECEIVE_BILLING_STATUS_FIELD] as string | undefined;
        return !status || !billedValues.includes(status);
      }).length;

      data.kpis.receivedPendingBill = pendingBill;

      setState({ data, loading: false, error: null, lastUpdated: new Date() });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  return { ...state, refresh: load };
}
