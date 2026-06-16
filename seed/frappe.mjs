/**
 * Thin Frappe / ERPNext REST client used by the structure seeder.
 *
 * Auth uses an API key/secret token pair (no OAuth dance like Zoho):
 *   Authorization: token <api_key>:<api_secret>
 *
 * Generate the pair in ERPNext:
 *   User menu → My Settings → API Access → Generate Keys
 * (or Settings → Users → <user> → API Access for another user)
 *
 * Required environment variables (see .env.example):
 *   FRAPPE_URL          e.g. https://yoursite.frappe.cloud
 *   FRAPPE_API_KEY
 *   FRAPPE_API_SECRET
 */

const BASE = (process.env.FRAPPE_URL || '').replace(/\/+$/, '');
const KEY = process.env.FRAPPE_API_KEY;
const SECRET = process.env.FRAPPE_API_SECRET;

export const DRY_RUN = process.argv.includes('--dry-run');

function assertConfig() {
  if (!BASE || !KEY || !SECRET) {
    throw new Error(
      'Missing config. Set FRAPPE_URL, FRAPPE_API_KEY and FRAPPE_API_SECRET ' +
        '(copy .env.example to .env and fill them in).'
    );
  }
}

function authHeaders() {
  return {
    Authorization: `token ${KEY}:${SECRET}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function request(method, path, body) {
  assertConfig();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }

  if (!res.ok) {
    const msg =
      data?._server_messages || data?.exception || data?._raw || res.statusText;
    const err = new Error(`${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Call a whitelisted server method: POST /api/method/<dotted.path> with params. */
export async function callMethod(method, params = {}) {
  return request('POST', `/api/method/${method}`, params);
}

/**
 * Return the `name` of the first record matching `filters`, or null.
 * filters: array of [field, operator, value], e.g. [["warehouse_name","=","Stores"]]
 */
export async function findName(doctype, filters) {
  const qs = new URLSearchParams({
    filters: JSON.stringify(filters),
    limit_page_length: '1',
    fields: JSON.stringify(['name']),
  });
  const data = await request(
    'GET',
    `/api/resource/${encodeURIComponent(doctype)}?${qs}`
  );
  return data?.data?.[0]?.name ?? null;
}

/** Fetch a single document by its primary name, or null if it does not exist. */
export async function getDoc(doctype, name) {
  try {
    const data = await request(
      'GET',
      `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
    );
    return data?.data ?? null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function createDoc(doctype, doc) {
  if (DRY_RUN) return { name: '(dry-run)', ...doc };
  const data = await request('POST', `/api/resource/${encodeURIComponent(doctype)}`, doc);
  return data?.data;
}

export async function updateDoc(doctype, name, patch) {
  if (DRY_RUN) return { name, ...patch };
  const data = await request(
    'PUT',
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    patch
  );
  return data?.data;
}

/**
 * Idempotent upsert.
 *  - `match` is the filter used to detect an existing record.
 *  - if found, no update is performed by default (config is created once);
 *    pass { update: true } to PUT the doc onto the existing record.
 * Returns { name, action: 'created' | 'exists' | 'updated' }.
 */
export async function upsert(doctype, doc, match, { update = false } = {}) {
  const existing = await findName(doctype, match);
  if (existing) {
    if (update) {
      await updateDoc(doctype, existing, doc);
      return { name: existing, action: 'updated' };
    }
    return { name: existing, action: 'exists' };
  }
  const created = await createDoc(doctype, { doctype, ...doc });
  return { name: created?.name, action: 'created' };
}

/** Resolve the abbreviation for a Company (used to build Warehouse names). */
export async function companyAbbr(companyName) {
  const doc = await getDoc('Company', companyName);
  if (!doc) throw new Error(`Company "${companyName}" not found on the site.`);
  return doc.abbr;
}
