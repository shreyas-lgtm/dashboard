// Offline tests for the pure helpers in Code.gs -- no Asana credentials needed.
// The Apps Script globals are stubbed; anything that touches the network is not
// exercised here. Run with:  node integrations/asana-purchase-requests/test-local.js

global.Session = { getScriptTimeZone: () => 'Asia/Kolkata' };
// Minimal formatDate honouring the patterns Code.gs uses, so format assertions
// test the code rather than the stub. UTC throughout, matching the helpers below.
global.Utilities = {
  formatDate: (d, _tz, pattern) => {
    const p = (n) => String(n).padStart(2, '0');
    return String(pattern)
      .replace('yyyy', d.getUTCFullYear())
      .replace('MM', p(d.getUTCMonth() + 1))
      .replace('dd', p(d.getUTCDate()))
      .replace('HH', p(d.getUTCHours()))
      .replace('mm', p(d.getUTCMinutes()));
  },
  sleep: () => {},
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'stub' }) };
global.UrlFetchApp = {}; global.SpreadsheetApp = {}; global.ScriptApp = {};
global.CacheService = {}; global.MailApp = {}; global.LockService = {};

const src = require('fs').readFileSync(__dirname + '/Code.gs', 'utf8');
// new Function keeps the script's declarations out of this module's scope.
const api = new Function(
  src + `\nreturn { dueDate_, buildNotes_, buildCustomFields_, resolveColumns_,
    routeFor_, needsPrice_, sameStatus_, sectionNameFor_, indexRowsByGid_,
    isKnownStatus_, assertRequiredFields_, cellText_, formatComments_, shortStamp_,
    REQUIRED_FIELDS, AUTO_CREATE, isDecision_, REQUESTER_EMAILS, effectiveDecision_,
    isPastPointOfNoReturn_, CFG, COL };`
)();

// Snapshot before any test mutates CFG.
const ORIGINAL_CUSTOM_FIELD_KEYS = Object.keys(api.CFG.customFieldGids);

let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got:  ${got}\n        want: ${want}`}`);
};
const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const g = (o) => (k) => o[k] || '';

// ---------------------------------------------------------------------------
console.log('-- due dates --');
eq('Critical -> +1d', api.dueDate_('Critical (Required within 24 hours)'), days(1));
eq('High -> +3d', api.dueDate_('High (Needed within 2–3 day)'), days(3));
eq('Normal -> +7d', api.dueDate_('Normal ( Need within a week)'), days(7));
eq('Planned -> +30d', api.dueDate_('Planned (Part of future project / inventory stock)'), days(30));
eq('blank -> default', api.dueDate_(''), days(7));
eq('unknown -> default', api.dueDate_('Whenever'), days(7));

// ---------------------------------------------------------------------------
console.log('\n-- routing on the new "Product type" question --');
const OPTIONS = [
  ['Mechanical - OTS', 'kiran@origin.tech'],
  ['Mechanical - Custom', 'kiran@origin.tech'],
  ['Electrical - OTS', 'abish@origin.tech'],
  ['Electrical - custom', 'abish@origin.tech'],
  ['Office supplies', 'syed@origin.tech'],
];
OPTIONS.forEach(([choice, owner]) => {
  eq(`${choice.padEnd(21)} -> ${owner.split('@')[0]}`,
     api.routeFor_(g({ productType: choice })).assign, owner);
});

// "Other:" writes the requester's free text straight into the cell.
eq('Other free text -> abish (default)',
   api.routeFor_(g({ productType: 'A thing I invented' })).assign, 'abish@origin.tech');
eq('blank product type -> abish (default)',
   api.routeFor_(g({ productType: '' })).assign, 'abish@origin.tech');
// ...but free text that starts with a known word still routes correctly.
eq('Other "Mechanical fastener" -> kiran',
   api.routeFor_(g({ productType: 'Mechanical fastener' })).assign, 'kiran@origin.tech');

console.log('   tolerances:');
eq('lowercase', api.routeFor_(g({ productType: 'mechanical - ots' })).assign, 'kiran@origin.tech');
eq('padded', api.routeFor_(g({ productType: '  Electrical - OTS  ' })).assign, 'abish@origin.tech');
eq('office supplies lc', api.routeFor_(g({ productType: 'office supplies' })).assign, 'syed@origin.tech');
// Must not match on a mere substring.
eq('"Non-mechanical" does not match kiran',
   api.routeFor_(g({ productType: 'Non-mechanical' })).assign, 'abish@origin.tech');

