import { useMemo, useState } from 'react';
import { Home, Filter } from 'lucide-react';
import { useListings } from '../../listings/useListings';
import { ListingCard } from './ListingCard';

type Tab = 'new' | 'approved' | 'rejected' | 'all';

const TABS: { id: Tab; label: string }[] = [
  { id: 'new', label: 'To review' },
  { id: 'approved', label: 'Shortlisted' },
  { id: 'rejected', label: 'Passed' },
  { id: 'all', label: 'All' },
];

export function ListingsView() {
  const { listings, updatedAt, setStatus } = useListings();
  const [tab, setTab] = useState<Tab>('new');
  const [hideSkips, setHideSkips] = useState(false);

  const counts = useMemo(() => {
    const c = { new: 0, approved: 0, rejected: 0, all: listings.length } as Record<Tab, number>;
    for (const l of listings) c[l.status as Exclude<Tab, 'all'>]++;
    return c;
  }, [listings]);

  const visible = useMemo(() => {
    let rows = tab === 'all' ? listings : listings.filter((l) => l.status === tab);
    if (hideSkips) rows = rows.filter((l) => l.recommendation !== 'Skip');
    return rows; // already score-sorted by the agent
  }, [listings, tab, hideSkips]);

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Home size={18} className="text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">Sourced Listings</h2>
          <span className="text-sm text-gray-400">
            {listings.length} ranked by the agent
          </span>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer select-none">
          <Filter size={14} />
          <input
            type="checkbox"
            checked={hideSkips}
            onChange={(e) => setHideSkips(e.target.checked)}
            className="accent-blue-600"
          />
          Hide “Skip” listings
        </label>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-gray-400">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <p className="text-sm text-gray-400 py-16 text-center">
          Nothing here yet. New listings land in “To review” after the agent runs.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((l) => (
            <ListingCard key={l.key} listing={l} onSetStatus={setStatus} />
          ))}
        </div>
      )}

      {updatedAt && (
        <p className="text-xs text-gray-400 text-right">
          Agent last ran {new Date(updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
