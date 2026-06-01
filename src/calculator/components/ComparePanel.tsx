import { useState } from 'react';
import { X, ArrowRight, GitCompareArrows } from 'lucide-react';
import {
  computePartCost,
  type PartInput,
  type PartCost,
} from '../costEngine';
import { MATERIALS, PROCESSES, FINISHES } from '../rateCard';
import { SYSTEM_LABEL } from '../systems';
import { inr, num } from '../format';

interface Props {
  parts: PartInput[];
  onClose: () => void;
}

const holeStr = (p: PartInput) =>
  `${p.holes.drilled}D · ${p.holes.tapped}T · ${p.holes.countersunk}CSK`;

// How a manufacturer explains a line-item gap: attribute it to the inputs that
// actually move that cost (weight, alloy rate, process/gross-up, counts).
function reasonFor(label: string, a: PartInput, b: PartInput, ca: PartCost, cb: PartCost): string {
  const bits: string[] = [];
  const wA = a.finishedWeightKg;
  const wB = b.finishedWeightKg;
  const weightBit =
    wA !== wB ? `weight ${num(wA, 2)}→${num(wB, 2)} kg` : '';

  if (label === 'Material') {
    if (a.material !== b.material) {
      bits.push(
        `${MATERIALS[a.material].label} (${inr(MATERIALS[a.material].ratePerKg)}/kg) → ${MATERIALS[b.material].label} (${inr(MATERIALS[b.material].ratePerKg)}/kg)`,
      );
    }
    if (weightBit) bits.push(weightBit);
    if (ca.grossUpFactor !== cb.grossUpFactor) {
      bits.push(`buy-to-fly ${ca.grossUpFactor}×→${cb.grossUpFactor}×`);
    }
  } else if (label === 'Processing') {
    if (a.process !== b.process) {
      bits.push(`${PROCESSES[a.process].label} → ${PROCESSES[b.process].label}`);
    }
    if (ca.processingRatePerKg !== cb.processingRatePerKg) {
      bits.push(`${inr(ca.processingRatePerKg)}/kg → ${inr(cb.processingRatePerKg)}/kg`);
    }
    if (weightBit) bits.push(weightBit);
  } else if (label === 'Hole operations') {
    bits.push(`${holeStr(a)} → ${holeStr(b)}`);
  } else if (label === 'Finishing') {
    if (a.finish !== b.finish) {
      bits.push(`${FINISHES[a.finish].label} → ${FINISHES[b.finish].label}`);
    }
    if (weightBit) bits.push(weightBit);
  } else if (label === 'Small-part penalty') {
    bits.push('part under 2 kg, ₹150/kg flat handling');
  } else if (label === 'Design risk buffer' || label === 'QC inspection') {
    bits.push('scales with the subtotal above');
  }
  return bits.join(' · ');
}

