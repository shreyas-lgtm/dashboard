/**
 * Scoring.gs — scrutinise, rank, and reach a verdict.
 *
 * Three-way verdict (the thing you asked for):
 *   ✅ Shortlist                 — meets every must, and scores well
 *   🟡 Worth a look / Weak fit   — meets musts, middling score
 *   ⚠️ Great, needs a compromise — fails ONE must but is otherwise excellent
 *   🚫 Doesn't fit               — fails a must and isn't compelling enough
 *
 * "Musts" = hard requirements (beds, baths, budget ceiling, area, has a price).
 * Everything else is soft and only nudges the score.
 */

function clamp01_(x) { return Math.max(0, Math.min(1, x)); }
function fmt_(n) { return Number(n).toLocaleString('en-US'); }

function pickTrack_(listing) {
  const text = ((listing.address || '') + ' ' + (listing.source || '')).toLowerCase();
  const commercial = (listing.beds == null && (listing.sqft || 0) >= 3000) ||
    /warehouse|industrial|loopnet|crexi/i.test(text);
  return commercial ? 'warehouse' : 'residential';
}

/** Returns { trackKey, flags:[{code,severity,message}] }. severity: must|warn|info */
function scrutinize_(listing) {
  const trackKey = pickTrack_(listing);
  const t = PREFERENCES[trackKey];
  const flags = [];
  const add = function (code, severity, message) { flags.push({ code: code, severity: severity, message: message }); };

  if (listing.price == null) add('NO_PRICE', 'must', 'No price in the email.');

  // Budget: over ceiling = must; between ideal and ceiling = soft "over target".
  if (listing.price != null) {
    const ideal = listing.dealType === 'sale' ? t.idealSalePrice : t.idealRent;
    const ceiling = listing.dealType === 'sale' ? t.maxSalePrice : t.maxRent;
    if (ceiling != null && listing.price > ceiling) {
      add('OVER_CEILING', 'must', '$' + fmt_(listing.price) + ' is over your $' + fmt_(ceiling) + ' ceiling.');
    } else if (ideal != null && listing.price > ideal) {
      add('OVER_TARGET', 'warn', '$' + fmt_(listing.price - ideal) + ' over your $' + fmt_(ideal) + ' target (within flex).');
    }
  }

  if (trackKey === 'residential') {
    if (listing.beds != null && listing.beds < t.minBeds) {
      add('BELOW_MIN_BEDS', 'must', listing.beds + ' bed(s) — under your ' + t.minBeds + '-bed minimum.');
    } else if (listing.beds != null && listing.beds < t.idealBeds) {
      add('BELOW_IDEAL_BEDS', 'info', listing.beds + ' beds (' + t.idealBeds + ' is ideal).');
    }
    if (listing.baths != null && listing.baths < t.minBaths) {
      add('BELOW_MIN_BATHS', 'must', listing.baths + ' bath(s) — under your ' + t.minBaths + '-bath minimum.');
    }
    if (listing.furnished === false && listing.amenities.length === 0) {
      add('UNFURNISHED_NO_AMENITIES', 'warn', 'Unfurnished and no amenities listed.');
    } else if (listing.furnished == null && listing.amenities.length === 0) {
      add('AMENITIES_UNKNOWN', 'info', 'Furnishing/amenities not in the email — open the listing.');
    }
  } else {
    if (t.minSqft != null && listing.sqft != null && listing.sqft < t.minSqft) {
      add('TOO_SMALL', 'must', fmt_(listing.sqft) + ' sqft — under your ' + fmt_(t.minSqft) + ' sqft minimum.');
    }
  }

  // Location.
  if (t.targetLocations && t.targetLocations.length) {
    const hay = ((listing.city || '') + ' ' + (listing.address || '')).toLowerCase();
    const match = t.targetLocations.some(function (loc) { return hay.indexOf(loc) !== -1; });
    if (!match) add('OUTSIDE_AREA', 'must', (listing.city || 'Location') + ' is outside your target areas.');
  }

  // Value + freshness (soft).
  if (listing.dealType === 'rent' && listing.pricePerSqft != null && t.maxPricePerSqftRent != null &&
      listing.pricePerSqft > t.maxPricePerSqftRent) {
    add('PRICEY_PER_SQFT', 'warn', '$' + listing.pricePerSqft + '/sqft is above your $' + t.maxPricePerSqftRent + ' guide.');
  }
  if (listing.receivedAt) {
    const ageDays = (Date.now() - new Date(listing.receivedAt).getTime()) / 86400000;
    if (ageDays > PREFERENCES.freshnessDays) add('STALE', 'info', Math.round(ageDays) + ' days old.');
  }

  return { trackKey: trackKey, flags: flags };
}

