// Example parts derived from the specific component call-outs in the proposal
// (precision-ground SAILMA base plate, 8mm Al 6061 top plate, Al 5052 doors,
// CRCA sheet brackets). Loading these gives the user a realistic starting BOM
// that mirrors how the rate card describes each item.

import type { PartInput } from './costEngine';
import { emptyHoles } from './costEngine';

let seq = 0;
export function newId(): string {
  seq += 1;
  return `part_${Date.now().toString(36)}_${seq}`;
}

export function blankPart(): PartInput {
  return {
    id: newId(),
    name: 'New part',
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

export const EXAMPLE_PARTS: PartInput[] = [
  {
    id: newId(),
    name: 'Precision-ground base plate (20mm SAILMA)',
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
