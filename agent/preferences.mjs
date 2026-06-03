// ---------------------------------------------------------------------------
// Sourcing preferences — the criteria the agent scrutinises and ranks against.
//
// THIS IS THE ONE FILE YOU SHOULD TUNE. Everything the agent decides flows
// from here. Defaults below were inferred from the listing emails currently
// in the inbox (Brooklyn 3–4 bd rentals ~$3.6k–4.5k/mo, plus warehouse space).
// Adjust freely.
// ---------------------------------------------------------------------------

export const preferences = {
  // Each "track" is a separate thing you're sourcing. A listing is matched to
  // the best-fitting track, then scored against that track's criteria.
  tracks: {
    residential: {
      label: 'Residential',
      // rent = monthly price, sale = purchase price. Listings of either kind
      // are accepted; budgets are evaluated per dealType.
      maxRent: 4500,           // $/mo — flexible ceiling around the ~$4k target
      idealRent: 4000,         // $/mo — best score at or below this
      maxSalePrice: 1_200_000, // $ — for "for sale" residential
      minBeds: 3,
      idealBeds: 4,            // 4 beds is the sweet spot
      minBaths: 2,
      // Neighbourhoods / cities you actually want (case-insensitive substring).
      targetLocations: [
        'brooklyn', 'bedford-stuyvesant', 'bed-stuy', 'bushwick',
        'crown heights', 'clinton hill', 'prospect heights', 'williamsburg',
      ],
      // $/sqft above this (when sqft is known) is flagged as expensive.
      maxPricePerSqftRent: 4.0,
      // Furnished is ideal; unfurnished is fine *if* it's amenity-rich.
      furnishedIdeal: true,
      // Desired amenities and their relative importance. In-unit laundry and a
      // dishwasher matter most; the rest are nice-to-haves (apartment-complex
      // perks). Tokens must match what parse.mjs emits.
      amenities: {
        'in-unit laundry': 3,  // washer/dryer in unit
        dishwasher: 3,
        dryer: 2,
        washer: 2,
        'shared laundry': 1,
        'stainless appliances': 1,
        elevator: 1,
        doorman: 1,
        gym: 1,
        parking: 1,
        'central air': 1,
        'outdoor space': 1,
        pool: 1,
        pets: 1,
        hardwood: 1,
      },
    },
    warehouse: {
      label: 'Warehouse / Industrial',
      maxRent: 50_000,         // $/mo
      idealRent: 35_000,
      minSqft: 5_000,          // warehouses are sized by area, not beds
      targetLocations: [],     // empty = location not scored for this track
      maxPricePerSqftRent: 2.5,
    },
  },

  // Listings older than this (by email received date) are flagged STALE.
  freshnessDays: 21,

  // Weights for the ranking score (must roughly sum to 1.0). Tune to taste.
  weights: {
    budgetFit: 0.24,           // how comfortably it sits under budget
    bedsOrSizeFit: 0.20,       // beds (residential) or sqft (warehouse)
    locationMatch: 0.18,       // is it where you want
    furnishingAmenities: 0.20, // furnished, or unfurnished + good amenities
    pricePerSqft: 0.06,        // value for money (only when sqft known)
    freshness: 0.04,           // newer is better
    dataCompleteness: 0.08,    // fully-specced listings rank above vague ones
  },

  // Score thresholds → recommendation label shown in the dashboard / Slack.
  thresholds: {
    strong: 75,   // >= strong  → "Strong match"
    consider: 55, // >= consider→ "Worth a look"
    // below consider → "Skip"
  },
};
