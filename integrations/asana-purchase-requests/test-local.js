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
  src + '\nreturn { dueDate_, buildNotes_, buildCustomFields_, resolveColumns_, routeFor_, CFG };'
)();

let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got:  ${got}\n        want: ${want}`}`);
};
const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); };

console.log('-- due dates --');
eq('Critical -> +1d',  api.dueDate_('Critical (Required within 24 hours)'), days(1));
eq('High -> +3d',      api.dueDate_('High (Needed within 2–3 day)'), days(3));
eq('Normal -> +7d',    api.dueDate_('Normal ( Need within a week)'), days(7));
eq('Planned -> +30d',  api.dueDate_('Planned (Part of future project / inventory stock)'), days(30));
eq('blank -> default', api.dueDate_(''), days(7));
eq('unknown -> default', api.dueDate_('Whenever'), days(7));
eq('reworded parenthetical', api.dueDate_('Critical (within 12 hours)'), days(1));

console.log('\n-- notes --');
const row = {
  prId: 'PR-2026-1524', requester: 'syed@origin.tech',
  item: 'TATA Coffee Machine Consumables', team: 'Brewer Enterprise',
  category: 'General & Administrative', urgency: 'Critical (Required within 24 hours)',
  quantity: 'Milk (72 LTR) Sugar (5Kg)', vendor: 'Brewer Enterprise',
  partNumber: 'INV 2923', price: '6,531', timestamp: '10/08/2026 16:15:25',
  justification: 'Bought for office use', link: 'NA',
};
const notes = api.buildNotes_((k) => row[k] || '');
console.log(notes.split('\n').map(l => '   | ' + l).join('\n'));
const valueCols = notes.split('\n').filter(l => /^[A-Za-z].*?:\s{2,}\S/.test(l))
  .map(l => l.match(/^(.*?:\s+)/)[1].length);
eq('all 6 aligned label rows present', valueCols.length, 6);
eq('values align in one column', new Set(valueCols).size, 1);
eq('includes justification', notes.includes('Justification\n-------------\nBought for office use'), true);
eq('drops link when NA', notes.includes('Link\n----'), false);

const sparse = api.buildNotes_((k) => (k === 'item' ? 'Widget' : ''));
eq('omits blank rows', sparse.includes('Preferred vendor'), false);
eq('survives all-empty row', sparse.includes('Created automatically'), true);
eq('keeps a real link', api.buildNotes_((k) => (k === 'link' ? 'https://robu.in/x' : '')).includes('https://robu.in/x'), true);

console.log('\n-- custom fields --');
eq('empty by default', Object.keys(api.buildCustomFields_((k)=>row[k]||'')).length, 0);
api.CFG.customFieldGids.prId = '111'; api.CFG.customFieldGids.team = '222';
eq('maps configured GIDs',
   JSON.stringify(api.buildCustomFields_((k) => row[k] || '')),
   JSON.stringify({'111':'PR-2026-1524','222':'Brewer Enterprise'}));
api.CFG.customFieldGids.price = '333';
eq('skips blank values', '333' in api.buildCustomFields_((k)=> k==='price' ? '' : (row[k]||'')), false);

console.log('\n-- column resolution (real 31-column header row) --');
const HDR = ['Timestamp','Email address','Item Name/ Description','Order Status','Quantity','Estimate','Part Number/ Model Number','Link','Justification for Purchase','Column 9','Final Approval','Urgency Level','Team','Preferred Vendor/ Source','PR_ID','Attachment','Product Main Category','Lead Time ','Price (INR)','Item Type','Lead time','Lead Time','Delivery Date','ETA','/.','Order ID','Utilized /Non - Utilized','Approval Date','Ordered Date','SCM Remark ','Projection Needed'];
function fakeSheet(headers) {
  const h = headers.slice();
  return {
    written: [],
    getLastColumn: () => h.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => [h.slice(c - 1, c - 1 + (nc || 1))],
      setValue: (v) => { h[c - 1] = v; },
    }),
    _headers: () => h,
  };
}
let s = fakeSheet(HDR);
let cols = api.resolveColumns_(s);
eq('finds Column 9 fallback at index 9', cols.approval, 9);
eq('appends Asana Task column at 31', cols.taskUrl, 31);
eq('header actually written', s._headers()[31], 'Asana Task');
eq('maps PR_ID', cols.fields.prId, 14);
eq('maps Price (INR)', cols.fields.price, 18);
eq('dup Lead Time -> first wins', HDR.indexOf('Lead time'), 20);

const renamed = HDR.slice(); renamed[9] = 'Lead approval';
cols = api.resolveColumns_(fakeSheet(renamed));
eq('finds "Lead approval" (the real J1 name)', cols.approval, 9);

// Casing and stray spaces must not matter -- J1 is typed by hand.
['Lead Approval', 'lead approval', 'LEAD APPROVAL', '  Lead approval  '].forEach((variant) => {
  const h = HDR.slice(); h[9] = variant;
  eq('case/space tolerant: ' + JSON.stringify(variant),
     api.resolveColumns_(fakeSheet(h)).approval, 9);
});

