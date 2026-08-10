/**
 * Purchase Request form -> Asana task
 *
 * Fires when the approval column (J) on the form-responses sheet is set to
 * "Approved", and creates a task in Asana. Writes the task URL back to the row,
 * which doubles as the guard against creating duplicates.
 *
 * Setup order is in README.md. Short version:
 *   1. Script Properties: ASANA_PAT = <your personal access token>
 *   2. Run testConnection()  -> confirms the token works
 *   3. Run discover()        -> logs the GIDs to paste into CFG below
 *   4. Fill in CFG.workspaceGid and CFG.projectGid
 *   5. Run setupTrigger()    -> installs the onEdit trigger
 *
 * Never hardcode the token here. It lives in Script Properties.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CFG = {
  // Filled in from discover() output.
  workspaceGid: '',
  projectGid: '',

  // The tab that the Google Form writes into.
  sheetName: 'Form responses 1',

  // Approval column, resolved by header name. 'Column 9' is the fallback for
  // as long as J1 is still blank -- rename J1 to 'Approval Decision' and the
  // primary name takes over with no code change.
  approvalHeader: 'Approval Decision',
  approvalHeaderFallback: 'Column 9',
  approvedValue: 'Approved',

  // Created automatically if absent.
  taskUrlHeader: 'Asana Task',

  // Asana user GID for the person who procures. Leave '' for unassigned.
  // discover() prints the GID for every user in the workspace.
  defaultAssigneeGid: '',

  // Where integration failures are emailed. Leave '' to disable.
  errorNotifyEmail: '',

  // Due date = approval date + N days, by Urgency Level prefix.
  dueDaysByUrgency: {
    Critical: 1,
    High: 3,
    Normal: 7,
    Planned: 30,
  },
  dueDaysDefault: 7,

  // Optional. Leave the GIDs empty and every field still appears in the task
  // description -- custom fields are an upgrade, not a requirement.
  customFieldGids: {
    prId: '',
    team: '',
    category: '',
    urgency: '',
    vendor: '',
    price: '',
  },
};

const ASANA_BASE = 'https://app.asana.com/api/1.0';

// Sheet columns read into the task, resolved by header name.
const COL = {
  timestamp: 'Timestamp',
  requester: 'Email address',
  item: 'Item Name/ Description',
  quantity: 'Quantity',
  partNumber: 'Part Number/ Model Number',
  link: 'Link',
  justification: 'Justification for Purchase',
  urgency: 'Urgency Level',
  team: 'Team',
  vendor: 'Preferred Vendor/ Source',
  prId: 'PR_ID',
  category: 'Product Main Category',
  price: 'Price (INR)',
};

// ---------------------------------------------------------------------------
// Trigger entry point
// ---------------------------------------------------------------------------

/**
 * Installable onEdit handler. Must be installable, not a simple trigger:
 * simple triggers cannot call external services, so they cannot reach Asana.
 *
 * Handles multi-cell edits, because approving by fill-down or paste hands over
 * a range rather than a single cell.
 */
function onApprovalEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== CFG.sheetName) return;

  const cols = resolveColumns_(sheet);
  const approvalCol = cols.approval + 1; // 1-based for Range comparisons

  // Did this edit touch the approval column at all?
  const firstCol = e.range.getColumn();
  const lastCol = e.range.getLastColumn();
  if (approvalCol < firstCol || approvalCol > lastCol) return;

  const firstRow = Math.max(e.range.getRow(), 2); // never the header
  const lastRow = e.range.getLastRow();
  if (lastRow < firstRow) return;

  // Serialise, so two people approving at once cannot double-create.
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
  const width = sheet.getLastColumn();
  const values = sheet.getRange(row, 1, 1, width).getValues()[0];

  const decision = String(values[cols.approval] || '').trim();
  if (decision.toLowerCase() !== CFG.approvedValue.toLowerCase()) return null;

  // Idempotency guard: a URL already present means this row is done.
  const existing = String(values[cols.taskUrl] || '').trim();
  if (existing && !existing.startsWith('ERROR')) return null;

  const url = createAsanaTask_(values, cols);
  sheet.getRange(row, cols.taskUrl + 1).setValue(url);
  return url;
}

// ---------------------------------------------------------------------------
// Asana
// ---------------------------------------------------------------------------

