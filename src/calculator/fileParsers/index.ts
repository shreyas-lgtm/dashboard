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