// Rule order is the precedence.
eq('first matching rule wins', api.routeFor_(g({ productType: 'Mechanical' })).label,
   'Product type = Mechanical');

// ---------------------------------------------------------------------------
console.log('\n-- price gate --');
eq('Ordered needs a price', api.needsPrice_('Ordered'), true);
eq('Handed Over needs a price', api.needsPrice_('Handed Over'), true);
eq('handed over, lowercase', api.needsPrice_('handed over'), true);
eq('Pending does not', api.needsPrice_('Pending'), false);
eq('Quotation Awaited does not', api.needsPrice_('Quotation Awaited'), false);
eq('Rework does not', api.needsPrice_('Rework'), false);
eq('blank does not', api.needsPrice_(''), false);

console.log('   every configured status is classified:');
api.CFG.statuses.forEach((s) => {
  const gated = api.needsPrice_(s);
  const expected = s === 'Ordered' || s === 'Handed Over';
  eq(`${s.padEnd(18)} gated=${gated}`, gated, expected);
});

console.log('   status comparison:');
eq('same, different case', api.sameStatus_('Handed Over', 'handed over'), true);
eq('same, padded', api.sameStatus_(' Ordered ', 'Ordered'), true);
eq('different', api.sameStatus_('Ordered', 'Pending'), false);
eq('blank vs blank', api.sameStatus_('', ''), true);

// ---------------------------------------------------------------------------
console.log('\n-- section reading --');
api.CFG.projectGid = 'PROJ';
eq('reads the section for our project',
   api.sectionNameFor_({ memberships: [{ project: { gid: 'PROJ' }, section: { name: 'Ordered' } }] }),
   'Ordered');
eq('ignores sections from other projects',
   api.sectionNameFor_({ memberships: [{ project: { gid: 'OTHER' }, section: { name: 'Ordered' } }] }),
   '');
eq('picks ours out of several',
   api.sectionNameFor_({ memberships: [
     { project: { gid: 'OTHER' }, section: { name: 'Nope' } },
     { project: { gid: 'PROJ' }, section: { name: 'Rework' } },
   ] }),
   'Rework');
eq('no memberships -> blank', api.sectionNameFor_({}), '');
eq('membership without a section -> blank',
   api.sectionNameFor_({ memberships: [{ project: { gid: 'PROJ' } }] }), '');

// ---------------------------------------------------------------------------
console.log('\n-- ticket body --');
const row = {
  requester: 'harini@origin.tech',
  item: 'DC motor for Operation Station Turntable POC',
  quantity: '1', partNumber: '24V/12RPM',
  productType: 'Electrical - OTS',
  urgency: 'High (Needed within 2–3 day)',
  vendor: '-', justification: 'Need urgently for POC of turntable',
  link: 'https://thinkrobotics.com/products/37mm-encoder-dc-metal-gearmotors',
};
const route = api.routeFor_(g(row));
const notes = api.buildNotes_(g(row), route);
console.log(notes.split('\n').map((l) => '   | ' + l).join('\n'));

const valueCols = notes.split('\n').filter((l) => /^[A-Za-z].*?:\s{2,}\S/.test(l))
  .map((l) => l.match(/^(.*?:\s+)/)[1].length);
eq('all 7 requested fields present', valueCols.length, 7);
eq('values align in one column', new Set(valueCols).size, 1);
['Requester', 'Item', 'Quantity', 'Part / model no.', 'Product type', 'Urgency', 'Preferred vendor']
  .forEach((f) => eq(`contains ${f}`, notes.includes(f + ':'), true));
eq('includes justification', notes.includes('Need urgently for POC of turntable'), true);
eq('includes link', notes.includes('thinkrobotics.com'), true);
eq('records the route', notes.includes('Routed to abish@origin.tech'), true);
eq('tells people how to change status', notes.includes('Move this card between sections'), true);

eq('drops link when NA', api.buildNotes_(g({ item: 'x', link: 'NA' }), route).includes('Link\n----'), false);
eq('omits blank fields', api.buildNotes_(g({ item: 'x' }), route).includes('Preferred vendor'), false);
eq('surfaces an unroutable owner',
   api.buildNotes_(g({ item: 'x' }), { assign: 'z@origin.tech', label: 'l', warning: 'no such user' })
     .includes('⚠ no such user'), true);

