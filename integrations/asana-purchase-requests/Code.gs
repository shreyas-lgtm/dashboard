/**
 * Purchase Request form <-> Asana
 *
 * Two halves:
 *
 *   1. Sheet -> Asana. When the approval column is set to "Approved", create a
 *      task in Asana, route it to the right procurement owner, and drop it in
 *      the "Pending" section. The task URL and GID are written back to the row;
 *      the URL doubles as the guard against creating duplicates.
 *
 *   2. Asana -> Sheet. A polling trigger reads each task's board section and
 *      writes that status back to the sheet. Moves into a price-gated status
 *      are reverted when no price is recorded.
 *
 * Status lives in the board sections and nowhere else. A second copy of the same
 * fact is how this sheet ended up with both "Column 9" and "Final Approval"
 * disagreeing with each other.
 *
 * Setup order is in README.md. Never hardcode the token here -- it lives in
 * Script Properties as ASANA_PAT.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CFG = {
  // Filled in from discover() output.
  workspaceGid: '',
  projectGid: '',

  // The tab the Google Form writes into. Check this against the NEW form's
  // responses sheet -- a fresh form usually also starts at "Form responses 1".
  sheetName: 'Form responses 1',

  // Accepted names for the approval column, highest priority first. Matching is
  // case-insensitive and ignores surrounding spaces.
  //
  // If none match, the script fails loudly rather than guessing at a column
  // position -- reading the wrong column would create tasks off unrelated data.
  approvalHeaders: ['Lead approval', 'Approval Decision', 'Column 9'],
  approvedValue: 'Approved',

  // Written back to the sheet. Created automatically if absent.
  taskUrlHeader: 'Asana Task',
  taskGidHeader: 'Asana Task GID', // the sync key; do not delete or reorder

  // ---- Status -------------------------------------------------------------
  // These become the board sections, in this order. ensureSections() creates
  // any that are missing.
  statuses: ['Pending', 'Quotation Awaited', 'Ordered', 'Handed Over', 'Rework'],
  initialStatus: 'Pending',

  // Moving a task into one of these without a price is reverted.
  priceRequiredFor: ['Ordered', 'Handed Over'],

  // ---- Routing ------------------------------------------------------------
  // First matching rule wins. Matching is case-insensitive on the START of the
  // cell value, so "Mechanical - OTS" and "Mechanical - Custom" both match
  // "mechanical".
  //
  // Google Forms writes the free text a requester types into "Other:" straight
  // into the cell, so an unrecognised value falls through to routingDefault.
  routingRules: [
    {
      field: 'productType',
      startsWith: 'mechanical',
      assign: 'kiran@origin.tech',
      label: 'Product type = Mechanical',
    },
    {
      field: 'productType',
      startsWith: 'electrical',
      assign: 'abish@origin.tech',
      label: 'Product type = Electrical',
    },
    {
      field: 'productType',
      startsWith: 'office supplies',
      assign: 'syed@origin.tech',
      label: 'Product type = Office supplies',
    },
  ],
  routingDefault: {
    assign: 'abish@origin.tech',
    label: 'unclassified "Other" -- default route',
  },

  // Where integration failures are emailed. Leave '' to disable.
  errorNotifyEmail: '',

  // Due date = approval date + N days, by Urgency Level prefix.
  dueDaysByUrgency: { Critical: 1, High: 3, Normal: 7, Planned: 30 },
  dueDaysDefault: 7,

  // Optional. With no GIDs set, every field still renders into the task
  // description. If you DO create a price custom field in Asana and set its GID
  // here, procurement can enter the price on the ticket and the sync copies it
  // into the sheet -- which is what satisfies the price gate.
  customFieldGids: {
    prId: '',
    productType: '',
    urgency: '',
    vendor: '',
    price: '',
  },
};

const ASANA_BASE = 'https://app.asana.com/api/1.0';

/**
 * Sheet columns, each with candidate header names in priority order. The new
 * form's headers go first, the old form's are kept as fallbacks so this works
 * against either sheet.
 *
 * Run checkSheetMapping() after building the new form to see exactly which of
 * these resolved and which did not.
 */
