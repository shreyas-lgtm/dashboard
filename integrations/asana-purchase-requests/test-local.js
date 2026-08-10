// Offline tests for the pure helpers in Code.gs -- no Asana credentials needed.
// The Apps Script globals are stubbed; anything that touches the network is not
// exercised here. Run with:  node integrations/asana-purchase-requests/test-local.js

global.Session = { getScriptTimeZone: () => 'Asia/Kolkata' };
global.Utilities = { formatDate: (d) => d.toISOString().slice(0, 10), sleep: () => {} };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'stub' }) };
global.UrlFetchApp = {}; global.SpreadsheetApp = {}; global.ScriptApp = {};
global.CacheService = {}; global.MailApp = {}; global.LockService = {};

const src = require('fs').readFileSync(__dirname + '/Code.gs', 'utf8');
// new Function keeps the script's declarations out of this module's scope.
const api = new Function(
  src + `\nreturn { dueDate_, buildNotes_, buildCustomFields_, resolveColumns_,
    routeFor_, needsPrice_, sameStatus_, sectionNameFor_, indexRowsByGid_, CFG, COL };`
)();

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
eq('maps Product type (routing key)', cols.fields.productType, 2);
eq('maps Price (gate key)', cols.fields.price, 12);
eq('maps requester', cols.fields.requester, 1);
eq('appends Asana Task', cols.taskUrl, 13);
eq('appends Asana Task GID', cols.taskGid, 14);
eq('auto-creates the status column', cols.fields.status, 15);
eq('status header written', s._headers()[15], 'Order Status');
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
eq('old sheet: reuses existing Order Status', cols.fields.status, 3);
eq('old sheet: productType falls back to Item Type', cols.fields.productType, 19);
eq('old sheet: maps Ordered Date', cols.fields.orderedDate, 28);

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
api.CFG.customFieldGids.price = '222';
eq('maps configured GIDs only',
   JSON.stringify(api.buildCustomFields_(g(row))), JSON.stringify({ '111': 'Electrical - OTS' }));
eq('skips a configured field with no value', '222' in api.buildCustomFields_(g(row)), false);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll assertions passed.');
process.exit(fail ? 1 : 0);
