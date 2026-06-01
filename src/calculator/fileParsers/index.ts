// File-upload dispatcher. Routes an uploaded drawing/model to the right parser
// and returns a unified ExtractionResult that the form can apply.

import type { MaterialId, FinishId } from '../rateCard';
import { MATERIALS } from '../rateCard';
import { parseStl, stlMassKg, type StlGeometry, type StlUnit } from './stl';
import { parseDxf, type DxfInfo } from './dxf';
import { scanText, readableAscii, type ScanHints } from './textScan';

export type FileKind = 'stl' | 'step' | 'iges' | 'dxf' | 'pdf' | 'unknown';

export interface ExtractionResult {
  fileName: string;
  kind: FileKind;
  /** Human-readable summary lines for the upload panel. */
  summary: string[];
  // Suggested form values (any subset may be present).
  suggestedMaterial?: MaterialId;
  suggestedFinish?: FinishId;
  suggestedWeightKg?: number;
  suggestedHoles?: { drilled: number; tapped: number; countersunk: number };
  // Raw payloads for advanced display / re-computation.
  stl?: StlGeometry & { unit: StlUnit };
  dxf?: DxfInfo;
  scan?: ScanHints;
  /** When several files for one component are merged, the file names involved. */
  sources?: string[];
}

export function detectKind(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'stl') return 'stl';
  if (ext === 'step' || ext === 'stp') return 'step';
  if (ext === 'iges' || ext === 'igs') return 'iges';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'pdf') return 'pdf';
  return 'unknown';
}

const fmt = (n: number, d = 1) => n.toLocaleString('en-IN', { maximumFractionDigits: d });

export async function extractFromFile(
  file: File,
  opts: { stlUnit?: StlUnit; densityForStl?: number } = {},
): Promise<ExtractionResult> {
  const kind = detectKind(file.name);
  const result: ExtractionResult = { fileName: file.name, kind, summary: [] };

  if (kind === 'stl') {
    const geo = parseStl(await file.arrayBuffer());
    const unit: StlUnit = opts.stlUnit ?? 'mm';
    const density = opts.densityForStl ?? MATERIALS.CRCA.densityKgM3;
    const massKg = stlMassKg(geo.volumeNative, unit, density);
    result.stl = { ...geo, unit };
    result.suggestedWeightKg = massKg;
    result.summary.push(
      `${geo.isBinary ? 'Binary' : 'ASCII'} STL · ${geo.triangleCount.toLocaleString()} triangles`,
      `Bounding box: ${geo.bbox.map((b) => fmt(b)).join(' × ')} ${unit}`,
      `Volume: ${fmt(geo.volumeNative, 0)} ${unit}³ → mass ≈ ${fmt(massKg, 3)} kg @ ${density} kg/m³`,
    );
    return result;
  }

  if (kind === 'dxf') {
    const info = parseDxf(await file.text());
    result.dxf = info;
    result.suggestedHoles = {
      drilled: info.circleCount,
      tapped: 0,
      countersunk: 0,
    };
    result.summary.push(`${info.circleCount} circle entities detected (suggested as drilled holes)`);
    if (info.extents) {
      result.summary.push(`Drawing extents: ${info.extents.map((e) => fmt(e)).join(' × ')} units`);
    }
    if (info.diameters.length) {
      const min = info.diameters[0];
      const max = info.diameters[info.diameters.length - 1];
      result.summary.push(`Hole Ø range: ${fmt(min, 2)} – ${fmt(max, 2)} units`);
    }
    return result;
  }

  if (kind === 'step' || kind === 'iges') {
    const text = await file.text();
    const scan = scanText(text, kind);
    result.scan = scan;
    result.suggestedMaterial = scan.material;
    result.suggestedFinish = scan.finish;
    result.suggestedWeightKg = scan.weightKg;
    if (scan.holeCounts.drilled + scan.holeCounts.tapped + scan.holeCounts.countersunk > 0) {
      result.suggestedHoles = scan.holeCounts;
    }
    result.summary.push(...scan.notes);
    return result;
  }

  if (kind === 'pdf') {
    const text = readableAscii(await file.arrayBuffer());
    const scan = scanText(text, 'pdf');
    result.scan = scan;
    result.suggestedMaterial = scan.material;
    result.suggestedFinish = scan.finish;
    result.suggestedWeightKg = scan.weightKg;
    if (scan.holeCounts.drilled + scan.holeCounts.tapped + scan.holeCounts.countersunk > 0) {
      result.suggestedHoles = scan.holeCounts;
    }
    result.summary.push(
      'PDF drawing attached. Text-based PDFs are scanned for callouts; most CAD',
      'PDFs store geometry as compressed vector data, so enter parameters manually.',
      ...scan.notes,
    );
    return result;
  }

  result.summary.push('Unrecognised file type — attached as reference. Enter parameters manually.');
  return result;
}

/** File name without its extension, used to recognise files of one component. */
export function stemOf(fileName: string): string {
  const base = (fileName.split('/').pop() || fileName).trim();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// Merge several files that describe the SAME component (e.g. a STEP model, a DXF
// flat pattern and a PDF drawing) into one extraction, so it's priced once. Each
// file type is trusted for what it knows best:
//   • mass     → STL geometry first, else any scanned weight
//   • material → STEP/IGES/PDF callouts
//   • finish   → STEP/IGES/PDF callouts
//   • holes    → per-type max across DXF circles and drawing callouts
export function mergeExtractions(results: ExtractionResult[]): ExtractionResult {
  if (results.length === 1) return results[0];

  const pick = <T>(get: (r: ExtractionResult) => T | undefined, order: FileKind[]): T | undefined => {
    for (const k of order) {
      const v = get(results.find((r) => r.kind === k) ?? ({} as ExtractionResult));
      if (v !== undefined) return v;
    }
    for (const r of results) {
      const v = get(r);
      if (v !== undefined) return v;
    }
    return undefined;
  };

  // Holes: take the largest count seen for each hole type across all sources.
  let holes: ExtractionResult['suggestedHoles'];
  for (const r of results) {
    if (!r.suggestedHoles) continue;
    holes ??= { drilled: 0, tapped: 0, countersunk: 0 };
    holes.drilled = Math.max(holes.drilled, r.suggestedHoles.drilled);
    holes.tapped = Math.max(holes.tapped, r.suggestedHoles.tapped);
    holes.countersunk = Math.max(holes.countersunk, r.suggestedHoles.countersunk);
  }

  const sources = results.map((r) => r.fileName);
  const merged: ExtractionResult = {
    fileName: stemOf(results[0].fileName),
    kind: pick((r) => (r.kind ? r.kind : undefined), ['step', 'iges', 'stl', 'dxf', 'pdf']) ?? 'unknown',
    summary: [`Merged ${results.length} files for this component: ${sources.join(', ')}`],
    sources,
    suggestedWeightKg: pick((r) => r.suggestedWeightKg, ['stl', 'step', 'iges', 'pdf']),
    suggestedMaterial: pick((r) => r.suggestedMaterial, ['step', 'iges', 'pdf', 'dxf']),
    suggestedFinish: pick((r) => r.suggestedFinish, ['step', 'iges', 'pdf']),
    suggestedHoles: holes,
    stl: results.find((r) => r.stl)?.stl,
    dxf: results.find((r) => r.dxf)?.dxf,
    scan: results.find((r) => r.scan)?.scan,
  };

  for (const r of results) {
    for (const line of r.summary) merged.summary.push(`[${r.fileName}] ${line}`);
  }
  return merged;
}
