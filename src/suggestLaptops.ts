/**
 * Ranking engine for the Laptop Alternative Suggester.
 *
 * Given a description of the user's *current* machine, a budget, and a primary
 * use case, it scores every in-budget laptop in the catalog and returns the
 * best alternatives with human-readable reasons and caveats.
 *
 * Pure & deterministic — no network, no side effects.
 */

import { LAPTOP_CATALOG, type Laptop, type OS, type UseCase } from './laptopCatalog';

/** How the user describes their current laptop. */
export interface CurrentSetup {
  /** Set when the user picked their current machine from the catalog. */
  laptopId?: string;
  label: string;
  os: OS;
  cpuScore: number;
  gpuScore: number;
  ramGB: number;
  storageGB: number;
  weightKg?: number;
}

export interface SuggestOptions {
  current: CurrentSetup;
  budgetUSD: number;
  useCase: UseCase;
  /** Only suggest machines on the same OS family as the current one. */
  keepOS?: boolean;
  /** Minimum acceptable RAM (GB). */
  minRamGB?: number;
}

export interface Suggestion {
  laptop: Laptop;
  score: number;
  reasons: string[];
  caveats: string[];
  topPick?: boolean;
  valuePick?: boolean;
}

/** Per-use-case weighting of the spec dimensions (each set sums to 1). */
const WEIGHTS: Record<
  UseCase,
  { cpu: number; gpu: number; ram: number; storage: number; portability: number; battery: number }