// ---------------------------------------------------------------------------
console.log('\n-- column resolution --');
function fakeSheet(headers) {
  const h = headers.slice();
  const cells = {};
  return {
    getLastColumn: () => h.length,
    getLastRow: () => 1,
    getRange: (r, c, nr, nc) => ({
      getValues: () => (r === 1
        ? [h.slice(c - 1, c - 1 + (nc || 1))]
        : [[cells[`${r},${c}`] || '']]),
      getValue: () => cells[`${r},${c}`] || '',
      setValue: (v) => { if (r === 1) h[c - 1] = v; else cells[`${r},${c}`] = v; },
      getA1Notation: () => String.fromCharCode(64 + c) + r,
    }),
    _headers: () => h,
  };
}

// The NEW form's likely header row: Product type replaces the old category cols.
const NEW_HDR = ['Timestamp', 'Email address', 'Product type', 'Item Name/ Description',
  'Quantity', 'Part Number/ Model Number', 'Link', 'Justification for Purchase',
  'Lead approval', 'Urgency Level', 'Preferred Vendor/ Source', 'PR_ID', 'Price (INR)'];

let s = fakeSheet(NEW_HDR);
let cols = api.resolveColumns_(s);
eq('finds Lead approval', cols.approval, 8);
eq('new sheet has no Final Approval column', cols.finalApproval, undefined);
eq('maps Product type (routing key)', cols.fields.productType, 2);
eq('maps Price (gate key)', cols.fields.price, 12);
eq('maps requester', cols.fields.requester, 1);
eq('appends Asana Task', cols.taskUrl, 13);
eq('appends Asana Task GID', cols.taskGid, 14);
eq('auto-creates the status column', cols.fields.status, 15);
eq('auto-creates the comments column', cols.fields.comments, 16);
eq('status header written', s._headers()[15], 'Order Status');
eq('comments header written', s._headers()[16], 'Asana Comments');
eq('GID header written', s._headers()[14], 'Asana Task GID');
eq('absent optional column stays undefined', cols.fields.orderedDate, undefined);

// Old sheet still resolves, via the fallback header names.
const OLD_HDR = ['Timestamp', 'Email address', 'Item Name/ Description', 'Order Status', 'Quantity',
  'Estimate', 'Part Number/ Model Number', 'Link', 'Justification for Purchase', 'Lead approval',
  'Final Approval', 'Urgency Level', 'Team', 'Preferred Vendor/ Source', 'PR_ID', 'Attachment',
  'Product Main Category', 'Lead Time ', 'Price (INR)', 'Item Type', 'Lead time', 'Lead Time',
  'Delivery Date', 'ETA', '/.', 'Order ID', 'Utilized /Non - Utilized', 'Approval Date',
  'Ordered Date', 'SCM Remark ', 'Projection Needed'];
cols = api.resolveColumns_(fakeSheet(OLD_HDR));
eq('old sheet: finds approval', cols.approval, 9);
eq('old sheet: finds Final Approval', cols.finalApproval, 10);
eq('old sheet: reuses existing Order Status', cols.fields.status, 3);
eq('old sheet: productType falls back to Item Type', cols.fields.productType, 19);
eq('old sheet: maps Ordered Date', cols.fields.orderedDate, 28);
eq('old sheet: comments reuse SCM Remark', cols.fields.comments, 29);

// Header-driven, not position-driven.
const moved = ['Lead approval'].concat(NEW_HDR.filter((_, i) => i !== 8));
eq('follows the approval header when it moves', api.resolveColumns_(fakeSheet(moved)).approval, 0);

// Unrecognised approval header must fail loudly.
const unknown = NEW_HDR.slice(); unknown[8] = 'Sign off';
let threw = '';
try { api.resolveColumns_(fakeSheet(unknown)); } catch (err) { threw = err.message; }
eq('throws when no known approval header matches',
   threw.startsWith('Could not find the approval column'), true);
eq('error dumps the actual header row', threw.includes('Sign off'), true);

