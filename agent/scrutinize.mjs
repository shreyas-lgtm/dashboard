// ---------------------------------------------------------------------------
// scrutinize.mjs — sanity-check a parsed listing and surface red flags.
//
// "Scrutinising" = the boring diligence a human does before bothering to look:
// is it in budget? big enough? the right area? is the data even complete? is
// it a duplicate of something I've already seen? Each issue becomes a flag
// with a severity, which the dashboard renders as a badge and the ranker uses
// to penalise (or hard-reject) the listing.
// ---------------------------------------------------------------------------

import { preferences } from './preferences.mjs';

/** Pick the track (residential / warehouse) a listing belongs to. */
export function pickTrack(listing) {
  // Warehouse/industrial cues: big sqft, no beds, commercial keywords.
  const text = `${listing.address || ''} ${listing.source || ''}`.toLowerCase();
  const looksCommercial =
    (listing.beds == null && (listing.sqft || 0) >= 3000) ||
    /warehouse|industrial|loopnet|crexi|sq\s?ft of/i.test(text);
  return looksCommercial ? 'warehouse' : 'residential';
}

const SEV = { HARD: 'hard', WARN: 'warn', INFO: 'info' };

/**
 * Returns { trackKey, flags: [{ code, severity, message }], seenKeys updated }.
 * `seenKeys` is a Set the caller maintains across a batch for dedupe.
 */
export function scrutinize(listing, seenKeys = new Set()) {
  const trackKey = pickTrack(listing);
  const track = preferences.tracks[trackKey];
  const flags = [];
  const flag = (code, severity, message) => flags.push({ code, severity, message });

  // --- completeness ---------------------------------------------------------
  if (listing.price == null) flag('MISSING_PRICE', SEV.HARD, 'No price found in the email.');
  if (listing.sqft == null) flag('MISSING_SQFT', SEV.INFO, 'Square footage not stated — value-for-money can’t be computed.');
  if (!listing.address) flag('MISSING_ADDRESS', SEV.WARN, 'Could not extract a street address.');
  if (!listing.url) flag('NO_LINK', SEV.INFO, 'No listing link found to view details.');

  // --- budget ---------------------------------------------------------------
  if (listing.price != null) {
    if (listing.dealType === 'rent' && track.maxRent != null && listing.price > track.maxRent) {
      flag('ABOVE_BUDGET', SEV.WARN, `Rent $${fmt(listing.price)}/mo is over the $${fmt(track.maxRent)} cap.`);
    }
    if (listing.dealType === 'sale' && track.maxSalePrice != null && listing.price > track.maxSalePrice) {
      flag('ABOVE_BUDGET', SEV.WARN, `Price $${fmt(listing.price)} is over the $${fmt(track.maxSalePrice)} cap.`);
    }
  }

  // --- size / beds ----------------------------------------------------------
  if (trackKey === 'residential') {
    if (track.minBeds != null && listing.beds != null && listing.beds < track.minBeds) {
      flag('LOW_BEDS', SEV.WARN, `${listing.beds} bed(s) — below the ${track.minBeds}-bed minimum.`);
    }
    if (track.minBaths != null && listing.baths != null && listing.baths < track.minBaths) {
      // Hard requirement: under the bath minimum disqualifies (forced to Skip).
      flag('LOW_BATHS', SEV.HARD, `${listing.baths} bath(s) — below the ${track.minBaths}-bath minimum.`);
    }

    // --- furnishing & amenities --------------------------------------------
    if (listing.furnished === false && listing.amenities.length === 0) {
      flag('UNFURNISHED_NO_AMENITIES', SEV.WARN, 'Unfurnished and no amenities listed.');
    } else if (listing.furnished == null && listing.amenities.length === 0) {
      flag('AMENITIES_UNKNOWN', SEV.INFO, 'Furnishing/amenities not in the email — open the listing to confirm.');
    }
  } else {
    if (track.minSqft != null && listing.sqft != null && listing.sqft < track.minSqft) {
      flag('TOO_SMALL', SEV.WARN, `${fmt(listing.sqft)} sqft — below the ${fmt(track.minSqft)} sqft minimum.`);
    }
  }

  // --- value for money ------------------------------------------------------
  if (listing.dealType === 'rent' && listing.pricePerSqft != null && track.maxPricePerSqftRent != null) {
    if (listing.pricePerSqft > track.maxPricePerSqftRent) {
      flag('PRICEY_PER_SQFT', SEV.WARN, `$${listing.pricePerSqft}/sqft/mo is above the $${track.maxPricePerSqftRent} guide.`);
    }
  }

  // --- location -------------------------------------------------------------
  if (track.targetLocations && track.targetLocations.length) {
    const hay = `${listing.city || ''} ${listing.address || ''}`.toLowerCase();
    const match = track.targetLocations.some((loc) => hay.includes(loc));
    if (!match) flag('LOCATION_MISMATCH', SEV.WARN, `${listing.city || 'Location'} is outside the target areas.`);
  }

  // --- freshness ------------------------------------------------------------
  if (listing.receivedAt) {
    const ageDays = (Date.now() - new Date(listing.receivedAt).getTime()) / 86_400_000;
    if (ageDays > preferences.freshnessDays) {
      flag('STALE', SEV.INFO, `Listing email is ${Math.round(ageDays)} days old.`);
    }
  }

  // --- dedupe ---------------------------------------------------------------
  if (seenKeys.has(listing.key)) {
    flag('DUPLICATE', SEV.INFO, 'Already seen this listing earlier in the batch.');
  } else {
    seenKeys.add(listing.key);
  }

  return { trackKey, flags };
}

export function hasHardFlag(flags) {
  return flags.some((f) => f.severity === SEV.HARD);
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}
