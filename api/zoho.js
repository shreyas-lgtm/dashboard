/**
 * Vercel serverless function — proxies requests to Zoho Procurement API.
 *
 * Handles OAuth token refresh automatically using a module-level cache so that
 * warm Lambda instances reuse the token instead of refreshing on every request.
 *
 * Required environment variables (set in Vercel dashboard):
 *   ZOHO_CLIENT_ID
 *   ZOHO_CLIENT_SECRET
 *   ZOHO_REFRESH_TOKEN
 *   ZOHO_ORGANIZATION_ID       (default: 60068679686)
 *   ZOHO_ACCOUNTS_URL          (default: https://accounts.zoho.com)
 *   ZOHO_API_BASE_URL          (default: https://www.zohoapis.com)
 *
 * Usage:
 *   GET /api/zoho?path=purchaseorders&status=issued&per_page=200
 */

let cachedToken = null;
let tokenExpiry = 0;

async function refreshToken() {
  const accountsUrl =
    process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com';

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });

  const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Token refresh failed (${res.status}): ${JSON.stringify(data)}`
    );
  }

  cachedToken = data.access_token;
  // Zoho tokens expire in 3600 s; refresh 2 min early
  tokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
  return cachedToken;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  return refreshToken();
}

async function zohoFetch(path, queryParams, token) {
  const baseUrl =
    process.env.ZOHO_API_BASE_URL || 'https://www.zohoapis.com';
  const orgId = process.env.ZOHO_ORGANIZATION_ID || '60068679686';

  const params = new URLSearchParams({
    organization_id: orgId,
    per_page: '200',
    ...queryParams,
  });

  const url = `${baseUrl}/procurement/v1/${path}?${params}`;

  return fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { path, ...queryParams } = req.query;

  if (!path) return res.status(400).json({ error: 'path query param is required' });

  // Basic path allow-list to prevent SSRF
  const ALLOWED_PATHS = [
    'purchaserequests',
    'purchaseorders',
    'purchasereceives',
    'bills',
    'contacts',
  ];
  if (!ALLOWED_PATHS.includes(path)) {
    return res.status(400).json({ error: `path '${path}' is not allowed` });
  }

  try {
    let token = await getToken();
    let zohoRes = await zohoFetch(path, queryParams, token);

    // If 401, force a single token refresh and retry
    if (zohoRes.status === 401) {
      cachedToken = null;
      token = await refreshToken();
      zohoRes = await zohoFetch(path, queryParams, token);
    }

    const data = await zohoRes.json();

    // Cache responses briefly in the browser (30 s)
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(zohoRes.status).json(data);
  } catch (err) {
    console.error('[zoho proxy]', err);
    return res.status(500).json({ error: err.message });
  }
}