> = {
  general:     { cpu: 0.25, gpu: 0.10, ram: 0.20, storage: 0.10, portability: 0.20, battery: 0.15 },
  development: { cpu: 0.35, gpu: 0.10, ram: 0.30, storage: 0.10, portability: 0.08, battery: 0.07 },
  creative:    { cpu: 0.28, gpu: 0.30, ram: 0.22, storage: 0.12, portability: 0.04, battery: 0.04 },
  business:    { cpu: 0.20, gpu: 0.05, ram: 0.15, storage: 0.10, portability: 0.30, battery: 0.20 },
  gaming:      { cpu: 0.30, gpu: 0.45, ram: 0.15, storage: 0.08, portability: 0.01, battery: 0.01 },
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Normalise each spec onto a 0–100 scale so they can be combined. */
function normalise(specs: { cpuScore: number; gpuScore: number; ramGB: number; storageGB: number; weightKg?: number; batteryHours?: number }) {
  return {
    cpu: clamp(specs.cpuScore),
    gpu: clamp(specs.gpuScore),
    ram: clamp((specs.ramGB / 64) * 100),
    storage: clamp((specs.storageGB / 2048) * 100),
    // Lighter is better: 1.0kg ≈ 100, 3.0kg ≈ 0
    portability: clamp(((3 - (specs.weightKg ?? 1.5)) / 2) * 100),
    battery: clamp(((specs.batteryHours ?? 12) / 24) * 100),
  };
}

/** Weighted 0–100 performance score for a given use case. */
function weightedScore(
  n: ReturnType<typeof normalise>,
  w: (typeof WEIGHTS)[UseCase],
): number {
  return (
    w.cpu * n.cpu +
    w.gpu * n.gpu +
    w.ram * n.ram +
    w.storage * n.storage +
    w.portability * n.portability +
    w.battery * n.battery
  );
}

function pct(from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.round((to / from - 1) * 100);
}

function buildReasons(
  laptop: Laptop,
  current: CurrentSetup,
  useCase: UseCase,
  budgetUSD: number,
): { reasons: string[]; caveats: string[] } {
  const reasons: string[] = [];
  const caveats: string[] = [];

  const cpuDelta = pct(current.cpuScore, laptop.cpuScore);
  if (cpuDelta >= 10) reasons.push(`~${cpuDelta}% faster CPU`);
  else if (cpuDelta <= -10) caveats.push(`~${Math.abs(cpuDelta)}% slower CPU`);

  const gpuDelta = pct(current.gpuScore, laptop.gpuScore);
  const gpuMatters = useCase === 'gaming' || useCase === 'creative';
  if (gpuDelta >= 15 && (gpuMatters || laptop.gpuScore >= 60))
    reasons.push(`~${gpuDelta}% stronger graphics`);
  else if (gpuMatters && gpuDelta <= -15)
    caveats.push(`weaker graphics than your current`);

  if (laptop.ramGB > current.ramGB) {
    const x = laptop.ramGB / current.ramGB;
    reasons.push(
      x >= 2 ? `${Math.round(x)}× the RAM (${laptop.ramGB}GB)` : `More RAM: ${laptop.ramGB}GB vs ${current.ramGB}GB`,
    );
  } else if (laptop.ramGB < current.ramGB) {
    caveats.push(`Less RAM: ${laptop.ramGB}GB vs ${current.ramGB}GB`);
  }

  if (laptop.storageGB > current.storageGB)
    reasons.push(`More storage: ${laptop.storageGB}GB vs ${current.storageGB}GB`);
  else if (laptop.storageGB < current.storageGB)
    caveats.push(`Less storage: ${laptop.storageGB}GB vs ${current.storageGB}GB`);

  if (current.weightKg != null) {
    const lighter = current.weightKg - laptop.weightKg;
    if (lighter >= 0.2) reasons.push(`${lighter.toFixed(1)}kg lighter`);
    else if (lighter <= -0.4) caveats.push(`${Math.abs(lighter).toFixed(1)}kg heavier`);
  }

  const headroom = budgetUSD - laptop.priceUSD;
  if (headroom >= 100) reasons.push(`$${headroom.toLocaleString()} under budget`);

  if (laptop.bestFor.includes(useCase)) reasons.push(`Built for ${useCase}`);

  if (laptop.os !== current.os) caveats.push(`Switches OS to ${laptop.os}`);

  // Always surface one catalog highlight if we have room.
  if (laptop.highlights[0] && reasons.length < 4) reasons.push(laptop.highlights[0]);

  return { reasons, caveats };
}

export function suggestLaptops(opts: SuggestOptions, limit = 4): Suggestion[] {
  const { current, budgetUSD, useCase, keepOS, minRamGB } = opts;
  const w = WEIGHTS[useCase];

  const candidates = LAPTOP_CATALOG.filter((l) => {
    if (l.id === current.laptopId) return false;
    if (l.priceUSD > budgetUSD) return false;
    if (keepOS && l.os !== current.os) return false;
    if (minRamGB && l.ramGB < minRamGB) return false;
    return true;
  });

  if (candidates.length === 0) return [];

  const currentScore = weightedScore(
    normalise({ ...current, batteryHours: 12 }),
    w,
  );

  // First pass: perf + value components.
  const scored = candidates.map((laptop) => {
    const perf = weightedScore(normalise(laptop), w);
    const value = (perf / laptop.priceUSD) * 1000; // perf per $1k
    const improvement = perf - currentScore; // >0 means better than current
    return { laptop, perf, value, improvement };
  });

  const maxValue = Math.max(...scored.map((s) => s.value)) || 1;

  const ranked: (Suggestion & { value: number })[] = scored
    .map(({ laptop, perf, value, improvement }) => {
      // Map improvement (−ve..+30) onto 0..100.
      const improvementScore = clamp(((improvement + 10) / 40) * 100);
      const valueScore = (value / maxValue) * 100;
      const fitScore = laptop.bestFor.includes(useCase) ? 100 : 45;

      const score =
        0.5 * perf + 0.2 * improvementScore + 0.2 * valueScore + 0.1 * fitScore;

      const { reasons, caveats } = buildReasons(laptop, current, useCase, budgetUSD);
      return { laptop, score: Math.round(score), reasons, caveats, value };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, limit);

  if (top.length > 0) {
    top[0].topPick = true;
    // Mark the best value/$ in the shortlist (if different from the top pick).
    const valuePick = [...top].sort((a, b) => b.value - a.value)[0];
    if (valuePick && valuePick.laptop.id !== top[0].laptop.id) {
      const match = top.find((t) => t.laptop.id === valuePick.laptop.id);
      if (match) match.valuePick = true;
    }
  }

  return top.map(({ value: _value, ...rest }) => rest);
}
