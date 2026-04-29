import { Header } from './components/Header';
import { PipelineFunnel } from './components/PipelineFunnel';
import { VendorChart } from './components/VendorChart';
import { SpendWidget } from './components/SpendWidget';
import { OverduePOsTable } from './components/OverduePOsTable';
import { StuckPRsTable } from './components/StuckPRsTable';
import { useProcurementData } from './useProcurementData';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function App() {
  const { data, loading, error, lastUpdated, refresh } = useProcurementData();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        lastUpdated={lastUpdated}
        isRefreshing={loading && !!data}
        onRefresh={refresh}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Initial loading state */}
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={32} className="animate-spin text-blue-500" />
            <p className="text-sm text-gray-500">
              Fetching live data from Zoho Procurement…
            </p>
          </div>
        )}

        {/* Error state */}
        {error && !data && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-red-800 text-sm">
                  Failed to load procurement data
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

        {/* Stale-data error banner (data loaded but subsequent refresh failed) */}
        {error && data && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm text-amber-800">
            <AlertCircle size={14} className="shrink-0" />
            Last refresh failed — showing stale data. ({error})
          </div>
        )}

        {data && (
          <>
            {/* Pipeline funnel — 6 KPI cards */}
            <PipelineFunnel kpis={data.kpis} />

            {/* Spend + Vendor chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <SpendWidget spend={data.spend} />
              <div className="lg:col-span-2">
                <VendorChart
                  data={data.topVendors}
                  currency={data.spend.currency}
                />
              </div>
            </div>

            {/* Detail tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <OverduePOsTable pos={data.overduePOList} />
              <StuckPRsTable prs={data.stuckPRList} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
