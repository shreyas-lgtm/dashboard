/**
 * Vercel serverless function — resolves a pasted product link to its title.
 *
 * The Laptop Alternative Suggester parses laptop details client-side straight
 * from the URL slug. That works for full product URLs but not for shortened or
 * opaque links (a.co/d/xxxx, amzn.to/xxxx, bestbuy short links), which carry no
 * product info. This endpoint follows the link server-side (no CORS, can follow
 * redirects) and returns the resolved <title> so the client can re-parse it.
 *
 * Usage:
 *   GET /api/laptop?url=https://a.co/d/abcd123
 *   → { resolvedUrl, title }
 *
 * Note: some retailers bot-block server requests; on failure the client falls
 * back to manual entry.
 */

// Only follow links to known shopping hosts — prevents the endpoint being used
// as a generic SSRF fetch-anything proxy.
const ALLOWED_HOST_RE =
  /(^|\.)(amazon\.[a-z.]+|a\.co|amzn\.to|amzn\.eu|bestbuy\.com|newegg\.com|apple\.com|dell\.com|lenovo\.com|asus\.com|hp\.com|razer\.com|microsoft\.com|acer\.com|lg\.com|frame\.work|bhphotovideo\.com|walmart\.com|costco\.com)$/i;

function isAllowed(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return ALLOWED_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

function extractTitle(html) {
  // Prefer Open Graph / Amazon product title, fall back to <title>.
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();

  const amazon = html.match(/id=["']productTitle["'][^>]*>([^<]+)</i);
  if (amazon) return decodeEntities(amazon[1]).trim();

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) return decodeEntities(title[1]).trim();

  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param is required' });

  if (!isAllowed(url)) {
    return res.status(400).json({ error: 'URL host is not an allowed retailer' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // A realistic UA improves the odds of getting real HTML rather than a block page.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const resolvedUrl = resp.url || url;
    // The resolved URL alone is often enough (short link → full slug URL).
    const html = await resp.text();
    const title = extractTitle(html);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ resolvedUrl, title });
  } catch (err) {
    console.error('[laptop resolver]', err);
    const aborted = err && err.name === 'AbortError';
    return res
      .status(aborted ? 504 : 502)
      .json({ error: aborted ? 'Timed out fetching link' : 'Could not fetch link' });
  } finally {
    clearTimeout(timeout);
  }
}
