/**
 * Preferences.gs — your sourcing criteria.
 *
 * THIS is the one block you tune. Everything the agent negates, flags, or
 * ranks flows from here. Apps Script shares globals across all .gs files, so
 * PREFERENCES is visible everywhere in the project.
 *
 * "Musts" are hard requirements: miss one and the listing is either rejected
 * or — if it's otherwise excellent — flagged as "great, but needs a
 * compromise." Everything else is a soft preference that only moves the score.
 */
const PREFERENCES = {
  residential: {
    label: 'Residential',
    // Budget — ideal is the target, max is the flexible ceiling. Between the
    // two = "over target but within flex" (a note, not a rejection). Above
    // max = a must-violation.
    idealRent: 4000,
    maxRent: 4500,
    idealSalePrice: 950000,
    maxSalePrice: 1200000,
    // Beds/baths.
    minBeds: 3,
    idealBeds: 4,
    minBaths: 2,   // hard requirement (your call) — under 2 triggers a flag
    // Where you actually want to live (case-insensitive substring match).
    targetLocations: [
      'brooklyn', 'bedford-stuyvesant', 'bed-stuy', 'bushwick',
      'crown heights', 'clinton hill', 'prospect heights', 'williamsburg',
    ],
    maxPricePerSqftRent: 4.0,
    // Furnished ideal; unfurnished fine if amenity-rich. Tokens must match
    // what Parser.gs emits.
    amenities: {
      'in-unit laundry': 3, dishwasher: 3, dryer: 2, washer: 2,
      'shared laundry': 1, 'stainless appliances': 1,
      elevator: 1, doorman: 1, gym: 1, parking: 1,
      'central air': 1, 'outdoor space': 1, pool: 1, pets: 1, hardwood: 1,
    },
  },

  warehouse: {
    label: 'Warehouse / Industrial',
    idealRent: 35000,
    maxRent: 50000,
    minSqft: 5000,
    targetLocations: [],
    maxPricePerSqftRent: 2.5,
    amenities: null, // n/a for warehouse
  },

  freshnessDays: 21,

  // Commute scoring: travel time from each listing to a fixed destination.
  // The destination ADDRESS is set as a Script Property named COMMUTE_DEST
  // (Project Settings → Script Properties) so you can change it without code.
  // If it's not set, commute scoring stays neutral (no effect).
  commute: {
    mode: 'transit',     // 'transit' | 'driving' | 'walking'
    idealMinutes: 30,    // <= this → full marks
    maxMinutes: 60,      // >= this → near-zero
  },

  // Score weights (soft desirability, 0–1 each). The verdict layer handles the
  // hard musts separately, so these just say "how good is it, ignoring gates."
  weights: {
    budgetFit: 0.22,
    bedsFit: 0.18,
    locationMatch: 0.10,
    commuteFit: 0.15,
    furnishingAmenities: 0.18,
    pricePerSqft: 0.05,
    freshness: 0.04,
    dataCompleteness: 0.08,
  },

  // Verdict thresholds on the 0–100 fit score.
  thresholds: {
    strong: 75,        // meets musts + this → Shortlist
    consider: 55,      // meets musts + this → Worth a look
    nearMiss: 70,      // fails a must BUT this good → "great, needs a compromise"
  },
};
