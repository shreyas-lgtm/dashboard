import { describe, it, expect } from 'vitest';
import {
  computePartCost,
  computePackageCost,
  emptyHoles,
  type PartInput,
} from './costEngine';

const base: PartInput = {
  id: 'p',
  name: 'part',
  system: 'Unsorted',
  material: 'CRCA',
  process: 'sheet_steel',
  finishedWeightKg: 1.5,
  precisionGround: false,
  flatnessPremium: false,
  holes: emptyHoles(),
  finish: 'none',
  quantity: 1,
};

const round = (n: number) => Math.round(n * 100) / 100;

describe('computePartCost — CRCA sheet bracket (small part)', () => {
  const part: PartInput = {
    ...base,
    finishedWeightKg: 1.5,
    holes: { drilled: 4, tapped: 2, countersunk: 0 },
    finish: 'powder',
  };
  const c = computePartCost(part);

  it('grosses up material 1.30× plus 5% yield loss at ₹105/kg', () => {
    // 1.5 × 1.30 × 1.05 = 2.0475 kg → × 105
    expect(round(c.rawMaterialKg)).toBe(2.05);
    expect(round(c.material)).toBe(214.99);
  });

  it('charges sheet-steel processing at ₹105/kg of finished weight', () => {
    expect(c.processing).toBe(1.5 * 105); // 157.5
  });

  it('does NOT charge drilled holes on a laser-cut sheet (only 2 tapped × 16)', () => {
    // 4 drilled holes are part of the laser cut profile → ₹0; tapped is a
    // secondary op and is still charged: 2 × 16 = 32.
    expect(c.holes).toBe(32);
  });

  it('charges powder coat at ₹75/kg finished', () => {
    expect(c.finishing).toBe(1.5 * 75); // 112.5
  });

  it('applies the small-part penalty (1.5kg < 2kg) at ₹150/kg', () => {
    expect(c.isSmallPart).toBe(true);
    expect(c.smallPartPenalty).toBe(225);
  });

  it('applies 7.5% buffer + 10% QC and lands the unit cost', () => {
    // subtotal = 214.9875 + 157.5 + 32 + 112.5 + 225 = 741.9875
    expect(round(c.subtotal)).toBe(741.99);
    expect(round(c.unitCost)).toBe(871.84); // 741.9875 × 1.175
  });
});

describe('computePartCost — laser-cut holes vs machined drilling', () => {
  it('charges drilled holes only on a machined plate, not on a sheet', () => {
    const sheet = computePartCost({ ...base, process: 'sheet_steel', holes: { drilled: 10, tapped: 0, countersunk: 0 } });
    expect(sheet.holes).toBe(0); // all 10 are laser-cut, included in the cut

    const plate = computePartCost({ ...base, process: 'plate_machined', holes: { drilled: 10, tapped: 0, countersunk: 0 } });
    expect(plate.holes).toBe(80); // 10 drilled × ₹8 — genuine secondary drilling
  });
});

describe('computePartCost — assembly / welding line', () => {
  const asm: PartInput = { ...base, kind: 'assembly', weldLengthIn: 20, finishedWeightKg: 0, quantity: 2 };
  const c = computePartCost(asm);

  it('prices weld length at the assumed ₹17/inch with no material/processing', () => {
    expect(c.welding).toBe(20 * 17); // 340
    expect(c.material).toBe(0);
    expect(c.processing).toBe(0);
    expect(c.subtotal).toBe(340);
  });

  it('still applies buffer + QC, then multiplies by quantity', () => {
    expect(round(c.unitCost)).toBe(round(340 * 1.175)); // 399.5
    expect(round(c.lineTotal)).toBe(round(340 * 1.175 * 2)); // 799
  });
});

describe('computePartCost — SAILMA precision-ground base plate', () => {
  const part: PartInput = {
    ...base,
    name: 'base plate',
    material: 'SAILMA',
    process: 'plate_machined',
    precisionGround: true,
    finishedWeightKg: 12,
    holes: { drilled: 8, tapped: 6, countersunk: 4 },
    finish: 'none',
  };
  const c = computePartCost(part);

  it('uses 1.80× gross-up for plate ground both faces', () => {
    expect(c.grossUpFactor).toBe(1.8);
    expect(round(c.rawMaterialKg)).toBe(22.68); // 12 × 1.8 × 1.05
    expect(round(c.material)).toBe(2835); // 22.68 × 125
  });

  it('doubles plate machining rate for precision grinding (₹130 × 2.0)', () => {
    expect(c.processingRatePerKg).toBe(260);
    expect(c.processing).toBe(12 * 260); // 3120
  });

  it('is not a small part and gets no penalty', () => {
    expect(c.isSmallPart).toBe(false);
    expect(c.smallPartPenalty).toBe(0);
  });

  it('sums holes (8×8 + 6×16 + 4×28 = 272) and totals correctly', () => {
    expect(c.holes).toBe(272);
    // subtotal = 2835 + 3120 + 272 = 6227 ; × 1.175
    expect(round(c.subtotal)).toBe(6227);
    expect(round(c.unitCost)).toBe(7316.73);
  });
});

describe('computePartCost — Al 6061 top plate (flatness premium)', () => {
  const part: PartInput = {
    ...base,
    material: 'AL6061',
    process: 'plate_machined',
    flatnessPremium: true,
    finishedWeightKg: 5,
  };
  const c = computePartCost(part);

  it('uses general plate gross-up 1.45× (not ground both faces)', () => {
    expect(c.grossUpFactor).toBe(1.45);
  });

  it('applies 1.40× flatness premium on the ₹130 base rate', () => {
    expect(round(c.processingRatePerKg)).toBe(182); // 130 × 1.4
  });
});

describe('computePackageCost — optional margin and GST', () => {
  const parts: PartInput[] = [{ ...base, quantity: 3 }];

  it('excludes margin and GST by default (rate card is reference-only)', () => {
    const pkg = computePackageCost(parts);
    expect(pkg.margin).toBe(0);
    expect(pkg.gst).toBe(0);
    expect(pkg.grandTotal).toBe(pkg.rateCardSubtotal);
    expect(pkg.totalUnits).toBe(3);
  });

  it('applies 23% margin then 18% GST when enabled', () => {
    const pkg = computePackageCost(parts, {
      applyMargin: true,
      marginRate: 0.23,
      applyGst: true,
      gstRate: 0.18,
    });
    expect(round(pkg.margin)).toBe(round(pkg.rateCardSubtotal * 0.23));
    expect(round(pkg.gst)).toBe(round(pkg.priceBeforeGst * 0.18));
    expect(round(pkg.grandTotal)).toBe(round(pkg.priceBeforeGst * 1.18));
  });
});
