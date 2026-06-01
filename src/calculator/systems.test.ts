import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { classifySystem } from './systems';
import { partFromExtraction } from './presets';
import { extractFromZip } from './fileParsers/zip';

describe('classifySystem (keyword anywhere, case-insensitive)', () => {
  it('matches the four systems wherever the keyword appears', () => {
    expect(classifySystem('base_plate_AMR_v2.stl')).toBe('AMR');
    expect(classifySystem('Tool-Sprayer-nozzle.step')).toBe('Sprayer');
    expect(classifySystem('SANDER_arm.dxf')).toBe('Sander');
    expect(classifySystem('operation station frame.pdf')).toBe('OperationStation');
    expect(classifySystem('opstation-bracket.stl')).toBe('OperationStation');
  });

  it('falls back to Unsorted when nothing matches', () => {
    expect(classifySystem('random_part_123.stl')).toBe('Unsorted');
  });
});

describe('partFromExtraction', () => {
  it('names the part after the file and files it by system', () => {
    const part = partFromExtraction({
      fileName: 'AMR_topplate.step',
      kind: 'step',
      summary: [],
      suggestedMaterial: 'AL6061',
      suggestedWeightKg: 4.123,
    });
    expect(part.name).toBe('AMR_topplate.step');
    expect(part.system).toBe('AMR');
    expect(part.material).toBe('AL6061');
    expect(part.process).toBe('plate_machined'); // inferred from Al 6061
    expect(part.finishedWeightKg).toBe(4.123);
  });
});

describe('extractFromZip', () => {
  it('imports every supported file and skips unknown ones', async () => {
    const zip = new JSZip();
    const asciiStl = `solid s
 facet normal 0 0 0
  outer loop
   vertex 0 0 0
   vertex 10 0 0
   vertex 0 10 0
  endloop
 endfacet
endsolid s`;
    zip.file('AMR_bracket.stl', asciiStl);
    zip.file('sprayer-door.dxf', '0\nSECTION\n0\nCIRCLE\n40\n3.0\n0\nENDSEC\n0\nEOF');
    zip.file('readme.txt', 'ignore me');
    zip.file('notes.md', 'ignore me too');

    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'parts.zip');

    const { results, skipped } = await extractFromZip(file);
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.fileName).sort();
    expect(names).toEqual(['AMR_bracket.stl', 'sprayer-door.dxf']);
    expect(skipped.sort()).toEqual(['notes.md', 'readme.txt']);

    // And those results classify into the right systems.
    const parts = results.map(partFromExtraction);
    const byName = Object.fromEntries(parts.map((p) => [p.name, p.system]));
    expect(byName['AMR_bracket.stl']).toBe('AMR');
    expect(byName['sprayer-door.dxf']).toBe('Sprayer');
  });

  it('merges files that share a base name into one priced component', async () => {
    const zip = new JSZip();
    const asciiStl = `solid s
 facet normal 0 0 0
  outer loop
   vertex 0 0 0
   vertex 50 0 0
   vertex 0 50 0
  endloop
 endfacet
endsolid s`;
    // Three files for ONE component: AMR_panel.{stl,dxf,step}
    zip.file('AMR_panel.stl', asciiStl);
    zip.file('AMR_panel.dxf', '0\nSECTION\n0\nCIRCLE\n40\n3\n0\nCIRCLE\n40\n3\n0\nENDSEC\n0\nEOF');
    zip.file('AMR_panel.step', 'ISO-10303-21;\n/* material: Aluminium 6061 */\nEND-ISO-10303-21;');
    // A second, single-file component.
    zip.file('AMR_loner.dxf', '0\nSECTION\n0\nCIRCLE\n40\n5\n0\nENDSEC\n0\nEOF');

    const blob = await zip.generateAsync({ type: 'blob' });
    const { results, mergedComponents } = await extractFromZip(new File([blob], 'parts.zip'));

    // 4 files → 2 components (one merged from 3 files, one standalone).
    expect(results).toHaveLength(2);
    expect(mergedComponents).toBe(1);

    const panel = results.find((r) => r.fileName === 'AMR_panel')!;
    expect(panel.sources).toHaveLength(3);
    expect(typeof panel.suggestedWeightKg).toBe('number'); // mass from the STL
    expect(panel.suggestedMaterial).toBe('AL6061'); // material from the STEP
    expect(panel.suggestedHoles?.drilled).toBe(2); // holes from the DXF
  });
});
