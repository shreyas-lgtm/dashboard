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
  src + '\nreturn { dueDate_, buildNotes_, buildCustomFields_, resolveColumns_, CFG };'
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
eq('all 10 label rows present', valueCols.length, 10);
eq('values align in one column', new Set(valueCols).size, 1);
eq('includes justification', notes.includes('Justification\n-------------\nBought for office use'), true);
eq('drops link when NA', notes.includes('Link\n----'), false);

const sparse = api.buildNotes_((k) => (k === 'item' ? 'Widget' : ''));
eq('omits blank rows', sparse.includes('Price'), false);
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

const renamed = HDR.slice(); renamed[9] = 'Approval Decision';
cols = api.resolveColumns_(fakeSheet(renamed));
eq('prefers Approval Decision once renamed', cols.approval, 9);

const withTask = HDR.concat(['Asana Task']);
cols = api.resolveColumns_(fakeSheet(withTask));
eq('reuses existing Asana Task column', cols.taskUrl, 31);

// J1 renamed AND moved, to prove name-based lookup beats the index fallback
const moved = ['Approval Decision'].concat(HDR.filter((_, i) => i !== 9));
cols = api.resolveColumns_(fakeSheet(moved));
eq('follows the header if the column moves', cols.approval, 0);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nAll assertions passed.');
process.exit(fail ? 1 : 0);
