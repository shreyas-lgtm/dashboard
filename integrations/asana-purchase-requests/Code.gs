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
  approvalHeaders: ['Lead Approval', 'Lead approval', 'Approval Decision', 'Column 9'],

  // The three values on the Lead Approval dropdown. Anything else is ignored.
  decisions: {
    approve: 'Approved',
    reject: 'Rejected',
    reverify: 'Re-verify',
  },

  // Final Approval outranks Lead Approval: once it is decided, Lead Approval is
  // set to match automatically. This lets a senior approve directly without the
  // team lead having got to it.
  //
  // Optional -- if the sheet has no such column the whole mechanism is skipped.
  finalApprovalHeaders: ['Final Approval'],
  finalApprovalOverrides: true,

  // Written back to the sheet. Created automatically if absent.
  taskUrlHeader: 'Asana Task',
  taskGidHeader: 'Asana Task GID', // the sync key; do not delete or reorder

  // ---- Status -------------------------------------------------------------
  // These become the board sections, in this order. ensureSections() creates
  // any that are missing.
  statuses: [
    'Pending',
    'Quotation Awaited',
    'Ordered',
    'Handed Over',
    'Rework',
    'Cancelled',
  ],
  initialStatus: 'Pending',

  // Where a ticket goes when a decision is revised after it exists.
  rejectedStatus: 'Cancelled',
  reverifyStatus: 'Rework',

  // Statuses past which a late rejection cannot simply cancel the request --
  // money is committed or the goods are already with the requester. Final
  // Approval is often filled well after Lead Approval, so this is reachable.
  // The card is left where it is and flagged for a human instead.
  pointOfNoReturn: ['Ordered', 'Handed Over'],

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
  // description. Price is deliberately absent: it is never entered in Asana,
  // only in the responses sheet.
  customFieldGids: {
    prId: '',
    productType: '',
    urgency: '',
    vendor: '',
  },

  // ---- Comment sync -------------------------------------------------------
  // Asana comments are mirrored into a sheet column, newest first. One-way:
  // comments written in the sheet are not pushed to Asana.
  //
  // The whole log is rebuilt from Asana each time rather than appended to, so
  // there is no "last seen comment" state to get out of step -- and an edited or
  // deleted comment in Asana corrects itself in the sheet.
  syncComments: true,
  commentsMaxCount: 20, // most recent N
  commentsMaxChars: 5000, // a cell holds 50k; stay well clear

  // ---- PR_ID generation ---------------------------------------------------
  // The old form's PR_IDs were static values written at submit time, not a
  // formula: they track submission order rather than row position (so they
  // survived the sheet being sorted) and they contain gaps, which a
  // position- or rank-based formula cannot produce.
  //
  // A counter in Script Properties reproduces that behaviour and is immune to
  // sorting and row deletion -- a PR_ID quoted on a PO stays valid forever.
  prIdPrefix: 'PR',
  prIdStartFrom: 1527, // highest on the old form; the next issued is 1528
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
  // Asana comment log, synced back from Asana. Auto-created if missing.
  comments: ['Asana Comments', 'SCM Remark', 'Remarks'],
  // Optional; stamped when the status reaches Ordered / Handed Over.
  orderedDate: ['Ordered Date'],
  handedOverDate: ['Handed Over Date', 'Handover Date'],
};

// Columns the script creates if the sheet does not already have them.
const AUTO_CREATE = ['status', 'comments'];

// Fields the integration cannot function without. Missing means a silent
// half-failure -- an unmapped price blocks every ticket at Quotation Awaited,
// an unmapped productType routes everything to the default owner -- so these
// are checked before any work is done.
const REQUIRED_FIELDS = ['price', 'productType', 'item'];

/** Cell -> trimmed string. Numeric 0 must not read as blank. */
function cellText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// ---------------------------------------------------------------------------
// PR_ID, assigned on submission
// ---------------------------------------------------------------------------

/**
 * Installable onFormSubmit handler. Does two jobs, because Google fires this
 * trigger both for a new response and for a response the requester later edits.
 *
 *   New response  -> assign the next PR_ID
 *   Edited response -> push the revised details onto the existing Asana card
 *
 * A row that already carries a PR_ID is by definition not new. That is the whole
 * detection mechanism: an edited response updates its row in place, so the
 * PR_ID is still sitting there from the first submission.
 *
 * A stored counter rather than a formula, because this sheet gets sorted and rows
 * get deleted -- both of which silently renumber a formula. An issued PR_ID must
 * never change.
 */
