/**
 * Enrich.gs — fill in building specs by opening the listing page.
 *
 * Why this exists: commercial alert emails (LoopNet / Crexi) carry size and a
 * rate but usually NOT clear height, loading, zoning or power. When those are
 * blank and we have a link, this "clicks" the link, pulls the page text, and
 * re-runs the same extractors used on email bodies (in Parser.gs).
 *
 * Three levels, tried in order, degrading gracefully:
 *   1. Firecrawl (if key set)  — clean markdown, handles JS + anti-bot; this is
 *                                what reads LoopNet/Crexi reliably (they 403 a
 *                                plain GET). Free tier available. setFirecrawlKey().
 *   2. Direct fetch (free)      — fallback with a browser UA; works on simple
 *                                broker sites, blocked by the big portals.
 *   3. Give up cleanly          — keep the "specs unknown" flags + the link so
 *                                you open that one listing by hand.
 */

// Master switch. Set false to skip page fetching entirely (email data only).
const ENRICH_ENABLED = true;

const ENRICH_UA_ = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Does this listing still need a page fetch? (missing key building specs) */
function needsEnrich_(listing) {
  return ENRICH_ENABLED && !!listing.url &&
    (listing.clearHeight == null ||
     listing.zoning == null ||
     (listing.docks == null && listing.driveIn == null) ||
     (listing.features || []).length === 0);
}

function enrichFromPage_(listing) {
  if (!needsEnrich_(listing)) return listing;

  const text = fetchListingText_(listing.url);
  if (!text) { listing.enrichStatus = 'blocked'; return listing; }

  // Fill anything still missing from the page; never overwrite email-derived
  // values (the email is usually the cleaner source).
  if (listing.clearHeight == null) listing.clearHeight = extractClearHeight_(text);
  if (listing.zoning == null) listing.zoning = extractZoning_(text);
  if (listing.docks == null) listing.docks = extractDocks_(text);
  if (listing.driveIn == null) listing.driveIn = extractDriveIn_(text);
  if (listing.power == null) listing.power = extractPower_(text);
  if (listing.sqft == null) listing.sqft = extractSqft_(text);
  if (listing.ratePsfYr == null) listing.ratePsfYr = extractRatePsfYr_(text);

  // Merge features (email-derived + page-derived).
  const merged = {};
  (listing.features || []).concat(extractFeatures_(text, listing.clearHeight)).forEach(function (f) { merged[f] = 1; });
  listing.features = Object.keys(merged);
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

/** Configure your Firecrawl API key (run once). Needed for LoopNet/Crexi. */
function setFirecrawlKey(key) {
  PropertiesService.getScriptProperties().setProperty('FIRECRAWL_KEY', key);
  Logger.log('Firecrawl key saved — LoopNet/Crexi enrichment enabled.');
}

/**
 * One-shot test: run this with a real listing URL after setting your key to
 * confirm enrichment works. Check View → Logs for the result.
 */
function enrichTest(url) {
  const text = fetchListingText_(url);
  if (!text) { Logger.log('✗ No text returned — blocked, bad key, or no key set.'); return; }
  Logger.log('✓ Got ' + text.length + ' chars');
  Logger.log('clear height: ' + extractClearHeight_(text));
  Logger.log('zoning: ' + extractZoning_(text));
  Logger.log('docks: ' + extractDocks_(text) + ', drive-in: ' + extractDriveIn_(text));
  Logger.log('features: ' + (extractFeatures_(text, extractClearHeight_(text)).join(', ') || '(none found)'));
}
