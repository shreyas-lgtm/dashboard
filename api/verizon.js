/**
 * Serverless endpoint for the Verizon account dashboard.
 *
 * WHY THIS IS A STUB
 * ------------------
 * Verizon does not publish a public consumer API, and there is no supported,
 * safe way to log into someone's My Verizon account programmatically. So this
 * endpoint does NOT scrape Verizon. Instead it returns whatever account data
 * you choose to store — the dashboard only cares about the shape of the JSON
 * (see src/types.ts → VerizonAccount).
 *
 * Recommended ways to feed it real data (pick one):
 *   1. Keep using mock mode: edit src/mockData.ts with your bill's numbers.
 *      No server needed. (This is the default; VITE_USE_MOCK is on.)
 *   2. Paste your account JSON into the ACCOUNT_JSON environment variable in
 *      Vercel, and this endpoint will serve it.
 *   3. Replace the body below to read from a Google Sheet, a private gist,
 *      a database, or a file you export from your bill.
 *
 * The JSON must match the VerizonAccount interface in src/types.ts.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Option 2: serve account data from an environment variable.
  const raw = process.env.ACCOUNT_JSON;
  if (raw) {
    try {
      const account = JSON.parse(raw);
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.status(200).json(account);
    } catch (err) {
      return res
        .status(500)
        .json({ error: `ACCOUNT_JSON is not valid JSON: ${err.message}` });
    }
  }

  return res.status(501).json({
    error:
      'No account data configured. Set the ACCOUNT_JSON environment variable, ' +
      'or run the dashboard in mock mode (VITE_USE_MOCK=true) and edit ' +
      'src/mockData.ts.',
  });
}
