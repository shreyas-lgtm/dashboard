/**
 * Best-effort laptop identification from a pasted product link (Amazon, Best
 * Buy, manufacturer store, etc.).
 *
 * Pure & client-side: it reads only what's encoded in the URL itself — the
 * product-title slug and any spec tokens (RAM / storage / screen / CPU) baked
 * into it. Most full product URLs contain a rich slug, e.g.
 *   amazon.com/Apple-2024-MacBook-Air-13-inch-M3-16GB-512GB/dp/B0...
 * which is enough to recognise the model and pull its key specs.
 *
 * Opaque or shortened links (e.g. a.co/d/xxxx, amzn.to/xxxx) carry no product
 * info; those return low confidence and the caller should fall back to the
 * /api/laptop resolver or to manual entry.
 */

import {
  LAPTOP_CATALOG,
  PERF_TIERS,
  type Laptop,
  type OS,
  type PerfTier,
} from './laptopCatalog';
import type { CurrentSetup } from './suggestLaptops';

export type Confidence = 'high' | 'medium' | 'low';

export interface ParsedLaptop {
  brand?: string;
  os?: OS;
  perfTier?: PerfTier;
  cpuLabel?: string;
  hasDiscreteGpu?: boolean;
  ramGB?: number;
  storageGB?: number;
  screenInch?: number;
  /** Cleaned, lower-cased words extracted from the URL slug. */
  tokens: string[];
}

export interface LinkResult {
  parsed: ParsedLaptop;
  match: Laptop | null;
  setup: CurrentSetup | null;
  confidence: Confidence;
  /** Short human-readable description of what we detected. */
  summary: string;
}

/** brand keyword → canonical brand (model family words also map to a brand). */
const BRAND_KEYWORDS: Record<string, string> = {
  apple: 'Apple', macbook: 'Apple', imac: 'Apple',
  dell: 'Dell', xps: 'Dell', latitude: 'Dell', inspiron: 'Dell',
  lenovo: 'Lenovo', thinkpad: 'Lenovo', ideapad: 'Lenovo', legion: 'Lenovo', yoga: 'Lenovo', carbon: 'Lenovo',
  asus: 'ASUS', zenbook: 'ASUS', vivobook: 'ASUS', zephyrus: 'ASUS', rog: 'ASUS', tuf: 'ASUS',
  hp: 'HP', spectre: 'HP', envy: 'HP', pavilion: 'HP', omen: 'HP',
  razer: 'Razer', blade: 'Razer',
  microsoft: 'Microsoft', surface: 'Microsoft',
  acer: 'Acer', swift: 'Acer', aspire: 'Acer', predator: 'Acer', nitro: 'Acer',
  lg: 'LG', gram: 'LG',
  framework: 'Framework',
  msi: 'MSI', samsung: 'Samsung', galaxybook: 'Samsung', galaxy: 'Samsung',
};

/** CPU / GPU keyword → performance tier. Longer keys are checked first. */
const TIER_KEYWORDS: Array<{ re: RegExp; tier: PerfTier; label: string }> = [
  { re: /\bm[1-4]\s*(max|ultra)\b/, tier: 'pro', label: 'Apple M-series Max/Ultra' },
  { re: /\bm[1-4]\s*pro\b/, tier: 'high', label: 'Apple M-series Pro' },
  { re: /\bm[1-4]\b/, tier: 'mainstream', label: 'Apple M-series' },
  { re: /\b(core\s*ultra\s*9|i9|ryzen\s*9)\b/, tier: 'pro', label: 'i9 / Ryzen 9 class' },
  { re: /\b(rtx\s*40(80|90))\b/, tier: 'pro', label: 'RTX 4080/4090' },
  { re: /\b(core\s*ultra\s*7|i7|ryzen\s*7)\b/, tier: 'high', label: 'i7 / Ryzen 7 class' },
  { re: /\b(rtx\s*40(60|70))\b/, tier: 'high', label: 'RTX 4060/4070' },
  { re: /\b(core\s*ultra\s*5|i5|ryzen\s*5)\b/, tier: 'mainstream', label: 'i5 / Ryzen 5 class' },
  { re: /\b(rtx\s*40?50|gtx)\b/, tier: 'mainstream', label: 'entry RTX/GTX' },
  { re: /\bsnapdragon\b/, tier: 'mainstream', label: 'Snapdragon X' },
  { re: /\b(i3|ryzen\s*3|celeron|pentium|athlon|n\d{3})\b/, tier: 'entry', label: 'entry CPU' },
];

