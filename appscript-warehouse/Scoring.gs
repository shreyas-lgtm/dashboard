/**
 * Scoring.gs — scrutinise, rank, and reach a verdict (warehouse edition).
 *
 * Three-way verdict (same as the residential agent):
 *   ✅ Shortlist                 — meets every must, and scores well
 *   🟡 Worth a look / Weak fit   — meets musts, middling score
 *   ⚠️ Great, needs a compromise — fails ONE must but is otherwise excellent
 *   🚫 Doesn't fit               — fails a must and isn't compelling enough
 *
 * "Musts" = hard requirements (in Brooklyn, big enough, under budget, has a
 * price). Everything else is soft and only nudges the score.
 */

function clamp01_(x) { return Math.max(0, Math.min(1, x)); }
function fmt_(n) { return Number(n).toLocaleString('en-US'); }

/** Effective lease rate in $/SF/yr (already annualised by the parser). */
function leaseRate_(l) { return l.ratePsfYr; }

/** Returns { flags:[{code,severity,message}] }. severity: must|warn|info|reject */
function scrutinize_(listing) {
  const t = PREFERENCES;
  const flags = [];
  const add = function (code, severity, message) { flags.push({ code: code, severity: severity, message: message }); };

  const isSale = listing.dealType === 'sale';
  const rate = leaseRate_(listing);

  // Price present?
  if (isSale ? listing.salePrice == null : (rate == null && listing.rentMonthly == null)) {
    add('NO_PRICE', 'must', 'No price/rate in the email.');
  }

  // Budget: over ceiling = must; between ideal and ceiling = soft "over target".
  if (isSale && listing.salePrice != null) {
    if (listing.salePrice > t.maxSalePrice) {
      add('OVER_CEILING', 'must', '$' + fmt_(listing.salePrice) + ' is over your $' + fmt_(t.maxSalePrice) + ' ceiling.');
    } else if (listing.salePrice > t.idealSalePrice) {
      add('OVER_TARGET', 'warn', '$' + fmt_(listing.salePrice - t.idealSalePrice) + ' over your $' + fmt_(t.idealSalePrice) + ' target (within flex).');
    }
  } else if (!isSale && rate != null) {
    if (rate > t.maxRatePsfYr) {
      add('OVER_CEILING', 'must', '$' + rate + '/SF/yr is over your $' + t.maxRatePsfYr + ' ceiling.');
    } else if (rate > t.idealRatePsfYr) {
      add('OVER_TARGET', 'warn', '$' + rate + '/SF/yr is over your $' + t.idealRatePsfYr + ' target (within flex).');
    }
  }

  // Size.
  if (listing.sqft != null) {
    if (listing.sqft < t.minSqft) {
      add('TOO_SMALL', 'must', fmt_(listing.sqft) + ' SF — under your ' + fmt_(t.minSqft) + ' SF minimum.');
    } else if (t.maxSqft != null && listing.sqft > t.maxSqft) {
      add('OVER_SIZED', 'warn', fmt_(listing.sqft) + ' SF — larger than your ' + fmt_(t.maxSqft) + ' SF target.');
    }
  } else {
    add('SIZE_UNKNOWN', 'info', 'Size not in the email — open the listing.');
  }

  // Clear height.
  if (listing.clearHeight != null) {
    if (listing.clearHeight < t.minClearHeight) {
      add('LOW_CEILING', 'warn', listing.clearHeight + "' clear — under your " + t.minClearHeight + "' minimum.");
    }
  } else {
    add('CEILING_UNKNOWN', 'info', 'Clear height not stated — open the listing.');
  }

  // Loading.
  if (listing.docks != null || listing.driveIn != null) {
    if ((listing.docks || 0) === 0 && (listing.driveIn || 0) === 0) {
      add('NO_LOADING', 'warn', 'Street-level only — no docks or drive-in doors listed.');
    }
  }

  // Location — the Brooklyn gate.
  if (t.targetLocations && t.targetLocations.length) {
    const hay = ((listing.neighborhood || '') + ' ' + (listing.address || '')).toLowerCase();
    const match = t.targetLocations.some(function (loc) { return hay.indexOf(loc) !== -1; });
    if (!match) add('OUTSIDE_AREA', 'must', (listing.neighborhood || 'Location') + ' is outside your Brooklyn target areas.');
  }

  // Zoning (soft).
  if (listing.zoning && t.preferredZoning && t.preferredZoning.length) {
    const z = listing.zoning.toLowerCase();
    const ok = t.preferredZoning.some(function (p) { return z.indexOf(p) === 0; });
    if (!ok) add('OFF_ZONING', 'warn', listing.zoning + ' zoning — outside your ' + t.preferredZoning.join('/').toUpperCase() + ' preference.');
  }

  // Freshness (soft).
  if (listing.receivedAt) {
    const ageDays = (Date.now() - new Date(listing.receivedAt).getTime()) / 86400000;
    if (ageDays > t.freshnessDays) add('STALE', 'info', Math.round(ageDays) + ' days old.');
  }

  return { flags: flags };
}

