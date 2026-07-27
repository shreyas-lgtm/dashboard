import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import type { Bill } from '../types';
import { CHARGE_COLORS } from '../config';
import { money } from '../format';

interface Props {
  bill: Bill;
}

/**
 * Breaks the single scary "total due" number into its real components, with a
 * stacked bar and an expandable explanation for each bucket. This is the view
 * the My Verizon site buries under three taps.
 */
export function BillBreakdown({ bill }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const total = bill.charges.reduce((s, c) => s + c.amount, 0);

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Where your bill goes
        </h2>
        <span className="text-sm text-gray-500 tabular-nums">
          {money(total, bill.currency)}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Tap any row to see what it actually means.
      </p>

      {/* Stacked proportion bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full mb-5">
        {bill.charges.map((c) => (
          <div
            key={c.key}
            style={{
              width: `${(c.amount / total) * 100}%`,
              backgroundColor: CHARGE_COLORS[c.key] ?? '#94a3b8',
            }}
            title={`${c.label}: ${money(c.amount, bill.currency)}`}
          />
        ))}
      </div>

      <ul className="space-y-1">
        {bill.charges.map((c) => {
          const isOpen = open === c.key;
          const pct = Math.round((c.amount / total) * 100);
          return (
            <li
              key={c.key}
              className="rounded-lg border border-transparent hover:border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <button
                onClick={() => setOpen(isOpen ? null : c.key)}
                className="w-full flex items-center gap-3 px-2 py-2.5 text-left"
              >
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: CHARGE_COLORS[c.key] ?? '#94a3b8' }}
                />
                <span className="flex-1 text-sm font-medium text-gray-800">
                  {c.label}
                </span>
                <span className="text-xs text-gray-400 tabular-nums w-10 text-right">
                  {pct}%
                </span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums w-20 text-right">
                  {money(c.amount, bill.currency)}
                </span>
                <ChevronDown
                  size={15}
                  className={`text-gray-400 transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <div className="flex gap-2 px-4 pb-3 pl-9">
                  <Info size={14} className="text-gray-400 mt-0.5 shrink-0" />
                  <p className="text-xs leading-relaxed text-gray-600">
                    {c.description}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {bill.previousBalance > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Includes {money(bill.previousBalance, bill.currency)} carried over from
          your previous bill.
        </p>
      )}
      {!bill.autopayEnabled && (
        <p className="mt-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
          Auto Pay is off — turning on Auto Pay + paperless billing usually saves
          about $10 per line.
        </p>
      )}
    </section>
  );
}
