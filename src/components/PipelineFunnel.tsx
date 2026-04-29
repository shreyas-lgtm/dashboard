import {
  ClipboardList,
  CheckCircle,
  ShoppingCart,
  Clock,
  Receipt,
  AlertTriangle,
} from 'lucide-react';
import { KPICard } from './KPICard';
import type { PipelineKPIs } from '../types';

interface Props {
  kpis: PipelineKPIs;
}

export function PipelineFunnel({ kpis }: Props) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
        Pipeline Funnel
      </h2>

      {/* Flow indicator */}
      <div className="flex items-center gap-1 text-xs text-gray-400 mb-4 overflow-x-auto pb-1">
        {[
          'PR Created',
          '→',
          'PR Approved',
          '→',
          'PO Raised',
          '→',
          'PO Approved',
          '→',
          'Delivered',
          '→',
          'Billed',
        ].map((s, i) => (
          <span
            key={i}
            className={
              s === '→' ? 'text-gray-300' : 'font-medium whitespace-nowrap'
            }
          >
            {s}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard
          label="PRs Awaiting Approval"
          value={kpis.prsAwaitingApproval}
          sublabel="Need manager sign-off"
          severity={kpis.prsAwaitingApproval > 0 ? 'warning' : 'neutral'}
          icon={<ClipboardList size={18} />}
        />
        <KPICard
          label="Approved PRs (No PO)"
          value={kpis.approvedPrsNoPO}
          sublabel="Convert to PO"
          severity={kpis.approvedPrsNoPO > 0 ? 'warning' : 'neutral'}
          icon={<CheckCircle size={18} />}
        />
        <KPICard
          label="POs Pending Approval"
          value={kpis.posPendingApproval}
          sublabel="Need approval before issue"
          severity={kpis.posPendingApproval > 0 ? 'warning' : 'neutral'}
          icon={<Clock size={18} />}
        />
        <KPICard
          label="Open POs"
          value={kpis.openPOs}
          sublabel="Issued, awaiting delivery"
          severity="info"
          icon={<ShoppingCart size={18} />}
        />
        <KPICard
          label="Received, Pending Bill"
          value={kpis.receivedPendingBill}
          sublabel="Goods in, bill outstanding"
          severity={kpis.receivedPendingBill > 0 ? 'warning' : 'neutral'}
          icon={<Receipt size={18} />}
        />
        <KPICard
          label="Overdue POs"
          value={kpis.overduePOs}
          sublabel="Past expected delivery"
          severity={kpis.overduePOs > 0 ? 'danger' : 'neutral'}
          icon={<AlertTriangle size={18} />}
        />
      </div>
    </section>
  );
}