// GID index -> row map, the sync's join key.
const sheetWithGids = fakeSheet(NEW_HDR.concat(['Asana Task', 'Asana Task GID', 'Order Status']));
sheetWithGids.getLastRow = () => 4;
const gidCol = 15;
[['1111', 2], ['2222', 3], ['', 4]].forEach(([gid, r]) => {
  sheetWithGids.getRange(r, gidCol + 1).setValue(gid);
});
sheetWithGids.getRange = ((orig) => (r, c, nr, nc) => {
  if (r === 2 && c === gidCol + 1 && nr === 3) {
    return { getValues: () => [['1111'], ['2222'], ['']] };
  }
  return orig(r, c, nr, nc);
})(sheetWithGids.getRange);
const map = api.indexRowsByGid_(sheetWithGids, { taskGid: gidCol });
eq('gid map: first row', map['1111'], 2);
eq('gid map: second row', map['2222'], 3);
eq('gid map: skips blanks', Object.keys(map).length, 2);

// ---------------------------------------------------------------------------
console.log('\n-- custom fields --');
eq('empty by default', Object.keys(api.buildCustomFields_(g(row))).length, 0);
api.CFG.customFieldGids.productType = '111';
api.CFG.customFieldGids.prId = '222'; // row has no prId, so this must be skipped
eq('maps configured GIDs only',
   JSON.stringify(api.buildCustomFields_(g(row))), JSON.stringify({ '111': 'Electrical - OTS' }));
eq('skips a configured field with no value', '222' in api.buildCustomFields_(g(row)), false);

// ---------------------------------------------------------------------------
console.log('\n-- cell reading (numeric zero must not read as blank) --');
eq('numeric 0 -> "0"', api.cellText_(0), '0');
eq('null -> ""', api.cellText_(null), '');
eq('undefined -> ""', api.cellText_(undefined), '');
eq('padded string trimmed', api.cellText_('  6531  '), '6531');
eq('numeric price preserved', api.cellText_(6531), '6531');
// The bug this replaces: `value || ''` turned a zero-cost item into a blank
// price, so it could never leave Quotation Awaited.
eq('a zero price counts as filled', api.cellText_(0) !== '', true);

// ---------------------------------------------------------------------------
console.log('\n-- unrecognised board sections are ignored, not written --');
api.CFG.statuses.forEach((s) => eq(`"${s}" is known`, api.isKnownStatus_(s), true));
eq('lowercase known', api.isKnownStatus_('handed over'), true);
eq('padded known', api.isKnownStatus_('  Ordered '), true);
['On Hold', 'Blocked', 'Done', 'Ordered 🎉', ''].forEach((s) =>
  eq(`"${s}" is NOT known`, api.isKnownStatus_(s), false));

// ---------------------------------------------------------------------------
console.log('\n-- required fields fail loudly --');
const okCols = { fields: { status: 3, price: 12, productType: 2, item: 4 } };
let raised = '';
try { api.assertRequiredFields_(okCols); } catch (e) { raised = e.message; }
eq('fully mapped -> no error', raised, '');

[['price', 'blocks every ticket'], ['productType', 'routes everything'], ['item', '']]
  .forEach(([field]) => {
    const broken = { fields: Object.assign({}, okCols.fields) };
    delete broken.fields[field];
    let msg = '';
    try { api.assertRequiredFields_(broken); } catch (e) { msg = e.message; }
    eq(`missing ${field} throws`, msg.includes(field), true);
  });

let noStatus = '';
try { api.assertRequiredFields_({ fields: { price: 1, productType: 2, item: 3 } }); }
catch (e) { noStatus = e.message; }
eq('missing status column throws', noStatus.includes('No status column'), true);
eq('REQUIRED_FIELDS covers price + productType',
   api.REQUIRED_FIELDS.includes('price') && api.REQUIRED_FIELDS.includes('productType'), true);

// ---------------------------------------------------------------------------
console.log('\n-- Asana holds no price field --');
eq('price is not an Asana custom field', ORIGINAL_CUSTOM_FIELD_KEYS.includes('price'), false);
eq('requester is not added as a follower', src.includes('addFollowerByEmail_'), false);
eq('rework notifies the requester by email', src.includes("notifyRequester_('rework'"), true);

// ---------------------------------------------------------------------------
console.log('\n-- PR_ID format --');
eq('start seed continues the old sequence', api.CFG.prIdStartFrom, 1527);
eq('prefix', api.CFG.prIdPrefix, 'PR');
// Reproduce the generator's format without touching PropertiesService.
const fmt = (n) => api.CFG.prIdPrefix + '-' + new Date().getFullYear() + '-' + n;
eq('next after seed', fmt(api.CFG.prIdStartFrom + 1), `PR-${new Date().getFullYear()}-1528`);
eq('matches the old form pattern', /^PR-\d{4}-\d{4}$/.test(fmt(1528)), true);

