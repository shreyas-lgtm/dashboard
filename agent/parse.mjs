// ---------------------------------------------------------------------------
// parse.mjs — turn a raw listing email into a structured Listing object.
//
// Input shape (a subset of what the Gmail MCP `get_thread` tool returns):
//   { id, threadId, sender, subject, date, snippet, plaintextBody }
//
// The parser is deliberately heuristic and source-aware. Real-estate alert
// emails (Zillow, Apartments.com, broker blasts) all encode the same handful
// of facts — price, beds, baths, sqft, address — in slightly different ways.
// We try source-specific extraction first, then fall back to generic regex.
// Anything we can't find is left null and gets caught by scrutinize.mjs.
// ---------------------------------------------------------------------------

/** Known senders → a friendly source name. */
const SOURCE_BY_SENDER = [
  [/zillow\.com/i, 'Zillow'],
  [/apartments\.com/i, 'Apartments.com'],
  [/vrbo\.com/i, 'Vrbo'],
  [/weplacerealty\.com/i, 'WePlace Realty'],
  [/realtor\.com/i, 'Realtor.com'],
  [/loopnet\.com/i, 'LoopNet'],          // common for warehouse/industrial
  [/crexi\.com/i, 'Crexi'],
];

function detectSource(sender = '') {
  for (const [re, name] of SOURCE_BY_SENDER) if (re.test(sender)) return name;
  // Fall back to the email domain.
  const m = sender.match(/@([^>\s]+)/);
  return m ? m[1] : 'Unknown';
}

/** rent vs sale, from subject/body language. Defaults to rent. */
function detectDealType(text) {
  if (/\bfor sale\b|\bsale\b|\$[\d,]+(?:\b|$)(?!\s*\/?\s*mo)/i.test(text) &&
      /\bfor sale\b/i.test(text)) return 'sale';
  if (/\/mo\b|\bfor rent\b|\brental\b|\brent\b|\blease\b/i.test(text)) return 'rent';
  if (/\bfor sale\b/i.test(text)) return 'sale';
  return 'rent';
}

/** First "$3,799/mo" or "$1,200,000" style number. Returns { price, perMonth }. */
function extractPrice(text) {
  const monthly = text.match(/\$\s?([\d,]+)\s*\/\s*mo\b/i);
  if (monthly) return { price: toNum(monthly[1]), perMonth: true };
  const any = text.match(/\$\s?([\d,]{3,})/);
  if (any) return { price: toNum(any[1]), perMonth: false };
  return { price: null, perMonth: null };
}

function extractBeds(text) {
  const m =
    text.match(/(\d+)\s*bd\b/i) ||
    text.match(/(\d+)\s*(?:bed|bedroom)s?\b/i);
  return m ? Number(m[1]) : null;
}

function extractBaths(text) {
  const m =
    text.match(/(\d+(?:\.\d)?)\s*ba\b/i) ||
    text.match(/(\d+(?:\.\d)?)\s*(?:bath|bathroom)s?\b/i);
  return m ? Number(m[1]) : null;
}

function extractSqft(text) {
  // "1,200 sqft" / "1200 sq ft" / "-- sqft" (unknown). Zillow uses "--".
  const m = text.match(/([\d,]{3,})\s*(?:sq\s?\.?\s?ft|sqft|square feet)\b/i);
  return m ? toNum(m[1]) : null;
}

/**
 * Address heuristic: a line that starts with a street number and contains a
 * comma + state, or the "N <St> ... , City, ST" pattern common in these emails.
 */
