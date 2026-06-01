// Bulk import from a ZIP of drawings / CAD files. Each supported entry is run
// through the same single-file extractor (extractFromFile), so a ZIP import
// behaves exactly like dropping each file in one by one — just at scale.

import JSZip from 'jszip';
import { extractFromFile, detectKind, mergeExtractions, stemOf, type ExtractionResult } from './index';
import type { StlUnit } from './stl';

export interface ZipImportResult {
  /** One entry per component (files sharing a base name are merged into one). */
  results: ExtractionResult[];
  /** File names found in the ZIP that we don't know how to parse. */
  skipped: string[];
  /** How many components were built from more than one file. */
  mergedComponents: number;
}

export async function extractFromZip(
  file: File,
  opts: { stlUnit?: StlUnit; densityForStl?: number } = {},
): Promise<ZipImportResult> {
  // Load from an ArrayBuffer for portability (works in browsers and Node alike).
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const results: ExtractionResult[] = [];
  const skipped: string[] = [];

  // Sort entries by name so the imported BOM has a stable, predictable order.
  const entries = Object.values(zip.files)
    .filter((e) => !e.dir)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const base = entry.name.split('/').pop() || entry.name;
    // Ignore macOS/Windows ZIP cruft.
    if (base.startsWith('.') || base.startsWith('__MACOSX')) continue;

    if (detectKind(base) === 'unknown') {
      skipped.push(base);
      continue;
    }

    const data = await entry.async('arraybuffer');
    const asFile = new File([data], base);
    results.push(await extractFromFile(asFile, opts));
  }

  // Group files of the same component (matching base name) and merge them so
  // a STEP + DXF + PDF of one part is priced once, not three times.
  const groups = new Map<string, ExtractionResult[]>();
  for (const r of results) {
    const key = stemOf(r.fileName).toLowerCase();
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const merged: ExtractionResult[] = [];
  let mergedComponents = 0;
  for (const list of groups.values()) {
    if (list.length > 1) mergedComponents++;
    merged.push(mergeExtractions(list));
  }

  return { results: merged, skipped, mergedComponents };
}
