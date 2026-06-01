// System grouping for the BOM. Parts are filed under one of the four Phase-1
// robotic systems (or "Unsorted"). When bulk-importing a ZIP we classify each
// part by matching keywords anywhere in its file name (case-insensitive).

export type SystemId = 'AMR' | 'Sprayer' | 'Sander' | 'OperationStation' | 'Unsorted';

export interface SystemDef {
  id: SystemId;
  label: string;
}

export const SYSTEMS: SystemDef[] = [
  { id: 'AMR', label: 'AMR (Base + Perception)' },
  { id: 'Sprayer', label: 'Tool Station — Sprayer' },
  { id: 'Sander', label: 'Tool Station — Sander' },
  { id: 'OperationStation', label: 'Operation Station' },
  { id: 'Unsorted', label: 'Unsorted' },
];

export const SYSTEM_LABEL: Record<SystemId, string> = SYSTEMS.reduce(
  (acc, s) => ({ ...acc, [s.id]: s.label }),
  {} as Record<SystemId, string>,
);

// An "assembly" drawing describes how parts are joined (welding etc.), not a part
// to be cut — these are priced as a weld/assembly line, never as a cut component.
export function isAssemblyFile(fileName: string): boolean {
  return /assembl|\bassy\b|weldment|weld[\s_-]?ment/i.test(fileName);
}

// Keyword-anywhere classification. Order matters: the first match wins, so the
// more specific patterns ("operation station") are written to be unambiguous.
export function classifySystem(fileName: string): SystemId {
  const n = fileName.toLowerCase();
  if (/\bamr\b|amr/.test(n)) return 'AMR';
  if (/spray/.test(n)) return 'Sprayer';
  if (/sand/.test(n)) return 'Sander';
  if (/operation|ostation|op[\s_-]?station|opstation|op[\s_-]?stn/.test(n)) {
    return 'OperationStation';
  }
  return 'Unsorted';
}
