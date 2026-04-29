import type { ReactNode } from 'react';

type Severity = 'neutral' | 'warning' | 'danger' | 'info';

interface KPICardProps {
  label: string;
  value: number;
  sublabel?: string;
  severity?: Severity;
  icon: ReactNode;
}

const SEVERITY_STYLES: Record<Severity, { card: string; badge: string; value: string }> = {
  neutral: {
    card: 'bg-white border-gray-200',
    badge: 'bg-gray-100 text-gray-600',
    value: 'text-gray-900',
  },
  info: {
    card: 'bg-white border-blue-200',
    badge: 'bg-blue-50 text-blue-600',
    value: 'text-blue-700',
  },
  warning: {
    card: 'bg-white border-amber-200',
    badge: 'bg-amber-50 text-amber-700',
    value: 'text-amber-700',
  },
  danger: {
    card: 'bg-white border-red-200',
    badge: 'bg-red-50 text-red-600',
    value: 'text-red-700',
  },
};

export function KPICard({ label, value, sublabel, severity = 'neutral', icon }: KPICardProps) {
  const styles = SEVERITY_STYLES[severity];

  return (
    <div className={`rounded-xl border p-5 shadow-sm ${styles.card}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {label}
          </p>
          <p className={`mt-2 text-3xl font-bold tabular-nums ${styles.value}`}>
            {value.toLocaleString()}
          </p>
          {sublabel && (
            <p className="mt-1 text-xs text-gray-400">{sublabel}</p>
          )}
        </div>
        <span className={`p-2 rounded-lg ${styles.badge}`}>{icon}</span>
      </div>
    </div>
  );
}
