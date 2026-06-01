// DXF parser — a DXF is a flat list of (group-code, value) line pairs. We don't
// need a full CAD kernel: to help a quote we count CIRCLE entities (candidate
// drilled/tapped holes) and read the drawing extents for a footprint area.
//
// This is a heuristic aid — the user always confirms hole counts in the form.

export interface DxfInfo {
  /** Number of CIRCLE entities — a good first guess at hole count. */
  circleCount: number;
  /** Circle diameters found, sorted ascending (native drawing units). */
  diameters: number[];
  /** Drawing extents [width, height] from $EXTMIN/$EXTMAX, if present. */
  extents: [number, number] | null;
}

export function parseDxf(text: string): DxfInfo {
  // Normalise line endings and split into trimmed lines.
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim());

  let circleCount = 0;
  const diameters: number[] = [];

  // Walk the entity list. A CIRCLE entity is introduced by code 0 / value
  // "CIRCLE"; its radius follows on code 40.
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i];
    const value = lines[i + 1];
    if (code === '0' && value.toUpperCase() === 'CIRCLE') {
      circleCount++;
      // Scan forward within this entity for the radius (code 40) until the next
      // entity boundary (code 0).
      for (let j = i + 2; j + 1 < lines.length; j += 2) {
        if (lines[j] === '0') break;
        if (lines[j] === '40') {
          const r = parseFloat(lines[j + 1]);
          if (!Number.isNaN(r)) diameters.push(r * 2);
          break;
        }
      }
    }
  }

  // Extents live in the HEADER as $EXTMIN / $EXTMAX, each followed by code
  // 10 (x) and 20 (y) pairs.
  const readPoint = (varName: string): [number, number] | null => {
    const idx = lines.indexOf(varName);
    if (idx === -1) return null;
    let x: number | null = null;
    let y: number | null = null;
    for (let j = idx + 1; j + 1 < lines.length && j < idx + 12; j += 2) {
      if (lines[j] === '10') x = parseFloat(lines[j + 1]);
      else if (lines[j] === '20') y = parseFloat(lines[j + 1]);
      else if (lines[j] === '9') break; // next header variable
      if (x !== null && y !== null) break;
    }
    return x !== null && y !== null ? [x, y] : null;
  };

  const min = readPoint('$EXTMIN');
  const max = readPoint('$EXTMAX');
  const extents: [number, number] | null =
    min && max ? [Math.abs(max[0] - min[0]), Math.abs(max[1] - min[1])] : null;

  return {
    circleCount,
    diameters: diameters.sort((a, b) => a - b),
    extents,
  };
}
