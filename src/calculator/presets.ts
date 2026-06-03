// Example parts derived from the specific component call-outs in the proposal
// (precision-ground SAILMA base plate, 8mm Al 6061 top plate, Al 5052 doors,
// CRCA sheet brackets). Loading these gives the user a realistic starting BOM
// that mirrors how the rate card describes each item.

import type { PartInput, PartMetrics } from './costEngine';
import { emptyHoles } from './costEngine';
import { classifySystem, isAssemblyFile } from './systems';
import type { ExtractionResult } from './fileParsers';
import type { MaterialId, ProcessId } from './rateCard';

const UNIT_TO_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

/** Pull displayable geometry metrics (size, volume, holes) from a parsed file. */
export function metricsFromExtraction(r: ExtractionResult): PartMetrics | undefined {
  const m: PartMetrics = {};
  if (r.stl) {
    const f = UNIT_TO_MM[r.stl.unit] ?? 1;
    m.bboxMm = [r.stl.bbox[0] * f, r.stl.bbox[1] * f, r.stl.bbox[2] * f];
    m.volumeMm3 = r.stl.volumeNative * f * f * f;
    m.triangleCount = r.stl.triangleCount;
  }
  if (r.dxf) {
    if (r.dxf.extents) m.footprintMm = r.dxf.extents;
    if (r.dxf.diameters.length) m.holeDiametersMm = r.dxf.diameters;
  }
  return Object.keys(m).length ? m : undefined;
}

// Pick a sensible default process for a material so auto-imported parts land on
// the right rate (sheet vs plate). The user can override per part.
function processForMaterial(material: MaterialId): ProcessId {
  if (material === 'AL5052') return 'sheet_aluminium';
  if (material === 'SAILMA' || material === 'AL6061') return 'plate_machined';
  return 'sheet_steel';
}

/** Build a part from a parsed file, filing it under the system in its name. */
export function partFromExtraction(result: ExtractionResult): PartInput {
  const part = blankPart(classifySystem(result.fileName));
  part.name = result.fileName;

  // An assembly/weldment drawing is a weld line, not a cut part — don't pull
  // weight/material/holes from it; the user enters the weld length.
  if (isAssemblyFile(result.fileName)) {
    part.kind = 'assembly';
    part.weldLengthIn = 0;
    part.finishedWeightKg = 0;
    if (result.provenance?.length) part.provenance = result.provenance;
    part.metrics = metricsFromExtraction(result);
    return part;
  }

  if (result.suggestedMaterial) part.material = result.suggestedMaterial;
  part.process = processForMaterial(part.material);
  if (result.suggestedFinish) part.finish = result.suggestedFinish;
  if (result.suggestedWeightKg !== undefined) {
    part.finishedWeightKg = Math.round(result.suggestedWeightKg * 1000) / 1000;
  }
  if (result.suggestedHoles) part.holes = result.suggestedHoles;
  if (result.provenance?.length) part.provenance = result.provenance;
  part.metrics = metricsFromExtraction(result);
  return part;
}

let seq = 0;
export function newId(): string {
  seq += 1;
  return `part_${Date.now().toString(36)}_${seq}`;
}

export function blankPart(system: PartInput['system'] = 'Unsorted'): PartInput {
  return {
    id: newId(),
    name: 'New part',
    system,
    kind: 'part',
    material: 'CRCA',
    process: 'sheet_steel',
    finishedWeightKg: 1,
    precisionGround: false,
    flatnessPremium: false,
    holes: emptyHoles(),
    finish: 'none',
    quantity: 1,
  };
}

export function blankAssembly(system: PartInput['system'] = 'Unsorted'): PartInput {
  return { ...blankPart(system), name: 'Assembly / weld', kind: 'assembly', weldLengthIn: 0, finishedWeightKg: 0 };
}

export const EXAMPLE_PARTS: PartInput[] = [
  {
    id: newId(),
    name: 'Precision-ground base plate (20mm SAILMA)',
    system: 'AMR',
    material: 'SAILMA',
    process: 'plate_machined',
    finishedWeightKg: 14,
    precisionGround: true,
    flatnessPremium: false,
    holes: { drilled: 12, tapped: 8, countersunk: 4 },
    finish: 'none',
    quantity: 1,
  },
  {
    id: newId(),
    name: 'Top plate (8mm Al 6061)',
    system: 'AMR',
    material: 'AL6061',
    process: 'plate_machined',
    finishedWeightKg: 4.5,
    precisionGround: false,
    flatnessPremium: true,
    holes: { drilled: 10, tapped: 14, countersunk: 6 },
    finish: 'none',
    quantity: 1,
  },
  {
    id: newId(),
    name: 'Enclosure door (Al 5052)',
    system: 'Sprayer',
    bends: 4,
    material: 'AL5052',
    process: 'sheet_aluminium',
    finishedWeightKg: 1.8,
    precisionGround: false,
    flatnessPremium: false,
    holes: { drilled: 6, tapped: 0, countersunk: 0 },
    finish: 'anodise',
    quantity: 2,
  },
  {
    id: newId(),
    name: 'Mounting bracket (CRCA 3mm)',
    system: 'Sander',
    bends: 2,
    material: 'CRCA',
    process: 'sheet_steel',
    finishedWeightKg: 0.9,
    precisionGround: false,
    flatnessPremium: false,
    holes: { drilled: 4, tapped: 2, countersunk: 0 },
    finish: 'powder',
    quantity: 4,
  },
];
