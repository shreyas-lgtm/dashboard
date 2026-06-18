/**
 * Parser.gs — turn a Gmail message into a structured warehouse listing.
 *
 * Commercial alerts (LoopNet / Crexi / CityFeet …) carry address, size and a
 * rate; building specs (clear height, docks, drive-in, zoning, power) often
 * only appear on the listing page, so Enrich.gs re-parses the page with these
 * same extractors when they're missing.
 */

const SOURCE_BY_SENDER_ = [
  [/loopnet\.com/i, 'LoopNet'],
  [/crexi\.com/i, 'Crexi'],
  [/cityfeet\.com/i, 'CityFeet'],
  [/commercialcafe\.com/i, 'CommercialCafe'],
  [/biproxi\.com/i, 'Biproxi'],
  [/brevitas\.com/i, 'Brevitas'],
  [/ten-?x\.com/i, 'Ten-X'],
  [/showcase\.com/i, 'Showcase'],
  [/costar\.com/i, 'CoStar'],
  [/realtor\.com/i, 'Realtor.com'],
];

function detectSource_(sender) {
  sender = sender || '';
  for (const pair of SOURCE_BY_SENDER_) if (pair[0].test(sender)) return pair[1];
  const m = sender.match(/@([^>\s]+)/);
  return m ? m[1] : 'Unknown';
}

function detectDealType_(text) {
  // A per-SF or /mo rate, or the words lease/rent, mean it's a lease.
  if (/\/\s*sf\b|\bpsf\b|per\s+(?:sf|square\s+foot)|\/\s*mo\b|\bfor lease\b|\bfor rent\b|\blease\b/i.test(text)) return 'lease';
  if (/\bfor sale\b|\basking price\b|\bsale price\b/i.test(text)) return 'sale';
  return 'lease';
}

function toNum_(s) {
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return isFinite(n) ? n : null;
}

/**
 * Extract the lease rate as $/SF/YEAR. Handles "$28/SF", "$28 PSF",
 * "$2.50/SF/mo" (→ ×12), "$28.00 per square foot/yr". Monthly per-SF rates are
 * annualised so everything is comparable.
 */
function extractRatePsfYr_(text) {
  const re = /\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/|per\s+)?\s*(?:psf|s\.?\s?f\.?|sq\.?\s?ft\.?|square\s?(?:foot|feet))\s*(?:\/\s*|per\s+)?(yr|year|annum|mo|month)?/i;
  const m = text.match(re);
  if (!m) return null;
  let val = toNum_(m[1]);
  if (val == null) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'mo' || unit === 'month') val *= 12;  // monthly per-SF → annual
  return Number(val.toFixed(2));
}

/** Monthly total rent, e.g. "$12,000/mo" (≥4 digits so a /SF rate can't match). */
function extractRentMonthly_(text) {
  const m = text.match(/\$\s?([\d,]{4,})\s*\/\s*(?:mo|month)\b/i);
  return m ? toNum_(m[1]) : null;
}

/** Largest plain dollar figure ≥ $100k — used as the sale asking price. */
function extractSalePrice_(text) {
  let best = null, m;
  const re = /\$\s?([\d,]{6,}(?:\.\d+)?)\b/g;
  while ((m = re.exec(text)) !== null) {
    if (/\/\s*(?:sf|mo|month|yr)|psf/i.test(text.substr(m.index, m[0].length + 6))) continue;
    const v = toNum_(m[1]);
    if (v != null && v >= 100000 && (best == null || v > best)) best = v;
  }
  return best;
}

/** Building size in SF. Takes the low end of a range ("5,000 - 10,000 SF"). */
function extractSqft_(text) {
  const m = text.match(/([\d,]{3,})(?:\s*(?:-|–|to)\s*[\d,]{3,})?\s*(?:rentable\s+)?(?:sq\.?\s?ft|sf\b|s\.?f\.?|square\s+feet)/i);
  return m ? toNum_(m[1]) : null;
}

/** Clear / ceiling height in feet, either word order. */
function extractClearHeight_(text) {
  let m = text.match(/(?:clear(?:\s*height)?|ceilings?(?:\s*height)?)\s*(?:of\s*)?[:\-]?\s*(\d{1,2}(?:\.\d)?)\s*['′]?\s*(?:ft|feet|foot|')?/i);
  if (m) return Number(m[1]);
  m = text.match(/(\d{1,2}(?:\.\d)?)\s*['′]?\s*(?:ft|feet|foot|')?\s*(?:clear|ceilings?)\b/i);
  return m ? Number(m[1]) : null;
}

