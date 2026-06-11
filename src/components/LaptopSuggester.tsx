import { useMemo, useState } from 'react';
import {
  Laptop,
  Award,
  Tag,
  Wallet,
  Check,
  AlertTriangle,
  Info,
  Link2,
  Loader2,
} from 'lucide-react';
import {
  LAPTOP_CATALOG,
  PERF_TIERS,
  USE_CASE_LABELS,
  type OS,
  type PerfTier,
  type UseCase,
} from '../laptopCatalog';
import {
  suggestLaptops,
  type CurrentSetup,
  type Suggestion,
} from '../suggestLaptops';
import { interpretLink, type Confidence, type LinkResult } from '../parseLaptopUrl';

type Mode = 'link' | 'catalog' | 'custom';

const BUDGET_PRESETS = [1000, 1500, 2000, 3000];

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function LaptopSuggester() {
  const [mode, setMode] = useState<Mode>('link');

  // Link mode
  const [url, setUrl] = useState('');
  const [resolved, setResolved] = useState<LinkResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Catalog mode
  const [currentLaptopId, setCurrentLaptopId] = useState<string>(LAPTOP_CATALOG[0].id);

  // Custom mode
  const [perfTier, setPerfTier] = useState<PerfTier>('mainstream');
  const [ramGB, setRamGB] = useState(16);
  const [storageGB, setStorageGB] = useState(512);
  const [os, setOS] = useState<OS>('Windows');

  // Shared
  const [budget, setBudget] = useState(1500);
  const [useCase, setUseCase] = useState<UseCase>('general');
  const [keepOS, setKeepOS] = useState(false);

  // Client-side parse of the pasted link (instant, no network).
  const clientLink = useMemo<LinkResult | null>(
    () => (url.trim() ? interpretLink(url) : null),
    [url],
  );
  // Prefer a server-resolved result when it's more confident.
  const linkResult = useMemo<LinkResult | null>(() => {
    if (!clientLink) return null;
    if (resolved && CONFIDENCE_RANK[resolved.confidence] >= CONFIDENCE_RANK[clientLink.confidence]) {
      return resolved;
    }
    return clientLink;
  }, [clientLink, resolved]);

  const current: CurrentSetup | null = useMemo(() => {
    if (mode === 'link') return linkResult?.setup ?? null;
    if (mode === 'catalog') {
      const l = LAPTOP_CATALOG.find((x) => x.id === currentLaptopId)!;
      return {
        laptopId: l.id,
        label: l.name,
        os: l.os,
        cpuScore: l.cpuScore,
        gpuScore: l.gpuScore,
        ramGB: l.ramGB,
        storageGB: l.storageGB,
        weightKg: l.weightKg,
      };
    }
    const tier = PERF_TIERS[perfTier];
    return {
      label: `Your ${tier.label.toLowerCase()} ${os} laptop`,
      os,
      cpuScore: tier.cpuScore,
      gpuScore: tier.gpuScore,
      ramGB,
      storageGB,
    };
  }, [mode, linkResult, currentLaptopId, perfTier, ramGB, storageGB, os]);

  const suggestions = useMemo(
    () => (current ? suggestLaptops({ current, budgetUSD: budget, useCase, keepOS }) : []),
    [current, budget, useCase, keepOS],
  );

  async function resolveLink() {
    if (!url.trim()) return;
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/laptop?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read that link');

      const fromUrl = data.resolvedUrl ? interpretLink(data.resolvedUrl) : null;
      const fromTitle = data.title ? interpretLink(data.title) : null;
      const best = [fromUrl, fromTitle]
        .filter((r): r is LinkResult => !!r)
        .sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])[0];

      if (!best || best.confidence === 'low') {
        setResolveError("Still couldn't read laptop details — try the full product URL or enter specs.");
      } else {
        setResolved(best);
      }
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Could not read that link');
    } finally {
      setResolving(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400';
  const labelClass = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
          <Laptop size={16} />
        </span>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Laptop Alternative Suggester
        </h2>
      </div>
      <p className="text-xs text-gray-400 mb-5">
        Paste a link to your laptop (or describe it) and set a budget — get
        better alternatives you can buy within it.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ---- Inputs ---- */}
        <div className="lg:col-span-4 space-y-4">
          {/* Current laptop source toggle */}
          <div>
            <span className={labelClass}>Your current laptop</span>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs font-medium">
              {([
                ['link', 'Paste a link'],
                ['catalog', 'Pick a model'],
                ['custom', 'Describe specs'],
              ] as [Mode, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    mode === m ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'link' && (
            <div className="space-y-2">
              <label className={labelClass}>Product link</label>
              <input
                type="url"
                inputMode="url"
                placeholder="Paste an Amazon (or store) link…"
                className={inputClass}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setResolved(null);
                  setResolveError(null);
                }}
              />
              {url.trim() && linkResult && (
                <DetectedBox
                  result={linkResult}
                  resolving={resolving}
                  resolveError={resolveError}
                  onResolve={resolveLink}
                  onSwitchMode={() => setMode('catalog')}
                />
              )}
            </div>
          )}

          {mode === 'catalog' && (
            <div>
              <label className={labelClass}>Model</label>
              <select
                className={inputClass}
                value={currentLaptopId}
                onChange={(e) => setCurrentLaptopId(e.target.value)}
              >
                {LAPTOP_CATALOG.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.brand} {l.name} — {l.ramGB}GB / {l.storageGB}GB
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'custom' && (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Performance level</label>
                <select
                  className={inputClass}
                  value={perfTier}
                  onChange={(e) => setPerfTier(e.target.value as PerfTier)}
                >
                  {(Object.keys(PERF_TIERS) as PerfTier[]).map((t) => (
                    <option key={t} value={t}>
                      {PERF_TIERS[t].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>RAM (GB)</label>
                  <select className={inputClass} value={ramGB} onChange={(e) => setRamGB(Number(e.target.value))}>
                    {[8, 16, 24, 32, 64].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Storage (GB)</label>
                  <select className={inputClass} value={storageGB} onChange={(e) => setStorageGB(Number(e.target.value))}>
                    {[128, 256, 512, 1024, 2048].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Operating system</label>
                <select className={inputClass} value={os} onChange={(e) => setOS(e.target.value as OS)}>
                  <option value="Windows">Windows</option>
                  <option value="macOS">macOS</option>
                </select>
              </div>
            </div>
          )}

          {/* Budget */}
          <div>
            <label className={labelClass}>Budget (USD)</label>
            <input
              type="number"
              min={500}
              step={50}
              className={inputClass}
              value={budget}
              onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {BUDGET_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setBudget(p)}
                  className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                    budget === p
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {usd(p)}
                </button>
              ))}
            </div>
          </div>

          {/* Use case */}
          <div>
            <label className={labelClass}>Primarily for</label>
            <select className={inputClass} value={useCase} onChange={(e) => setUseCase(e.target.value as UseCase)}>
              {(Object.keys(USE_CASE_LABELS) as UseCase[]).map((u) => (
                <option key={u} value={u}>{USE_CASE_LABELS[u]}</option>
              ))}
            </select>
          </div>

          {current && (
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepOS}
                onChange={(e) => setKeepOS(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
              />
              Stay on {current.os}
            </label>
          )}
        </div>

        {/* ---- Results ---- */}
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500">
              {suggestions.length > 0
                ? `${suggestions.length} alternative${suggestions.length > 1 ? 's' : ''} under ${usd(budget)}`
                : current ? 'No matches' : 'Awaiting your laptop'}
            </p>
            {current && (
              <p className="text-xs text-gray-400 truncate max-w-[55%] text-right">
                vs. {current.label}
              </p>
            )}
          </div>

          {!current ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
              <Link2 size={18} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">
                {mode === 'link'
                  ? 'Paste a product link above to see alternatives.'
                  : 'Tell us about your current laptop to see alternatives.'}
              </p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
              <Info size={18} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Nothing in the catalog fits these filters.</p>
              <p className="mt-1 text-xs text-gray-400">
                Try raising the budget{keepOS ? ` or unchecking “Stay on ${current.os}”` : ''}.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions.map((s) => (
                <SuggestionCard key={s.laptop.id} suggestion={s} />
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-gray-400 border-t border-gray-100 pt-3">
        Laptop details are read from the link's web address; specs and prices in
        the catalog are approximate (USD, pre-tax) and for guidance only.
        Performance is a relative index, not a benchmark score.
      </p>
    </section>
  );
}

function DetectedBox({
  result,
  resolving,
  resolveError,
  onResolve,
  onSwitchMode,
}: {
  result: LinkResult;
  resolving: boolean;
  resolveError: string | null;
  onResolve: () => void;
  onSwitchMode: () => void;
}) {
  const weak = result.confidence === 'low' || !result.setup;

  if (weak) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={13} /> Couldn't read enough from that link.
        </p>
        <p className="mt-1 text-amber-700">
          Try the full product page URL (not a shortened share link), or{' '}
          <button onClick={onSwitchMode} className="underline font-medium">
            pick a model
          </button>
          .
        </p>
        <button
          onClick={onResolve}
          disabled={resolving}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {resolving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
          {resolving ? 'Reading link…' : 'Try to resolve link'}
        </button>
        {resolveError && <p className="mt-1.5 text-amber-700">{resolveError}</p>}
      </div>
    );
  }

  const tone =
    result.confidence === 'high'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-blue-200 bg-blue-50 text-blue-800';

  return (
    <div className={`rounded-lg border p-3 text-xs ${tone}`}>
      <p className="flex items-center gap-1.5 font-medium">
        <Check size={13} /> Detected: {result.summary}
      </p>
      <p className="mt-1 opacity-80">
        {result.confidence === 'high'
          ? 'Matched to a known model.'
          : 'Read from the link — not exact? '}
        {result.confidence !== 'high' && (
          <button onClick={onSwitchMode} className="underline font-medium">
            pick a model instead
          </button>
        )}
      </p>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const { laptop, reasons, caveats, topPick, valuePick } = suggestion;

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        topPick ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">{laptop.name}</h3>
            {topPick && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                <Award size={11} /> Top pick
              </span>
            )}
            {valuePick && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                <Tag size={11} /> Best value
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {laptop.brand} · {laptop.os} · {laptop.cpu} · {laptop.ramGB}GB /{' '}
            {laptop.storageGB}GB · {laptop.screenNote} · {laptop.weightKg}kg
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-gray-900 tabular-nums">{usd(laptop.priceUSD)}</p>
          <p className="text-[11px] text-gray-400 flex items-center justify-end gap-1">
            <Wallet size={11} /> {laptop.batteryHours}h battery
          </p>
        </div>
      </div>

      {/* Why */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {reasons.map((r, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
          >
            <Check size={11} /> {r}
          </span>
        ))}
      </div>

      {/* Caveats */}
      {caveats.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {caveats.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
            >
              <AlertTriangle size={11} /> {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