const RAM_VALUES = [8, 12, 16, 18, 24, 32, 36, 48, 64, 96, 128];

function decodeSlug(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* malformed escapes — fall back to raw */
  }
  return s.toLowerCase().replace(/[+_]/g, '-');
}

/** Pull the most descriptive slug text out of a URL string. */
function extractSlugText(input: string): string {
  let work = input.trim();
  // Allow bare URLs without protocol.
  if (!/^https?:\/\//i.test(work)) work = `https://${work}`;

  let pathname = work;
  let search = '';
  try {
    const u = new URL(work);
    pathname = u.pathname;
    search = u.search;
  } catch {
    /* not a valid URL — treat the whole thing as text */
  }

  const decoded = decodeSlug(pathname + ' ' + search);
  // Amazon puts the title before /dp/ or /gp/; keep everything but drop the id.
  const segments = decoded.split(/[\/?&=]/).filter(Boolean);

  // Prefer the longest hyphenated, mostly-alphabetic segment (the title slug).
  const titleSegment = segments
    .filter((s) => s.includes('-') && /[a-z]/.test(s))
    .sort((a, b) => b.length - a.length)[0];

  return (titleSegment ?? decoded).replace(/-/g, ' ');
}

function detectSizes(text: string): { ramGB?: number; storageGB?: number } {
  const sizes: Array<{ gb: number; isTb: boolean }> = [];
  const re = /(\d{1,4})\s*(tb|gb)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    const isTb = m[2] === 'tb';
    sizes.push({ gb: isTb ? n * 1024 : n, isTb });
  }
  if (sizes.length === 0) return {};

  // TB is always storage. Among GB values, small known-RAM sizes are RAM,
  // larger ones (>=128) are storage.
  let ramGB: number | undefined;
  let storageGB: number | undefined;
  for (const { gb, isTb } of sizes) {
    if (isTb || gb >= 256) {
      storageGB = Math.max(storageGB ?? 0, gb);
    } else if (RAM_VALUES.includes(gb) && gb <= 128) {
      ramGB = ramGB == null ? gb : Math.min(ramGB, gb);
    }
  }
  // A lone "128gb" with no other size is almost certainly storage.
  if (storageGB == null && ramGB == null && sizes.length === 1 && sizes[0].gb >= 128) {
    storageGB = sizes[0].gb;
  }
  return { ramGB, storageGB };
}