function onFormSubmitHandler(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== CFG.sheetName) return;

  const row = e.range.getRow();
  if (row < 2) return;

  const cols = resolveColumns_(sheet);
  const idx = cols.fields.prId;
  if (idx === undefined) {
    notifyFailure_(
      'Purchase Request: cannot assign PR_ID',
      'No PR_ID column found on "' + CFG.sheetName + '". Tried: ' + COL.prId.join(' | ')
    );
    return;
  }

  const cell = sheet.getRange(row, idx + 1);
  if (!cellText_(cell.getValue())) {
    cell.setValue(nextPrId_()); // a genuinely new request
    return;
  }

  // Already has a PR_ID, so this is an edit of an existing response.
  try {
    handleEditedResponse_(sheet, row, cols);
  } catch (err) {
    console.error('Could not apply edited response on row ' + row + ': ' + err.message);
    notifyFailure_(
      'Purchase Request: edited response could not be applied',
      'Row ' + row + ' of "' + CFG.sheetName + '" was edited by the requester, but the ' +
        'Asana card could not be updated.\n\n' + err.message
    );
  }
}

/** Kept so that re-running setupTrigger() removes a trigger installed under the old name. */
function onFormSubmitAssignPrId(e) {
  onFormSubmitHandler(e);
}

/**
 * The requester changed their request after submitting it. Push the new details
 * onto the card so procurement is not working from a stale spec.
 */
function handleEditedResponse_(sheet, row, cols) {
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const gid = cellText_(values[cols.taskGid]);

  const status = cols.fields.status === undefined
    ? ''
    : cellText_(values[cols.fields.status]);

  const action = editedResponseAction_(status, !!gid);
  if (action === 'none') return; // not approved yet: the eventual card picks up the new values

  const get = function (key) {
    const idx = cols.fields[key];
    return idx === undefined ? '' : cellText_(values[idx]);
  };

  const prId = get('prId');
  const item = get('item') || '(no item description)';
  const route = routeFor_(get);

  // Refresh name and description. Asana keeps the previous version in the task's
  // own activity history, so nothing is lost by overwriting.
  asanaFetch_('PUT', '/tasks/' + gid, {
    data: {
      name: prId ? prId + ' · ' + item : item,
      notes: buildNotes_(get, route),
    },
  });

  if (action === 'escalate') {
    addComment_(gid,
      '⚠ The requester edited this request AFTER it reached "' + status + '". The ' +
      'details above are the new version.\n\nThe order was placed against the ' +
      'earlier specification -- check whether it still matches what is needed.');
    notifyFailure_(
      'Purchase request edited after it was ' + status,
      'Row ' + row + ' of "' + CFG.sheetName + '" (' + (prId || item) + ') was edited by ' +
        'the requester after reaching "' + status + '".\n\nThe Asana card description has ' +
        'been refreshed, but the order was placed against the earlier spec and needs a ' +
        'human check.'
    );
    return;
  }

  addComment_(gid,
    'The requester edited this request after it was created. The details above have ' +
    'been updated to the new version.');
}

/**
 * What to do about an edited response.
 *
 *   none     -- no card yet, so nothing to correct
 *   update   -- refresh the card and note the change
 *   escalate -- refresh it, but the order is already placed, so alert a human
 */
function editedResponseAction_(status, hasTask) {
  if (!hasTask) return 'none';
  return isPastPointOfNoReturn_(status) ? 'escalate' : 'update';
}

/**
 * Next PR_ID, e.g. "PR-2026-1528". Serialised so two submissions landing at the
 * same moment cannot collide on the counter.
 */
function nextPrId_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const current = parseInt(props.getProperty('PR_ID_COUNTER'), 10);
    const next = (isNaN(current) ? CFG.prIdStartFrom : current) + 1;
    props.setProperty('PR_ID_COUNTER', String(next));
    return CFG.prIdPrefix + '-' + new Date().getFullYear() + '-' + next;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sets the counter by hand. Pass the highest PR number already issued -- the
 * next request gets that plus one.
 *
 *   seedPrIdCounter(1527)   // next issued is PR-2026-1528
 */
