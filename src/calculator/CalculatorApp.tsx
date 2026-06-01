import { useMemo, useState } from 'react';
import { Plus, Calculator, ListPlus, Trash2, Download, Sparkles, Package, GitCompareArrows } from 'lucide-react';
import {
  computePackageCost,
  type PartInput,
  type PackageOptions,
} from './costEngine';
import { COMMERCIAL } from './rateCard';
import { SYSTEMS, SYSTEM_LABEL, type SystemId } from './systems';
import { blankPart, EXAMPLE_PARTS, newId, partFromExtraction } from './presets';
import { inr, pct } from './format';
import { extractFromZip } from './fileParsers/zip';
import { PartEditor } from './components/PartEditor';
import { RateCardPanel } from './components/RateCardPanel';
import { DropZone } from './components/DropZone';
import { ComparePanel } from './components/ComparePanel';

interface ImportSummary {
  counts: Partial<Record<SystemId, number>>;
  total: number;
  skipped: string[];
  mergedComponents: number;
}

function exportCsv(parts: PartInput[]) {
  const pkg = computePackageCost(parts);
  const header = [
    'System', 'Part', 'Material', 'Process', 'Finished kg', 'Qty',
    'Material', 'Processing', 'Holes', 'Finishing', 'Small-part',
    'Subtotal', 'Buffer 7.5%', 'QC 10%', 'Unit cost', 'Line total',
  ];
  const rows = pkg.lines.map(({ part, cost }) => [
    SYSTEM_LABEL[part.system], part.name, part.material, part.process,
    part.finishedWeightKg, part.quantity,
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
  a.download = 'manufacturing_quote.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function CalculatorApp() {
  const [parts, setParts] = useState<PartInput[]>(() =>
    EXAMPLE_PARTS.map((p) => ({ ...p, id: newId() })),
  );
  const [opts, setOpts] = useState<PackageOptions>({
    applyMargin: false,
    marginRate: COMMERCIAL.margin,
    applyGst: false,
    gstRate: COMMERCIAL.gst,
  });
  const [zipBusy, setZipBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [comparing, setComparing] = useState(false);

  const pkg = useMemo(() => computePackageCost(parts, opts), [parts, opts]);

  // Group the priced lines by system, in canonical system order.
  const grouped = useMemo(() => {
    return SYSTEMS.map((sys) => {
      const lines = pkg.lines.filter((l) => l.part.system === sys.id);
      const subtotal = lines.reduce((s, l) => s + l.cost.lineTotal, 0);
      const units = lines.reduce((s, l) => s + l.part.quantity, 0);
      return { sys, lines, subtotal, units };
    }).filter((g) => g.lines.length > 0);
  }, [pkg]);

  const updatePart = (id: string, next: PartInput) =>
    setParts((ps) => ps.map((p) => (p.id === id ? next : p)));
  const removePart = (id: string) => setParts((ps) => ps.filter((p) => p.id !== id));
  const addPart = (system: SystemId) => setParts((ps) => [...ps, blankPart(system)]);

  const handleZip = async (file: File) => {
    setZipBusy(true);
    setImportSummary(null);
    try {
      const { results, skipped, mergedComponents } = await extractFromZip(file);
      const newParts = results.map(partFromExtraction);
      const counts: Partial<Record<SystemId, number>> = {};
      for (const p of newParts) counts[p.system] = (counts[p.system] ?? 0) + 1;
      setParts((ps) => [...ps, ...newParts]);
      setImportSummary({ counts, total: newParts.length, skipped, mergedComponents });
    } finally {
      setZipBusy(false);
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: bulk import + grouped parts */}
        <div className="lg:col-span-2 space-y-4">
          {/* Bulk ZIP import */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Package size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700">Bulk import a ZIP of drawings</h2>
            </div>
            <DropZone
              onFile={handleZip}
              busy={zipBusy}
              accept=".zip"
              title="Drop a .zip of drawings / CAD files"
              hint="Each file becomes a part, auto-filed by system from its name (AMR · Sprayer · Sander · Operation)"
            />
            {importSummary && (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
                <Sparkles size={13} className="mt-0.5 shrink-0 text-green-600" />
                <div>
                  <p className="font-medium">
                    Imported {importSummary.total} component{importSummary.total === 1 ? '' : 's'}.
                    {importSummary.mergedComponents > 0 &&
                      ` ${importSummary.mergedComponents} built from multiple files (STEP/DXF/PDF merged into one).`}
                  </p>
                  <p>
                    {Object.entries(importSummary.counts)
                      .map(([sys, n]) => `${SYSTEM_LABEL[sys as SystemId]}: ${n}`)
                      .join(' · ')}
                  </p>
                  {importSummary.skipped.length > 0 && (
                    <p className="text-green-700/70 mt-0.5">
                      Skipped {importSummary.skipped.length} unsupported file
                      {importSummary.skipped.length === 1 ? '' : 's'}: {importSummary.skipped.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {parts.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
              <Calculator size={28} className="mx-auto text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">
                No parts yet. Import a ZIP, add a part, or load the example BOM.
              </p>
            </div>
          )}

          {/* Grouped sections */}
          {grouped.map(({ sys, lines, subtotal, units }) => (
            <section key={sys.id} className="space-y-3">
              <div className="flex items-center justify-between border-b border-gray-200 pb-1.5">
                <h2 className="text-sm font-bold text-gray-800">
                  {sys.label}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {lines.length} part{lines.length === 1 ? '' : 's'} · {units} pc
                  </span>
                </h2>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {inr(subtotal)}
                </span>
              </div>

              {lines.map(({ part }) => (
                <PartEditor
                  key={part.id}
                  part={part}
                  index={parts.findIndex((p) => p.id === part.id)}
                  onChange={(next) => updatePart(part.id, next)}
                  onRemove={() => removePart(part.id)}
                />
              ))}

              <button
                onClick={() => addPart(sys.id)}
                className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus size={14} /> Add part to {sys.label}
              </button>
            </section>
          ))}

          {/* Global toolbar */}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => addPart('Unsorted')}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Plus size={15} /> Add part
            </button>
            <button
              onClick={() => {
                setParts(EXAMPLE_PARTS.map((p) => ({ ...p, id: newId() })));
                setImportSummary(null);
              }}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ListPlus size={15} /> Load example BOM
            </button>
            {parts.length >= 2 && (
              <button
                onClick={() => setComparing(true)}
                className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <GitCompareArrows size={15} /> Compare parts
              </button>
            )}
            {parts.length > 0 && (
              <button
                onClick={() => {
                  setParts([]);
                  setImportSummary(null);
                }}
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
                Quote Estimate
              </h2>
              <p className="mt-1 text-xs text-gray-400">
                {parts.length} part type{parts.length === 1 ? '' : 's'} · {pkg.totalUnits} piece
                {pkg.totalUnits === 1 ? '' : 's'} total
              </p>

              <div className="mt-4 space-y-2 text-sm">
                {/* Per-system subtotals */}
                {grouped.map(({ sys, subtotal }) => (
                  <div key={sys.id} className="flex items-center justify-between">
                    <span className="text-gray-600 truncate pr-2">{sys.label}</span>
                    <span className="tabular-nums text-gray-700">{inr(subtotal)}</span>
                  </div>
                ))}

                <div className="border-t border-gray-100 pt-2">
                  <SummaryRow label="Rate-card subtotal" value={pkg.rateCardSubtotal} strong />
                </div>

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
                onClick={() => exportCsv(parts)}
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

      {comparing && parts.length >= 2 && (
        <ComparePanel parts={parts} onClose={() => setComparing(false)} />
      )}
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
