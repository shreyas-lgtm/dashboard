// STL parser — computes solid volume, bounding box and (with a density) mass,
// directly in the browser. Handles both binary and ASCII STL. No dependencies.
//
// Volume is the signed sum of tetrahedron volumes formed by each triangle and
// the origin: V = Σ (v1 · (v2 × v3)) / 6. For a closed manifold this yields the
// enclosed volume regardless of where the origin sits.

export interface StlGeometry {
  triangleCount: number;
  /** Volume in the STL's native units cubed (STL is unitless; usually mm). */
  volumeNative: number;
  /** Bounding box size [x, y, z] in native units. */
  bbox: [number, number, number];
  isBinary: boolean;
}

function signedVolumeOfTriangle(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  // (a · (b × c)) / 6
  const crossX = by * cz - bz * cy;
  const crossY = bz * cx - bx * cz;
  const crossZ = bx * cy - by * cx;
  return (ax * crossX + ay * crossY + az * crossZ) / 6;
}

// A binary STL is 80-byte header + uint32 count + 50 bytes/triangle. ASCII STL
// begins with "solid". Some binary files also start with "solid" in the header,
// so we cross-check the declared triangle count against the file length.
function looksBinary(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false;
  const dv = new DataView(buf);
  const triCount = dv.getUint32(80, true);
  const expected = 84 + triCount * 50;
  return expected === buf.byteLength;
}

function parseBinary(buf: ArrayBuffer): StlGeometry {
  const dv = new DataView(buf);
  const triCount = dv.getUint32(80, true);
  let volume = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // skip normal vector
    const v: number[] = [];
    for (let j = 0; j < 9; j++) {
      v.push(dv.getFloat32(offset, true));
      offset += 4;
    }
    offset += 2; // attribute byte count
    volume += signedVolumeOfTriangle(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
    for (let k = 0; k < 9; k += 3) {
      minX = Math.min(minX, v[k]); maxX = Math.max(maxX, v[k]);
      minY = Math.min(minY, v[k + 1]); maxY = Math.max(maxY, v[k + 1]);
      minZ = Math.min(minZ, v[k + 2]); maxZ = Math.max(maxZ, v[k + 2]);
    }
  }

  return {
    triangleCount: triCount,
    volumeNative: Math.abs(volume),
    bbox: [maxX - minX, maxY - minY, maxZ - minZ],
    isBinary: true,
  };
}

function parseAscii(text: string): StlGeometry {
  const nums = text.match(/vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g) || [];
  let volume = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let triCount = 0;

  const verts: number[][] = [];
  for (const line of nums) {
    const m = line.match(/vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/);
    if (!m) continue;
    const x = parseFloat(m[1]), y = parseFloat(m[2]), z = parseFloat(m[3]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    verts.push([x, y, z]);
    if (verts.length === 3) {
      const [a, b, c] = verts;
      volume += signedVolumeOfTriangle(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      triCount++;
      verts.length = 0;
    }
  }

  return {
    triangleCount: triCount,
    volumeNative: Math.abs(volume),
    bbox: [maxX - minX, maxY - minY, maxZ - minZ],
    isBinary: false,
  };
}

export function parseStl(buf: ArrayBuffer): StlGeometry {
  if (looksBinary(buf)) return parseBinary(buf);
  const text = new TextDecoder().decode(buf);
  return parseAscii(text);
}

export type StlUnit = 'mm' | 'cm' | 'm' | 'in';

const UNIT_TO_M: Record<StlUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
};

/** Convert native volume to mass in kg given a unit interpretation and density. */
export function stlMassKg(
  volumeNative: number,
  unit: StlUnit,
  densityKgM3: number,
): number {
  const scale = UNIT_TO_M[unit];
  const volumeM3 = volumeNative * scale * scale * scale;
  return volumeM3 * densityKgM3;
}