function seedPrIdCounter(highestIssued) {
  const n = parseInt(highestIssued, 10);
  if (isNaN(n)) throw new Error('Pass a number, e.g. seedPrIdCounter(1527).');

  PropertiesService.getScriptProperties().setProperty('PR_ID_COUNTER', String(n));
  console.log('Counter set to %s. Next PR_ID issued: %s-%s-%s',
    n, CFG.prIdPrefix, new Date().getFullYear(), n + 1);
}

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

  // Either approval column can start this off, since Final Approval cascades
  // into Lead Approval.
  const firstCol = e.range.getColumn();
  const lastCol = e.range.getLastColumn();
  const touched = function (idx) {
    return idx !== undefined && idx + 1 >= firstCol && idx + 1 <= lastCol;
  };
  if (!touched(cols.approval) && !touched(cols.finalApproval)) return;

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
 * Acts on the Lead Approval decision for one row.
 *
 *   Approved   -> create the ticket (or reinstate one previously cancelled)
 *   Rejected   -> cancel the ticket if it exists, and tell the requester
 *   Re-verify  -> send the ticket back to Rework, and tell the requester
 *
 * Any other value, including blank, is ignored. Returns the task URL when one was
 * created, otherwise null.
 */
function processRow_(sheet, row, cols) {
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

  const approval = effectiveDecision_(values, cols);
  const decision = approval.decision;
  if (!decision) return null;

  // Write the cascade back so the sheet is self-consistent and anything
  // filtering on Lead Approval keeps working. A script write does not re-fire
  // onEdit, so there is no loop.
  if (approval.cascade) {
    sheet.getRange(row, cols.approval + 1).setValue(decision);
    values[cols.approval] = decision;
  }

  const url = cellText_(values[cols.taskUrl]);
  const gid = cellText_(values[cols.taskGid]);
  const hasTask = !!gid && url.indexOf('ERROR') !== 0;

  if (isDecision_(decision, 'approve')) {
    // Idempotency guard: a task already present means this row is done, except
    // that a previously cancelled ticket has to come back to life.
    if (hasTask) {
      reinstateIfCancelled_(sheet, row, cols, gid);
      return null;
    }

    const task = createAsanaTask_(values, cols, approval);
    sheet.getRange(row, cols.taskUrl + 1).setValue(task.url);
    sheet.getRange(row, cols.taskGid + 1).setValue(task.gid);

    // Seed the status so the sheet and the board agree from the outset.
    if (cols.fields.status !== undefined && !cellText_(values[cols.fields.status])) {
      sheet.getRange(row, cols.fields.status + 1).setValue(CFG.initialStatus);
    }
    return task.url;
  }

  if (isDecision_(decision, 'reject')) {
    notifyRequester_('rejected', values, cols);
    if (!hasTask) return null;

    const current = cols.fields.status === undefined
      ? ''
      : cellText_(values[cols.fields.status]);
    const which = approval.source === 'final' ? 'Final Approval' : 'Lead Approval';

    // Past Ordered the request cannot just be cancelled -- money is committed or
    // the goods are already delivered. Leave the card alone and escalate.
    if (isPastPointOfNoReturn_(current)) {
      addComment_(gid,
        '⚠ ' + which + ' was changed to "Rejected", but this request is already at "' +
        current + '".\n\nIt has NOT been cancelled automatically, because the order ' +
        'is placed or the item is already with the requester. Decide by hand ' +
        'whether it can be returned or cancelled with the vendor.');
      notifyFailure_(
        'Purchase Request rejected after it was already ' + current,
        which + ' was set to "Rejected" on a request already at "' + current + '".\n\n' +
          'Row ' + row + ' of "' + CFG.sheetName + '". The Asana card was left as is ' +
          'and needs a human decision on returning or cancelling with the vendor.'
      );
      return null;
    }

    moveTaskToStatus_(sheet, row, cols, gid, CFG.rejectedStatus,
      which + ' was changed to "Rejected" on the responses sheet, so this request ' +
      'is cancelled. Do not order it.');
    return null;
  }

  if (isDecision_(decision, 'reverify')) {
    notifyRequester_('reverify', values, cols);
    if (!hasTask) return null;

    const current = cols.fields.status === undefined
      ? ''
      : cellText_(values[cols.fields.status]);

    // Sending an already-ordered item back to Rework would misrepresent it as
    // pending when it is not.
    if (isPastPointOfNoReturn_(current)) {
      addComment_(gid,
        '⚠ Approval was changed to "Re-verify", but this request is already at "' +
        current + '", so it has been left where it is. The requester has been asked ' +
        'to confirm the details.');
      return null;
    }

    moveTaskToStatus_(sheet, row, cols, gid, CFG.reverifyStatus,
      'Approval was changed to "Re-verify" on the responses sheet. The requester ' +
      'has been asked to confirm the details; hold until they reply.');
    return null;
  }

  return null;
}

