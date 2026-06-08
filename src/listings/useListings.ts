import { useMemo, useState } from 'react';
import storeData from '../../data/listings.json';
import type { Listing, ListingsStore, ListingStatus } from './types';

// ---------------------------------------------------------------------------
// useListings — load the agent's listings.json and layer human decisions on top.
//
// v1 keeps approve/reject decisions in localStorage so a click is instant and
// survives refreshes without any backend. (When a write-back endpoint or
// Google Sheet is wired in, `setStatus` is the single place to POST to it —
// the agent already preserves the `status` field across re-runs.)
// ---------------------------------------------------------------------------

const LS_KEY = 'listing-decisions-v1';

function loadDecisions(): Record<string, ListingStatus> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function useListings() {
  const store = storeData as unknown as ListingsStore;
  const [decisions, setDecisions] = useState<Record<string, ListingStatus>>(loadDecisions);

  const setStatus = (key: string, status: ListingStatus) => {
    setDecisions((prev) => {
      const next = { ...prev, [key]: status };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / privacy-mode errors */
      }
      return next;
    });
  };

  const listings: Listing[] = useMemo(
    () =>
      store.listings.map((l) => ({
        ...l,
        status: decisions[l.key] ?? l.status,
      })),
    [store.listings, decisions]
  );

  return {
    listings,
    updatedAt: store.updatedAt,
    setStatus,
  };
}