/** Soft desirability 0–100. Gates are NOT applied here — the verdict handles them. */
function rank_(listing, flags) {
  const t = PREFERENCES;
  const w = t.weights;
  const b = {};

  b.rateFit = scoreRate_(listing, t);
  b.sizeFit = scoreSize_(listing, t);
  b.locationMatch = scoreLocation_(listing, t);
  b.clearHeightFit = scoreClearHeight_(listing, t);
  b.loadingFit = scoreLoading_(listing);
  b.features = scoreFeatures_(listing, t);
  b.zoningFit = scoreZoning_(listing, t);
  b.driveFit = scoreDrive_(listing);
  b.freshness = scoreFreshness_(listing);
  b.dataCompleteness = scoreCompleteness_(listing);

  let raw = w.rateFit * b.rateFit + w.sizeFit * b.sizeFit + w.locationMatch * b.locationMatch +
    w.clearHeightFit * b.clearHeightFit + w.loadingFit * b.loadingFit + w.features * b.features +
    w.zoningFit * b.zoningFit + w.driveFit * b.driveFit + w.freshness * b.freshness +
    w.dataCompleteness * b.dataCompleteness;

  if (flags.some(function (f) { return f.severity === 'reject'; })) return { score: 0, breakdown: b };

  const warns = flags.filter(function (f) { return f.severity === 'warn'; }).length;
  raw -= Math.min(0.12, warns * 0.04);

  return { score: Math.round(clamp01_(raw) * 100), breakdown: b };
}