// ---------------------------------------------------------------------------
console.log('\n-- comment log --');
const STORIES = [
  { type: 'comment', text: 'Vendor confirmed lead time 3 days', created_at: '2026-08-09T05:32:00.000Z', created_by: { name: 'Kiran' } },
  { type: 'system', text: 'moved this task to Ordered', created_at: '2026-08-09T06:00:00.000Z', created_by: { name: 'Kiran' } },
  { type: 'comment', text: 'Quotation received,\n6531 INR', created_at: '2026-08-10T11:15:00.000Z', created_by: { name: 'Abish Kumar' } },
];
const onlyComments = STORIES.filter((s) => s.type === 'comment');
const log = api.formatComments_(onlyComments);
console.log(log.split('\n').map((l) => '   | ' + l).join('\n'));

eq('newest comment first', log.split('\n')[0].includes('Quotation received'), true);
eq('oldest comment last', log.split('\n')[1].includes('lead time 3 days'), true);
eq('one line per comment', log.split('\n').length, 2);
eq('multi-line comment collapsed', log.includes('Quotation received, / 6531 INR'), true);
eq('author included', log.includes('Abish Kumar:'), true);
eq('timestamp included', /^\[\d{2}\/\d{2} \d{2}:\d{2}\]/.test(log), true);
eq('empty list -> empty string', api.formatComments_([]), '');

// Only the most recent N are kept.
const many = Array.from({ length: 30 }, (_, i) => ({
  type: 'comment', text: 'comment ' + i,
  created_at: '2026-08-10T00:00:00.000Z', created_by: { name: 'X' },
}));
eq('capped at commentsMaxCount', api.formatComments_(many).split('\n').length, api.CFG.commentsMaxCount);
eq('newest of many is first', api.formatComments_(many).split('\n')[0].includes('comment 29'), true);

// Long comments are truncated rather than blowing the cell limit.
const huge = Array.from({ length: 20 }, (_, i) => ({
  type: 'comment', text: 'x'.repeat(500),
  created_at: '2026-08-10T00:00:00.000Z', created_by: { name: 'X' },
}));
const truncated = api.formatComments_(huge);
eq('respects commentsMaxChars', truncated.length <= api.CFG.commentsMaxChars, true);
eq('says it truncated', truncated.includes('(truncated)'), true);

// System stories must never reach the sheet.
eq('system stories are excluded upstream',
   api.formatComments_(onlyComments).includes('moved this task to'), false);
eq('stories filter keeps comment_added subtype',
   src.includes("resource_subtype === 'comment_added'"), true);

eq('comments column is auto-created', api.AUTO_CREATE.includes('comments'), true);
eq('comments sync is one-way (no push to Asana)',
   src.includes('syncCommentsForRow_') && !src.includes('pushCommentToAsana'), true);

// ---------------------------------------------------------------------------
console.log('\n-- Lead Approval dropdown: all three values --');
eq('"Approved" is approve', api.isDecision_('Approved', 'approve'), true);
eq('"Rejected" is reject', api.isDecision_('Rejected', 'reject'), true);
eq('"Re-verify" is reverify', api.isDecision_('Re-verify', 'reverify'), true);

console.log('   values are mutually exclusive:');
[['Approved', 'approve'], ['Rejected', 'reject'], ['Re-verify', 'reverify']].forEach(([val, key]) => {
  ['approve', 'reject', 'reverify'].forEach((k) => {
    eq(`${val.padEnd(10)} vs ${k.padEnd(8)}`, api.isDecision_(val, k), k === key);
  });
});

console.log('   tolerances and non-matches:');
eq('lowercase re-verify', api.isDecision_('re-verify', 'reverify'), true);
eq('padded approved', api.isDecision_('  Approved  ', 'approve'), true);
eq('blank matches nothing', api.isDecision_('', 'approve'), false);
// "Re-verify" must not be mistaken for "Rejected" -- both begin with R, and the
// decision check is exact rather than prefix-based unlike routing.
eq('Re-verify is not Rejected', api.isDecision_('Re-verify', 'reject'), false);
eq('"Approve" (no d) matches nothing', api.isDecision_('Approve', 'approve'), false);
eq('"Yes" matches nothing', api.isDecision_('Yes', 'approve'), false);

