import { CheckCircle } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { PurchaseRequest } from '../types';

interface Props {
  prs: PurchaseRequest[];
}

export function StuckPRsTable({ prs }: Props) {
  if (prs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Approved PRs Without a PO
        </h2>
        <p className="text-sm text-gray-400 py-4 text-center">
          All approved PRs have linked purchase orders
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle size={16} className="text-amber-500" />
        <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide">
          Approved PRs, No PO Yet ({prs.length})
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="pb-2 font-medium">PR #</th>
              <th className="pb-2 font-medium">Vendor</th>
              <th className="pb-2 font-medium text-right">Value</th>
              <th className="pb-2 font-medium text-right">Approved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {prs.map((pr) => {
              const age = formatDistanceToNow(parseISO(pr.date), {
                addSuffix: true,
              });

              const total = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: pr.currency_code || 'USD',
                maximumFractionDigits: 0,
              }).format(pr.total);

              return (
                <tr key={pr.purchase_request_id} className="hover:bg-amber-50 transition-colors">
                  <td className="py-2 font-medium text-gray-900">
                    {pr.purchase_request_number}
                  </td>
                  <td className="py-2 text-gray-600">{pr.vendor_name ?? '—'}</td>
                  <td className="py-2 text-right text-gray-900 tabular-nums">
                    {total}
                  </td>
                  <td className="py-2 text-right text-gray-500">{age}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