const COL = {
  timestamp: ['Timestamp'],
  requester: ['Email address', 'Email Address', 'Requester Name'],
  item: ['Item Name/ Description', 'Item Name/Description', 'Item Name', 'Item Description'],
  quantity: ['Quantity', 'Qty'],
  partNumber: ['Part Number/ Model Number', 'Part Number/Model Number', 'Part Number', 'Model Number'],
  link: ['Link'],
  justification: ['Justification for Purchase', 'Justification', 'Purpose'],
  urgency: ['Urgency Level', 'Urgency'],
  vendor: ['Preferred Vendor/ Source', 'Preferred Vendor/Source', 'Preferred Vendor', 'Vendor'],
  prId: ['PR_ID', 'PR ID'],
  price: ['Price (INR)', 'Price', 'Final Price', 'Price INR'],
  // The routing key on the new form.
  productType: ['Product type', 'Product Type', 'Item Type', 'Product Main Category'],
  // Status, synced back from Asana. Auto-created if missing.
  status: ['Order Status', 'Status'],
  // Optional; stamped when the status reaches Ordered / Handed Over.
  orderedDate: ['Ordered Date'],
  handedOverDate: ['Handed Over Date', 'Handover Date'],
};

// Columns the script creates if the sheet does not already have them.
const AUTO_CREATE = ['status'];

// ---------------------------------------------------------------------------
// Half 1: sheet -> Asana, on approval
// ---------------------------------------------------------------------------

/**
 * Installable onEdit handler. Must be installable, not simple: simple triggers
 * cannot call external services, so they cannot reach Asana.
 *
 * Handles multi-cell edits, because approving by fill-down or paste hands over a
 * range rather than a single cell.
 */
function onApprovalEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== CFG.sheetName) return;

  let cols;
  try {
    cols = resolveColumns_(sheet);
  } catch (err) {
    notifyFailure_('Purchase Request -> Asana: cannot read the sheet headers', err.message);
    throw err;
  }

  const approvalCol = cols.approval + 1; // 1-based, to compare against the Range
  if (approvalCol < e.range.getColumn() || approvalCol > e.range.getLastColumn()) return;

  const firstRow = Math.max(e.range.getRow(), 2); // never the header
  const lastRow = e.range.getLastRow();
  if (lastRow < firstRow) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    for (let row = firstRow; row <= lastRow; row++) {
      try {
        processRow_(sheet, row, cols);
      } catch (err) {
        handleRowError_(sheet, row, cols, err);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates the Asana task for one row, if it is approved and has no task yet.
 * Returns the task URL, or null when the row was skipped.
 */
function processRow_(sheet, row, cols) {
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

  const decision = String(values[cols.approval] || '').trim();
  if (decision.toLowerCase() !== CFG.approvedValue.toLowerCase()) return null;

  // Idempotency guard: a URL already present means this row is done.
  const existing = String(values[cols.taskUrl] || '').trim();
  if (existing && existing.indexOf('ERROR') !== 0) return null;

  const task = createAsanaTask_(values, cols);

  sheet.getRange(row, cols.taskUrl + 1).setValue(task.url);
  sheet.getRange(row, cols.taskGid + 1).setValue(task.gid);

  // Seed the status so the sheet and the board agree from the outset.
  if (cols.fields.status !== undefined && !String(values[cols.fields.status] || '').trim()) {
    sheet.getRange(row, cols.fields.status + 1).setValue(CFG.initialStatus);
  }

  return task.url;
}

function createAsanaTask_(values, cols) {
  const get = function (key) {
    const idx = cols.fields[key];
    return idx === undefined ? '' : String(values[idx] === null ? '' : values[idx]).trim();
  };

  const prId = get('prId');
  const item = get('item') || '(no item description)';
  const name = prId ? prId + ' · ' + item : item;

  const route = routeFor_(get);

  // An unroutable owner must not lose the task: create it unassigned, say so in
  // the description, and alert. Silently unassigned is how tickets go missing.
  let assigneeGid = '';
  if (route.assign) {
    assigneeGid = lookupUserGid_(route.assign);
    if (!assigneeGid) {
      route.warning =
        'Could not match ' + route.assign + ' to an Asana user in this workspace. ' +
        'Assign this task by hand, then run verifyRouting().';
      notifyFailure_(
        'Purchase Request -> Asana: unroutable owner',
        route.warning + '\n\nTask: ' + name
      );
    }
  }

  const payload = {
    data: {
      name: name,
      notes: buildNotes_(get, route),
      projects: [CFG.projectGid],
      due_on: dueDate_(get('urgency')),
    },
  };
  if (assigneeGid) payload.data.assignee = assigneeGid;

  const custom = buildCustomFields_(get);
  if (Object.keys(custom).length) payload.data.custom_fields = custom;

  const res = asanaFetch_('POST', '/tasks?opt_fields=permalink_url,gid', payload);
  const task = res.data || {};

  // Section placement is a separate call: more reliable than passing memberships
  // on create, and a failure here must not lose the task.
  try {
    const sections = sectionsByName_();
    const gid = sections[CFG.initialStatus.toLowerCase()];
    if (gid) asanaFetch_('POST', '/sections/' + gid + '/addTask', { data: { task: task.gid } });
  } catch (err) {
    console.warn('Could not place task in "' + CFG.initialStatus + '": ' + err.message);
  }

  // Best effort, in its own call: a requester with no Asana account must not
  // fail the task creation.
  addFollowerByEmail_(task.gid, get('requester'));

  return {
    gid: task.gid,
    url: task.permalink_url || (task.gid ? 'https://app.asana.com/0/0/' + task.gid : ''),
  };
}

/**
 * The seven requested fields, plus justification for context. Link gets its own
 * block because some of these URLs run to several hundred characters and would
 * wreck the aligned column.
 */
function buildNotes_(get, route) {
  const rows = [
    ['Requester', get('requester')],
    ['Item', get('item')],
    ['Quantity', get('quantity')],
    ['Part / model no.', get('partNumber')],
    ['Product type', get('productType')],
    ['Urgency', get('urgency')],
    ['Preferred vendor', get('vendor')],
  ].filter(function (r) { return r[1]; });

  const pad = Math.max.apply(null, rows.map(function (r) { return r[0].length; }));
  let out = rows
    .map(function (r) { return r[0] + ':' + ' '.repeat(pad - r[0].length + 2) + r[1]; })
    .join('\n');

  const justification = get('justification');
  if (justification) out += '\n\nJustification\n-------------\n' + justification;

  const link = get('link');
  if (link && link.toUpperCase() !== 'NA') out += '\n\nLink\n----\n' + link;

  out += '\n\n---';
  if (route && route.warning) out += '\n⚠ ' + route.warning;
  if (route && route.label) out += '\nRouted to ' + route.assign + ' — ' + route.label + '.';
  out += '\nMove this card between sections to update its status; the sheet follows.';
  return out;
}

/**
 * Applies CFG.routingRules in order, falling back to CFG.routingDefault.
 * Returns { assign, label, warning? }.
 */
function routeFor_(get) {
  for (let i = 0; i < CFG.routingRules.length; i++) {
    const rule = CFG.routingRules[i];
    const value = String(get(rule.field) || '').trim().toLowerCase();
    if (value && value.indexOf(String(rule.startsWith).toLowerCase()) === 0) {
      return { assign: rule.assign, label: rule.label };
    }
  }
  return { assign: CFG.routingDefault.assign, label: CFG.routingDefault.label };
}

function buildCustomFields_(get) {
  const out = {};
  Object.keys(CFG.customFieldGids).forEach(function (key) {
    const gid = CFG.customFieldGids[key];
    const value = get(key);
    if (gid && value) out[gid] = value;
  });
  return out;
}

/** Approval date + urgency allowance, as yyyy-MM-dd. */
function dueDate_(urgency) {
  const label = String(urgency || '').trim();
  let days = CFG.dueDaysDefault;
  for (const prefix in CFG.dueDaysByUrgency) {
    if (label.indexOf(prefix) === 0) {
      days = CFG.dueDaysByUrgency[prefix];
      break;
    }
  }
  const d = new Date();
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// Half 2: Asana -> sheet, on a timer
// ---------------------------------------------------------------------------

/**
 * Polling sync. Reads every task's board section and writes that status into the
 * sheet. Runs from a time-based trigger -- see setupSyncTrigger().
 *
 * Polling rather than webhooks: an Asana webhook needs a public HTTPS endpoint
 * and a handshake, which means an Apps Script Web App deployed to "anyone".
 * At ~19 tickets a week a ten-minute poll is cheaper and has far less to go
 * wrong.
 *
 * Assignees are never written by this function. Procurement reassigning tickets
 * among themselves in Asana is expected, and must not be undone.
 */
function syncStatusesFromAsana() {
  if (!CFG.projectGid) throw new Error('Set CFG.projectGid first.');

  const sheet = SpreadsheetApp.getActive().getSheetByName(CFG.sheetName);
  if (!sheet) throw new Error('No sheet named "' + CFG.sheetName + '".');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    const cols = resolveColumns_(sheet);
    if (cols.fields.status === undefined) {
      throw new Error('No status column on the sheet, and it could not be created.');
    }

    const rowByGid = indexRowsByGid_(sheet, cols);
    if (!Object.keys(rowByGid).length) return;

    const sections = sectionsByName_();
    const tasks = fetchProjectTasks_();

    let synced = 0;
    let blocked = 0;

    tasks.forEach(function (task) {
      const row = rowByGid[task.gid];
      if (!row) return; // a task created by hand in Asana; nothing to sync to

      const asanaStatus = sectionNameFor_(task);
      if (!asanaStatus) return;

      const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      const sheetStatus = String(values[cols.fields.status] || '').trim();
      if (sameStatus_(asanaStatus, sheetStatus)) return;

      // Let a price entered on the ticket flow into the sheet first, so that
      // procurement can satisfy the gate without leaving Asana.
      const priceWritten = syncPriceFromTask_(sheet, row, cols, task, values);
      const price = priceWritten || (cols.fields.price === undefined
        ? ''
        : String(values[cols.fields.price] || '').trim());

      if (needsPrice_(asanaStatus) && !price) {
        revertStatus_(task, sheetStatus, sections, asanaStatus);
        blocked++;
        return;
      }

      sheet.getRange(row, cols.fields.status + 1).setValue(asanaStatus);
      stampStatusDate_(sheet, row, cols, asanaStatus);
      synced++;
    });

    if (synced || blocked) {
      console.log('Synced %s status change(s); blocked %s for a missing price.', synced, blocked);
    }
  } finally {
    lock.releaseLock();
  }
}

/** True when a status may only be set once a price is recorded. */
function needsPrice_(status) {
  const s = String(status || '').trim().toLowerCase();
  return CFG.priceRequiredFor.some(function (p) { return p.toLowerCase() === s; });
}

function sameStatus_(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Puts the task back where the sheet says it belongs and explains why.
 *
 * No loop risk: after the move, Asana matches the sheet, so the next poll sees
 * no difference and says nothing further.
 */
function revertStatus_(task, sheetStatus, sections, attempted) {
  const target = sheetStatus && sections[sheetStatus.toLowerCase()]
    ? sheetStatus
    : CFG.initialStatus;
  const gid = sections[target.toLowerCase()];

  if (gid) {
    asanaFetch_('POST', '/sections/' + gid + '/addTask', { data: { task: task.gid } });
  }

  addComment_(
    task.gid,
    'Moved back to "' + target + '". A price has to be recorded before this can go to "' +
      attempted + '".\n\n' +
      'Add the price on the request row in the responses sheet' +
      (CFG.customFieldGids.price ? ', or in the price field on this task' : '') +
      ', then move the card again.'
  );
}

/**
 * Copies a price entered on the Asana task into the sheet. Returns the value
 * written, or '' when there was nothing to copy.
 */
function syncPriceFromTask_(sheet, row, cols, task, values) {
  const gid = CFG.customFieldGids.price;
  if (!gid || cols.fields.price === undefined) return '';
  if (String(values[cols.fields.price] || '').trim()) return ''; // sheet already has one

  const field = (task.custom_fields || []).filter(function (f) { return f.gid === gid; })[0];
  const value = field ? String(field.display_value || '').trim() : '';
  if (!value) return '';

  sheet.getRange(row, cols.fields.price + 1).setValue(value);
  return value;
}

/** Stamps the matching date column, when the sheet has one and it is empty. */
function stampStatusDate_(sheet, row, cols, status) {
  const map = { ordered: 'orderedDate', 'handed over': 'handedOverDate' };
  const key = map[String(status).trim().toLowerCase()];
  if (!key) return;

  const idx = cols.fields[key];
  if (idx === undefined) return;
  if (String(sheet.getRange(row, idx + 1).getValue() || '').trim()) return;

  sheet
    .getRange(row, idx + 1)
    .setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'));
}

/** Builds { taskGid: rowNumber } from the sheet's GID column. */
function indexRowsByGid_(sheet, cols) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const gids = sheet.getRange(2, cols.taskGid + 1, lastRow - 1, 1).getValues();
  const out = {};
  gids.forEach(function (r, i) {
    const gid = String(r[0] || '').trim();
    if (gid) out[gid] = i + 2;
  });
  return out;
}

/** The task's section within our project. */
function sectionNameFor_(task) {
  const memberships = task.memberships || [];
  for (let i = 0; i < memberships.length; i++) {
    const m = memberships[i];
    if (m.project && m.project.gid === CFG.projectGid && m.section && m.section.name) {
      return String(m.section.name).trim();
    }
  }
  return '';
}

function fetchProjectTasks_() {
  return asanaFetchAll_(
    '/tasks?project=' + CFG.projectGid +
      '&opt_fields=gid,name,memberships.project.gid,memberships.section.name,' +
      'custom_fields.gid,custom_fields.display_value'
  );
}

/** { lowercased section name: gid } for the project. */
function sectionsByName_() {
  const cached = CacheService.getScriptCache().get('asana_sections_' + CFG.projectGid);
  if (cached) return JSON.parse(cached);

  const sections = asanaFetchAll_('/projects/' + CFG.projectGid + '/sections?opt_fields=name');
  const out = {};
  sections.forEach(function (s) {
    if (s.name) out[String(s.name).trim().toLowerCase()] = s.gid;
  });

  CacheService.getScriptCache().put(
    'asana_sections_' + CFG.projectGid,
    JSON.stringify(out),
    600
  );
  return out;
}

function addComment_(taskGid, text) {
  try {
    asanaFetch_('POST', '/tasks/' + taskGid + '/stories', { data: { text: text } });
  } catch (err) {
    console.warn('Could not comment on ' + taskGid + ': ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Asana transport
// ---------------------------------------------------------------------------

function asanaFetch_(method, path, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('ASANA_PAT');
  if (!token) throw new Error('ASANA_PAT is not set in Script Properties.');

  const options = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/json',
    muteHttpExceptions: true,
  };
  if (payload) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(ASANA_BASE + path, options);
  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code >= 300) {
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed.errors) {
        detail = parsed.errors.map(function (e) { return e.message; }).join('; ');
      }
    } catch (ignore) {}
    throw new Error('Asana ' + code + ' on ' + method + ' ' + path + ' -- ' + detail);
  }

  return JSON.parse(body);
}

/** GET that follows Asana's pagination. */
function asanaFetchAll_(path) {
  const out = [];
  let offset = '';

  do {
    const sep = path.indexOf('?') === -1 ? '?' : '&';
    const url = path + sep + 'limit=100' + (offset ? '&offset=' + offset : '');
    const res = asanaFetch_('GET', url);
    (res.data || []).forEach(function (d) { out.push(d); });
    offset = res.next_page && res.next_page.offset ? res.next_page.offset : '';
  } while (offset);

  return out;
}

function addFollowerByEmail_(taskGid, email) {
  if (!taskGid || !email) return;
  try {
    const gid = lookupUserGid_(email);
    if (!gid) return;
    asanaFetch_('POST', '/tasks/' + taskGid + '/addFollowers', { data: { followers: [gid] } });
  } catch (err) {
    console.warn('Could not add follower ' + email + ': ' + err.message);
  }
}

/** Email -> user GID, cached for 6h to keep the edit handler responsive. */
function lookupUserGid_(email) {
  const key = 'asana_user_' + email.toLowerCase();
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return hit === 'none' ? '' : hit;

  const users = asanaFetchAll_('/workspaces/' + CFG.workspaceGid + '/users?opt_fields=email');
  let found = '';
  users.forEach(function (u) {
    if (u.email) {
      cache.put('asana_user_' + u.email.toLowerCase(), u.gid, 21600);
      if (u.email.toLowerCase() === email.toLowerCase()) found = u.gid;
    }
  });
  if (!found) cache.put(key, 'none', 21600);
  return found;
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

/**
 * Maps header names to 0-based indices. Lookup is case-insensitive and ignores
 * surrounding spaces; first occurrence wins, which matters because the old sheet
 * had three columns all named some case of "Lead Time".
 *
 * Each COL entry lists candidate names in priority order, so this works against
 * both the new form's sheet and the old one.
 */
function resolveColumns_(sheet) {
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];

  const byName = {};
  headers.forEach(function (h, i) {
    const key = String(h).trim().toLowerCase();
    if (key && !(key in byName)) byName[key] = i;
  });
  const find = function (name) { return byName[String(name).trim().toLowerCase()]; };
  const findAny = function (names) {
    for (let i = 0; i < names.length; i++) {
      const idx = find(names[i]);
      if (idx !== undefined) return idx;
    }
    return undefined;
  };

  const approval = findAny(CFG.approvalHeaders);
  if (approval === undefined) {
    throw new Error(
      'Could not find the approval column. Expected one of: "' +
        CFG.approvalHeaders.join('", "') +
        '". Row 1 currently reads: ' +
        headers.map(function (h) { return String(h).trim(); })
          .filter(function (h) { return h; })
          .join(' | ') +
        '. Add the real header name to CFG.approvalHeaders.'
    );
  }

  // Appended in a fixed order so the GID column lands in the same place whether
  // one or both are missing.
  let nextCol = width;
  const ensure = function (header) {
    let idx = find(header);
    if (idx === undefined) {
      idx = nextCol++;
      sheet.getRange(1, idx + 1).setValue(header);
      byName[header.trim().toLowerCase()] = idx;
    }
    return idx;
  };

  const taskUrl = ensure(CFG.taskUrlHeader);
  const taskGid = ensure(CFG.taskGidHeader);

  const fields = {};
  Object.keys(COL).forEach(function (key) {
    let idx = findAny(COL[key]);
    if (idx === undefined && AUTO_CREATE.indexOf(key) !== -1) idx = ensure(COL[key][0]);
    fields[key] = idx;
  });

  return { approval: approval, taskUrl: taskUrl, taskGid: taskGid, fields: fields };
}

function handleRowError_(sheet, row, cols, err) {
  console.error('Row ' + row + ' -- ' + err.message);
  try {
    sheet.getRange(row, cols.taskUrl + 1).setValue('ERROR: ' + err.message);
  } catch (ignore) {}

  notifyFailure_(
    'Purchase Request -> Asana failed (row ' + row + ')',
    'Row ' + row + ' of "' + CFG.sheetName + '" could not be pushed to Asana.\n\n' +
      err.message +
      '\n\nThe row is marked in the "' + CFG.taskUrlHeader + '" column. Clear that ' +
      'cell and re-enter the approval to retry.'
  );
}

/** Emails CFG.errorNotifyEmail, if one is configured. Never throws. */
function notifyFailure_(subject, body) {
  if (!CFG.errorNotifyEmail) return;
  try {
    MailApp.sendEmail(CFG.errorNotifyEmail, subject, body);
  } catch (ignore) {}
}

// ---------------------------------------------------------------------------
// Setup helpers -- run these by hand from the editor
// ---------------------------------------------------------------------------

/** Confirms the token is valid and shows who it belongs to. */
function testConnection() {
  const me = asanaFetch_('GET', '/users/me?opt_fields=name,email').data || {};
  console.log('Token OK. Authenticated as %s <%s>', me.name, me.email);
  return me;
}

/** Logs every GID needed to fill in CFG. */
function discover() {
  const me = asanaFetch_('GET', '/users/me?opt_fields=name,email,workspaces.name');
  const workspaces = (me.data && me.data.workspaces) || [];

  console.log('=== WORKSPACES ===');
  workspaces.forEach(function (w) { console.log('  %s   %s', w.gid, w.name); });

  const wsGid = CFG.workspaceGid || (workspaces[0] && workspaces[0].gid);
  if (!wsGid) return console.log('No workspace found. Stopping.');
  if (!CFG.workspaceGid) console.log('\n(using first workspace %s below)', wsGid);

  console.log('\n=== PROJECTS ===');
  asanaFetchAll_('/workspaces/' + wsGid + '/projects?opt_fields=name').forEach(function (p) {
    console.log('  %s   %s', p.gid, p.name);
  });

  console.log('\n=== USERS ===');
  asanaFetchAll_('/workspaces/' + wsGid + '/users?opt_fields=name,email').forEach(function (u) {
    console.log('  %s   %s <%s>', u.gid, u.name, u.email || '-');
  });

  if (!CFG.projectGid) return console.log('\n(set CFG.projectGid, then re-run for sections)');

  console.log('\n=== SECTIONS on %s ===', CFG.projectGid);
  asanaFetchAll_('/projects/' + CFG.projectGid + '/sections?opt_fields=name').forEach(function (s) {
    console.log('  %s   %s', s.gid, s.name);
  });

  console.log('\n=== CUSTOM FIELDS on %s ===', CFG.projectGid);
  const settings = asanaFetchAll_(
    '/projects/' + CFG.projectGid +
      '/custom_field_settings?opt_fields=custom_field.name,custom_field.gid,custom_field.resource_subtype'
  );
  if (!settings.length) console.log('  (none -- fields render into the description instead)');
  settings.forEach(function (s) {
    const f = s.custom_field || {};
    console.log('  %s   %s  [%s]', f.gid, f.name, f.resource_subtype);
  });
}

/**
 * Creates any missing board sections so the project matches CFG.statuses.
 * Existing sections are left alone, including their order.
 */
function ensureSections() {
  if (!CFG.projectGid) throw new Error('Set CFG.projectGid first.');

  const existing = sectionsByName_();
  let created = 0;

  CFG.statuses.forEach(function (name) {
    if (existing[name.toLowerCase()]) {
      console.log('exists   %s', name);
      return;
    }
    asanaFetch_('POST', '/projects/' + CFG.projectGid + '/sections', { data: { name: name } });
    console.log('created  %s', name);
    created++;
  });

  CacheService.getScriptCache().remove('asana_sections_' + CFG.projectGid);
  console.log('\n%s section(s) created. Drag them into workflow order in Asana.', created);
}

/**
 * Confirms every routing target is a real Asana user. Run before go-live, and
 * again whenever someone joins or leaves procurement -- an address that does not
 * resolve produces unassigned tasks.
 */
function verifyRouting() {
  if (!CFG.workspaceGid) throw new Error('Set CFG.workspaceGid first.');

  const targets = CFG.routingRules
    .map(function (r) { return { email: r.assign, label: r.label }; })
    .concat([{ email: CFG.routingDefault.assign, label: CFG.routingDefault.label }]);

  let bad = 0;
  targets.forEach(function (t) {
    const gid = t.email ? lookupUserGid_(t.email) : '';
    if (gid) {
      console.log('OK    %s  ->  %s   (%s)', t.email, gid, t.label);
    } else {
      bad++;
      console.log('FAIL  %s  ->  no Asana user in this workspace   (%s)', t.email, t.label);
    }
  });

  console.log(
    bad
      ? '\n' + bad + ' target(s) will produce UNASSIGNED tasks. Invite them, or ' +
        'change the address in CFG.routingRules.'
      : '\nAll routing targets resolve.'
  );
  return bad === 0;
}

/**
 * Shows which sheet column each field resolved to. Run this after building the
 * new form -- it is the fastest way to spot a header this script cannot find.
 */
function checkSheetMapping() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CFG.sheetName);
  if (!sheet) throw new Error('No sheet named "' + CFG.sheetName + '".');

  const cols = resolveColumns_(sheet);
  const letter = function (i) {
    return i === undefined ? '--' : sheet.getRange(1, i + 1).getA1Notation().replace(/\d+/, '');
  };

  console.log('Approval column:  %s', letter(cols.approval));
  console.log('Task URL column:  %s', letter(cols.taskUrl));
  console.log('Task GID column:  %s', letter(cols.taskGid));
  console.log('\nField mapping:');

  const missing = [];
  Object.keys(COL).forEach(function (key) {
    const idx = cols.fields[key];
    if (idx === undefined) missing.push(key);
    console.log(
      '  %s  %-16s %s',
      idx === undefined ? 'MISSING' : 'col ' + letter(idx).padEnd(3),
      key,
      idx === undefined ? '(tried: ' + COL[key].join(' | ') + ')' : ''
    );
  });

  if (missing.length) {
    console.log(
      '\n%s field(s) unmapped: %s\nAdd the real header name to the front of that ' +
        'entry in COL. "price" and "productType" matter most -- price gates the ' +
        'Ordered and Handed Over statuses, productType drives routing.',
      missing.length,
      missing.join(', ')
    );
  } else {
    console.log('\nEvery field mapped.');
  }
  return missing;
}

