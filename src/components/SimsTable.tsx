import { Cpu } from 'lucide-react';
import type { Sim, Line } from '../types';

interface Props {
  sims: Sim[];
  lines: Line[];
}

const STATUS_STYLES: Record<Sim['status'], string> = {
  active: 'bg-green-50 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  suspended: 'bg-amber-50 text-amber-700',
};

export function SimsTable({ sims, lines }: Props) {
  const lineFor = (lineId: string) => lines.find((l) => l.lineId === lineId);

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <Cpu size={16} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          SIMs & eSIMs
        </h2>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        The chips (physical or digital) that connect each device to the network.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium">ICCID</th>
              <th className="pb-2 font-medium">Line</th>
              <th className="pb-2 font-medium">Device</th>
              <th className="pb-2 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sims.map((sim) => {
              const line = lineFor(sim.lineId);
              return (
                <tr key={sim.simId} className="hover:bg-gray-50 transition-colors">
                  <td className="py-2.5">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        sim.type === 'eSIM'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {sim.type}
                    </span>
                  </td>
                  <td className="py-2.5 text-gray-500 tabular-nums">
                    •••• {sim.iccidLast4}
                  </td>
                  <td className="py-2.5 text-gray-900 tabular-nums">
                    {line?.phoneNumber ?? '—'}
                  </td>
                  <td className="py-2.5 text-gray-600">{line?.device ?? '—'}</td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${
                        STATUS_STYLES[sim.status]
                      }`}
                    >
                      {sim.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