function extractAddress(plaintextBody, snippet, subject) {
  const haystacks = [plaintextBody, snippet, subject].filter(Boolean);
  for (const text of haystacks) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      // e.g. "1132 Hancock St #9, Brooklyn, NY" or "31 Dawn Lane, Airmont,NY 10901"
      const m = line.match(
        /^(\d+[^,]*?,\s*[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s*\d{5})?)/
      );
      if (m) return m[1].replace(/\s*,\s*/g, ', ').trim();
    }
  }
  // Looser fallback: a street-number line without full city/state.
  for (const text of haystacks) {
    const m = text.match(/(\d{1,5}\s+[A-Z][A-Za-z0-9 .'#-]{3,40}(?:St|Ave|Blvd|Rd|Lane|Ln|Dr|Way|Pl|Street|Avenue))\b/);
    if (m) return m[1].trim();
  }
  return null;
}

/** Best-effort city from the address or subject ("... in Brooklyn for ..."). */
function extractCity(address, subject) {
  if (address) {
    const parts = address.split(',').map((s) => s.trim());
    if (parts.length >= 2) return parts[1];
  }
  const m = subject.match(/\bin\s+([A-Z][A-Za-z .'-]+?)\s+(?:for|\$|–|-)/);
  return m ? m[1].trim() : null;
}

/**
 * Furnishing: true (furnished) / false (explicitly unfurnished) / null (silent).
 * Check "unfurnished" first since it contains the substring "furnished".
 */
export function extractFurnished(text) {
  if (/\bunfurnished\b|\bnot furnished\b/i.test(text)) return false;
  if (/\b(fully\s+)?furnished\b/i.test(text)) return true;
  return null;
}

/**
 * Amenities → canonical tokens that match preferences.mjs keys. Alert emails
 * are usually terse (often only "Pets"); richer broker emails / enriched
 * listing-page text yield more. Order doesn't matter; we de-dupe.
 */
const AMENITY_PATTERNS = [
  ['laundry', /in[-\s]?unit laundry|washer\s*\/?\s*dryer|washer and dryer|in[-\s]?unit washer/i],
  ['dishwasher', /dishwasher/i],
  ['dryer', /\bdryer\b/i],
  ['washer', /\bwasher\b/i],
  ['elevator', /\belevator\b/i],
  ['doorman', /doorman|concierge/i],
  ['gym', /\bgym\b|fitness (?:center|room)/i],
  ['parking', /\bparking\b|\bgarage\b/i],
  ['central air', /central air|central a\/c|air conditioning|\bA\/C\b/i],
  ['outdoor space', /balcony|terrace|patio|backyard|private outdoor|roof ?deck/i],
  ['pool', /\bpool\b/i],
  ['pets', /\bpets?\b|pet[-\s]friendly|dogs? ok|cats? ok/i],
  ['hardwood', /hardwood/i],
];

export function extractAmenities(text) {
  const found = new Set();
  for (const [token, re] of AMENITY_PATTERNS) if (re.test(text)) found.add(token);
  // "washer/dryer" already counts as laundry; drop the redundant singletons.
  if (found.has('laundry')) { found.delete('washer'); found.delete('dryer'); }
  return [...found];
}

/** "Listing by: MADEHOME" → broker/agent name. */
function extractBroker(plaintextBody) {
  if (!plaintextBody) return null;
  const m = plaintextBody.match(/Listing by:\s*([^\n\r]+)/i);
  return m ? m[1].trim() : null;
}

/** The real listing URL (strips the click-tracker wrapper's target= param). */
function extractListingUrl(plaintextBody, source) {
  if (!plaintextBody) return null;
  // Tracking links carry the real destination in ?target=<urlencoded>.
  const targets = [...plaintextBody.matchAll(/[?&]target=([^&\s]+)/g)]
    .map((m) => safeDecode(m[1]))
    .filter((u) => /homedetails|\/property|\/listing|\/home|rentals?\//i.test(u));
  if (targets.length) return stripQuery(targets[0]);
  // Otherwise first plain http link that looks like a listing.
  const plain = plaintextBody.match(/https?:\/\/[^\s)]+/);
  return plain ? plain[0] : null;
}

/** A stable id for dedupe: source listing id from URL, else normalised address. */
function deriveListingKey(url, address, source) {
  if (url) {
    const zpid = url.match(/(\d{6,})_zpid/);
    if (zpid) return `zillow:${zpid[1]}`;
    const idish = url.match(/\/(\d{6,})\b/);
    if (idish) return `${source.toLowerCase()}:${idish[1]}`;
  }
  if (address) return `addr:${address.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return null;
}

export function parseListing(email) {
  const { sender = '', subject = '', snippet = '', plaintextBody = '', date, id, threadId } = email;
  const combined = [subject, snippet, plaintextBody].join('\n');

  const source = detectSource(sender);
  const dealType = detectDealType(combined);
  const { price, perMonth } = extractPrice(combined);
  const beds = extractBeds(combined);
  const baths = extractBaths(combined);
  const sqft = extractSqft(combined);
  const address = extractAddress(plaintextBody, snippet, subject);
  const city = extractCity(address, subject);
  const broker = extractBroker(plaintextBody);
  const url = extractListingUrl(plaintextBody, source);
  const key = deriveListingKey(url, address, source);
  const furnished = extractFurnished(combined);
  const amenities = extractAmenities(combined);

  // pricePerSqft only meaningful for rent when sqft is known.
  const pricePerSqft =
    price != null && sqft ? Number((price / sqft).toFixed(2)) : null;

  return {
    key: key || `msg:${id}`,
    source,
    dealType, // 'rent' | 'sale'
    price,
    priceUnit: perMonth ? '/mo' : dealType === 'rent' ? '/mo' : 'total',
    beds,
    baths,
    sqft,
    pricePerSqft,
    furnished, // true | false | null (unknown)
    amenities, // canonical tokens, e.g. ['dishwasher','laundry']
    address,
    city,
    broker,
    url,
    receivedAt: date || null,
    emailId: id || null,
    threadId: threadId || null,
  };
}

// --- small helpers ---------------------------------------------------------
function toNum(s) {
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}
function stripQuery(u) {
  return u.split('?')[0];
}
