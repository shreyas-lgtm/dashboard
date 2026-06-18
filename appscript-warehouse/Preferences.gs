/**
 * Preferences.gs — your warehouse sourcing criteria (Brooklyn).
 *
 * THIS is the one block you tune. Everything the agent negates, flags, or
 * ranks flows from here. Apps Script shares globals across all .gs files, so
 * PREFERENCES is visible everywhere in the project.
 *
 * "Musts" are hard requirements: miss one and the listing is either rejected
 * or — if it's otherwise excellent — flagged as "great, but needs a
 * compromise." Everything else is a soft preference that only moves the score.
 *
 * (Sibling of the residential Listings Agent — same machine, warehouse brain.)
 */
const PREFERENCES = {
  // Industrial leases are quoted in $/SF/YEAR; these are annual per-SF rates.
  // ideal = the target, max = the flexible ceiling. Between the two = "over
  // target but within flex" (a note). Above max = a must-violation.
  idealRatePsfYr: 30,
  maxRatePsfYr: 42,

  // If you're BUYING instead of leasing.
  idealSalePrice: 4000000,
  maxSalePrice: 7000000,

  // Size band you actually want (square feet).
  minSqft: 5000,     // hard floor — smaller is a must-violation
  idealSqft: 12000,
  maxSqft: 60000,    // bigger than this is a soft over-shoot, not a reject

  // Building specs.
  minClearHeight: 14,   // ft — under this is flagged (low for racking/trucks)
  idealClearHeight: 18,
  minDocks: 1,          // dock-high doors; 0 (street-level only) is a soft flag

  // Brooklyn industrial submarkets (case-insensitive substring match). Outside
  // these = a must-violation, so the borough filter is real, not cosmetic.
  targetLocations: [
    'brooklyn', 'red hook', 'sunset park', 'industry city', 'gowanus',
    'east williamsburg', 'williamsburg', 'greenpoint', 'bushwick',
    'navy yard', 'east new york', 'brownsville', 'canarsie',
    'bath beach', 'bensonhurst', 'flatlands', 'cypress hills', 'maspeth',
    '11205', '11206', '11211', '11215', '11217', '11220', '11231', '11232',
    '11237', '11236', '11207', '11208', '11222', '11201',
  ],

  // NYC manufacturing districts you can operate in. Off-zoning = soft flag.
  preferredZoning: ['m1', 'm2', 'm3'],

  // Desirable features → weight. Tokens must match what Parser.gs emits.
  features: {
    'dock-high loading': 3, 'drive-in door': 3, 'truck court': 2,
    'heavy power': 2, 'high ceilings': 2, 'fenced yard': 2,
    'climate controlled': 1, 'sprinklered': 1, 'rail access': 1,
    'crane': 1, 'office buildout': 1, 'ground floor': 1,
  },

  freshnessDays: 21,

  // Optional drive-time scoring to a fixed destination (your hub / a port /
  // the BQE on-ramp you care about). Set Script Property DRIVE_DEST to an
  // address to enable; mode is driving. Dormant when unset.
  drive: { idealMinutes: 20, maxMinutes: 45 },

  // Score weights (soft desirability, 0–1 each). The verdict layer handles the
  // hard musts separately, so these just say "how good is it, ignoring gates."
  weights: {
    rateFit: 0.24,        // $/SF/yr (lease) or sale price vs budget
    sizeFit: 0.18,
    locationMatch: 0.12,
    clearHeightFit: 0.12,
    loadingFit: 0.12,     // docks + drive-in doors
    features: 0.10,
    zoningFit: 0.04,
    driveFit: 0.04,
    freshness: 0.02,
    dataCompleteness: 0.02,
  },

  // Verdict thresholds on the 0–100 fit score.
  thresholds: {
    strong: 75,        // meets musts + this → Shortlist
    consider: 55,      // meets musts + this → Worth a look
    nearMiss: 70,      // fails a must BUT this good → "great, needs a compromise"
  },
};
