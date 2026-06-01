import { describe, it, expect } from 'vitest';
import { parseStl, stlMassKg } from './stl';
import { parseDxf } from './dxf';

// Build a binary STL of an axis-aligned cube of side `s` (12 triangles).
function cubeBinaryStl(s: number): ArrayBuffer {
  const tris: number[][] = [];
  const c = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], // bottom z=0
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s], // top z=s
  ];
  const quad = (a: number, b: number, d: number, e: number) => {
    tris.push([...c[a], ...c[b], ...c[d]]);
    tris.push([...c[a], ...c[d], ...c[e]]);
  };
  quad(0, 1, 2, 3); // bottom
  quad(4, 5, 6, 7); // top
  quad(0, 1, 5, 4); // front
  quad(1, 2, 6, 5); // right
  quad(2, 3, 7, 6); // back
  quad(3, 0, 4, 7); // left

  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    off += 12; // normal (zeros)
    for (let k = 0; k < 9; k++) {
      dv.setFloat32(off, t[k], true);
      off += 4;
    }
    off += 2; // attr
  }
  return buf;
}

describe('parseStl', () => {
  it('computes the volume of a 10mm cube as 1000 mm³', () => {
    const geo = parseStl(cubeBinaryStl(10));
    expect(geo.isBinary).toBe(true);
    expect(geo.triangleCount).toBe(12);
    expect(geo.volumeNative).toBeCloseTo(1000, 3);
    expect(geo.bbox).toEqual([10, 10, 10]);
  });

  it('converts volume to mass using density and unit', () => {
    // 1000 mm³ steel @ 7850 kg/m³ = 1e-6 m³ × 7850 = 0.00785 kg
    expect(stlMassKg(1000, 'mm', 7850)).toBeCloseTo(0.00785, 6);
    // same volume read as inches is far heavier
    expect(stlMassKg(1000, 'in', 2700)).toBeGreaterThan(stlMassKg(1000, 'mm', 2700));
  });

  it('parses ASCII STL', () => {
    const ascii = `solid t
 facet normal 0 0 0
  outer loop
   vertex 0 0 0
   vertex 1 0 0
   vertex 0 1 0
  endloop
 endfacet
endsolid t`;
    const buf = new TextEncoder().encode(ascii).buffer;
    const geo = parseStl(buf);
    expect(geo.isBinary).toBe(false);
    expect(geo.triangleCount).toBe(1);
  });
});

describe('parseDxf', () => {
  const dxf = `0
SECTION
2
HEADER
9
$EXTMIN
10
0.0
20
0.0
9
$EXTMAX
10
200.0
20
100.0
0
ENDSEC
0
SECTION
2
ENTITIES
0
CIRCLE
8
0
10
10.0
20
10.0
40
3.0
0
CIRCLE
8
0
10
50.0
20
50.0
40
4.0
0
ENDSEC
0
EOF`;

  it('counts circles and reads diameters + extents', () => {
    const info = parseDxf(dxf);
    expect(info.circleCount).toBe(2);
    expect(info.diameters).toEqual([6, 8]); // radius 3 and 4 → Ø6, Ø8
    expect(info.extents).toEqual([200, 100]);
  });
});
