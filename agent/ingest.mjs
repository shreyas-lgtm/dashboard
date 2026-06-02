// ---------------------------------------------------------------------------
// ingest.mjs — the agent's main loop (one pass).
//
//   raw emails  →  parse  →  scrutinize  →  rank  →  merge into data/listings.json
//                                                  →  print a Slack-ready digest
//
// Usage:
//   node agent/ingest.mjs                      # reads agent/inbox.json
//   node agent/ingest.mjs path/to/emails.json  # explicit input
//   cat emails.json | node agent/ingest.mjs -  # stdin
//
// Input is a JSON array of email objects shaped like the Gmail MCP `get_thread`
// messages: { id, threadId, sender, subject, date, snippet, plaintextBody }.
// In production, a small fetch step (cron / Apps Script / serverless) supplies
// that array; see agent/README.md. This script is pure + deterministic so it's
// trivial to test and safe to re-run (it dedupes against the existing store).
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseListing } from './parse.mjs';
import { enrichAll } from './enrich.mjs';
import { scrutinize } from './scrutinize.mjs';
import { rank } from './rank.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', 'data', 'listings.json');
const DEFAULT_INPUT = join(__dirname, 'inbox.json');

const ENRICH = process.argv.includes('--enrich');

function readInput() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (arg === '-') return JSON.parse(readFileSync(0, 'utf8'));
  const path = arg || DEFAULT_INPUT;
  if (!existsSync(path)) {
    console.error(`No input file at ${path}. Pass a JSON array of emails.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadStore() {
  if (!existsSync(STORE_PATH)) return { listings: [], updatedAt: null };
  try { return JSON.parse(readFileSync(STORE_PATH, 'utf8')); }
  catch { return { listings: [], updatedAt: null }; }
}

async function main() {
  const emails = readInput();
  const store = loadStore();

  // Preserve human decisions (approved/rejected) across re-runs, keyed by listing key.
  const decisions = new Map(store.listings.map((l) => [l.key, l.status]));
  const seenKeys = new Set();

  let parsed = emails.map(parseListing);

  // Optional: open each listing page to fill furnishing/amenities (--enrich).
  if (ENRICH) {
    console.error('Enriching from listing pages…');
    parsed = await enrichAll(parsed);
    const okCount = parsed.filter((l) => l.enrichment?.ok).length;
    console.error(`  enriched ${okCount}/${parsed.length} (rest blocked or had no URL)`);
  }

  const processed = parsed.map((listing) => {
    const { trackKey, flags } = scrutinize(listing, seenKeys);
    const { score, recommendation, breakdown } = rank(listing, trackKey, flags);
    return {
      ...listing,
      track: trackKey,
      flags,
      score,
      recommendation,
      breakdown,
      // 'new' until a human acts in the dashboard; carry prior decision forward.
      status: decisions.get(listing.key) ?? 'new',
    };
  });

  // Merge: new listings replace older copies with the same key (keep best data).
  const byKey = new Map(store.listings.map((l) => [l.key, l]));
  for (const l of processed) byKey.set(l.key, l);

  const listings = [...byKey.values()].sort((a, b) => b.score - a.score);
  const out = { updatedAt: new Date().toISOString(), count: listings.length, listings };

  writeFileSync(STORE_PATH, JSON.stringify(out, null, 2) + '\n');
  printDigest(processed);
  console.error(`\n✓ Wrote ${listings.length} listings to ${STORE_PATH}`);
}

/** A compact, Slack-friendly markdown digest of THIS run's new listings. */
function printDigest(processed) {
  const fresh = processed.filter((l) => l.status === 'new');
  const ranked = [...fresh].sort((a, b) => b.score - a.score);
  const lines = [];
  lines.push(`*🏠 ${ranked.length} new listing(s) processed*`);
  for (const l of ranked) {
    const emoji = l.recommendation === 'Strong match' ? '🟢' : l.recommendation === 'Worth a look' ? '🟡' : '⚪️';
    const price = l.price != null ? `$${l.price.toLocaleString()}${l.priceUnit}` : 'price n/a';
    const specs = [l.beds && `${l.beds}bd`, l.baths && `${l.baths}ba`, l.sqft && `${l.sqft.toLocaleString()}sqft`]
      .filter(Boolean).join(' · ');
    const flagText = l.flags.filter((f) => f.severity !== 'info').map((f) => f.code).join(', ');
    lines.push(
      `${emoji} *${l.score}* — ${l.address || 'address n/a'} · ${price}${specs ? ' · ' + specs : ''} · _${l.source}_` +
      (flagText ? `\n   ⚠️ ${flagText}` : '') +
      (l.url ? `\n   <${l.url}|view listing>` : '')
    );
  }
  // Printed to stdout so it can be piped straight into a Slack draft.
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error('ingest failed:', e);
  process.exit(1);
});
