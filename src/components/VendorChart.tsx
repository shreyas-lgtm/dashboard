import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { VendorSpend } from '../types';

interface Props {
  data: VendorSpend[];
  currency: string;
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function VendorChart({ data, currency }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        No vendor data available
      </div>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Top Vendors by PO Value
      </h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
          <XAxis
            type="number"
            tickFormatter={(v) => formatCurrency(v, currency)}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="vendor_name"
            width={110}
            tick={{ fontSize: 12, fill: '#374151' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number) => [
              formatCurrency(value, currency),
              'PO Total',
            ]}
            contentStyle={{
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              fontSize: 12,
            }}
          />
          <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
