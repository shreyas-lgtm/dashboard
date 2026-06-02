// ---------------------------------------------------------------------------
// rank.mjs — score a scrutinised listing 0–100 and label a recommendation.
//
// The score is a weighted blend of how well the listing fits your criteria
// (budget, size, location, value, freshness, completeness). Hard flags (e.g.
// no price at all) force the score to 0. Each sub-score is normalised to
// 0–1 so the weights in preferences.mjs are easy to reason about.
// ---------------------------------------------------------------------------

import { preferences } from './preferences.mjs';
import { hasHardFlag } from './scrutinize.mjs';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Returns { score, recommendation, breakdown }. */
export function rank(listing, trackKey, flags) {
  const track = preferences.tracks[trackKey];
  const w = preferences.weights;

  if (hasHardFlag(flags)) {
    return { score: 0, recommendation: 'Skip', breakdown: { reason: 'hard-flag' } };
  }

  const breakdown = {};

  // --- budget fit: 1.0 at/under ideal, sloping to 0 at the cap ------------
  breakdown.budgetFit = scoreBudget(listing, track);

  // --- beds (residential) or sqft (warehouse) -----------------------------
  breakdown.bedsOrSizeFit = trackKey === 'residential'
    ? scoreBeds(listing, track)
    : scoreSize(listing, track);

  // --- location -----------------------------------------------------------
  breakdown.locationMatch = scoreLocation(listing, track);

  // --- value (price per sqft) ---------------------------------------------
  breakdown.pricePerSqft = scorePricePerSqft(listing, track);

  // --- freshness ----------------------------------------------------------
  breakdown.freshness = scoreFreshness(listing);

  // --- data completeness --------------------------------------------------
  breakdown.dataCompleteness = scoreCompleteness(listing);

  const raw =
    w.budgetFit * breakdown.budgetFit +
    w.bedsOrSizeFit * breakdown.bedsOrSizeFit +
    w.locationMatch * breakdown.locationMatch +
    w.pricePerSqft * breakdown.pricePerSqft +
    w.freshness * breakdown.freshness +
    w.dataCompleteness * breakdown.dataCompleteness;

  // Soft penalty for each warning flag (hard flags already handled above).
  const warnCount = flags.filter((f) => f.severity === 'warn').length;
  const penalty = Math.min(0.25, warnCount * 0.08);

  const score = Math.round(clamp01(raw - penalty) * 100);

  const { strong, consider } = preferences.thresholds;
  const recommendation = score >= strong ? 'Strong match' : score >= consider ? 'Worth a look' : 'Skip';

  return { score, recommendation, breakdown };
}

// --- sub-scorers -----------------------------------------------------------

function scoreBudget(listing, track) {
  if (listing.price == null) return 0;
  const ideal = listing.dealType === 'sale' ? (track.maxSalePrice ?? 0) * 0.8 : track.idealRent;
  const cap = listing.dealType === 'sale' ? track.maxSalePrice : track.maxRent;
  if (ideal == null || cap == null) return 0.5;
  if (listing.price <= ideal) return 1;
  if (listing.price >= cap) return 0.1;
  // Linear between ideal (1.0) and cap (0.1).
  return clamp01(1 - 0.9 * ((listing.price - ideal) / (cap - ideal)));
}

function scoreBeds(listing, track) {
  if (listing.beds == null) return 0.4; // unknown → mild penalty, not zero
  if (track.minBeds == null) return 1;
  if (listing.beds < track.minBeds) return clamp01(listing.beds / track.minBeds * 0.5);
  // At minimum = 0.8, each extra bed adds, capping at 1.
  return clamp01(0.8 + (listing.beds - track.minBeds) * 0.1);
}

function scoreSize(listing, track) {
  if (listing.sqft == null) return 0.3;
  if (track.minSqft == null) return 1;
  return clamp01(listing.sqft / track.minSqft >= 1
    ? 0.8 + Math.min(0.2, (listing.sqft / track.minSqft - 1) * 0.1)
    : listing.sqft / track.minSqft * 0.6);
}

function scoreLocation(listing, track) {
  if (!track.targetLocations || !track.targetLocations.length) return 1; // not scored
  const hay = `${listing.city || ''} ${listing.address || ''}`.toLowerCase();
  return track.targetLocations.some((loc) => hay.includes(loc)) ? 1 : 0.15;
}

function scorePricePerSqft(listing, track) {
  if (listing.pricePerSqft == null || track.maxPricePerSqftRent == null) return 0.5; // neutral when unknown
  if (listing.dealType !== 'rent') return 0.5;
  // 1.0 at half the guide, 0 at the guide and above.
  const ratio = listing.pricePerSqft / track.maxPricePerSqftRent;
  return clamp01(1 - (ratio - 0.5) / 0.5);
}

function scoreFreshness(listing) {
  if (!listing.receivedAt) return 0.5;
  const ageDays = (Date.now() - new Date(listing.receivedAt).getTime()) / 86_400_000;
  if (ageDays <= 2) return 1;
  if (ageDays >= preferences.freshnessDays) return 0.2;
  return clamp01(1 - ageDays / preferences.freshnessDays);
}

function scoreCompleteness(listing) {
  const fields = ['price', 'beds', 'baths', 'sqft', 'address', 'url'];
  const present = fields.filter((f) => listing[f] != null).length;
  return present / fields.length;
}
