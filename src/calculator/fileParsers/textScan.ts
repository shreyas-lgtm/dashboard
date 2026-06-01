// Lightweight keyword scan for text-bearing files (STEP/STP, IGES/IGS, and the
// readable portions of PDF drawings). This is intentionally best-effort: it
// surfaces *suggestions* the user can accept, never authoritative values.
//
// STEP and IGES are ASCII, so this works well on them. PDFs store most text in
// compressed streams; we scan the raw decoded bytes for any readable tokens,
// which catches uncompressed annotations and title-block text in many drawings.

import type { MaterialId, FinishId } from '../rateCard';

export interface ScanHints {
  material?: MaterialId;
  finish?: FinishId;
  /** A weight in kg if a "… kg" token was found. */
  weightKg?: number;
  holeCounts: { drilled: number; tapped: number; countersunk: number };
  /** STEP unit declaration if detected (e.g. "MILLI.METRE"). */
  unit?: string;
  /** Geometry-complexity hint: count of CARTESIAN_POINT / surface entities. */
  geometryEntities?: number;
  notes: string[];
}

function detectMaterial(t: string): MaterialId | undefined {
  if (/\b6061\b/.test(t)) return 'AL6061';
  if (/\b5052\b/.test(t)) return 'AL5052';
  if (/sailma|s\s?gl3|e\s?350/i.test(t)) return 'SAILMA';
  if (/crca|cold[\s-]?rolled/i.test(t)) return 'CRCA';
  return undefined;
}

function detectFinish(t: string): FinishId | undefined {
  if (/anodi[sz]/i.test(t)) return 'anodise';
  if (/powder|ral\s?9017|powder[\s-]?coat/i.test(t)) return 'powder';
  return undefined;
}

function detectWeight(t: string): number | undefined {
  // First "<number> kg" token, ignoring absurd values.
  const m = t.match(/(\d+(?:\.\d+)?)\s*kg\b/i);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  return v > 0 && v < 10000 ? v : undefined;
}

function countHoles(t: string) {
  // Count threaded callouts (M3–M12) as tapped, CSK as countersunk, Ø/DIA as
  // drilled. These regexes are deliberately conservative.
  const tapped = (t.match(/\bM(?:3|4|5|6|8|10|12)\b/gi) || []).length;
  const countersunk = (t.match(/\b(?:csk|c['’]?sink|countersunk)\b/gi) || []).length;
  const drilled = (t.match(/(?:Ø|\bdia\.?\b|⌀)\s*\d/gi) || []).length;
  return { drilled, tapped, countersunk };
}

function detectStepUnit(t: string): string | undefined {
  if (/MILLI\.?\s*METRE|MILLIMETRE/i.test(t)) return 'mm';
  if (/CENTI\.?\s*METRE/i.test(t)) return 'cm';
  if (/\bINCH\b/i.test(t)) return 'in';
  if (/(?<!MILLI\.)(?<!CENTI\.)\bMETRE\b/i.test(t)) return 'm';
  return undefined;
}

export function scanText(text: string, kind: 'step' | 'iges' | 'pdf'): ScanHints {
  const hints: ScanHints = { holeCounts: { drilled: 0, tapped: 0, countersunk: 0 }, notes: [] };

  hints.material = detectMaterial(text);
  hints.finish = detectFinish(text);
  hints.weightKg = detectWeight(text);
  hints.holeCounts = countHoles(text);

  if (kind === 'step') {
    hints.unit = detectStepUnit(text);
    const pts = (text.match(/CARTESIAN_POINT/g) || []).length;
    const faces = (text.match(/ADVANCED_FACE|MANIFOLD_SOLID_BREP/g) || []).length;
    hints.geometryEntities = pts + faces;
    if (faces > 0) hints.notes.push(`STEP B-rep solid detected (${faces} faces).`);
    if (hints.unit) hints.notes.push(`STEP units: ${hints.unit}.`);
  }

  const found: string[] = [];
  if (hints.material) found.push(`material ${hints.material}`);
  if (hints.finish && hints.finish !== 'none') found.push(`finish ${hints.finish}`);
  if (hints.weightKg) found.push(`weight ${hints.weightKg}kg`);
  const holeTotal =
    hints.holeCounts.drilled + hints.holeCounts.tapped + hints.holeCounts.countersunk;
  if (holeTotal > 0) found.push(`${holeTotal} hole callouts`);

  if (found.length) hints.notes.unshift(`Detected: ${found.join(', ')}.`);
  else hints.notes.unshift('No parameters auto-detected — please enter them manually.');

  return hints;
}

/** Pull readable ASCII runs from raw PDF bytes (uncompressed text + annotations). */
export function readableAscii(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  let run = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // printable ASCII + common whitespace
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) {
      run += String.fromCharCode(b);
    } else {
      if (run.length >= 3) out += run + ' ';
      run = '';
    }
  }
  if (run.length >= 3) out += run;
  return out;
}