/** Number of dock-high doors, if a count is given. */
function extractDocks_(text) {
  const m = text.match(/(\d{1,2})\s*(?:dock[-\s]?high\s*doors?|loading\s*docks?|dock\s*doors?|docks?\b)/i);
  return m ? Number(m[1]) : null;
}

/** Number of drive-in doors / bays, if a count is given. */
function extractDriveIn_(text) {
  const m = text.match(/(\d{1,2})\s*drive[-\s]?in\s*(?:doors?|bays?)?/i);
  return m ? Number(m[1]) : null;
}

/** NYC manufacturing zoning, e.g. "M1-2", "M3-1". */
function extractZoning_(text) {
  const m = text.match(/\b(M[123](?:-\d[A-D]?)?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Electrical service in amps, if stated (e.g. "800 amps", "1200A 3-phase"). */
function extractPower_(text) {
  const m = text.match(/(\d{3,4})\s*(?:amp|amps|a\b)/i);
  return m ? Number(m[1]) : null;
}

const FEATURE_PATTERNS_ = [
  ['dock-high loading', /dock[-\s]?high|loading\s*docks?|dock\s*doors?|tailboard/i],
  ['drive-in door', /drive[-\s]?in|grade[-\s]?level\s*door|drive\s*up/i],
  ['truck court', /truck\s*court|trailer\s*parking|truck\s*parking|maneuvering|loading\s*area/i],
  ['heavy power', /heavy\s*power|3[-\s]?phase|three[-\s]?phase|480\s*v|\d{3,4}\s*amp/i],
  ['high ceilings', /high\s*ceilings?|tall\s*ceilings?|clear\s*height/i],
  ['fenced yard', /fenced|\byard\b|outdoor\s*storage|gated\s*lot|parking\s*lot/i],
  ['climate controlled', /climate[-\s]?controlled|air[-\s]?conditioned|refrigerat|cold\s*storage|freezer/i],
  ['sprinklered', /sprinkler|esfr|fire\s*suppress|wet\s*system/i],
  ['rail access', /\brail(?:road)?\b|rail\s*spur|rail\s*access/i],
  ['crane', /\bcrane\b|gantry/i],
  ['office buildout', /office\s*(?:space|buildout|built[-\s]?out|area)|finished\s*office|built[-\s]?out\s*office/i],
  ['ground floor', /ground\s*floor|grade\s*level|street\s*level/i],
];

function extractFeatures_(text, clearHeight) {
  const found = {};
  for (const pair of FEATURE_PATTERNS_) if (pair[1].test(text)) found[pair[0]] = true;
  if (clearHeight != null && clearHeight >= 16) found['high ceilings'] = true;
  return Object.keys(found);
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
    const m = text.match(/(\d{1,5}\s+[A-Z][A-Za-z0-9 .'#-]{3,40}(?:St|Ave|Blvd|Rd|Lane|Ln|Dr|Way|Pl|Street|Avenue|Place|Court|Ct))\b/);
    if (m) return m[1].trim();
  }
  return null;
}

/** Neighbourhood / city — the matched target submarket if present, else the
 *  city field of the address, else a guess from the subject. */
function extractNeighborhood_(address, subject, body) {
  const hay = ((address || '') + ' ' + (subject || '') + ' ' + (body || '')).toLowerCase();
  // Prefer a specific submarket over the generic borough match.
  for (const loc of PREFERENCES.targetLocations) {
    if (/^\d/.test(loc) || loc === 'brooklyn') continue; // skip zips + the catch-all
    if (hay.indexOf(loc) !== -1) return loc.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  if (hay.indexOf('brooklyn') !== -1) return 'Brooklyn';
  if (address) {
    const parts = address.split(',').map(function (s) { return s.trim(); });
    if (parts.length >= 2) return parts[1];
  }
  const m = (subject || '').match(/\bin\s+([A-Z][A-Za-z .'-]+?)\s+(?:for|\$|–|-)/);
  return m ? m[1].trim() : null;
}

function extractBroker_(body) {
  if (!body) return null;
  const m = body.match(/(?:Listing by|Listed by|Broker|Contact|Presented by)\s*[:\-]?\s*([^\n\r]+)/i);
  return m ? m[1].trim().slice(0, 80) : null;
}

function extractListingUrl_(body) {
  if (!body) return null;
  const re = /[?&](?:target|url|u|redirect)=([^&\s]+)/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    let u;
    try { u = decodeURIComponent(m[1]); } catch (e) { u = m[1]; }
    if (/loopnet\.com\/Listing|crexi\.com\/(?:properties|lease|sale)|\/property|\/listing|cityfeet|commercialcafe|biproxi|brevitas/i.test(u)) {
      return u.split('?')[0];
    }
  }
  const direct = body.match(/https?:\/\/[^\s)]*(?:loopnet\.com\/Listing|crexi\.com\/(?:properties|lease|sale))[^\s)]*/i);
  if (direct) return direct[0].split('?')[0];
  const plain = body.match(/https?:\/\/[^\s)]+/);
  return plain ? plain[0] : null;
}

function deriveKey_(url, address, source) {
  if (url) {
    const loop = url.match(/loopnet\.com\/Listing\/(\d{4,})/i);
    if (loop) return 'loopnet:' + loop[1];
    const crexi = url.match(/crexi\.com\/(?:properties|lease|sale)\/(\d{4,})/i);
    if (crexi) return 'crexi:' + crexi[1];
    const idish = url.match(/\/(\d{6,})\b/);
    if (idish) return source.toLowerCase() + ':' + idish[1];
  }
  if (address) return 'addr:' + address.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return null;
}

/** Gmail message-ish object → structured warehouse listing. */
function parseListing_(email) {
  const sender = email.sender || '';
  const subject = email.subject || '';
  const body = email.plaintextBody || '';
  const combined = [subject, body].join('\n');

  const source = detectSource_(sender);
  const dealType = detectDealType_(combined);
  const sqft = extractSqft_(combined);
  const ratePsfYr = extractRatePsfYr_(combined);
  const rentMonthly = extractRentMonthly_(combined);
  const salePrice = dealType === 'sale' ? extractSalePrice_(combined) : null;
  const clearHeight = extractClearHeight_(combined);
  const address = extractAddress_(body, subject);
  const url = extractListingUrl_(body);
  const key = deriveKey_(url, address, source) || ('msg:' + email.id);

  // For a lease, derive the annual rate from a monthly total when no /SF rate.
  let rate = ratePsfYr;
  if (rate == null && rentMonthly != null && sqft) rate = Number(((rentMonthly * 12) / sqft).toFixed(2));

  return {
    key: key,
    source: source,
    dealType: dealType,
    sqft: sqft,
    ratePsfYr: rate,
    rentMonthly: rentMonthly,
    salePrice: salePrice,
    pricePerSqftSale: salePrice != null && sqft ? Number((salePrice / sqft).toFixed(0)) : null,
    clearHeight: clearHeight,
    docks: extractDocks_(combined),
    driveIn: extractDriveIn_(combined),
    zoning: extractZoning_(combined),
    power: extractPower_(combined),
    features: extractFeatures_(combined, clearHeight),
    address: address,
    neighborhood: extractNeighborhood_(address, subject, body),
    broker: extractBroker_(body),
    url: url,
    receivedAt: email.date || null,
    emailId: email.id || null,
  };
}

/** Worth keeping? Needs an address and at least one price signal. */
function isListing_(l) {
  return !!l.address && (l.ratePsfYr != null || l.salePrice != null || l.rentMonthly != null);
}

/**
 * Split a possibly-multi-listing email into ONE listing per property.
 * Saved-search digests pack several listings, each with its own property link;
 * we cut the body at those links and parse each block. Falls back to the
 * single-listing parser when there are 0–1 property links.
 */
function parseListings_(email) {
  const body = email.plaintextBody || '';
  const re = /(?:loopnet\.com(?:%2F|\/)Listing(?:%2F|\/)(\d{4,})|crexi\.com(?:%2F|\/)(?:properties|lease|sale)(?:%2F|\/)(\d{4,}))/gi;
  const marks = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const id = m[1] || m[2];
    const src = m[1] ? 'loopnet' : 'crexi';
    marks.push({ id: id, src: src, start: m.index, end: re.lastIndex });
  }
  if (marks.length <= 1) return [parseListing_(email)];

  const out = [];
  let prev = 0;
  for (let i = 0; i < marks.length; i++) {
    const chunk = body.substring(prev, marks[i].start); // this unit's block precedes its link
    prev = marks[i].end;
    const l = parseListing_({
      id: email.id + ':' + marks[i].id, threadId: email.threadId,
      sender: email.sender, subject: '', date: email.date, plaintextBody: chunk,
    });
    l.url = marks[i].src === 'loopnet'
      ? 'https://www.loopnet.com/Listing/' + marks[i].id + '/'
      : 'https://www.crexi.com/properties/' + marks[i].id;
    l.key = marks[i].src + ':' + marks[i].id;
    out.push(l);
  }
  return out;
}
