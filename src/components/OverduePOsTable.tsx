import { AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { PurchaseOrder } from '../types';

interface Props {
  pos: PurchaseOrder[];
}

export function OverduePOsTable({ pos }: Props) {
  if (pos.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Overdue POs
        </h2>
        <p className="text-sm text-gray-400 py-4 text-center">
          No overdue purchase orders
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-red-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle size={16} className="text-red-500" />
        <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide">
          Overdue POs ({pos.length})
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="pb-2 font-medium">PO #</th>
              <th className="pb-2 font-medium">Vendor</th>
              <th className="pb-2 font-medium text-right">Total</th>
              <th className="pb-2 font-medium text-right">Overdue By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pos.map((po) => {
              const overdueSince = po.delivery_date
                ? formatDistanceToNow(parseISO(po.delivery_date), {
                    addSuffix: false,
                  })
                : '—';

              const total = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: po.currency_code || 'USD',
                maximumFractionDigits: 0,
              }).format(po.total);

              return (
                <tr key={po.purchaseorder_id} className="hover:bg-red-50 transition-colors">
                  <td className="py-2 font-medium text-gray-900">
                    {po.purchaseorder_number}
                  </td>
                  <td className="py-2 text-gray-600">{po.vendor_name}</td>
                  <td className="py-2 text-right text-gray-900 tabular-nums">
                    {total}
                  </td>
                  <td className="py-2 text-right text-red-600 font-medium">
                    {overdueSince}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
