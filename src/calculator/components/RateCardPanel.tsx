import { useState } from 'react';
import { ChevronDown, BookOpen } from 'lucide-react';
import {
  MATERIALS,
  GROSS_UP,
  PROCESSING,
  HOLES,
  FINISHES,
  ADJUSTMENTS,
} from '../rateCard';
import { inr, pct } from '../format';

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-1.5 pr-3 text-gray-700">{label}</td>
      <td className="py-1.5 pr-3 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">
        {value}
      </td>
      <td className="py-1.5 text-xs text-gray-400">{note}</td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {title}
      </h3>
      <table className="w-full text-sm">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function RateCardPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <BookOpen size={16} className="text-gray-400" />
          Annexure A — Manufacturing Rate Card (reference only)
        </span>
        <ChevronDown
          size={16}
          className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <Section title="A. Raw material (INR/kg)">
            {Object.values(MATERIALS).map((m) => (
              <Row key={m.id} label={m.label} value={inr(m.ratePerKg)} note={m.notes} />
            ))}
          </Section>

          <Section title="B. Gross-up factors">
            <Row label="Sheet metal (drop + scrap)" value={`${GROSS_UP.sheetMetal}×`} />
            <Row label="Plate (general)" value={`${GROSS_UP.plateGeneral}×`} />
            <Row
              label="Plate (precision-ground both faces)"
              value={`${GROSS_UP.platePrecisionGround}×`}
            />
            <Row label="In-process yield loss" value={pct(GROSS_UP.yieldLossAdditive)} note="additive" />
          </Section>

          <Section title="C. Processing (INR/kg) + multipliers">
            <Row label="Sheet metal — laser + brake + deburr" value={inr(PROCESSING.sheetSteelPerKg)} />
            <Row label="Plate machining (base)" value={inr(PROCESSING.plateMachiningPerKg)} />
            <Row label="Precision grinding mult." value={`${PROCESSING.precisionGrindingMult}×`} />
            <Row label="Flatness premium mult." value={`${PROCESSING.flatnessPremiumMult}×`} />
            <Row label="Aluminium sheet (cut + edge finish)" value={inr(PROCESSING.aluminiumSheetPerKg)} />
          </Section>

          <Section title="D. Hole operations (INR/hole)">
            <Row label="Drilled thru hole" value={inr(HOLES.drilled)} />
            <Row label="Tapped hole (M5–M10)" value={inr(HOLES.tapped)} />
            <Row label="Countersunk (Ø18 × 90°)" value={inr(HOLES.countersunk)} />
          </Section>

          <Section title="E. Finishing (INR/kg)">
            <Row label={FINISHES.powder.label} value={inr(FINISHES.powder.ratePerKg)} />
            <Row label={FINISHES.anodise.label} value={inr(FINISHES.anodise.ratePerKg)} />
          </Section>

          <Section title="F. Adjustments">
            <Row
              label="Small-part penalty (<2kg)"
              value={`${inr(ADJUSTMENTS.smallPartPenaltyPerKg)}/kg`}
            />
            <Row label="Design risk buffer" value={pct(ADJUSTMENTS.designRiskBuffer)} note="on subtotal" />
            <Row label="QC inspection" value={pct(ADJUSTMENTS.qcInspection)} note="on subtotal" />
          </Section>

          <p className="md:col-span-2 text-xs text-gray-400 border-t border-gray-100 pt-3">
            Rate card is for budgetary use only and excludes SPMIL margin (23%) and GST
            (18%). Binding pricing is released per-system once Origin approves drawings.
            Source: SPMIL/ORIGIN/2026-05/003 (Rev 5).
          </p>
        </div>
      )}
    </div>
  );
}
