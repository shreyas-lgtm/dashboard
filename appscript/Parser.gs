/**
 * Parser.gs — turn a Gmail message into a structured listing.
 * Ported from the Node agent's parse.mjs; same heuristics, Apps Script style.
 */

const SOURCE_BY_SENDER_ = [
  [/zillow\.com/i, 'Zillow'],
  [/apartments\.com/i, 'Apartments.com'],
  [/vrbo\.com/i, 'Vrbo'],
  [/weplacerealty\.com/i, 'WePlace Realty'],
  [/realtor\.com/i, 'Realtor.com'],
  [/loopnet\.com/i, 'LoopNet'],
  [/crexi\.com/i, 'Crexi'],
];

function detectSource_(sender) {
  sender = sender || '';
  for (const pair of SOURCE_BY_SENDER_) if (pair[0].test(sender)) return pair[1];
  const m = sender.match(/@([^>\s]+)/);
  return m ? m[1] : 'Unknown';
}

function detectDealType_(text) {
  if (/\bfor sale\b/i.test(text) && !/\/mo\b|\bfor rent\b/i.test(text)) return 'sale';
  if (/\/mo\b|\bfor rent\b|\brental\b|\brent\b|\blease\b/i.test(text)) return 'rent';
  if (/\bfor sale\b/i.test(text)) return 'sale';
  return 'rent';
}

function toNum_(s) {
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return isFinite(n) ? n : null;
}

function extractPrice_(text) {
  const monthly = text.match(/\$\s?([\d,]+)\s*\/\s*mo\b/i);
  if (monthly) return { price: toNum_(monthly[1]), perMonth: true };
  const any = text.match(/\$\s?([\d,]{3,})/);
  if (any) return { price: toNum_(any[1]), perMonth: false };
  return { price: null, perMonth: null };
}

function extractBeds_(text) {
  // Prefer the co-located "3 bd | 1 ba" form so a stray number can't hijack it.
  const combo = text.match(/(\d{1,2})\s*(?:bd|beds?)\b\s*[|·,\/-]?\s*\d{1,2}(?:\.\d)?\s*(?:ba|baths?)\b/i);
  if (combo) return Number(combo[1]);
  const m = text.match(/(\d{1,2})\s*bd\b/i) || text.match(/(\d{1,2})\s*(?:bed|bedroom)s?\b/i);
  const n = m ? Number(m[1]) : null;
  return n != null && n >= 0 && n <= 12 ? n : null;
}

function extractBaths_(text) {
  const combo = text.match(/\d{1,2}\s*(?:bd|beds?)\b\s*[|·,\/-]?\s*(\d{1,2}(?:\.\d)?)\s*(?:ba|baths?)\b/i);
  if (combo) return Number(combo[1]);
  const m = text.match(/(\d{1,2}(?:\.\d)?)\s*ba\b/i) || text.match(/(\d{1,2}(?:\.\d)?)\s*(?:bath|bathroom)s?\b/i);
  const n = m ? Number(m[1]) : null;
  return n != null && n > 0 && n <= 10 ? n : null;
}

function extractSqft_(text) {
  const m = text.match(/([\d,]{3,})\s*(?:sq\s?\.?\s?ft|sqft|square feet)\b/i);
  return m ? toNum_(m[1]) : null;
}