function createAsanaTask_(values, cols) {
  const get = (key) => {
    const idx = cols.fields[key];
    return idx === undefined ? '' : String(values[idx] === null ? '' : values[idx]).trim();
  };

  const prId = get('prId');
  const item = get('item') || '(no item description)';
  const name = prId ? prId + ' · ' + item : item;

  const payload = {
    data: {
      name: name,
      notes: buildNotes_(get),
      projects: [CFG.projectGid],
      due_on: dueDate_(get('urgency')),
    },
  };

  if (CFG.defaultAssigneeGid) payload.data.assignee = CFG.defaultAssigneeGid;

  const custom = buildCustomFields_(get);
  if (Object.keys(custom).length) payload.data.custom_fields = custom;

  const res = asanaFetch_(
    'POST',
    '/tasks?opt_fields=permalink_url,gid',
    payload
  );

  const task = res.data || {};

  // Best effort, in its own call: a requester who has no Asana account must not
  // fail the task creation.
  addFollowerByEmail_(task.gid, get('requester'));

  return task.permalink_url || (task.gid ? 'https://app.asana.com/0/0/' + task.gid : '');
}

function buildNotes_(get) {
  const rows = [
    ['PR ID', get('prId')],
    ['Requested by', get('requester')],
    ['Team', get('team')],
    ['Category', get('category')],
    ['Urgency', get('urgency')],
    ['Quantity', get('quantity')],
    ['Preferred vendor', get('vendor')],
    ['Part / model no.', get('partNumber')],
    ['Price (INR)', get('price')],
    ['Submitted', get('timestamp')],
  ].filter(function (r) { return r[1]; });

  const pad = Math.max.apply(null, rows.map(function (r) { return r[0].length; }));
  let out = rows
    .map(function (r) { return r[0] + ':' + ' '.repeat(pad - r[0].length + 2) + r[1]; })
    .join('\n');

  const justification = get('justification');
  if (justification) out += '\n\nJustification\n-------------\n' + justification;

  const link = get('link');
  if (link && link.toUpperCase() !== 'NA') out += '\n\nLink\n----\n' + link;

  out += '\n\n---\nCreated automatically from the Purchase Request form on approval.';
  return out;
}