// ---------------------------------------------------------------------------
console.log('\n-- Cancelled status --');
eq('Cancelled is a known status', api.isKnownStatus_('Cancelled'), true);
eq('Cancelled is NOT price-gated', api.needsPrice_('Cancelled'), false);
eq('Rejected routes to Cancelled', api.CFG.rejectedStatus, 'Cancelled');
eq('Re-verify routes to Rework', api.CFG.reverifyStatus, 'Rework');
eq('both revision targets are real statuses',
   api.isKnownStatus_(api.CFG.rejectedStatus) && api.isKnownStatus_(api.CFG.reverifyStatus), true);

// ---------------------------------------------------------------------------
console.log('\n-- requester emails --');
['rework', 'reverify', 'rejected'].forEach((k) => {
  const t = api.REQUESTER_EMAILS[k];
  eq(`${k}: template exists`, !!t, true);
  eq(`${k}: subject carries the label`, t.subject.includes('{label}'), true);
  eq(`${k}: body is non-trivial`, t.body.length > 80, true);
});
// Approved / Ordered / Handed Over are deliberately silent.
['approved', 'ordered', 'handedover'].forEach((k) =>
  eq(`no email template for "${k}"`, k in api.REQUESTER_EMAILS, false));
eq('rejection tells them how to reverse it',
   api.REQUESTER_EMAILS.rejected.body.includes('change the decision'), true);

// ---------------------------------------------------------------------------
console.log('\n-- backfill safety --');
eq('backfill filters to Approved before processing',
   /if \(!approvedRow\(row\)\) continue;/.test(src), true);
eq('backfill honours the Final Approval override too',
   /effectiveDecision_\(grid\[row - 2\], cols\)/.test(src), true);

// ---------------------------------------------------------------------------
console.log('\n-- Final Approval outranks Lead Approval --');
// Column indices for a sheet with both approval columns.
const AC = { approval: 9, finalApproval: 10 };
const rowWith = (lead, final) => { const v = []; v[9] = lead; v[10] = final; return v; };
const dec = (lead, final) => api.effectiveDecision_(rowWith(lead, final), AC);

// The stated rule: Final Approval done -> Lead Approval automatically approved.
let d = dec('', 'Approved');
eq('blank lead + final Approved -> Approved', d.decision, 'Approved');
eq('  ...sourced from final', d.source, 'final');
eq('  ...cascades into the lead cell', d.cascade, true);

d = dec('Re-verify', 'Approved');
eq('lead Re-verify is overridden by final Approved', d.decision, 'Approved');
eq('  ...cascades', d.cascade, true);

d = dec('Rejected', 'Approved');
eq('lead Rejected is overridden by final Approved', d.decision, 'Approved');

// A final rejection must outrank a lead approval, or an overruled request ships.
d = dec('Approved', 'Rejected');
eq('lead Approved + final Rejected -> Rejected', d.decision, 'Rejected');
eq('  ...sourced from final', d.source, 'final');

// Already in agreement: no pointless write back to the sheet.
d = dec('Approved', 'Approved');
eq('both Approved -> no cascade write', d.cascade, false);
eq('  ...still Approved', d.decision, 'Approved');

// Final Approval blank or unrecognised: the lead governs.
d = dec('Approved', '');
eq('blank final -> lead governs', d.decision, 'Approved');
eq('  ...source is lead', d.source, 'lead');
eq('  ...no cascade', d.cascade, false);
d = dec('Re-verify', '');
eq('lead Re-verify survives a blank final', d.decision, 'Re-verify');
d = dec('Re-verify', 'Something else');
eq('unrecognised final value -> lead governs', d.decision, 'Re-verify');
// Re-verify in the final column does NOT cascade -- only Approved and Rejected.
d = dec('Approved', 'Re-verify');
eq('final Re-verify does not override', d.decision, 'Approved');
eq('  ...source stays lead', d.source, 'lead');

console.log('   feature is optional:');
d = api.effectiveDecision_(rowWith('Approved', 'Rejected'), { approval: 9 });
eq('no Final Approval column -> lead governs', d.decision, 'Approved');
eq('  ...no cascade', d.cascade, false);
api.CFG.finalApprovalOverrides = false;
d = dec('Approved', 'Rejected');
eq('overrides disabled -> lead governs', d.decision, 'Approved');
api.CFG.finalApprovalOverrides = true;