function detectScreen(text: string): number | undefined {
  // e.g. 13.6", 14 inch, 15.6-inch, 16in
  const m = text.match(/\b(1[0-7](?:\.\d)?)\s*(?:"|inch|in\b|-inch)/);
  if (m) return Number(m[1]);
  return undefined;
}

export function parseLaptopUrl(input: string): ParsedLaptop {
  const text = extractSlugText(input);
  const tokens = text.split(/\s+/).filter(Boolean);
  const tokenSet = new Set(tokens);

  let brand: string | undefined;
  for (const t of tokens) {
    if (BRAND_KEYWORDS[t]) {
      brand = BRAND_KEYWORDS[t];
      break;
    }
  }

  const os: OS | undefined = tokenSet.has('macbook') || tokenSet.has('imac')
    ? 'macOS'
    : brand
      ? brand === 'Apple' ? 'macOS' : 'Windows'
      : undefined;

  let perfTier: PerfTier | undefined;
  let cpuLabel: string | undefined;
  for (const { re, tier, label } of TIER_KEYWORDS) {
    if (re.test(text)) {
      perfTier = tier;
      cpuLabel = label;
      break;
    }
  }

  const hasDiscreteGpu = /\b(rtx|gtx|radeon\s*rx)\b/.test(text);
  const { ramGB, storageGB } = detectSizes(text);
  const screenInch = detectScreen(text);

  return { brand, os, perfTier, cpuLabel, hasDiscreteGpu, ramGB, storageGB, screenInch, tokens };
}

/** Score how well a catalog laptop matches the parsed tokens. */
function scoreMatch(laptop: Laptop, parsed: ParsedLaptop): number {
  const tokens = new Set(parsed.tokens);
  let score = 0;

  if (parsed.brand && laptop.brand === parsed.brand) score += 3;

  // Model-name word overlap (ignore generic words and the literal brand name —
  // the brand is already scored above, so e.g. an HP Pavilion shouldn't match
  // the HP Spectre on the shared word "hp").
  const generic = new Set([
    'laptop', 'inch', 'notebook', 'computer', 'pc', '2023', '2024', '2025',
    'apple', 'dell', 'lenovo', 'asus', 'hp', 'razer', 'microsoft', 'acer', 'lg', 'framework', 'msi', 'samsung',
  ]);
  const nameWords = laptop.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !generic.has(w));
  for (const w of nameWords) {
    if (tokens.has(w)) score += 1.5;
  }

  // Spec corroboration.
  if (parsed.ramGB && parsed.ramGB === laptop.ramGB) score += 0.5;
  if (parsed.storageGB && parsed.storageGB === laptop.storageGB) score += 0.5;
  if (parsed.screenInch && Math.abs(parsed.screenInch - laptop.screenInch) < 0.6) score += 0.5;

  return score;
}

export function matchCatalog(parsed: ParsedLaptop): Laptop | null {
  let best: Laptop | null = null;
  let bestScore = 0;
  for (const laptop of LAPTOP_CATALOG) {
    const s = scoreMatch(laptop, parsed);
    if (s > bestScore) {
      bestScore = s;
      best = laptop;
    }
  }
  // Require brand + at least one model word (>= ~4.5) to claim a confident match.
  return bestScore >= 4.5 ? best : null;
}

export function interpretLink(input: string): LinkResult {
  const parsed = parseLaptopUrl(input);
  const match = matchCatalog(parsed);

  if (match) {
    const setup: CurrentSetup = {
      laptopId: match.id,
      label: match.name,
      os: match.os,
      cpuScore: match.cpuScore,
      gpuScore: match.gpuScore,
      // Prefer the exact config from the link if it differs from the base model.
      ramGB: parsed.ramGB ?? match.ramGB,
      storageGB: parsed.storageGB ?? match.storageGB,
      weightKg: match.weightKg,
    };
    return {
      parsed,
      match,
      setup,
      confidence: 'high',
      summary: `${match.name} · ${setup.ramGB}GB / ${setup.storageGB}GB · ${match.os}`,
    };
  }

  // No catalog match — build a best-effort setup from parsed tokens.
  const hasSignal = parsed.brand || parsed.perfTier || parsed.ramGB || parsed.storageGB;
  if (!hasSignal) {
    return {
      parsed,
      match: null,
      setup: null,
      confidence: 'low',
      summary: "Couldn't read laptop details from that link.",
    };
  }

  const tier = parsed.perfTier ?? 'mainstream';
  const t = PERF_TIERS[tier];
  const os: OS = parsed.os ?? 'Windows';
  const ramGB = parsed.ramGB ?? 16;
  const storageGB = parsed.storageGB ?? 512;

  const labelParts = [parsed.brand, parsed.cpuLabel].filter(Boolean);
  const label = labelParts.length ? labelParts.join(' · ') : 'Pasted laptop';

  const setup: CurrentSetup = {
    label,
    os,
    cpuScore: t.cpuScore,
    gpuScore: parsed.hasDiscreteGpu ? Math.max(t.gpuScore, 60) : t.gpuScore,
    ramGB,
    storageGB,
  };

  return {
    parsed,
    match: null,
    setup,
    confidence: parsed.brand && parsed.perfTier ? 'medium' : 'low',
    summary: `${parsed.brand ?? 'Laptop'}${parsed.cpuLabel ? ` (${parsed.cpuLabel})` : ''} · ${ramGB}GB / ${storageGB}GB · ${os}`,
  };
}
