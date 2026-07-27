import { AlertCircle, Loader2 } from 'lucide-react';
import { Header } from './components/Header';
import { SummaryCards } from './components/SummaryCards';
import { BillBreakdown } from './components/BillBreakdown';
import { LinesSection } from './components/LinesSection';
import { SimsTable } from './components/SimsTable';
import { Glossary } from './components/Glossary';
import { useVerizonData } from './useVerizonData';

export default function App() {
  const { account, summary, loading, error, lastUpdated, refresh } =
    useVerizonData();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        accountName={account?.bill.accountName}
        accountNumber={account?.bill.accountNumber}
        planName={account?.bill.planName}
        lastUpdated={lastUpdated}
        isRefreshing={loading && !!account}
        onRefresh={refresh}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Initial loading */}
        {loading && !account && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={32} className="animate-spin text-blue-500" />
            <p className="text-sm text-gray-500">Loading your account…</p>
          </div>
        )}

        {/* Hard error */}
        {error && !account && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-red-800 text-sm">
                  Couldn’t load account data
                </p>
                <p className="mt-1 text-sm text-red-700 font-mono break-all">
                  {error}
                </p>
                <button
                  onClick={refresh}
                  className="mt-3 text-sm font-medium text-red-700 underline"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}

        {account && summary && (
          <>
            <SummaryCards summary={summary} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BillBreakdown bill={account.bill} />
              <Glossary />
            </div>

            <LinesSection
              lines={account.lines}
              devicePayments={account.devicePayments}
              sims={account.sims}
              currency={account.bill.currency}
            />

            <SimsTable sims={account.sims} lines={account.lines} />

            <p className="text-center text-xs text-gray-400 pt-2">
              Showing sample data. Replace the values in{' '}
              <code className="text-gray-500">src/mockData.ts</code> with the
              numbers from your latest Verizon bill to see your own account.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
