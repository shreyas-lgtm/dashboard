import { TrendingUp } from 'lucide-react';
import type { SpendStats } from '../types';
import { format } from 'date-fns';

interface Props {
  spend: SpendStats;
}

export function SpendWidget({ spend }: Props) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: spend.currency || 'USD',
    maximumFractionDigits: 0,
  }).format(spend.totalThisMonth);

  const monthName = format(new Date(), 'MMMM yyyy');

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Total PO Spend
          </p>
          <p className="mt-1 text-xs text-gray-400">{monthName}</p>
          <p className="mt-3 text-3xl font-bold text-gray-900 tabular-nums">
            {formatted}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Across all issued purchase orders
          </p>
        </div>
        <span className="p-2 rounded-lg bg-green-50 text-green-600">
          <TrendingUp size={18} />
        </span>
      </div>
    </div>
  );
}