/** True when a cell value matches one of CFG.decisions. */
function isDecision_(value, key) {
  return cellText_(value).toLowerCase() === String(CFG.decisions[key]).trim().toLowerCase();
}

/**
 * Resolves the decision that actually governs a row.
 *
 * Final Approval outranks Lead Approval: once Final Approval is decided, Lead
 * Approval is treated as matching it and gets written to match. So a senior can
 * approve directly and the request proceeds without the team lead acting.
 *
 * Returns { decision, source: 'lead' | 'final', cascade: boolean }.
 */
function effectiveDecision_(values, cols) {
  const lead = cellText_(values[cols.approval]);

  if (!CFG.finalApprovalOverrides || cols.finalApproval === undefined) {
    return { decision: lead, source: 'lead', cascade: false };
  }

  const final = cellText_(values[cols.finalApproval]);
  if (!final) return { decision: lead, source: 'lead', cascade: false };

  // Only Approved and Rejected cascade. A final rejection has to outrank a lead
  // approval too, otherwise an overruled request would still get ordered.
  let resolved = '';
  if (isDecision_(final, 'approve')) resolved = CFG.decisions.approve;
  else if (isDecision_(final, 'reject')) resolved = CFG.decisions.reject;

  if (!resolved) return { decision: lead, source: 'lead', cascade: false };

  return {
    decision: resolved,
    source: 'final',
    cascade: !sameStatus_(lead, resolved), // only write when it differs
  };
}

/**
 * Moves an existing task to a named status, updates the sheet, and comments.
 * Used when the lead revises a decision after the ticket already exists.
 */
function moveTaskToStatus_(sheet, row, cols, taskGid, status, comment) {
  try {
    const sections = sectionsByName_();
    const sectionGid = sections[String(status).toLowerCase()];
    if (sectionGid) {
      asanaFetch_('POST', '/sections/' + sectionGid + '/addTask', { data: { task: taskGid } });
    } else {
      console.warn('No "' + status + '" section on the board; run ensureSections().');
    }
    if (comment) addComment_(taskGid, comment);

    if (cols.fields.status !== undefined) {
      sheet.getRange(row, cols.fields.status + 1).setValue(status);
    }
  } catch (err) {
    console.error('Could not move task ' + taskGid + ' to ' + status + ': ' + err.message);
    throw err;
  }
}

/**
 * Brings a cancelled ticket back to Pending when the lead re-approves. Without
 * this, flipping Rejected -> Approved would leave the card stranded in Cancelled
 * with nothing to signal that it is live again.
 */
function reinstateIfCancelled_(sheet, row, cols, taskGid) {
  const current = cols.fields.status === undefined
    ? ''
    : cellText_(sheet.getRange(row, cols.fields.status + 1).getValue());

  if (!sameStatus_(current, CFG.rejectedStatus)) return;

  moveTaskToStatus_(sheet, row, cols, taskGid, CFG.initialStatus,
    'Lead Approval was set back to "Approved", so this request is live again.');
}

