import { useMemo, useState } from 'react';
import { Plus, Calculator, ListPlus, Trash2, Download } from 'lucide-react';
import {
  computePackageCost,
  type PartInput,
  type PackageOptions,
} from './costEngine';
import { COMMERCIAL } from './rateCard';
import { blankPart, EXAMPLE_PARTS, newId } from './presets';
import { inr, pct } from './format';
import { PartEditor } from './components/PartEditor';
import { RateCardPanel } from './components/RateCardPanel';

const SYSTEMS = ['AMR', 'Tool Station — Sprayer', 'Tool Station — Sander', 'Operation Station'];

function exportCsv(packageName: string, parts: PartInput[]) {
  const pkg = computePackageCost(parts);
  const header = [
    'Part', 'Material', 'Process', 'Finished kg', 'Qty',
    'Material', 'Processing', 'Holes', 'Finishing', 'Small-part',
    'Subtotal', 'Buffer 7.5%', 'QC 10%', 'Unit cost', 'Line total',
  ];
  const rows = pkg.lines.map(({ part, cost }) => [
    part.name, part.material, part.process, part.finishedWeightKg, part.quantity,
    cost.material, cost.processing, cost.holes, cost.finishing, cost.smallPartPenalty,
    cost.subtotal, cost.designRiskBuffer, cost.qcInspection, cost.unitCost, cost.lineTotal,
  ]);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...rows, [], ['Rate-card subtotal', pkg.rateCardSubtotal]]
    .map((r) => r.map(esc).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${packageName.replace(/\s+/g, '_') || 'package'}_quote.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function CalculatorApp() {
  const [packageName, setPackageName] = useState(SYSTEMS[0]);
  const [parts, setParts] = useState<PartInput[]>(() =>
    EXAMPLE_PARTS.map((p) => ({ ...p, id: newId() })),
  );
  const [opts, setOpts] = useState<PackageOptions>({
    applyMargin: false,
    marginRate: COMMERCIAL.margin,
    applyGst: false,
    gstRate: COMMERCIAL.gst,
  });

  const pkg = useMemo(() => computePackageCost(parts, opts), [parts, opts]);

  const updatePart = (id: string, next: PartInput) =>
    setParts((ps) => ps.map((p) => (p.id === id ? next : p)));
  const removePart = (id: string) => setParts((ps) => ps.filter((p) => p.id !== id));

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: parts list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-gray-500">System package</label>
            <input
              list="systems"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              className="flex-1 min-w-[180px] rounded-md border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
            />
            <datalist id="systems">
              {SYSTEMS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          {parts.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
              <Calculator size={28} className="mx-auto text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">
                No parts yet. Add a part or load the example BOM.
              </p>
            </div>
          )}

          {parts.map((part, i) => (
            <PartEditor
              key={part.id}
              part={part}
              index={i}
              onChange={(next) => updatePart(part.id, next)}
              onRemove={() => removePart(part.id)}
            />
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setParts((ps) => [...ps, blankPart()])}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Plus size={15} /> Add part
            </button>
            <button
              onClick={() => setParts(EXAMPLE_PARTS.map((p) => ({ ...p, id: newId() })))}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ListPlus size={15} /> Load example BOM
            </button>
            {parts.length > 0 && (
              <button
                onClick={() => setParts([])}
                className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <Trash2 size={15} /> Clear all
              </button>
            )}
          </div>
        </div>

        {/* Right: sticky summary */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-6 space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                {packageName || 'Package'} — Estimate
              </h2>
              <p className="mt-1 text-xs text-gray-400">
                {parts.length} part type{parts.length === 1 ? '' : 's'} · {pkg.totalUnits} piece
                {pkg.totalUnits === 1 ? '' : 's'} total
              </p>

              <div className="mt-4 space-y-2 text-sm">
                <SummaryRow label="Rate-card subtotal" value={pkg.rateCardSubtotal} strong />
                <p className="text-xs text-gray-400 -mt-1">
                  Material + processing + holes + finishing + buffer + QC
                </p>

                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <Toggle
                    label={`SPMIL margin (${pct(opts.marginRate)})`}
                    checked={opts.applyMargin}
                    onChange={(v) => setOpts((o) => ({ ...o, applyMargin: v }))}
                    amount={opts.applyMargin ? pkg.margin : null}
                  />
                  <Toggle
                    label={`GST (${pct(opts.gstRate)})`}
                    checked={opts.applyGst}
                    onChange={(v) => setOpts((o) => ({ ...o, applyGst: v }))}
                    amount={opts.applyGst ? pkg.gst : null}
                  />
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      {opts.applyGst ? 'Total (incl. GST)' : 'Total'}
                    </span>
                    <span className="text-xl font-bold text-blue-700 tabular-nums">
                      {inr(pkg.grandTotal)}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => exportCsv(packageName, parts)}
                disabled={parts.length === 0}
                className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <Download size={15} /> Export CSV
              </button>

              <p className="mt-3 text-xs text-gray-400 leading-relaxed">
                Budgetary estimate from Annexure A (reference only). Binding pricing is
                released per-system once Origin approves drawings. Margin and GST are
                off by default — the rate card excludes both.
              </p>
            </div>

            <RateCardPanel />
          </div>
        </div>
      </div>
    </main>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-medium text-gray-700' : 'text-gray-600'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
        {inr(value)}
      </span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  amount,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  amount: number | null;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="flex items-center gap-2 text-gray-600">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-gray-300"
        />
        {label}
      </span>
      <span className="tabular-nums text-gray-700">
        {amount !== null ? inr(amount) : '—'}
      </span>
    </label>
  );
}