/** Combine score + musts into a verdict and a human note. */
function evaluate_(listing, flags, score) {
  const rejects = flags.filter(function (f) { return f.severity === 'reject'; });
  const musts = flags.filter(function (f) { return f.severity === 'must'; });
  const warns = flags.filter(function (f) { return f.severity === 'warn'; });
  const th = PREFERENCES.thresholds;

  if (rejects.length) {
    return {
      verdict: '🚫 Doesn’t fit', emoji: '🚫',
      note: 'Reject: ' + rejects.concat(musts).map(function (f) { return f.message; }).join(' '),
      meetsMusts: false,
    };
  }

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
function scoreRate_(l, t) {
  if (l.dealType === 'sale') {
    if (l.salePrice == null) return 0;
    const ideal = t.idealSalePrice, cap = t.maxSalePrice;
    if (l.salePrice <= ideal) return 1;
    if (l.salePrice >= cap * 1.15) return 0.05;
    if (l.salePrice >= cap) return 0.2;
    return clamp01_(1 - 0.8 * ((l.salePrice - ideal) / (cap - ideal)));
  }
  const rate = leaseRate_(l);
  if (rate == null) return 0;
  const ideal = t.idealRatePsfYr, cap = t.maxRatePsfYr;
  if (rate <= ideal) return 1;
  if (rate >= cap * 1.15) return 0.05;
  if (rate >= cap) return 0.2;
  return clamp01_(1 - 0.8 * ((rate - ideal) / (cap - ideal)));
}

function scoreSize_(l, t) {
  if (l.sqft == null) return 0.3;
  if (l.sqft < t.minSqft) return clamp01_(l.sqft / t.minSqft * 0.6);
  if (t.maxSqft != null && l.sqft > t.maxSqft) return clamp01_(0.7 - Math.min(0.4, (l.sqft / t.maxSqft - 1) * 0.5));
  const ideal = t.idealSqft || t.minSqft;
  if (l.sqft >= ideal) return 1;
  return clamp01_(0.7 + 0.3 * ((l.sqft - t.minSqft) / Math.max(1, ideal - t.minSqft)));
}

function scoreLocation_(l, t) {
  if (!t.targetLocations || !t.targetLocations.length) return 1;
  const hay = ((l.neighborhood || '') + ' ' + (l.address || '')).toLowerCase();
  return t.targetLocations.some(function (loc) { return hay.indexOf(loc) !== -1; }) ? 1 : 0.15;
}

function scoreClearHeight_(l, t) {
  if (l.clearHeight == null) return 0.4;
  const min = t.minClearHeight || 0, ideal = t.idealClearHeight || min;
  if (l.clearHeight >= ideal) return 1;
  if (l.clearHeight < min) return clamp01_(l.clearHeight / Math.max(min, 1) * 0.6);
  return clamp01_(0.7 + 0.3 * ((l.clearHeight - min) / Math.max(1, ideal - min)));
}

function scoreLoading_(l) {
  const docks = l.docks, di = l.driveIn;
  if (docks == null && di == null) return 0.45;        // unknown → neutral-ish
  if ((docks || 0) === 0 && (di || 0) === 0) return 0.25; // street-level only
  let s = 0.6;
  if ((docks || 0) >= 1) s += 0.25;
  if ((docks || 0) >= 3) s += 0.1;
  if ((di || 0) >= 1) s += 0.15;
  return clamp01_(s);
}

function scoreFeatures_(l, t) {
  if (!t.features) return 1;
  const wants = t.features;
  let maxW = 0; for (const k in wants) maxW += wants[k];
  maxW = maxW || 1;
  let gotW = 0; (l.features || []).forEach(function (k) { gotW += wants[k] || 0; });
  if (!l.features || !l.features.length) return 0.45;
  return clamp01_(0.4 + 0.6 * clamp01_(gotW / (maxW * 0.6)));
}

function scoreZoning_(l, t) {
  if (!l.zoning || !t.preferredZoning) return 0.6;     // unknown → neutral
  const z = l.zoning.toLowerCase();
  return t.preferredZoning.some(function (p) { return z.indexOf(p) === 0; }) ? 1 : 0.3;
}

function scoreFreshness_(l) {
  if (!l.receivedAt) return 0.5;
  const ageDays = (Date.now() - new Date(l.receivedAt).getTime()) / 86400000;
  if (ageDays <= 2) return 1;
  if (ageDays >= PREFERENCES.freshnessDays) return 0.2;
  return clamp01_(1 - ageDays / PREFERENCES.freshnessDays);
}

function scoreCompleteness_(l) {
  const fields = ['sqft', 'ratePsfYr', 'salePrice', 'clearHeight', 'address', 'zoning', 'url'];
  let present = 0; fields.forEach(function (f) { if (l[f] != null) present++; });
  return clamp01_(present / 5);   // 5 of these is "complete enough"
}

// --- drive time (to a fixed destination) -----------------------------------

/**
 * Scores how close the listing is to PREFERENCES.drive destination (set as the
 * DRIVE_DEST script property — e.g. your hub or a port). Stashes minutes on the
 * listing (l.driveMins) for the sheet. Neutral when not configured or
 * uncomputable.
 */
function scoreDrive_(l) {
  const dest = PropertiesService.getScriptProperties().getProperty('DRIVE_DEST');
  if (!dest) return 0.7;            // not configured → dormant
  if (!l.address) return 0.5;
  const c = PREFERENCES.drive || {};
  const mins = driveMinutes_(l.address, dest);
  l.driveMins = mins;
  if (mins == null) return 0.5;
  const ideal = c.idealMinutes || 20, max = c.maxMinutes || 45;
  if (mins <= ideal) return 1;
  if (mins >= max) return 0.1;
  return clamp01_(1 - 0.9 * ((mins - ideal) / (max - ideal)));
}

/** Driving time in minutes via Google's Maps service, or null on failure. */
function driveMinutes_(origin, dest) {
  try {
    const finder = Maps.newDirectionFinder()
      .setOrigin(origin).setDestination(dest)
      .setMode(Maps.DirectionFinder.Mode.DRIVING);
    const res = finder.getDirections();
    const legs = res && res.routes && res.routes[0] && res.routes[0].legs;
    if (!legs || !legs[0] || !legs[0].duration) return null;
    return Math.round(legs[0].duration.value / 60);
  } catch (e) {
    Logger.log('drive calc failed (' + origin + '): ' + e);
    return null;
  }
}