function buildCustomFields_(get) {
  const map = {
    prId: get('prId'),
    team: get('team'),
    category: get('category'),
    urgency: get('urgency'),
    vendor: get('vendor'),
    price: get('price'),
  };
  const out = {};
  Object.keys(CFG.customFieldGids).forEach(function (key) {
    const gid = CFG.customFieldGids[key];
    if (gid && map[key]) out[gid] = map[key];
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

function addFollowerByEmail_(taskGid, email) {
  if (!taskGid || !email) return;
  try {
    const gid = lookupUserGid_(email);
    if (!gid) return;
    asanaFetch_('POST', '/tasks/' + taskGid + '/addFollowers', {
      data: { followers: [gid] },
    });
  } catch (err) {
    // Non-fatal by design.
    console.warn('Could not add follower ' + email + ': ' + err.message);
  }
}

/** Email -> user GID, cached for 6h to keep the edit handler responsive. */
function lookupUserGid_(email) {
  const key = 'asana_user_' + email.toLowerCase();
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return hit === 'none' ? '' : hit;

  const res = asanaFetch_(
    'GET',
    '/workspaces/' + CFG.workspaceGid + '/users?opt_fields=email,gid'
  );
  let found = '';
  (res.data || []).forEach(function (u) {
    if (u.email) {
      cache.put('asana_user_' + u.email.toLowerCase(), u.gid, 21600);
      if (u.email.toLowerCase() === email.toLowerCase()) found = u.gid;
    }
  });
  if (!found) cache.put(key, 'none', 21600);
  return found;
}

function asanaFetch_(method, path, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('ASANA_PAT');
  if (!token) {
    throw new Error('ASANA_PAT is not set in Script Properties.');
  }

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

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

/**
 * Maps header names to 0-based indices. First occurrence wins, which matters
 * because the sheet has three columns all named some case of "Lead Time".
 * Creates the task-URL column if it does not exist yet.
 */
function resolveColumns_(sheet) {
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];

  const byName = {};
  headers.forEach(function (h, i) {
    const key = String(h).trim();
    if (key && !(key in byName)) byName[key] = i;
  });

  let approval = byName[CFG.approvalHeader];
  if (approval === undefined) approval = byName[CFG.approvalHeaderFallback];
  if (approval === undefined) approval = 9; // column J
  if (approval === undefined) {
    throw new Error('Could not locate the approval column.');
  }

  let taskUrl = byName[CFG.taskUrlHeader];
  if (taskUrl === undefined) {
    taskUrl = width; // append
    sheet.getRange(1, taskUrl + 1).setValue(CFG.taskUrlHeader);
  }

  const fields = {};
  Object.keys(COL).forEach(function (key) {
    fields[key] = byName[COL[key]];
  });

  return { approval: approval, taskUrl: taskUrl, fields: fields };
}

function handleRowError_(sheet, row, cols, err) {
  const message = 'ERROR: ' + err.message;
  console.error('Row ' + row + ' -- ' + err.message);
  try {
    sheet.getRange(row, cols.taskUrl + 1).setValue(message);
  } catch (ignore) {}

  if (CFG.errorNotifyEmail) {
    try {
      MailApp.sendEmail(
        CFG.errorNotifyEmail,
        'Purchase Request -> Asana failed (row ' + row + ')',
        'Row ' + row + ' of "' + CFG.sheetName + '" could not be pushed to Asana.\n\n' +
          err.message +
          '\n\nThe row is marked in the "' + CFG.taskUrlHeader + '" column. Clear that ' +
          'cell and re-enter the approval to retry.'
      );
    } catch (ignore) {}
  }
}

// ---------------------------------------------------------------------------
// Setup helpers -- run these by hand from the editor
// ---------------------------------------------------------------------------

/** Step 2. Confirms the token is valid and shows who it belongs to. */
function testConnection() {
  const res = asanaFetch_('GET', '/users/me?opt_fields=name,email');
  const me = res.data || {};
  console.log('Token OK. Authenticated as %s <%s>', me.name, me.email);
  return me;
}

/**
 * Step 3. Logs every GID needed to fill in CFG: workspaces, projects, users,
 * and the custom fields on CFG.projectGid once that is set.
 */
function discover() {
  const me = asanaFetch_('GET', '/users/me?opt_fields=name,email,workspaces.name');
  const workspaces = (me.data && me.data.workspaces) || [];

  console.log('=== WORKSPACES ===');
  workspaces.forEach(function (w) {
    console.log('  %s   %s', w.gid, w.name);
  });

  const wsGid = CFG.workspaceGid || (workspaces[0] && workspaces[0].gid);
  if (!wsGid) {
    console.log('No workspace found. Stopping.');
    return;
  }
  if (!CFG.workspaceGid) {
    console.log('\n(using first workspace %s for the lists below)', wsGid);
  }

  console.log('\n=== PROJECTS in %s ===', wsGid);
  const projects = asanaFetch_(
    'GET',
    '/workspaces/' + wsGid + '/projects?opt_fields=name&limit=100'
  );
  (projects.data || []).forEach(function (p) {
    console.log('  %s   %s', p.gid, p.name);
  });

  console.log('\n=== USERS in %s  (for defaultAssigneeGid) ===', wsGid);
  const users = asanaFetch_(
    'GET',
    '/workspaces/' + wsGid + '/users?opt_fields=name,email&limit=100'
  );
  (users.data || []).forEach(function (u) {
    console.log('  %s   %s <%s>', u.gid, u.name, u.email || '-');
  });

  if (CFG.projectGid) {
    console.log('\n=== CUSTOM FIELDS on project %s ===', CFG.projectGid);
    const settings = asanaFetch_(
      'GET',
      '/projects/' + CFG.projectGid +
        '/custom_field_settings?opt_fields=custom_field.name,custom_field.gid,custom_field.resource_subtype'
    );
    const list = settings.data || [];
    if (!list.length) {
      console.log('  (none -- every field will appear in the task description instead)');
    }
    list.forEach(function (s) {
      const f = s.custom_field || {};
      console.log('  %s   %s  [%s]', f.gid, f.name, f.resource_subtype);
    });
  } else {
    console.log('\n(set CFG.projectGid, then re-run to list its custom fields)');
  }
}

/** Step 5. Installs the onEdit trigger, replacing any previous copy. */
function setupTrigger() {
  if (!CFG.workspaceGid || !CFG.projectGid) {
    throw new Error('Set CFG.workspaceGid and CFG.projectGid before installing the trigger.');
  }

  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onApprovalEdit') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onApprovalEdit').forSpreadsheet(ss).onEdit().create();
  console.log('Installed onEdit trigger on "%s".', ss.getName());
}

/**
 * Optional. Creates tasks for rows already marked Approved that have no task.
 * Off by default -- the whole backlog arriving at once buries the board.
 * Pass a limit to work through it in batches: backfillApproved(10)
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
