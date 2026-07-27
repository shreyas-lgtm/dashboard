/**
 * Core data-fetching hook.
 *
 * Loads the Verizon account (mock or proxy), computes the top-line summary,
 * and auto-refreshes on an interval.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchAccount } from './api';
import { REFRESH_INTERVAL_MS } from './config';
import type { VerizonAccount, AccountSummary } from './types';

interface State {
  account: VerizonAccount | null;
  summary: AccountSummary | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export function computeSummary(account: VerizonAccount): AccountSummary {
  const { bill, lines, devicePayments } = account;

  const monthlyPlanTotal = lines.reduce(
    (sum, l) => sum + (l.monthlyLineAccess ?? 0),
    0,
  );

  const devicePaymentMonthly = devicePayments.reduce(
    (sum, dp) => sum + (dp.monthlyAmount ?? 0),
    0,
  );

  const deviceDebtRemaining = devicePayments.reduce(
    (sum, dp) => sum + (dp.remainingBalance ?? 0),
    0,
  );

  const totalDataUsedGb = lines.reduce(
    (sum, l) => sum + (l.dataUsedGb ?? 0),
    0,
  );

  return {
    totalDue: bill.totalDue,
    dueDate: bill.dueDate,
    lineCount: lines.length,
    monthlyPlanTotal,
    devicePaymentMonthly,
    deviceDebtRemaining,
    totalDataUsedGb,
    vsLastMonth: bill.totalDue - bill.lastMonthTotal,
    currency: bill.currency,
  };
}

export function useVerizonData() {
  const [state, setState] = useState<State>({
    account: null,
    summary: null,
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const account = await fetchAccount();
      const summary = computeSummary(account);
      setState({
        account,
        summary,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
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
