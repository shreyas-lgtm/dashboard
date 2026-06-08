import { Check, X, ExternalLink, MapPin, BedDouble, Bath, Maximize, AlertTriangle, RotateCcw } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { Listing, ListingStatus, Recommendation } from '../../listings/types';

interface Props {
  listing: Listing;
  onSetStatus: (key: string, status: ListingStatus) => void;
}

const REC_STYLE: Record<Recommendation, { ring: string; chip: string; score: string }> = {
  'Strong match': { ring: 'border-emerald-200', chip: 'bg-emerald-50 text-emerald-700', score: 'text-emerald-600' },
  'Worth a look': { ring: 'border-amber-200', chip: 'bg-amber-50 text-amber-700', score: 'text-amber-600' },
  Skip: { ring: 'border-gray-200', chip: 'bg-gray-100 text-gray-500', score: 'text-gray-400' },
};

function formatPrice(listing: Listing): string {
  if (listing.price == null) return 'Price n/a';
  const n = listing.price.toLocaleString('en-US');
  return listing.dealType === 'rent' ? `$${n}/mo` : `$${n}`;
}

export function ListingCard({ listing, onSetStatus }: Props) {
  const style = REC_STYLE[listing.recommendation];
  const warnFlags = listing.flags.filter((f) => f.severity !== 'info');
  const decided = listing.status !== 'new';

  return (
    <div
      className={`bg-white rounded-xl border ${style.ring} shadow-sm p-5 flex flex-col gap-3 ${
        listing.status === 'rejected' ? 'opacity-50' : ''
      }`}
    >
      {/* Header: score + recommendation + deal type */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold tabular-nums ${style.score}`}>{listing.score}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.chip}`}>
            {listing.recommendation}
          </span>
        </div>
        <span className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">
          {listing.dealType === 'rent' ? 'For rent' : 'For sale'} · {listing.track}
        </span>
      </div>

      {/* Address + price */}
      <div>
        <p className="font-semibold text-gray-900 leading-snug">{listing.address || 'Address n/a'}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{formatPrice(listing)}</p>
      </div>

      {/* Specs */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
        {listing.beds != null && (
          <span className="flex items-center gap-1"><BedDouble size={14} /> {listing.beds} bd</span>
        )}
        {listing.baths != null && (
          <span className="flex items-center gap-1"><Bath size={14} /> {listing.baths} ba</span>
        )}
        {listing.sqft != null && (
          <span className="flex items-center gap-1"><Maximize size={14} /> {listing.sqft.toLocaleString()} sqft</span>
        )}
        {listing.pricePerSqft != null && (
          <span className="text-gray-400">${listing.pricePerSqft}/sqft</span>
        )}
      </div>

      {/* Furnishing + amenities */}
      {(listing.furnished != null || listing.amenities.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {listing.furnished === true && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              Furnished
            </span>
          )}
          {listing.furnished === false && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              Unfurnished
            </span>
          )}
          {listing.amenities.map((a) => (
            <span key={a} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 capitalize">
              {a}
            </span>
          ))}
        </div>
      )}

      {/* Source / broker / freshness */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <MapPin size={12} />
        <span>{listing.source}</span>
        {listing.broker && <span>· {listing.broker}</span>}
        {listing.receivedAt && (
          <span>· {formatDistanceToNow(parseISO(listing.receivedAt), { addSuffix: true })}</span>
        )}
      </div>

      {/* Scrutiny flags */}
      {warnFlags.length > 0 && (
        <div className="flex flex-col gap-1">
          {warnFlags.map((f) => (
            <div
              key={f.code}
              className={`flex items-start gap-1.5 text-xs ${
                f.severity === 'hard' ? 'text-red-600' : 'text-amber-700'
              }`}
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{f.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 mt-auto">
        {!decided ? (
          <>
            <button
              onClick={() => onSetStatus(listing.key, 'approved')}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg py-2 transition-colors"
            >
              <Check size={15} /> Shortlist
            </button>
            <button
              onClick={() => onSetStatus(listing.key, 'rejected')}
              className="flex items-center justify-center gap-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg py-2 px-3 transition-colors"
            >
              <X size={15} /> Pass
            </button>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-between">
            <span
              className={`text-sm font-medium ${
                listing.status === 'approved' ? 'text-emerald-600' : 'text-gray-400'
              }`}
            >
              {listing.status === 'approved' ? '✓ Shortlisted' : '✕ Passed'}
            </span>
            <button
              onClick={() => onSetStatus(listing.key, 'new')}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <RotateCcw size={12} /> Undo
            </button>
          </div>
        )}
        {listing.url && (
          <a
            href={listing.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center text-gray-400 hover:text-blue-600 rounded-lg py-2 px-2.5 border border-gray-200 transition-colors"
            title="View original listing"
          >
            <ExternalLink size={15} />
          </a>
        )}
      </div>
    </div>
  );
}
