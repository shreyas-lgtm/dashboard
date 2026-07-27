import { CalendarClock, Layers, Smartphone, Database } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { AccountSummary } from '../types';
import { money } from '../format';

interface Props {
  summary: AccountSummary;
}

export function SummaryCards({ summary }: Props) {
  const due = parseISO(summary.dueDate);
  const wentUp = summary.vsLastMonth > 0;
  const changeLabel =
    summary.vsLastMonth === 0
      ? 'Same as last month'
      : `${wentUp ? '↑' : '↓'} ${money(Math.abs(summary.vsLastMonth), summary.currency)} vs last month`;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total due — the number everyone actually wants */}
      <div className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Total due
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-red-700">
              {money(summary.totalDue, summary.currency)}
            </p>
            <p
              className={`mt-1 text-xs font-medium ${
                wentUp ? 'text-amber-600' : 'text-green-600'
              }`}
            >
              {changeLabel}
            </p>
          </div>
          <span className="p-2 rounded-lg bg-red-50 text-red-600">
            <CalendarClock size={18} />
          </span>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Due {format(due, 'EEE, MMM d, yyyy')}
        </p>
      </div>

      {/* Recurring plan cost */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Plan / month
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
              {money(summary.monthlyPlanTotal, summary.currency)}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {summary.lineCount} lines · recurring service
            </p>
          </div>
          <span className="p-2 rounded-lg bg-blue-50 text-blue-600">
            <Layers size={18} />
          </span>
        </div>
      </div>

      {/* Device payments */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Devices / month
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-violet-700">
              {money(summary.devicePaymentMonthly, summary.currency)}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {money(summary.deviceDebtRemaining, summary.currency, false)} left
              to pay off
            </p>
          </div>
          <span className="p-2 rounded-lg bg-violet-50 text-violet-600">
            <Smartphone size={18} />
          </span>
        </div>
      </div>

      {/* Data usage */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Data this cycle
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
              {summary.totalDataUsedGb.toFixed(1)}
              <span className="text-lg font-semibold text-gray-400"> GB</span>
            </p>
            <p className="mt-1 text-xs text-gray-400">Across all lines</p>
          </div>
          <span className="p-2 rounded-lg bg-cyan-50 text-cyan-600">
            <Database size={18} />
          </span>
        </div>
      </div>
    </section>
  );
}
