// Annexure A — Manufacturing Rate Card (Reference Only)
// Source: SPMIL Contract Manufacturing Proposal, Quote Ref SPMIL/ORIGIN/2026-05/003 (Rev 5)
//
// This file is a faithful, single-source-of-truth transcription of the rate card.
// It is the ONLY place rates live — the cost engine reads everything from here so
// that when SPMIL revises the card, one edit updates the whole calculator.
//
// NOTE (from the proposal): "Rate cards do not have SPMIL margin and GST included
// in it." Margin (23%) and GST (18%) are therefore modelled as optional, clearly
// labelled add-ons applied at the package level, not baked into the part cost.

export type MaterialId = 'CRCA' | 'SAILMA' | 'AL5052' | 'AL6061';

export interface Material {
  id: MaterialId;
  label: string;
  /** A. Raw material rate, INR per kg (before yield loss). */
  ratePerKg: number;
  /** Density used for auto mass-estimation from CAD geometry, kg/m^3. */
  densityKgM3: number;
  notes: string;
}

// A. Raw Material Rates — INR per kg, before yield loss.
export const MATERIALS: Record<MaterialId, Material> = {
  CRCA: {
    id: 'CRCA',
    label: 'Carbon steel sheet (CRCA)',
    ratePerKg: 105,
    densityKgM3: 7850,
    notes: 'For sheet metal parts up to 3mm thick',
  },
  SAILMA: {
    id: 'SAILMA',
    label: 'Carbon steel plate (SAILMA)',
    ratePerKg: 125,
    densityKgM3: 7850,
    notes: 'For machined plates incl. precision-ground bottom plate (20mm)',
  },
  AL5052: {
    id: 'AL5052',
    label: 'Aluminium 5052 sheet',
    ratePerKg: 395,
    densityKgM3: 2680,
    notes: 'Door grade, anodisable',
  },
  AL6061: {
    id: 'AL6061',
    label: 'Aluminium 6061 plate',
    ratePerKg: 440,
    densityKgM3: 2700,
    notes: 'Top plate material (8mm)',
  },
};

// B. Gross-up Factors — raw material consumed / finished weight.
export const GROSS_UP = {
  sheetMetal: 1.3, // drop + scrap, laser-cut sheets with nesting drop
  plateGeneral: 1.45, // machined plates (e.g. 8mm Al 6061 top plate)
  platePrecisionGround: 1.8, // 20mm SAILMA bottom plate, ground both faces
  yieldLossAdditive: 0.05, // in-process yield loss applied on top of gross-up
} as const;

// C. Processing Rates and Multipliers.
export const PROCESSING = {
  /** Sheet metal — laser cut + press brake + deburr. INR/kg. CRCA 3mm parts. */
  sheetSteelPerKg: 105,
  /** Plate machining base rate (general tolerance), INR/kg, before multipliers. */
  plateMachiningPerKg: 130,
  /** Precision grinding multiplier (0.05mm flat/parallel) — 20mm SAILMA plate. */
  precisionGrindingMult: 2.0,
  /** 0.5mm flatness premium multiplier — 8mm Al 6061 top plate. */
  flatnessPremiumMult: 1.4,
  /** Aluminium sheet — cut + deburr + edge finish. INR/kg. Al 5052 doors. */
  aluminiumSheetPerKg: 60,
} as const;

// D. Hole Operations — INR per hole.
export const HOLES = {
  drilled: 8, // generic clearance hole
  tapped: 16, // tapped hole M5–M10 (M6/M8 common)
  countersunk: 28, // countersunk hole Ø18 × 90°
} as const;

export type HoleType = keyof typeof HOLES;

// E. Finishing — INR per kg of finished weight.
export type FinishId = 'none' | 'powder' | 'anodise';

export const FINISHES: Record<FinishId, { label: string; ratePerKg: number }> = {
  none: { label: 'None / as-machined', ratePerKg: 0 },
  powder: { label: 'Powder coating (any colour, incl. RAL 9017)', ratePerKg: 75 },
  anodise: { label: 'Hard anodising (Type II / III, 25–50µm)', ratePerKg: 250 },
};

// F. Adjustments.
export const ADJUSTMENTS = {
  smallPartPenaltyPerKg: 150, // INR/kg flat, setup-dominated low-utilisation parts
  smallPartThresholdKg: 2.0, // parts below this weight attract the penalty
  designRiskBuffer: 0.075, // 7.5% on subtotal; reduce as drawings mature
  qcInspection: 0.1, // 10% on subtotal; FAI, dimensional checks, sign-off
} as const;

// Commercial add-ons — NOT part of the rate card itself (see note above).
export const COMMERCIAL = {
  margin: 0.23, // standard contract-manufacturing margin (proposal §5)
  gst: 0.18, // GST added at invoicing (proposal §6)
} as const;

// Process archetypes the user picks from — each maps to the right gross-up and
// processing rate so the form stays close to how the rate card is written.
export type ProcessId =
  | 'sheet_steel'
  | 'sheet_aluminium'
  | 'plate_machined';

export const PROCESSES: Record<
  ProcessId,
  { label: string; allowsPrecisionGround: boolean; allowsFlatness: boolean; notes: string }
> = {
  sheet_steel: {
    label: 'Sheet metal — laser + press brake + deburr (CRCA)',
    allowsPrecisionGround: false,
    allowsFlatness: false,
    notes: 'Gross-up 1.30×, processing ₹105/kg',
  },
  sheet_aluminium: {
    label: 'Aluminium sheet — cut + deburr + edge finish (Al 5052)',
    allowsPrecisionGround: false,
    allowsFlatness: false,
    notes: 'Gross-up 1.30×, processing ₹60/kg',
  },
  plate_machined: {
    label: 'Plate — machined (SAILMA / Al 6061)',
    allowsPrecisionGround: true,
    allowsFlatness: true,
    notes: 'Gross-up 1.45× (1.80× if ground both faces), processing ₹130/kg × multipliers',
  },
};
