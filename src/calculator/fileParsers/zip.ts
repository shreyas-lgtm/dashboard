// Bulk import from a ZIP of drawings / CAD files. Each supported entry is run
// through the same single-file extractor (extractFromFile), so a ZIP import
// behaves exactly like dropping each file in one by one — just at scale.

import JSZip from 'jszip';
import { extractFromFile, detectKind, type ExtractionResult } from './index';
import type { StlUnit } from './stl';

export interface ZipImportResult {
  results: ExtractionResult[];
  /** File names found in the ZIP that we don't know how to parse. */
  skipped: string[];
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

  return { results, skipped };
}
