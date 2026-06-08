/**
 * Enrich.gs — fill in furnishing & amenities by opening the listing page.
 *
 * Why this exists: alert emails (Zillow especially) carry price/beds/baths but
 * NOT furnishing or amenities. When those are blank and we have a link, this
 * "clicks" the link, pulls the page text, and re-runs the same extractors used
 * on email bodies (extractFurnished_ / extractAmenities_ in Parser.gs).
 *
 * Three levels, tried in order, degrading gracefully:
 *   1. Firecrawl (if key set)  — returns clean markdown, handles JS + anti-bot;
 *                                this is what beats Zillow's 403. Free tier
 *                                available. Set with setFirecrawlKey().
 *   2. Direct fetch (free)      — fallback when no key; works for simple
 *                                broker sites / Apartments.com, blocked by Zillow.
 *   3. Give up cleanly          — keep the AMENITIES_UNKNOWN flag + the link
 *                                so you open that one listing by hand.
 */

// Master switch. Set false to skip page fetching entirely (email data only).
const ENRICH_ENABLED = true;

const ENRICH_UA_ = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Does this listing still need a page fetch? (missing furnishing/amenities) */
function needsEnrich_(listing) {
  return ENRICH_ENABLED && !!listing.url &&
    (listing.furnished == null || (listing.amenities || []).length === 0);
}

function enrichFromPage_(listing) {
  if (!needsEnrich_(listing)) return listing;

  const text = fetchListingText_(listing.url);
  if (!text) { listing.enrichStatus = 'blocked'; return listing; }

  const pageAmenities = extractAmenities_(text);
  const pageFurnished = extractFurnished_(text);

  // Merge: keep email-derived values, add page-derived ones.
  const merged = {};
  (listing.amenities || []).concat(pageAmenities).forEach(function (a) { merged[a] = 1; });
  listing.amenities = Object.keys(merged);
  if (listing.furnished == null) listing.furnished = pageFurnished;
  listing.enrichStatus = 'ok';
  return listing;
}

/** Fetch page text — via Firecrawl if a key is configured, else a direct GET. */
function fetchListingText_(url) {
  const fcKey = PropertiesService.getScriptProperties().getProperty('FIRECRAWL_KEY');
  try {
    if (fcKey) {
      const resp = UrlFetchApp.fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + fcKey },
        payload: JSON.stringify({ url: url, formats: ['markdown'], onlyMainContent: true }),
        muteHttpExceptions: true,
      });
      if (resp.getResponseCode() !== 200) {
        Logger.log('Firecrawl ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200));
        return null;
      }
      const json = JSON.parse(resp.getContentText());
      const d = json && json.data ? json.data : {};
      return d.markdown || (d.html ? htmlToText_(d.html) : null);
    }
    // Direct fallback (no key): plain GET with a browser UA.
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': ENRICH_UA_ },
    });
    return resp.getResponseCode() === 200 ? htmlToText_(resp.getContentText()) : null;
  } catch (e) {
    Logger.log('enrich fetch failed for ' + url + ': ' + e);
    return null;
  }
}

/** Crude, dependency-free HTML → visible text (used for the direct-fetch path). */
function htmlToText_(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Configure your Firecrawl API key (run once). Needed for Zillow links. */
function setFirecrawlKey(key) {
  PropertiesService.getScriptProperties().setProperty('FIRECRAWL_KEY', key);
  Logger.log('Firecrawl key saved — Zillow enrichment enabled.');
}

/**
 * One-shot test: run this with a real listing URL after setting your key to
 * confirm enrichment works. Check View → Logs for the result.
 *   enrichTest('https://www.zillow.com/homedetails/2073616612_zpid/')
 */
function enrichTest(url) {
  const text = fetchListingText_(url);
  if (!text) { Logger.log('✗ No text returned — blocked, bad key, or no key set.'); return; }
  Logger.log('✓ Got ' + text.length + ' chars');
  Logger.log('furnished: ' + extractFurnished_(text));
  Logger.log('amenities: ' + (extractAmenities_(text).join(', ') || '(none found)'));
}
