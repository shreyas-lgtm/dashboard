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

// ScraperAPI options. Zillow's page is JS-rendered AND bot-protected, so it
// needs both of these on. They cost more ScraperAPI credits per request — turn
// them off (false) for cheaper fetches of simpler broker sites.
const SCRAPER_RENDER = true;   // execute JavaScript on the page
const SCRAPER_PREMIUM = true;  // premium/residential proxies (usually required for Zillow)

/** Does this listing still need a page fetch? (missing furnishing/amenities) */
function needsEnrich_(listing) {
  return ENRICH_ENABLED && !!listing.url &&
    (listing.furnished == null || (listing.amenities || []).length === 0);
}

function enrichFromPage_(listing) {
  if (!needsEnrich_(listing)) return listing;

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

/** Fetch page HTML — via ScraperAPI if a key is configured, else directly. */
function fetchListingHtml_(url) {
  const key = PropertiesService.getScriptProperties().getProperty('SCRAPER_API_KEY');
  try {
    const target = key ? buildScraperUrl_(key, url) : url;
    const resp = UrlFetchApp.fetch(target, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: key ? {} : { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
    });
    const code = resp.getResponseCode();
    if (code !== 200) {
      Logger.log('enrich fetch ' + code + ' for ' + url + (key ? ' (via ScraperAPI)' : ''));
      return null;
    }
    return resp.getContentText();
  } catch (e) {
    Logger.log('enrich fetch failed for ' + url + ': ' + e);
    return null;
  }
}

/** Build the ScraperAPI request URL with the configured options. */
function buildScraperUrl_(key, url) {
  let u = 'https://api.scraperapi.com/?api_key=' + encodeURIComponent(key) +
    '&url=' + encodeURIComponent(url);
  if (SCRAPER_RENDER) u += '&render=true';
  if (SCRAPER_PREMIUM) u += '&premium=true';
  return u;
}

/**
 * One-shot test: run this with a real listing URL after setting your key to
 * confirm enrichment works. Check View → Logs for the result.
 *   enrichTest('https://www.zillow.com/homedetails/2073616612_zpid/')
 */
function enrichTest(url) {
  const html = fetchListingHtml_(url);
  if (!html) { Logger.log('✗ No HTML returned — blocked, bad key, or no key set.'); return; }
  const text = htmlToText_(html);
  Logger.log('✓ Got ' + text.length + ' chars');
  Logger.log('furnished: ' + extractFurnished_(text));
  Logger.log('amenities: ' + (extractAmenities_(text).join(', ') || '(none found)'));
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