function createAsanaTask_(values, cols, approval) {
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
      notes: buildNotes_(get, route, approval),
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

  // Requesters are deliberately NOT added as followers. Asana is the procurement
  // team's board; requesters never get a seat, and are reached by email instead
  // (see notifyRequester_).

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
function buildNotes_(get, route, approval) {
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
  if (approval && approval.source === 'final') {
    out += '\nApproved via Final Approval; Lead Approval was set to match.';
  }
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
    assertRequiredFields_(cols);

    const rowByGid = indexRowsByGid_(sheet, cols);
    if (!Object.keys(rowByGid).length) return;

    // One read for the whole grid, rather than a round trip per row.
    const lastRow = sheet.getLastRow();
    const grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const rowValues = function (row) { return grid[row - 2] || []; };

    const sections = sectionsByName_();
    const tasks = fetchProjectTasks_();

    // Comments are only refetched for tasks that changed since the last run --
    // one extra API call per task, so doing it for all of them every ten minutes
    // would be wasteful. The cutoff is rolled back a few minutes so a change
    // landing mid-run is not missed.
    const props = PropertiesService.getScriptProperties();
    const runStartedAt = new Date().toISOString();
    const lastSync = props.getProperty('LAST_SYNC_AT');
    const cutoff = lastSync
      ? new Date(new Date(lastSync).getTime() - 5 * 60 * 1000).toISOString()
      : '';

    let synced = 0;
    let blocked = 0;
    let commentsUpdated = 0;
    const unknownSections = {};

    tasks.forEach(function (task) {
      const row = rowByGid[task.gid];
      if (!row) return; // a task created by hand in Asana; nothing to sync to

      // Comments first: they are worth syncing even when the status has not moved.
      if (CFG.syncComments && cols.fields.comments !== undefined) {
        const changed = !cutoff || !task.modified_at || task.modified_at > cutoff;
        if (changed && syncCommentsForRow_(sheet, row, cols, task, rowValues(row))) {
          commentsUpdated++;
        }
      }

      const asanaStatus = sectionNameFor_(task);
      if (!asanaStatus) return;

      // Never write a section name we do not recognise into the sheet. Someone
      // adding an "On Hold" column in Asana must not pollute Order Status.
      if (!isKnownStatus_(asanaStatus)) {
        unknownSections[asanaStatus] = (unknownSections[asanaStatus] || 0) + 1;
        return;
      }

      const values = rowValues(row);
      const sheetStatus = cellText_(values[cols.fields.status]);
      if (sameStatus_(asanaStatus, sheetStatus)) return;

      // Price is only ever entered in the responses sheet, never in Asana.
      const price = cellText_(values[cols.fields.price]);
      if (needsPrice_(asanaStatus) && !price) {
        revertStatus_(task, sheetStatus, sections, asanaStatus);
        blocked++;
        return;
      }

      sheet.getRange(row, cols.fields.status + 1).setValue(asanaStatus);
      stampStatusDate_(sheet, row, cols, asanaStatus);

      // Rework means the requester has to recheck the request -- and requesters
      // are not in Asana, so email is the only way to reach them.
      if (sameStatus_(asanaStatus, 'Rework')) {
        notifyRequester_('rework', values, cols);
      }

      synced++;
    });

    if (synced || blocked || commentsUpdated) {
      console.log(
        'Synced %s status change(s), %s comment log(s); blocked %s for a missing price.',
        synced, commentsUpdated, blocked
      );
    }

    // Advanced only on a clean run, so a failure re-examines the same window
    // rather than skipping over it.
    props.setProperty('LAST_SYNC_AT', runStartedAt);

    const strays = Object.keys(unknownSections);
    if (strays.length) {
      const detail = strays
        .map(function (s) { return '"' + s + '" (' + unknownSections[s] + ' task(s))'; })
        .join(', ');
      console.warn('Ignored unrecognised section(s): %s', detail);
      notifyFailure_(
        'Purchase Request -> Asana: unrecognised board section',
        'These board sections are not in CFG.statuses, so tasks sitting in them are ' +
          'not being synced:\n\n  ' + detail + '\n\nEither rename the section to one of: ' +
          CFG.statuses.join(', ') + '\nor add it to CFG.statuses.'
      );
    }
  } finally {
    lock.releaseLock();
  }
}

/** True when the request has progressed too far to be cancelled automatically. */
function isPastPointOfNoReturn_(status) {
  const s = cellText_(status).toLowerCase();
  return CFG.pointOfNoReturn.some(function (v) { return v.toLowerCase() === s; });
}

/** True when the name matches one of the configured statuses. */
function isKnownStatus_(name) {
  const s = cellText_(name).toLowerCase();
  return CFG.statuses.some(function (v) { return v.toLowerCase() === s; });
}

