/**
 * Enrich.gs — fill in furnishing & amenities by opening the listing page.
 *
 * Why this exists: alert emails (Zillow especially) carry price/beds/baths but
 * NOT furnishing or amenities. When those are blank and we have a link, this
 * "clicks" the link, pulls the page text, and re-runs the same extractors used
 * on email bodies (extractFurnished_ / extractAmenities_ in Parser.gs).
 *
 * Three levels, tried in order, degrading gracefully:
 *   1. Direct fetch (free)        — works for broker sites / Apartments.com.
 *   2. Scraping API (if key set)  — real browser + IP rotation; beats Zillow's
 *                                   403 bot-block. Set with setScraperApiKey().
 *   3. Give up cleanly            — keep the AMENITIES_UNKNOWN flag + the link
 *                                   so you open that one listing by hand.
 */

// Master switch. Set false to skip page fetching entirely (email data only).
const ENRICH_ENABLED = true;

function enrichFromPage_(listing) {
  if (!ENRICH_ENABLED || !listing.url) return listing;
  const needs = listing.furnished == null || (listing.amenities || []).length === 0;
  if (!needs) return listing;

  const html = fetchListingHtml_(listing.url);
  if (!html) { listing.enrichStatus = 'blocked'; return listing; }

  const text = htmlToText_(html);
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

/** Fetch page HTML — via scraping API if a key is configured, else directly. */
function fetchListingHtml_(url) {
  const key = PropertiesService.getScriptProperties().getProperty('SCRAPER_API_KEY');
  try {
    let resp;
    if (key) {
      // ScraperAPI-style passthrough (render=true runs a real browser).
      // Swap the base URL for ScrapingBee/Zenrows if you use those instead.
      const proxied = 'https://api.scraperapi.com/?api_key=' + encodeURIComponent(key) +
        '&render=true&url=' + encodeURIComponent(url);
      resp = UrlFetchApp.fetch(proxied, { muteHttpExceptions: true });
    } else {
      resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      });
    }
    return resp.getResponseCode() === 200 ? resp.getContentText() : null;
  } catch (e) {
    Logger.log('enrich fetch failed for ' + url + ': ' + e);
    return null;
  }
}

/** Crude, dependency-free HTML → visible text. */
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

/** Configure a scraping-API key (run once). Needed for Zillow links. */
function setScraperApiKey(key) {
  PropertiesService.getScriptProperties().setProperty('SCRAPER_API_KEY', key);
  Logger.log('Scraper API key saved — Zillow enrichment enabled.');
}