// "Lead approval" must win even while the old placeholder still exists elsewhere.
const both = HDR.slice(); both[9] = 'Lead approval'; both[10] = 'Column 9';
eq('prefers Lead approval over a stray Column 9', api.resolveColumns_(fakeSheet(both)).approval, 9);

const withTask = HDR.concat(['Asana Task']);
cols = api.resolveColumns_(fakeSheet(withTask));
eq('reuses existing Asana Task column', cols.taskUrl, 31);

// Renamed AND moved, to prove the lookup is by name and not by position.
const moved = ['Lead approval'].concat(HDR.filter((_, i) => i !== 9));
eq('follows the header if the column moves', api.resolveColumns_(fakeSheet(moved)).approval, 0);

// An unrecognised header must fail loudly, not silently read column J.
const unknown = HDR.slice(); unknown[9] = 'Sign off';
let threw = '';
try { api.resolveColumns_(fakeSheet(unknown)); } catch (err) { threw = err.message; }
eq('throws when no known header matches', threw.startsWith('Could not find the approval column'), true);
eq('error names the expected headers', threw.includes('Lead approval'), true);
eq('error dumps the actual header row', threw.includes('Sign off'), true);

console.log('\n-- routing --');
const g = (o) => (k) => o[k] || '';
const r1 = api.routeFor_(g({ itemType: 'Fabrication', category: 'Direct Product COGS' }));
eq('Fabrication -> kiran', r1.assign, 'kiran@origin.tech');
const r2 = api.routeFor_(g({ itemType: '', category: 'General & Administrative' }));
eq('G&A -> syed', r2.assign, 'syed@origin.tech');
const r3 = api.routeFor_(g({ itemType: '', category: 'Direct Product COGS' }));
eq('COGS -> abish (default)', r3.assign, 'abish@origin.tech');
const r4 = api.routeFor_(g({ itemType: '', category: 'R & D' }));
eq('R&D -> abish (default)', r4.assign, 'abish@origin.tech');
const r5 = api.routeFor_(g({ itemType: '', category: '' }));
eq('all blank -> abish (default)', r5.assign, 'abish@origin.tech');

// Precedence: Fabrication must beat G&A, per the stated rule order.
const r6 = api.routeFor_(g({ itemType: 'Fabrication', category: 'General & Administrative' }));
eq('Fabrication beats G&A', r6.assign, 'kiran@origin.tech');

// Tolerances on hand-typed cells.
eq('lowercase fabrication', api.routeFor_(g({ itemType: 'fabrication' })).assign, 'kiran@origin.tech');
eq('fabrication with suffix', api.routeFor_(g({ itemType: 'Fabrication (sheet metal)' })).assign, 'kiran@origin.tech');
eq('padded fabrication', api.routeFor_(g({ itemType: '  Fabrication  ' })).assign, 'kiran@origin.tech');
eq('"General & Admin" short form', api.routeFor_(g({ category: 'General & Admin' })).assign, 'syed@origin.tech');
eq('"general and administrative" lc', api.routeFor_(g({ category: 'general & administrative' })).assign, 'syed@origin.tech');
// Must NOT match on a substring that merely contains the word.
eq('"Not General" does not match', api.routeFor_(g({ category: 'Not General' })).assign, 'abish@origin.tech');
eq('itemType "Off the shelf (OTS)" -> default', api.routeFor_(g({ itemType: 'Off the shelf (OTS)' })).assign, 'abish@origin.tech');

// The routing decision is recorded in the ticket for auditability.
const routed = api.buildNotes_(g({ item: 'Widget', requester: 'a@origin.tech' }), r1);
eq('notes record the route', routed.includes('Routed to kiran@origin.tech'), true);
eq('notes record the reason', routed.includes('Item Type = Fabrication'), true);
const warned = api.buildNotes_(g({ item: 'Widget' }), { assign: 'x@origin.tech', label: 'l', warning: 'no such user' });
eq('notes surface an unroutable owner', warned.includes('⚠ no such user'), true);

// Distribution across the real 78 rows, as a sanity check on the rules.
const REAL = [
  ...Array(40).fill({ category: 'Direct Product COGS' }),
  ...Array(22).fill({ category: 'R & D' }),
  ...Array(12).fill({ category: 'General & Administrative' }),
  ...Array(4).fill({ category: 'Field Operations' }),
];
const tally = {};
REAL.forEach((row) => {
  const who = api.routeFor_(g(row)).assign.split('@')[0];
  tally[who] = (tally[who] || 0) + 1;
});
eq('78 rows accounted for', Object.values(tally).reduce((a, b) => a + b, 0), 78);
eq('syed gets the 12 G&A rows', tally.syed, 12);
eq('abish gets the other 66', tally.abish, 66);
eq('kiran gets none (Item Type is empty on all 78)', tally.kiran, undefined);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll assertions passed.');
process.exit(fail ? 1 : 0);