/** Soft desirability 0–100. Gates are NOT applied here — the verdict handles them. */
function rank_(listing, trackKey, flags) {
  const t = PREFERENCES[trackKey];
  const w = PREFERENCES.weights;
  const b = {};

  b.budgetFit = scoreBudget_(listing, t);
  b.bedsFit = trackKey === 'residential' ? scoreBeds_(listing, t) : scoreSize_(listing, t);
  b.locationMatch = scoreLocation_(listing, t);
  b.furnishingAmenities = scoreFurnishing_(listing, t);
  b.pricePerSqft = scorePricePerSqft_(listing, t);
  b.freshness = scoreFreshness_(listing);
  b.dataCompleteness = scoreCompleteness_(listing);

  let raw = w.budgetFit * b.budgetFit + w.bedsFit * b.bedsFit + w.locationMatch * b.locationMatch +
    w.furnishingAmenities * b.furnishingAmenities + w.pricePerSqft * b.pricePerSqft +
    w.freshness * b.freshness + w.dataCompleteness * b.dataCompleteness;

  const warns = flags.filter(function (f) { return f.severity === 'warn'; }).length;
  raw -= Math.min(0.12, warns * 0.04);

  return { score: Math.round(clamp01_(raw) * 100), breakdown: b };
}

/** Combine score + musts into a verdict and a human note. */
function evaluate_(listing, flags, score) {
  const musts = flags.filter(function (f) { return f.severity === 'must'; });
  const warns = flags.filter(function (f) { return f.severity === 'warn'; });
  const th = PREFERENCES.thresholds;
  const meetsMusts = musts.length === 0;

  let verdict, emoji;
  if (meetsMusts) {
    if (score >= th.strong) { verdict = 'Shortlist'; emoji = '✅'; }
    else if (score >= th.consider) { verdict = 'Worth a look'; emoji = '🟡'; }
    else { verdict = 'Weak fit'; emoji = '🟡'; }
  } else if (score >= th.nearMiss) {
    verdict = 'Great, needs a compromise'; emoji = '⚠️';
  } else {
    verdict = "Doesn't fit"; emoji = '🚫';
  }

  let note;
  const mustText = musts.map(function (f) { return f.message; }).join(' ');
  const warnText = warns.map(function (f) { return f.message; }).join(' ');
  if (!meetsMusts) {
    note = (score >= th.nearMiss ? 'Strong otherwise — compromise: ' : 'Reject: ') + mustText;
    if (warnText) note += ' ' + warnText;
  } else {
    note = warnText || 'Meets all your requirements.';
  }

  return { verdict: emoji + ' ' + verdict, emoji: emoji, note: note, meetsMusts: meetsMusts };
}

// --- sub-scorers -----------------------------------------------------------
function scoreBudget_(l, t) {
  if (l.price == null) return 0;
  const ideal = l.dealType === 'sale' ? t.idealSalePrice : t.idealRent;
  const cap = l.dealType === 'sale' ? t.maxSalePrice : t.maxRent;
  if (ideal == null || cap == null) return 0.5;
  if (l.price <= ideal) return 1;
  if (l.price >= cap * 1.15) return 0.05;
  if (l.price >= cap) return 0.2;
  return clamp01_(1 - 0.8 * ((l.price - ideal) / (cap - ideal)));
}
function scoreBeds_(l, t) {
  if (l.beds == null) return 0.4;
  const min = t.minBeds || 0, ideal = t.idealBeds || min;
  if (l.beds >= ideal) return 1;
  if (l.beds < min) return clamp01_((l.beds / Math.max(min, 1)) * 0.5);
  if (ideal === min) return 0.85;
  return clamp01_(0.7 + 0.3 * ((l.beds - min) / (ideal - min)));
}
function scoreSize_(l, t) {
  if (l.sqft == null) return 0.3;
  if (t.minSqft == null) return 1;
  return l.sqft >= t.minSqft ? clamp01_(0.8 + Math.min(0.2, (l.sqft / t.minSqft - 1) * 0.1)) : clamp01_(l.sqft / t.minSqft * 0.6);
}
function scoreLocation_(l, t) {
  if (!t.targetLocations || !t.targetLocations.length) return 1;
  const hay = ((l.city || '') + ' ' + (l.address || '')).toLowerCase();
  return t.targetLocations.some(function (loc) { return hay.indexOf(loc) !== -1; }) ? 1 : 0.15;
}
function scoreFurnishing_(l, t) {
  if (!t.amenities) return 1;
  const wants = t.amenities;
  let maxW = 0; for (const k in wants) maxW += wants[k];
  maxW = maxW || 1;
  let gotW = 0; (l.amenities || []).forEach(function (k) { gotW += wants[k] || 0; });
  const a = clamp01_(gotW / maxW);
  if (l.furnished === true) return clamp01_(0.85 + 0.15 * a);
  if (l.furnished === false) return clamp01_(0.4 + 0.6 * a);
  if (!l.amenities || !l.amenities.length) return 0.45;
  return clamp01_(0.5 + 0.5 * a);
}
function scorePricePerSqft_(l, t) {
  if (l.pricePerSqft == null || t.maxPricePerSqftRent == null || l.dealType !== 'rent') return 0.5;
  return clamp01_(1 - (l.pricePerSqft / t.maxPricePerSqftRent - 0.5) / 0.5);
}
function scoreFreshness_(l) {
  if (!l.receivedAt) return 0.5;
  const ageDays = (Date.now() - new Date(l.receivedAt).getTime()) / 86400000;
  if (ageDays <= 2) return 1;
  if (ageDays >= PREFERENCES.freshnessDays) return 0.2;
  return clamp01_(1 - ageDays / PREFERENCES.freshnessDays);
}
function scoreCompleteness_(l) {
  const fields = ['price', 'beds', 'baths', 'sqft', 'address', 'url'];
  let present = 0; fields.forEach(function (f) { if (l[f] != null) present++; });
  return present / fields.length;
}
