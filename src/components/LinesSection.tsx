import { Smartphone, Wifi, CreditCard, Infinity as InfinityIcon } from 'lucide-react';
import type { Line, DevicePayment, Sim } from '../types';
import { money } from '../format';

interface Props {
  lines: Line[];
  devicePayments: DevicePayment[];
  sims: Sim[];
  currency: string;
}

export function LinesSection({ lines, devicePayments, sims, currency }: Props) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
        Your lines
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        One card per phone number. Each shows its plan charge, the device on it,
        how far along the device payoff is, and which SIM it uses.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lines.map((line) => {
          const dp = devicePayments.find(
            (d) => d.agreementId === line.devicePaymentId,
          );
          const sim = sims.find((s) => s.simId === line.simId);
          const paidOff = !dp;
          const pctPaid = dp
            ? Math.round((dp.monthsPaid / dp.termMonths) * 100)
            : 100;

          return (
            <div
              key={line.lineId}
              className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 flex flex-col gap-4"
            >
              {/* Header: nickname + number */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{line.nickname}</p>
                  <p className="text-sm text-gray-500 tabular-nums">
                    {line.phoneNumber}
                  </p>
                </div>
                <span className="p-2 rounded-lg bg-gray-100 text-gray-500">
                  <Smartphone size={16} />
                </span>
              </div>

              {/* Device + plan charge */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{line.device}</span>
                <span className="font-medium text-gray-900 tabular-nums">
                  {money(line.monthlyLineAccess, currency)}
                  <span className="text-xs text-gray-400 font-normal">/mo</span>
                </span>
              </div>

              {/* Data usage */}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Wifi size={14} className="text-cyan-500 shrink-0" />
                {line.dataAllowanceGb === 'unlimited' ? (
                  <span className="flex items-center gap-1">
                    {line.dataUsedGb.toFixed(1)} GB used ·
                    <InfinityIcon size={13} className="text-gray-400" />
                    <span className="text-gray-400">unlimited</span>
                  </span>
                ) : (
                  <span>
                    {line.dataUsedGb.toFixed(1)} / {line.dataAllowanceGb} GB
                  </span>
                )}
              </div>

              {/* Device payoff progress */}
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard size={14} className="text-violet-500 shrink-0" />
                  <span className="text-xs font-medium text-gray-600">
                    Device payoff
                  </span>
                </div>
                {paidOff ? (
                  <p className="text-xs text-green-600 font-medium">
                    ✓ Paid off — no device charge on this line
                  </p>
                ) : (
                  <>
                    <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-500"
                        style={{ width: `${pctPaid}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>
                        {dp!.monthsPaid} of {dp!.termMonths} months
                      </span>
                      <span className="tabular-nums">
                        {money(dp!.remainingBalance, currency, false)} left
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400 tabular-nums">
                      {money(dp!.monthlyAmount, currency)}/mo
                      {dp!.promoCredit ? (
                        <>
                          {' − '}
                          {money(dp!.promoCredit, currency)} promo credit ={' '}
                          <span className="text-green-600 font-medium">
                            {money(dp!.monthlyAmount - dp!.promoCredit, currency)}
                            /mo net
                          </span>
                        </>
                      ) : null}
                    </p>
                  </>
                )}
              </div>

              {/* SIM */}
              {sim && (
                <div className="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-gray-100">
                  <span>
                    {sim.type} · ICCID •••• {sim.iccidLast4}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      sim.status === 'active'
                        ? 'text-green-600'
                        : 'text-gray-400'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        sim.status === 'active' ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    />
                    {sim.status}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
