// ---------------------------------------------------------------------------
// Listing types — mirror the objects the agent writes to data/listings.json
// (produced by agent/ingest.mjs). Keep in sync with agent/parse.mjs +
// agent/scrutinize.mjs + agent/rank.mjs.
// ---------------------------------------------------------------------------

export type DealType = 'rent' | 'sale';
export type FlagSeverity = 'hard' | 'warn' | 'info';
export type Recommendation = 'Strong match' | 'Worth a look' | 'Skip';
export type ListingStatus = 'new' | 'approved' | 'rejected';

export interface ListingFlag {
  code: string;
  severity: FlagSeverity;
  message: string;
}

export interface Listing {
  key: string;
  source: string;
  dealType: DealType;
  price: number | null;
  priceUnit: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pricePerSqft: number | null;
  furnished: boolean | null;
  amenities: string[];
  address: string | null;
  city: string | null;
  broker: string | null;
  url: string | null;
  receivedAt: string | null;
  emailId: string | null;
  threadId: string | null;
  track: string;
  flags: ListingFlag[];
  score: number;
  recommendation: Recommendation;
  breakdown: Record<string, number | string>;
  status: ListingStatus;
}

export interface ListingsStore {
  updatedAt: string | null;
  count: number;
  listings: Listing[];
}