function extractAddress_(body, subject) {
  const haystacks = [body, subject].filter(Boolean);
  for (const text of haystacks) {
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      const m = line.match(/^(\d+[^,]*?,\s*[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s*\d{5})?)/);
      if (m) return m[1].replace(/\s*,\s*/g, ', ').trim();
    }
  }
  for (const text of haystacks) {
    const m = text.match(/(\d{1,5}\s+[A-Z][A-Za-z0-9 .'#-]{3,40}(?:St|Ave|Blvd|Rd|Lane|Ln|Dr|Way|Pl|Street|Avenue))\b/);
    if (m) return m[1].trim();
  }
  return null;
}

function extractCity_(address, subject) {
  if (address) {
    const parts = address.split(',').map(function (s) { return s.trim(); });
    if (parts.length >= 2) return parts[1];
  }
  const m = subject.match(/\bin\s+([A-Z][A-Za-z .'-]+?)\s+(?:for|\$|–|-)/);
  return m ? m[1].trim() : null;
}

function extractBroker_(body) {
  if (!body) return null;
  const m = body.match(/Listing by:\s*([^\n\r]+)/i);
  return m ? m[1].trim() : null;
}

function extractListingUrl_(body) {
  if (!body) return null;
  const re = /[?&]target=([^&\s]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    let u;
    try { u = decodeURIComponent(m[1]); } catch (e) { u = m[1]; }
    if (/homedetails|\/property|\/listing|\/home|rentals?\//i.test(u)) return u.split('?')[0];
  }
  const plain = body.match(/https?:\/\/[^\s)]+/);
  return plain ? plain[0] : null;
}

function deriveKey_(url, address, source) {
  if (url) {
    const zpid = url.match(/(\d{6,})_zpid/);
    if (zpid) return 'zillow:' + zpid[1];
    const idish = url.match(/\/(\d{6,})\b/);
    if (idish) return source.toLowerCase() + ':' + idish[1];
  }
  if (address) return 'addr:' + address.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return null;
}

function extractFurnished_(text) {
  if (/\bunfurnished\b|\bnot furnished\b/i.test(text)) return false;
  if (/\b(fully\s+)?furnished\b/i.test(text)) return true;
  return null;
}

const AMENITY_PATTERNS_ = [
  ['in-unit laundry', /in[-\s]?unit laundry|laundry:\s*in[-\s]?unit|washer\s*\/?\s*dryer|washer and dryer|in[-\s]?unit washer/i],
  ['shared laundry', /shared laundry|laundry:\s*shared|laundry:\s*in building|common laundry|laundry room/i],
  ['dishwasher', /dishwasher/i],
  ['dryer', /\bdryer\b/i],
  ['washer', /\bwasher\b/i],
  ['elevator', /\belevator\b/i],
  ['doorman', /doorman|concierge/i],
  ['gym', /\bgym\b|fitness (?:center|room)/i],
  ['parking', /\bgarage\b|on[-\s]?site parking|private parking|parking (?:spot|space|included|available)|parking:\s*(?:garage|available|included|yes)/i],
  ['central air', /central air|central a\/c|air conditioning|\bA\/C\b|cooling:\s*central/i],
  ['outdoor space', /balcony|terrace|patio|backyard|private outdoor|roof ?deck|outdoor space/i],
  ['pool', /\bpool\b/i],
  ['pets', /pets? (?:ok|allowed|welcome)|pet[-\s]friendly|dogs? ok|cats?,? dogs? ok|cats? ok|pets allowed:\s*yes/i],
  ['hardwood', /hardwood/i],
  ['stainless appliances', /stainless steel|s\/s appliances|stainless appliances/i],
];

function extractAmenities_(text) {
  const found = {};
  for (const pair of AMENITY_PATTERNS_) if (pair[1].test(text)) found[pair[0]] = true;
  // in-unit laundry implies washer+dryer and supersedes a shared-laundry note.
  if (found['in-unit laundry']) { delete found['washer']; delete found['dryer']; delete found['shared laundry']; }
  return Object.keys(found);
}

/** Gmail message-ish object → structured listing. */
function parseListing_(email) {
  const sender = email.sender || '';
  const subject = email.subject || '';
  const body = email.plaintextBody || '';
  const combined = [subject, body].join('\n');

  const source = detectSource_(sender);
  const dealType = detectDealType_(combined);
  const priceInfo = extractPrice_(combined);
  const beds = extractBeds_(combined);
  const baths = extractBaths_(combined);
  const sqft = extractSqft_(combined);
  const address = extractAddress_(body, subject);
  const city = extractCity_(address, subject);
  const url = extractListingUrl_(body);
  const key = deriveKey_(url, address, source) || ('msg:' + email.id);

  return {
    key: key,
    source: source,
    dealType: dealType,
    price: priceInfo.price,
    priceUnit: priceInfo.perMonth || dealType === 'rent' ? '/mo' : 'total',
    beds: beds,
    baths: baths,
    sqft: sqft,
    pricePerSqft: priceInfo.price != null && sqft ? Number((priceInfo.price / sqft).toFixed(2)) : null,
    furnished: extractFurnished_(combined),
    amenities: extractAmenities_(combined),
    address: address,
    city: city,
    broker: extractBroker_(body),
    url: url,
    receivedAt: email.date || null,
    emailId: email.id || null,
  };
}

/** Worth keeping? Needs at least an address and a price. */
function isListing_(l) {
  return !!l.address && l.price != null;
}

/**
 * Split a possibly-multi-listing email into ONE listing per unit.
 * Zillow digests ("10 Rentals…") and saved-home alerts pack several listings
 * in one mail, each ending with its own homedetails/<zpid> link. We cut the
 * body at those links and parse each block separately. Falls back to the
 * single-listing parser when there's 0–1 detail link.
 */
function parseListings_(email) {
  const body = email.plaintextBody || '';
  const re = /homedetails(?:%2F|\/)(\d{6,})_zpid/gi;
  const marks = [];
  let m;
  while ((m = re.exec(body)) !== null) marks.push({ zpid: m[1], start: m.index, end: re.lastIndex });
  if (marks.length <= 1) return [parseListing_(email)];

  const out = [];
  let prev = 0;
  for (let i = 0; i < marks.length; i++) {
    const chunk = body.substring(prev, marks[i].start); // this unit's block precedes its link
    prev = marks[i].end;
    const l = parseListing_({
      id: email.id + ':' + marks[i].zpid, threadId: email.threadId,
      sender: email.sender, subject: '', date: email.date, plaintextBody: chunk,
    });
    l.url = 'https://www.zillow.com/homedetails/' + marks[i].zpid + '_zpid/';
    l.key = 'zillow:' + marks[i].zpid;
    out.push(l);
  }
  return out;
}
