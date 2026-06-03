import { useState } from 'react';
import { Trash2, ChevronDown, Sparkles, AlertTriangle, FileCheck2, Ruler } from 'lucide-react';
import {
  MATERIALS,
  PROCESSES,
  FINISHES,
  ASSEMBLY,
  type MaterialId,
  type ProcessId,
  type FinishId,
} from '../rateCard';
import { computePartCost, type PartInput } from '../costEngine';
import { SYSTEMS, type SystemId } from '../systems';
import { metricsFromExtraction } from '../presets';
import { extractFromFile, type ExtractionResult } from '../fileParsers';
import { stlMassKg, type StlUnit } from '../fileParsers/stl';
import { inr, num } from '../format';
import { DropZone } from './DropZone';

interface Props {
  part: PartInput;
  index: number;
  onChange: (part: PartInput) => void;
  onRemove: () => void;
}

const STL_UNITS: StlUnit[] = ['mm', 'cm', 'm', 'in'];

const fieldCls =
  'w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200';
const labelCls = 'block text-xs font-medium text-gray-500 mb-1';

export function PartEditor({ part, index, onChange, onRemove }: Props) {
  const [attachment, setAttachment] = useState<ExtractionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [stlUnit, setStlUnit] = useState<StlUnit>('mm');
  const [showBreakdown, setShowBreakdown] = useState(true);

  const cost = computePartCost(part);
  const proc = PROCESSES[part.process];
  const isAssembly = part.kind === 'assembly';
  // On a laser-cut sheet, through-holes are part of the cut (not charged);
  // drilling is only billed on a machined plate.
  const laserCut = part.process === 'sheet_steel' || part.process === 'sheet_aluminium';

  // Overall size for the metrics panel: 3D bbox from STL, else flat footprint from DXF.
  const m = part.metrics;
  const dims = m?.bboxMm
    ? `${num(m.bboxMm[0], 1)} × ${num(m.bboxMm[1], 1)} × ${num(m.bboxMm[2], 1)} mm`
    : m?.footprintMm
      ? `${num(m.footprintMm[0], 1)} × ${num(m.footprintMm[1], 1)} mm (flat pattern)`
      : null;

  const set = <K extends keyof PartInput>(key: K, value: PartInput[K]) =>
    onChange({ ...part, [key]: value });

  const setHole = (key: keyof PartInput['holes'], value: number) =>
    onChange({ ...part, holes: { ...part.holes, [key]: Math.max(0, value) } });

  // Recompute STL-derived mass when material/unit change while a model is loaded.
  const recomputeStlMass = (next: { material?: MaterialId; unit?: StlUnit }) => {
    if (!attachment?.stl) return;
    const unit = next.unit ?? stlUnit;
    const matId = next.material ?? part.material;
    const mass = stlMassKg(attachment.stl.volumeNative, unit, MATERIALS[matId].densityKgM3);
    onChange({ ...part, material: matId, finishedWeightKg: Math.round(mass * 1000) / 1000 });
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const result = await extractFromFile(file, {
        stlUnit,
        densityForStl: MATERIALS[part.material].densityKgM3,
      });
      setAttachment(result);
      const patch: PartInput = { ...part, name: part.name === 'New part' ? file.name : part.name };
      if (result.suggestedWeightKg !== undefined) {
        patch.finishedWeightKg = Math.round(result.suggestedWeightKg * 1000) / 1000;
      }
      if (result.suggestedMaterial) patch.material = result.suggestedMaterial;
      if (result.suggestedFinish) patch.finish = result.suggestedFinish;
      if (result.suggestedHoles) patch.holes = result.suggestedHoles;
      patch.metrics = metricsFromExtraction(result);
      onChange(patch);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600 shrink-0">
        {index + 1}
      </span>
      <input
        value={part.name}
        onChange={(e) => set('name', e.target.value)}
        className="flex-1 bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
        placeholder={isAssembly ? 'Assembly name' : 'Part name'}
      />
      {isAssembly && (
        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">
          Assembly
        </span>
      )}
      <span className="text-sm font-bold text-gray-900 tabular-nums">{inr(cost.lineTotal)}</span>
      <button
        onClick={onRemove}
        className="text-gray-300 hover:text-red-500 transition-colors"
        title="Remove"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );

  // Assembly / welding line — a different cost model (weld length × rate), so it
  // gets a dedicated, simpler editor instead of the cut-part form.
  if (isAssembly) {
    return (
      <div className="bg-white rounded-xl border border-purple-200 shadow-sm overflow-hidden">
        {header}
        <div className="p-4 space-y-4">
          {part.provenance && part.provenance.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <FileCheck2 size={13} className="text-emerald-600" />
                Source drawings
              </div>
              <ul className="space-y-0.5">
                {part.provenance.map((p, i) => (
                  <li key={i}>
                    <span className="font-medium">{p.label}:</span> {p.value}{' '}
                    <span className="text-emerald-600/80">← {p.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
            <span>
              <strong>Assumed rate — not yet confirmed.</strong> This is an assembly drawing (how
              parts are welded/joined), not a part to be cut. It&apos;s priced at{' '}
              <strong>{inr(ASSEMBLY.weldRatePerInch)}/inch of weld</strong>, a placeholder pending
              SPMIL&apos;s confirmed welding rate. Enter the total weld length below.
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className={labelCls}>System</label>
              <select
                value={part.system}
                onChange={(e) => set('system', e.target.value as SystemId)}
                className={fieldCls}
              >
                {SYSTEMS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Weld length (inches)</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={part.weldLengthIn ?? 0}
                onChange={(e) => set('weldLengthIn', Math.max(0, parseFloat(e.target.value) || 0))}
                className={`${fieldCls} tabular-nums`}
              />
            </div>
            <div>
              <label className={labelCls}>Quantity</label>
              <input
                type="number"
                min={1}
                step={1}
                value={part.quantity}
                onChange={(e) => set('quantity', Math.max(1, parseInt(e.target.value) || 1))}
                className={`${fieldCls} tabular-nums`}
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-100">
            <div className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <Ruler size={13} /> Cost-driver metrics
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                <MetricLine
                  label="Weld length"
                  value={`${num(part.weldLengthIn ?? 0, 1)} in`}
                  basis={`${inr(ASSEMBLY.weldRatePerInch)}/in — assumed, unconfirmed`}
                />
                {dims && <MetricLine label="Overall size" value={dims} basis="geometry (informational)" />}
              </tbody>
            </table>
          </div>

          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              <BreakdownRow
                label="Welding / assembly"
                detail={`${num(part.weldLengthIn ?? 0, 1)} in @ ${inr(ASSEMBLY.weldRatePerInch)}/in — assumed`}
                value={cost.welding}
              />
              <BreakdownRow label="Design risk buffer (7.5%)" value={cost.designRiskBuffer} />
              <BreakdownRow label="QC inspection (10%)" value={cost.qcInspection} />
              <BreakdownRow label="Unit cost" value={cost.unitCost} bold />
              <BreakdownRow label={`Line total × ${part.quantity}`} value={cost.lineTotal} bold highlight />
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {header}

      <div className="p-4 space-y-4">
        {/* Quote inputs & sources — lets you verify where each value came from */}
        {part.provenance && part.provenance.length > 0 && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <FileCheck2 size={13} className="text-emerald-600" />
              Quote inputs &amp; sources
            </div>
            <ul className="space-y-0.5">
              {part.provenance.map((p, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    <span className="font-medium">{p.label}:</span> {p.value}
                  </span>
                  <span className="text-emerald-600/80 truncate">← {p.source}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Missing-weight warning — the usual reason the same part prices
            differently across file formats (STL carries mass, STEP/DXF may not). */}
        {part.finishedWeightKg <= 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
            <span>
              <strong>No finished weight set.</strong> Material, processing and finishing all
              price at ₹0, so this line is far cheaper than it should be. This is usually why the
              same part costs differently across file formats — an STL carries mass, but a
              STEP/DXF/PDF often doesn&apos;t. Enter the weight below, or attach an STL.
            </span>
          </div>
        )}

        {/* Upload */}
        <div>
          <DropZone onFile={handleFile} busy={busy} fileName={attachment?.fileName} />
          {attachment && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-blue-500" />
              <div className="space-y-0.5">
                {attachment.summary.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          )}
          {attachment?.kind === 'stl' && (
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <span>Interpret STL units as</span>
              <select
                value={stlUnit}
                onChange={(e) => {
                  const u = e.target.value as StlUnit;
                  setStlUnit(u);
                  recomputeStlMass({ unit: u });
                }}
                className="rounded border border-gray-200 px-1.5 py-0.5"
              >
                {STL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <span>· mass auto-updates with material</span>
            </div>
          )}
        </div>

        {/* Inputs grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>System</label>
            <select
              value={part.system}
              onChange={(e) => set('system', e.target.value as SystemId)}
              className={fieldCls}
            >
              {SYSTEMS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Material</label>
            <select
              value={part.material}
              onChange={(e) => recomputeStlMass({ material: e.target.value as MaterialId })}
              className={fieldCls}
            >
              {Object.values(MATERIALS).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {inr(m.ratePerKg)}/kg
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className={labelCls}>Process</label>
            <select
              value={part.process}
              onChange={(e) => {
                const p = e.target.value as ProcessId;
                const allows = PROCESSES[p];
                onChange({
                  ...part,
                  process: p,
                  precisionGround: allows.allowsPrecisionGround ? part.precisionGround : false,
                  flatnessPremium: allows.allowsFlatness ? part.flatnessPremium : false,
                });
              }}
              className={fieldCls}
            >
              {Object.entries(PROCESSES).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Finished weight (kg)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={part.finishedWeightKg}
              onChange={(e) => set('finishedWeightKg', parseFloat(e.target.value) || 0)}
              className={`${fieldCls} tabular-nums`}
            />
          </div>

          <div>
            <label className={labelCls}>Finish</label>
            <select
              value={part.finish}
              onChange={(e) => set('finish', e.target.value as FinishId)}
              className={fieldCls}
            >
              {Object.entries(FINISHES).map(([id, f]) => (
                <option key={id} value={id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Quantity</label>
            <input
              type="number"
              min={1}
              step={1}
              value={part.quantity}
              onChange={(e) => set('quantity', Math.max(1, parseInt(e.target.value) || 1))}
              className={`${fieldCls} tabular-nums`}
            />
          </div>

          <div>
            <label className={labelCls}>
              {laserCut ? 'Drilled / cut holes' : 'Drilled holes'}
            </label>
            <input
              type="number"
              min={0}
              value={part.holes.drilled}
              onChange={(e) => setHole('drilled', parseInt(e.target.value) || 0)}
              className={`${fieldCls} tabular-nums`}
            />
            {laserCut && (
              <p className="mt-0.5 text-[11px] text-gray-400">Laser-cut — included in cut, ₹0</p>
            )}
          </div>
          <div>
            <label className={labelCls}>Tapped holes</label>
            <input
              type="number"
              min={0}
              value={part.holes.tapped}
              onChange={(e) => setHole('tapped', parseInt(e.target.value) || 0)}
              className={`${fieldCls} tabular-nums`}
            />
          </div>
          <div>
            <label className={labelCls}>Countersunk</label>
            <input
              type="number"
              min={0}
              value={part.holes.countersunk}
              onChange={(e) => setHole('countersunk', parseInt(e.target.value) || 0)}
              className={`${fieldCls} tabular-nums`}
            />
          </div>
          {laserCut && (
            <div>
              <label className={labelCls}>Bends (press brake)</label>
              <input
                type="number"
                min={0}
                value={part.bends ?? 0}
                onChange={(e) => set('bends', Math.max(0, parseInt(e.target.value) || 0))}
                className={`${fieldCls} tabular-nums`}
              />
              <p className="mt-0.5 text-[11px] text-gray-400">In sheet processing rate</p>
            </div>
          )}
        </div>

        {/* Plate multiplier toggles */}
        {(proc.allowsPrecisionGround || proc.allowsFlatness) && (
          <div className="flex flex-wrap gap-4">
            {proc.allowsPrecisionGround && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={part.precisionGround}
                  onChange={(e) =>
                    onChange({
                      ...part,
                      precisionGround: e.target.checked,
                      // mutually exclusive with flatness premium
                      flatnessPremium: e.target.checked ? false : part.flatnessPremium,
                    })
                  }
                  className="rounded border-gray-300"
                />
                Precision ground (0.05mm, both faces) — 2.0× + 1.80× gross-up
              </label>
            )}
            {proc.allowsFlatness && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={part.flatnessPremium}
                  onChange={(e) =>
                    onChange({
                      ...part,
                      flatnessPremium: e.target.checked,
                      precisionGround: e.target.checked ? false : part.precisionGround,
                    })
                  }
                  className="rounded border-gray-300"
                />
                Flatness premium (0.5mm) — 1.40×
              </label>
            )}
          </div>
        )}

        {/* Cost-driver metrics — the parameters the rate is calculated from */}
        <div className="rounded-lg border border-gray-100">
          <div className="flex items-center gap-1.5 border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <Ruler size={13} /> Cost-driver metrics
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {dims && <MetricLine label="Overall size" value={dims} basis="geometry (informational)" />}
              {part.metrics?.volumeMm3 !== undefined && (
                <MetricLine
                  label="Solid volume"
                  value={`${num(part.metrics.volumeMm3 / 1000, 1)} cm³`}
                  basis="informational"
                />
              )}
              <MetricLine
                label="Finished weight"
                value={`${num(part.finishedWeightKg, 3)} kg`}
                basis="drives material + processing + finishing"
              />
              <MetricLine
                label="Raw stock (buy-to-fly)"
                value={`${num(cost.rawMaterialKg, 3)} kg @ ${cost.grossUpFactor}×`}
                basis={`material @ ${inr(MATERIALS[part.material].ratePerKg)}/kg`}
              />
              <MetricLine
                label="Processing"
                value={proc.label.split(' — ')[0]}
                basis={`${inr(cost.processingRatePerKg)}/kg of finished weight`}
              />
              {laserCut && (
                <MetricLine
                  label="Bends (press brake)"
                  value={`${part.bends ?? 0}`}
                  basis="included in sheet processing rate"
                />
              )}
              <MetricLine
                label="Holes — drilled / cut"
                value={`${part.holes.drilled}`}
                basis={part.process === 'plate_machined' ? `drilling @ ${inr(8)}/hole` : 'laser-cut — included (₹0)'}
              />
              <MetricLine label="Holes — tapped" value={`${part.holes.tapped}`} basis={`tapping @ ${inr(16)}/hole`} />
              <MetricLine
                label="Holes — countersunk"
                value={`${part.holes.countersunk}`}
                basis={`countersink @ ${inr(28)}/hole`}
              />
              {part.metrics?.holeDiametersMm && part.metrics.holeDiametersMm.length > 0 && (
                <MetricLine
                  label="Hole sizes"
                  value={`Ø ${part.metrics.holeDiametersMm.map((d) => num(d, 1)).join(', ')} mm`}
                  basis="from DXF"
                />
              )}
              <MetricLine
                label="Finish"
                value={FINISHES[part.finish].label}
                basis={cost.finishing > 0 ? `${inr(FINISHES[part.finish].ratePerKg)}/kg` : 'no cost'}
              />
            </tbody>
          </table>
        </div>

        {/* Breakdown */}
        <div className="rounded-lg border border-gray-100 bg-gray-50">
          <button
            onClick={() => setShowBreakdown((s) => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide"
          >
            Per-unit cost breakdown
            <ChevronDown
              size={14}
              className={`transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
            />
          </button>
          {showBreakdown && (
            <table className="w-full text-sm px-3">
              <tbody className="divide-y divide-gray-100">
                <BreakdownRow
                  label="Material"
                  detail={`${num(cost.rawMaterialKg, 3)} kg raw @ ${inr(MATERIALS[part.material].ratePerKg)}/kg (gross-up ${cost.grossUpFactor}×)`}
                  value={cost.material}
                />
                <BreakdownRow
                  label="Processing"
                  detail={`${num(part.finishedWeightKg, 2)} kg @ ${inr(cost.processingRatePerKg)}/kg`}
                  value={cost.processing}
                />
                <BreakdownRow
                  label="Hole operations"
                  detail={
                    laserCut
                      ? `${part.holes.drilled} laser-cut (in cut, ₹0) · ${part.holes.tapped}T · ${part.holes.countersunk}CSK charged`
                      : `${part.holes.drilled}D · ${part.holes.tapped}T · ${part.holes.countersunk}CSK`
                  }
                  value={cost.holes}
                />
                {cost.finishing > 0 && (
                  <BreakdownRow
                    label="Finishing"
                    detail={FINISHES[part.finish].label}
                    value={cost.finishing}
                  />
                )}
                {cost.isSmallPart && (
                  <BreakdownRow
                    label="Small-part penalty"
                    detail="part < 2kg, ₹150/kg flat"
                    value={cost.smallPartPenalty}
                  />
                )}
                <BreakdownRow label="Subtotal" value={cost.subtotal} bold />
                <BreakdownRow label="Design risk buffer (7.5%)" value={cost.designRiskBuffer} />
                <BreakdownRow label="QC inspection (10%)" value={cost.qcInspection} />
                <BreakdownRow label="Unit cost" value={cost.unitCost} bold />
                <BreakdownRow
                  label={`Line total × ${part.quantity}`}
                  value={cost.lineTotal}
                  bold
                  highlight
                />
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricLine({ label, value, basis }: { label: string; value: string; basis: string }) {
  return (
    <tr>
      <td className="py-1.5 pl-3 pr-2 text-gray-600 whitespace-nowrap">{label}</td>
      <td className="py-1.5 px-2 font-medium text-gray-900 tabular-nums">{value}</td>
      <td className="py-1.5 pr-3 text-right text-xs text-gray-400">{basis}</td>
    </tr>
  );
}

function BreakdownRow({
  label,
  detail,
  value,
  bold,
  highlight,
}: {
  label: string;
  detail?: string;
  value: number;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr className={highlight ? 'bg-blue-50' : ''}>
      <td className={`py-1.5 pl-3 ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
        {label}
      </td>
      <td className="py-1.5 text-xs text-gray-400">{detail}</td>
      <td
        className={`py-1.5 pr-3 text-right tabular-nums ${
          bold ? 'font-semibold text-gray-900' : 'text-gray-700'
        }`}
      >
        {inr(value, 2)}
      </td>
    </tr>
  );
}