export function ComparePanel({ parts, onClose }: Props) {
  const [idA, setIdA] = useState(parts[0]?.id ?? '');
  const [idB, setIdB] = useState(parts[1]?.id ?? parts[0]?.id ?? '');

  const a = parts.find((p) => p.id === idA) ?? parts[0];
  const b = parts.find((p) => p.id === idB) ?? parts[1] ?? parts[0];
  const ca = computePartCost(a);
  const cb = computePartCost(b);

  const inputRows: { label: string; a: string; b: string }[] = [
    { label: 'System', a: SYSTEM_LABEL[a.system], b: SYSTEM_LABEL[b.system] },
    {
      label: 'Material',
      a: `${MATERIALS[a.material].label} · ${inr(MATERIALS[a.material].ratePerKg)}/kg`,
      b: `${MATERIALS[b.material].label} · ${inr(MATERIALS[b.material].ratePerKg)}/kg`,
    },
    { label: 'Process', a: PROCESSES[a.process].label, b: PROCESSES[b.process].label },
    { label: 'Finished weight', a: `${num(a.finishedWeightKg, 3)} kg`, b: `${num(b.finishedWeightKg, 3)} kg` },
    { label: 'Holes (D·T·CSK)', a: holeStr(a), b: holeStr(b) },
    { label: 'Finish', a: FINISHES[a.finish].label, b: FINISHES[b.finish].label },
    {
      label: 'Plate options',
      a: a.precisionGround ? 'Precision ground' : a.flatnessPremium ? 'Flatness premium' : '—',
      b: b.precisionGround ? 'Precision ground' : b.flatnessPremium ? 'Flatness premium' : '—',
    },
    { label: 'Quantity', a: `${a.quantity}`, b: `${b.quantity}` },
  ];

  // Per-piece cost drivers, ranked by the size of the gap they create.
  const drivers = [
    { label: 'Material', a: ca.material, b: cb.material },
    { label: 'Processing', a: ca.processing, b: cb.processing },
    { label: 'Hole operations', a: ca.holes, b: cb.holes },
    { label: 'Finishing', a: ca.finishing, b: cb.finishing },
    { label: 'Small-part penalty', a: ca.smallPartPenalty, b: cb.smallPartPenalty },
    { label: 'Design risk buffer', a: ca.designRiskBuffer, b: cb.designRiskBuffer },
    { label: 'QC inspection', a: ca.qcInspection, b: cb.qcInspection },
  ]
    .map((d) => ({ ...d, delta: d.b - d.a }))
    .filter((d) => Math.abs(d.delta) >= 0.005)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const unitDelta = cb.unitCost - ca.unitCost;
  const unitPct = ca.unitCost > 0 ? (unitDelta / ca.unitCost) * 100 : 0;
  const maxAbs = drivers.reduce((m, d) => Math.max(m, Math.abs(d.delta)), 0) || 1;

  // Manufacturer sanity metrics.
  const perKg = (c: PartCost, p: PartInput) =>
    p.finishedWeightKg > 0 ? c.unitCost / p.finishedWeightKg : null;
  const matShare = (c: PartCost) => (c.unitCost > 0 ? (c.material / c.unitCost) * 100 : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-4 w-full max-w-3xl rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <GitCompareArrows size={16} className="text-blue-600" />
            Compare parts
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Selectors */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <select
              value={a.id}
              onChange={(e) => setIdA(e.target.value)}
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ArrowRight size={16} className="text-gray-400" />
            <select
              value={b.id}
              onChange={(e) => setIdB(e.target.value)}
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Headline verdict */}
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              Math.abs(unitDelta) < 0.005
                ? 'bg-emerald-50 text-emerald-900'
                : 'bg-blue-50 text-blue-900'
            }`}
          >
            {Math.abs(unitDelta) < 0.005 ? (
              <span>
                <strong>Identical unit cost ({inr(ca.unitCost)}).</strong> Same inputs price the
                same regardless of file format — the quote is consistent.
              </span>
            ) : (
              <span>
                <strong>“{b.name}”</strong> costs <strong>{inr(Math.abs(unitDelta))}</strong>{' '}
                {unitDelta > 0 ? 'more' : 'less'} per piece than <strong>“{a.name}”</strong> (
                {unitPct > 0 ? '+' : ''}
                {num(unitPct, 1)}%). Biggest driver: <strong>{drivers[0]?.label}</strong>.
              </span>
            )}
          </div>

          {/* Driver attribution */}
          {drivers.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                What drives the gap (per piece)
              </h3>
              <div className="space-y-2">
                {drivers.map((d) => {
                  const reason = reasonFor(d.label, a, b, ca, cb);
                  const w = (Math.abs(d.delta) / maxAbs) * 100;
                  return (
                    <div key={d.label} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700">{d.label}</span>
                        <span
                          className={`tabular-nums font-medium ${
                            d.delta > 0 ? 'text-red-600' : 'text-emerald-600'
                          }`}
                        >
                          {d.delta > 0 ? '+' : '−'}
                          {inr(Math.abs(d.delta))}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-gray-100">
                        <div
                          className={d.delta > 0 ? 'h-full bg-red-400' : 'h-full bg-emerald-400'}
                          style={{ width: `${w}%` }}
                        />
                      </div>
                      {reason && <p className="mt-0.5 text-xs text-gray-400">{reason}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inputs side by side */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Inputs
            </h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {inputRows.map((r) => {
                  const diff = r.a !== r.b;
                  return (
                    <tr key={r.label} className={diff ? 'bg-amber-50/60' : ''}>
                      <td className="py-1.5 pr-2 text-gray-500">{r.label}</td>
                      <td className={`py-1.5 px-2 ${diff ? 'font-medium text-amber-900' : 'text-gray-700'}`}>
                        {r.a}
                      </td>
                      <td className={`py-1.5 pl-2 ${diff ? 'font-medium text-amber-900' : 'text-gray-700'}`}>
                        {r.b}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Manufacturer sanity metrics */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Sanity check
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left font-normal">Metric</th>
                  <th className="text-left font-normal px-2 truncate">{a.name}</th>
                  <th className="text-left font-normal pl-2 truncate">{b.name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <MetricRow
                  label="Unit cost"
                  a={inr(ca.unitCost)}
                  b={inr(cb.unitCost)}
                />
                <MetricRow
                  label="Cost per finished kg"
                  a={perKg(ca, a) !== null ? `${inr(perKg(ca, a)!)}/kg` : '—'}
                  b={perKg(cb, b) !== null ? `${inr(perKg(cb, b)!)}/kg` : '—'}
                />
                <MetricRow
                  label="Raw stock consumed (buy-to-fly)"
                  a={`${num(ca.rawMaterialKg, 3)} kg (${ca.grossUpFactor}×)`}
                  b={`${num(cb.rawMaterialKg, 3)} kg (${cb.grossUpFactor}×)`}
                />
                <MetricRow
                  label="Material as % of unit cost"
                  a={`${num(matShare(ca), 0)}%`}
                  b={`${num(matShare(cb), 0)}%`}
                />
                <MetricRow
                  label={`Line total (× qty)`}
                  a={inr(ca.lineTotal)}
                  b={inr(cb.lineTotal)}
                />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr>
      <td className="py-1.5 pr-2 text-gray-500">{label}</td>
      <td className="py-1.5 px-2 tabular-nums text-gray-700">{a}</td>
      <td className="py-1.5 pl-2 tabular-nums text-gray-700">{b}</td>
    </tr>
  );
}
