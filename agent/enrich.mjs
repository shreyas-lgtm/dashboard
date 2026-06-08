// ---------------------------------------------------------------------------
// enrich.mjs — fill in furnishing & amenities by opening the listing page.
//
// Alert emails (Zillow, Apartments.com) only carry price/beds/baths/sqft, so
// furnishing and amenities arrive blank. This step fetches the listing URL,
// strips the HTML to text, and re-runs the same furnishing/amenity extractors
// used on email bodies — then merges anything new into the listing.
//
// Best-effort by design: it never throws. Many portals (Zillow especially)
// bot-block server-side fetches; when that happens the listing keeps its
// "unknown" state and records why under `enrichment`. For blocked sources,
// the fallbacks are a scraping API or Claude's WebFetch (see agent/README.md).
// ---------------------------------------------------------------------------

import { extractFurnished, extractAmenities } from './parse.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Crude but dependency-free HTML → visible text. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    return { ok: true, text: htmlToText(html) };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a NEW listing with furnishing/amenities filled from the page when
 * the email didn't have them. Adds `enrichment: { attempted, ok, error? }`.
 */
export async function enrichListing(listing) {
  const needs = listing.furnished == null || (listing.amenities || []).length === 0;
  if (!listing.url || !needs) {
    return { ...listing, enrichment: { attempted: false } };
  }

  const { ok, text, error } = await fetchText(listing.url);
  if (!ok) return { ...listing, enrichment: { attempted: true, ok: false, error } };

  const pageFurnished = extractFurnished(text);
  const pageAmenities = extractAmenities(text);

  // Merge: keep email-derived values, add page-derived ones.
  const amenities = [...new Set([...(listing.amenities || []), ...pageAmenities])];
  const furnished = listing.furnished != null ? listing.furnished : pageFurnished;

  return { ...listing, furnished, amenities, enrichment: { attempted: true, ok: true } };
}

/** Enrich a batch with limited concurrency so we don't hammer a host. */
export async function enrichAll(listings, concurrency = 4) {
  const out = new Array(listings.length);
  let i = 0;
  async function worker() {
    while (i < listings.length) {
      const idx = i++;
      out[idx] = await enrichListing(listings[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, listings.length) }, worker));
  return out;
}