/** Installs the onEdit trigger, replacing any previous copy. */
function setupTrigger() {
  if (!CFG.workspaceGid || !CFG.projectGid) {
    throw new Error('Set CFG.workspaceGid and CFG.projectGid before installing triggers.');
  }

  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onApprovalEdit') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onApprovalEdit').forSpreadsheet(ss).onEdit().create();
  console.log('Installed onEdit trigger on "%s".', ss.getName());
}

/** Installs the status-sync poll, replacing any previous copy. */
function setupSyncTrigger(minutes) {
  if (!CFG.projectGid) throw new Error('Set CFG.projectGid first.');

  const every = minutes || 10;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncStatusesFromAsana') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('syncStatusesFromAsana').timeBased().everyMinutes(every).create();
  console.log('Status sync will run every %s minutes.', every);
}

/**
 * Creates tasks for rows already marked Approved that have no task. Off by
 * default -- dropping the whole backlog onto a new board buries it. Run in
 * batches: backfillApproved(10)
 */
function backfillApproved(limit) {
  const max = limit || 10;
  const sheet = SpreadsheetApp.getActive().getSheetByName(CFG.sheetName);
  if (!sheet) throw new Error('No sheet named "' + CFG.sheetName + '".');

  const cols = resolveColumns_(sheet);
  const lastRow = sheet.getLastRow();
  let created = 0;

  for (let row = 2; row <= lastRow && created < max; row++) {
    try {
      const url = processRow_(sheet, row, cols);
      if (url) {
        created++;
        console.log('Row %s -> %s', row, url);
        Utilities.sleep(600); // stay well inside Asana's rate limit
      }
    } catch (err) {
      handleRowError_(sheet, row, cols, err);
    }
  }

  console.log('Created %s task(s). Re-run for the next batch.', created);
}
