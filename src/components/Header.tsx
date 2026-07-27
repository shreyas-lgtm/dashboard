import { RefreshCw, Smartphone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface HeaderProps {
  accountName?: string;
  accountNumber?: string;
  planName?: string;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function Header({
  accountName,
  accountNumber,
  planName,
  lastUpdated,
  isRefreshing,
  onRefresh,
}: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="p-2 rounded-lg bg-red-50 text-red-600">
            <Smartphone size={20} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              My Verizon — Account Overview
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {accountName ? (
                <>
                  {accountName} · Account {accountNumber} ·{' '}
                  <span className="font-medium text-gray-600">{planName}</span>
                </>
              ) : (
                'Everything on one screen'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {lastUpdated && (
            <span className="hidden sm:inline text-xs text-gray-400">
              Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
    </header>
  );
}