/**
 * Stops with a clear message when a field the integration depends on is not
 * mapped. Without this the failure is silent and looks like partial success.
 */
function assertRequiredFields_(cols) {
  if (cols.fields.status === undefined) {
    throw new Error('No status column on the sheet, and it could not be created.');
  }

  const missing = REQUIRED_FIELDS.filter(function (k) { return cols.fields[k] === undefined; });
  if (missing.length) {
    throw new Error(
      'These required columns are not mapped: ' + missing.join(', ') +
        '. Run checkSheetMapping() and add the real header names to the front of ' +
        'those entries in COL. Until then: an unmapped price blocks every ticket ' +
        'at Quotation Awaited, and an unmapped productType routes everything to ' +
        CFG.routingDefault.assign + '.'
    );
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
 *
 * When the sheet has no usable status we comment but do NOT move the card.
 * Guessing would drag a ticket that has legitimately progressed back to Pending.
 */
function revertStatus_(task, sheetStatus, sections, attempted) {
  const known = sheetStatus && isKnownStatus_(sheetStatus) && sections[sheetStatus.toLowerCase()];

  if (known) {
    asanaFetch_('POST', '/sections/' + sections[sheetStatus.toLowerCase()] + '/addTask', {
      data: { task: task.gid },
    });
    addComment_(
      task.gid,
      'Moved back to "' + sheetStatus + '". The price has to be recorded on this ' +
        'request\'s row in the responses sheet before it can go to "' + attempted + '".\n\n' +
        'Add the price against this PR ID in the sheet, then move the card again.'
    );
    return;
  }

  addComment_(
    task.gid,
    'This cannot go to "' + attempted + '" until the price is recorded on this ' +
      'request\'s row in the responses sheet. Add the price against this PR ID, ' +
      'and the status will sync.\n\n' +
      '(Left where it is: the sheet has no recorded status to move it back to.)'
  );
}

/**
 * Rebuilds the comment log for one row from Asana. Returns true when the cell
 * actually changed.
 *
 * The full log is rebuilt rather than appended to: no "last seen" bookkeeping to
 * drift, and an edited or deleted comment in Asana corrects itself here.
 */
function syncCommentsForRow_(sheet, row, cols, task, values) {
  const log = formatComments_(fetchComments_(task.gid));
  const existing = cellText_(values[cols.fields.comments]);
  if (log === existing) return false;

  sheet.getRange(row, cols.fields.comments + 1).setValue(log);
  return true;
}

/** Real comments on a task, oldest first. System events are excluded. */
function fetchComments_(taskGid) {
  const stories = asanaFetchAll_(
    '/tasks/' + taskGid + '/stories?opt_fields=type,resource_subtype,text,created_at,created_by.name'
  );
  return stories.filter(function (s) {
    return s.type === 'comment' || s.resource_subtype === 'comment_added';
  });
}

/**
 * Newest first, one comment per line:
 *   [10/08 16:45] Abish: Quotation received, 6531
 */
function formatComments_(comments) {
  const lines = comments
    .slice()
    .reverse()
    .slice(0, CFG.commentsMaxCount)
    .map(function (c) {
      const who = (c.created_by && c.created_by.name) || 'Unknown';
      const when = c.created_at ? shortStamp_(c.created_at) : '';
      // Collapse newlines: one comment per line keeps the cell readable.
      const text = cellText_(c.text).replace(/\s*\n+\s*/g, ' / ');
      return '[' + when + '] ' + who + ': ' + text;
    });

  let out = lines.join('\n');
  if (out.length > CFG.commentsMaxChars) {
    out = out.slice(0, CFG.commentsMaxChars - 20).replace(/\n[^\n]*$/, '') + '\n…(truncated)';
  }
  return out;
}

/** ISO timestamp -> "10/08 16:45" in the script's timezone. */
function shortStamp_(iso) {
  try {
    return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), 'dd/MM HH:mm');
  } catch (err) {
    return String(iso).slice(0, 10);
  }
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
      '&opt_fields=gid,name,modified_at,memberships.project.gid,memberships.section.name'
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

/**
 * Emails the requester when something needs them to act.
 *
 * Requesters have no Asana access by design, so anything that requires them
 * would otherwise be invisible to the one person who can resolve it.
 *
 * Only states that need requester action are notified. Approved, Ordered and
 * Handed Over are deliberately silent -- the requester is already chasing
 * approval, and they find out about delivery by receiving the thing.
 */
const REQUESTER_EMAILS = {
  rework: {
    subject: 'Action needed: purchase request {label} sent back for rechecking',
    body:
      'Procurement has moved your purchase request to Rework, which means it needs ' +
      'another look from you.\n\nUsually this means something is unclear, ' +
      'unavailable, or needs a different specification. Please check the details ' +
      'and reply to procurement with the correction.',
  },
  reverify: {
    subject: 'Action needed: purchase request {label} needs re-verification',
    body:
      'Your lead has marked this request "Re-verify" rather than approving it, so ' +
      'they want something confirmed before it goes ahead.\n\nPlease check with ' +
      'your lead, update the details if needed, and ask them to set Lead Approval ' +
      'once they are satisfied. Nothing will be ordered until then.',
  },
  rejected: {
    subject: 'Purchase request {label} was not approved',
    body:
      'Your lead has marked this request "Rejected", so it will not be ordered.\n\n' +
      'If you think it should go ahead, speak to your lead -- if they change the ' +
      'decision on the sheet, the request picks up again automatically.',
  },
};

function notifyRequester_(kind, values, cols) {
  const template = REQUESTER_EMAILS[kind];
  if (!template) return;

  const email = cellText_(values[cols.fields.requester]);
  if (!email || email.indexOf('@') === -1) return;

  const prId = cols.fields.prId === undefined ? '' : cellText_(values[cols.fields.prId]);
  const item = cols.fields.item === undefined ? '' : cellText_(values[cols.fields.item]);
  const label = prId ? prId + ' (' + item + ')' : item || '(unnamed request)';

  const detail =
    (prId ? 'PR ID: ' + prId + '\n' : '') + (item ? 'Item:  ' + item + '\n' : '');

  try {
    MailApp.sendEmail(
      email,
      template.subject.replace('{label}', label),
      template.body + '\n\n' + detail
    );
  } catch (err) {
    console.warn('Could not email requester ' + email + ': ' + err.message);
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

  // Optional: absent means the Final Approval override is simply skipped.
  const finalApproval = findAny(CFG.finalApprovalHeaders);

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

  return {
    approval: approval,
    finalApproval: finalApproval,
    taskUrl: taskUrl,
    taskGid: taskGid,
    fields: fields,
  };
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

  console.log('Lead Approval:    %s', letter(cols.approval));
  console.log('Final Approval:   %s%s', letter(cols.finalApproval),
    cols.finalApproval === undefined ? '  (absent -- override disabled)' : '');
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

/**
 * Installs both sheet-side triggers, replacing any previous copies:
 *   onFormSubmitAssignPrId -- assigns the PR_ID on submission
 *   onApprovalEdit         -- creates the Asana task on approval
 */
function setupTrigger() {
  if (!CFG.workspaceGid || !CFG.projectGid) {
    throw new Error('Set CFG.workspaceGid and CFG.projectGid before installing triggers.');
  }

  const ss = SpreadsheetApp.getActive();
  const handlers = ['onApprovalEdit', 'onFormSubmitHandler', 'onFormSubmitAssignPrId'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onApprovalEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onFormSubmitHandler').forSpreadsheet(ss).onFormSubmit().create();

  console.log('Installed onEdit + onFormSubmit triggers on "%s".', ss.getName());
  console.log(
    'PR_ID counter is at %s. Run seedPrIdCounter(n) if that is wrong.',
    PropertiesService.getScriptProperties().getProperty('PR_ID_COUNTER') ||
      '(unset -- will start from ' + CFG.prIdStartFrom + ')'
  );
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

  // Only Approved rows. Handing the whole sheet to processRow_ would fire
  // rejection and re-verify emails at requesters over historical decisions.
  const grid = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const approvedRow = function (row) {
    const d = effectiveDecision_(grid[row - 2], cols);
    return isDecision_(d.decision, 'approve');
  };

  for (let row = 2; row <= lastRow && created < max; row++) {
    if (!approvedRow(row)) continue;
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
