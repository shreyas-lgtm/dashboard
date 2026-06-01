// Pure cost engine — implements the Annexure A rate-card math.
//
// Everything here is a pure function of its inputs and the constants in
// rateCard.ts, so it is trivially testable (see costEngine.test.ts) and has no
// React / DOM dependency.

import {
  ADJUSTMENTS,
  COMMERCIAL,
  FINISHES,
  GROSS_UP,
  HOLES,
  MATERIALS,
  PROCESSING,
  type FinishId,
  type MaterialId,
  type ProcessId,
} from './rateCard';
import type { SystemId } from './systems';

export interface HoleCounts {
  drilled: number;
  tapped: number;
  countersunk: number;
}

export interface PartInput {
  id: string;
  name: string;
  /** Which robotic system this part belongs to (for BOM grouping). */
  system: SystemId;
  material: MaterialId;
  process: ProcessId;
  /** Finished part weight in kg (one piece). */
  finishedWeightKg: number;
  /** Precision grinding 0.05mm flat/parallel — ground both faces (plate only). */
  precisionGround: boolean;
  /** 0.5mm flatness premium (plate only). */
  flatnessPremium: boolean;
  holes: HoleCounts;
  finish: FinishId;
  quantity: number;
}

export interface PartCost {
  // Line items (per single piece, in INR).
  material: number;
  processing: number;
  holes: number;
  finishing: number;
  smallPartPenalty: number;
  /** material + processing + holes + finishing + smallPartPenalty */
  subtotal: number;
  designRiskBuffer: number;
  qcInspection: number;
  /** Rate-card cost for ONE piece (subtotal + buffer + QC). Excludes margin/GST. */
  unitCost: number;
  /** unitCost × quantity. */
  lineTotal: number;
  // Supporting figures surfaced for transparency in the UI.
  rawMaterialKg: number;
  grossUpFactor: number;
  processingRatePerKg: number;
  isSmallPart: boolean;
}

export function emptyHoles(): HoleCounts {
  return { drilled: 0, tapped: 0, countersunk: 0 };
}

/** Gross-up factor (raw consumed / finished) for the chosen process. */
export function grossUpFor(part: PartInput): number {
  switch (part.process) {
    case 'sheet_steel':
    case 'sheet_aluminium':
      return GROSS_UP.sheetMetal;
    case 'plate_machined':
      return part.precisionGround
        ? GROSS_UP.platePrecisionGround
        : GROSS_UP.plateGeneral;
  }
}

/** Processing rate (INR/kg of finished weight) including plate multipliers. */
export function processingRateFor(part: PartInput): number {
  switch (part.process) {
    case 'sheet_steel':
      return PROCESSING.sheetSteelPerKg;
    case 'sheet_aluminium':
      return PROCESSING.aluminiumSheetPerKg;
    case 'plate_machined': {
      let rate = PROCESSING.plateMachiningPerKg;
      if (part.precisionGround) rate *= PROCESSING.precisionGrindingMult;
      if (part.flatnessPremium) rate *= PROCESSING.flatnessPremiumMult;
      return rate;
    }
  }
}

export function computePartCost(part: PartInput): PartCost {
  const weight = Math.max(0, part.finishedWeightKg);
  const qty = Math.max(0, Math.floor(part.quantity));

  // A + B. Raw material consumed = finished × gross-up × (1 + yield loss).
  const grossUpFactor = grossUpFor(part);
  const rawMaterialKg = weight * grossUpFactor * (1 + GROSS_UP.yieldLossAdditive);
  const material = rawMaterialKg * MATERIALS[part.material].ratePerKg;

  // C. Processing on finished weight × multipliers.
  const processingRatePerKg = processingRateFor(part);
  const processing = weight * processingRatePerKg;

  // D. Hole operations.
  const holes =
    part.holes.drilled * HOLES.drilled +
    part.holes.tapped * HOLES.tapped +
    part.holes.countersunk * HOLES.countersunk;

  // E. Finishing on finished weight.
  const finishing = weight * FINISHES[part.finish].ratePerKg;

  // F. Small-part handling penalty (flat INR/kg) for parts below threshold.
  const isSmallPart = weight > 0 && weight < ADJUSTMENTS.smallPartThresholdKg;
  const smallPartPenalty = isSmallPart
    ? ADJUSTMENTS.smallPartPenaltyPerKg * weight
    : 0;

  const subtotal = material + processing + holes + finishing + smallPartPenalty;

  // F. Buffer + QC applied on subtotal.
  const designRiskBuffer = subtotal * ADJUSTMENTS.designRiskBuffer;
  const qcInspection = subtotal * ADJUSTMENTS.qcInspection;

  const unitCost = subtotal + designRiskBuffer + qcInspection;
  const lineTotal = unitCost * qty;

  return {
    material,
    processing,
    holes,
    finishing,
    smallPartPenalty,
    subtotal,
    designRiskBuffer,
    qcInspection,
    unitCost,
    lineTotal,
    rawMaterialKg,
    grossUpFactor,
    processingRatePerKg,
    isSmallPart,
  };
}

export interface PackageOptions {
  applyMargin: boolean;
  marginRate: number; // e.g. 0.23
  applyGst: boolean;
  gstRate: number; // e.g. 0.18
}

export const defaultPackageOptions: PackageOptions = {
  applyMargin: false,
  marginRate: COMMERCIAL.margin,
  applyGst: false,
  gstRate: COMMERCIAL.gst,
};

export interface PackageCost {
  lines: { part: PartInput; cost: PartCost }[];
  /** Sum of rate-card line totals (excludes margin/GST). */
  rateCardSubtotal: number;
  margin: number;
  /** rateCardSubtotal + margin. */
  priceBeforeGst: number;
  gst: number;
  /** Final budgetary figure including any selected add-ons. */
  grandTotal: number;
  totalUnits: number;
}

export function computePackageCost(
  parts: PartInput[],
  opts: PackageOptions = defaultPackageOptions,
): PackageCost {
  const lines = parts.map((part) => ({ part, cost: computePartCost(part) }));
  const rateCardSubtotal = lines.reduce((s, l) => s + l.cost.lineTotal, 0);
  const totalUnits = parts.reduce((s, p) => s + Math.max(0, Math.floor(p.quantity)), 0);

  const margin = opts.applyMargin ? rateCardSubtotal * opts.marginRate : 0;
  const priceBeforeGst = rateCardSubtotal + margin;
  const gst = opts.applyGst ? priceBeforeGst * opts.gstRate : 0;
  const grandTotal = priceBeforeGst + gst;

  return {
    lines,
    rateCardSubtotal,
    margin,
    priceBeforeGst,
    gst,
    grandTotal,
    totalUnits,
  };
}