console.log('   ticket records the override:');
const viaFinal = api.buildNotes_(g({ item: 'Widget' }), route, { source: 'final' });
eq('notes mention Final Approval', viaFinal.includes('Approved via Final Approval'), true);
const viaLead = api.buildNotes_(g({ item: 'Widget' }), route, { source: 'lead' });
eq('normal approval says nothing extra', viaLead.includes('Approved via Final Approval'), false);

// ---------------------------------------------------------------------------
console.log('\n-- late rejection: point of no return --');
// Final Approval is often filled well after Lead Approval, so a rejection can
// land on a request that has already been ordered or delivered.
eq('Ordered is past the point of no return', api.isPastPointOfNoReturn_('Ordered'), true);
eq('Handed Over is past it', api.isPastPointOfNoReturn_('Handed Over'), true);
eq('  ...case-insensitively', api.isPastPointOfNoReturn_('handed over'), true);
eq('Pending is not', api.isPastPointOfNoReturn_('Pending'), false);
eq('Quotation Awaited is not', api.isPastPointOfNoReturn_('Quotation Awaited'), false);
eq('Rework is not', api.isPastPointOfNoReturn_('Rework'), false);
eq('Cancelled is not', api.isPastPointOfNoReturn_('Cancelled'), false);
eq('blank is not', api.isPastPointOfNoReturn_(''), false);

// The gate and the point of no return happen to coincide today, but they are
// separate concepts -- assert they are configured separately, not aliased.
eq('pointOfNoReturn is its own config key',
   Array.isArray(api.CFG.pointOfNoReturn) && api.CFG.pointOfNoReturn !== api.CFG.priceRequiredFor,
   true);
eq('every pointOfNoReturn entry is a real status',
   api.CFG.pointOfNoReturn.every((s) => api.isKnownStatus_(s)), true);

console.log('   the reject path checks it before cancelling:');
eq('reject branch consults isPastPointOfNoReturn_',
   /isDecision_\(decision, 'reject'\)[\s\S]{0,900}isPastPointOfNoReturn_\(current\)/.test(src), true);
eq('reverify branch consults it too',
   /isDecision_\(decision, 'reverify'\)[\s\S]{0,900}isPastPointOfNoReturn_\(current\)/.test(src), true);
eq('a past-the-line rejection escalates by email',
   /isPastPointOfNoReturn_\(current\)[\s\S]{0,700}notifyFailure_/.test(src), true);
eq('the comment names which column was changed',
   src.includes("approval.source === 'final' ? 'Final Approval' : 'Lead Approval'"), true);

// ---------------------------------------------------------------------------
console.log('\n-- Final Approval is optional: it usually is not filled --');
// Lead Approval is always filled; Final Approval only sometimes. So a blank,
// missing or junk Final Approval must never block or alter anything.
const WITH_FINAL = { approval: 9, finalApproval: 10 };
const NO_FINAL_COL = { approval: 9 };
const mkRow = (lead, fin) => { const v = []; v[9] = lead; v[10] = fin; return v; };

['Approved', 'Rejected', 'Re-verify'].forEach((lead) => {
  const blank = api.effectiveDecision_(mkRow(lead, ''), WITH_FINAL);
  eq(`blank final: lead ${lead.padEnd(10)} still governs`, blank.decision, lead);
  eq(`  ...no cascade write`, blank.cascade, false);

  const absent = api.effectiveDecision_(mkRow(lead, undefined), NO_FINAL_COL);
  eq(`no final column: lead ${lead.padEnd(10)} still governs`, absent.decision, lead);
});

// Values that are neither Approved nor Rejected must not hijack the decision.
['   ', '-', 'N/A', 'Pending', 'TBD', '0'].forEach((junk) => {
  const d = api.effectiveDecision_(mkRow('Approved', junk), WITH_FINAL);
  eq(`junk final ${JSON.stringify(junk).padEnd(11)} -> lead governs`, d.decision, 'Approved');
  eq(`  ...source stays lead`, d.source, 'lead');
});

eq('Final Approval is never a required column',
   api.REQUIRED_FIELDS.includes('finalApproval'), false);
let noFinalErr = '';
try { api.assertRequiredFields_({ fields: { status: 3, price: 12, productType: 2, item: 4 } }); }
catch (e) { noFinalErr = e.message; }
eq('an unmapped Final Approval does not throw', noFinalErr, '');

console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll assertions passed.');
process.exit(fail ? 1 : 0);
