const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const policy = require('../src/utils/localDataPolicy');

const STATE_KEY = 'date-storage-2.5.0';
const SIMPLE_TABLES = {
  local_purchase_entries: 'booking_date',
  local_manual_unsold_entries: 'booking_date',
  local_prize_results: 'result_for_date'
};
const DRAFT_TABLES = ['local_purchase_send_drafts', 'local_unsold_drafts', 'local_unsold_remove_drafts'];

function atomicJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function directory(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const stat = fs.lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe data directory: ${folder}`);
}

function createDateStorage(db, { desktop, userData }) {
  const root = path.join(desktop, 'Lottery Booking Data');
  const backupRoot = path.join(userData, 'recovery-2.5.0');
  let state;
  let lastSnapshot = '';
  const writtenDays = new Map();
  const readState = () => {
    const row = db.prepare('SELECT value FROM local_metadata WHERE key = ?').get(STATE_KEY);
    return row ? JSON.parse(row.value) : null;
  };
  const saveState = () => db.prepare(`INSERT INTO local_metadata (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(STATE_KEY, JSON.stringify(state), new Date().toISOString());
  const removed = (date) => policy.isRemoved(date, state.deletedDates);

  function checkRoot() {
    // Losing/moving the whole Desktop folder must NOT be treated as deleting every date.
    if (!fs.existsSync(root) || !fs.existsSync(path.join(root, '.lottery-data.json'))) {
      throw new Error(`Data folder missing. Restore ${root} before opening the app.`);
    }
    directory(root);
    const marker = JSON.parse(fs.readFileSync(path.join(root, '.lottery-data.json'), 'utf8'));
    if (marker.id !== state.id) throw new Error('Desktop data folder belongs to another installation.');
  }

  function queueDates(row) {
    const payload = JSON.parse(row.payload_json);
    const dates = policy.collectDates(payload);
    let uncertain = false;
    const inspectDates = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const field of ['bookingDate', 'booking_date', 'drawDate', 'resultForDate', 'result_for_date']) {
        if (Object.prototype.hasOwnProperty.call(value, field) && !policy.dateOnly(value[field])) uncertain = true;
      }
      Object.values(value).forEach((child) => { if (child && typeof child === 'object') inspectDates(child); });
    };
    inspectDates(payload);
    const body = payload.body || {};
    const ids = [...(Array.isArray(body.entryIds) ? body.entryIds : []), ...(Array.isArray(body.deletedEntryIds) ? body.deletedEntryIds : [])];
    if (body.entryId) ids.push(body.entryId);
    const match = /\/(?:pending-entries|received-entries|entries)\/(\d+)(?:\/|$)/.exec(payload.url || '');
    if (match) ids.push(match[1]);
    for (const id of ids) {
      const entry = db.prepare('SELECT booking_date FROM local_purchase_entries WHERE server_id = ? OR local_id = ?').get(id, String(id));
      if (entry && policy.dateOnly(entry.booking_date)) dates.push(policy.dateOnly(entry.booking_date));
      else uncertain = true;
    }
    if (/^\/prices(?:\/|$)/.test(payload.url || '')) {
      const prizeIds = Array.isArray(body.ids) ? [...body.ids] : [];
      const prizeMatch = /^\/prices\/(\d+)$/.exec(payload.url || '');
      if (prizeMatch) prizeIds.push(prizeMatch[1]);
      for (const id of prizeIds) {
        const prize = db.prepare('SELECT result_for_date FROM local_prize_results WHERE server_id = ? OR local_id = ?').get(id, String(id));
        if (prize && policy.dateOnly(prize.result_for_date)) dates.push(policy.dateOnly(prize.result_for_date));
        else uncertain = true;
      }
    }
    const result = [...new Set(dates)];
    result.uncertain = uncertain;
    return result;
  }

  function cleanup() {
    const report = { cutoff: policy.CUTOFF, deletedDates: state.deletedDates, removed: {}, review: [] };
    // Resolve queued IDs BEFORE deleting the rows they point to.
    for (const row of db.prepare('SELECT * FROM sync_queue').all()) {
      try {
        const dates = queueDates(row);
        if (dates.length && dates.every(removed) && !dates.uncertain) {
          db.prepare('DELETE FROM sync_queue WHERE local_id = ?').run(row.local_id);
          report.removed.sync_queue = (report.removed.sync_queue || 0) + 1;
        } else if (dates.some(removed) || dates.uncertain) {
          // A mixed-date operation can replace a whole memo. Do not replay a partial replacement.
          db.prepare("UPDATE sync_queue SET status = 'needs_review', last_error = ? WHERE local_id = ?")
            .run('Mixed selected dates; retained for recovery, not automatically replayed.', row.local_id);
          report.review.push(`sync_queue:${row.local_id}`);
        }
      } catch (_) {
        db.prepare("UPDATE sync_queue SET status = 'needs_review', last_error = ? WHERE local_id = ?")
          .run('Cannot safely determine the selected date; retained for review.', row.local_id);
        report.review.push(`sync_queue:${row.local_id}`);
      }
    }
    for (const [table, column] of Object.entries(SIMPLE_TABLES)) {
      report.removed[table] = db.prepare(`DELETE FROM ${table} WHERE retention_removed(${column}) = 1`).run().changes;
    }
    for (const table of DRAFT_TABLES) {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        try {
          const rows = JSON.parse(row.rows_json);
          if (!Array.isArray(rows)) throw new Error('Invalid draft');
          const kept = policy.cleanRows(rows, row.booking_date, state.deletedDates);
          if (!kept.length && (rows.length || removed(row.booking_date))) {
            db.prepare(`DELETE FROM ${table} WHERE local_id = ?`).run(row.local_id);
          } else if (kept.length !== rows.length) {
            db.prepare(`UPDATE ${table} SET rows_json = ? WHERE local_id = ?`).run(JSON.stringify(kept), row.local_id);
          }
          report.removed[table] = (report.removed[table] || 0) + rows.length - kept.length;
        } catch (_) { report.review.push(`${table}:${row.local_id}`); }
      }
    }
    for (const row of db.prepare('SELECT * FROM local_generated_bills').all()) {
      try {
        const filters = JSON.parse(row.filters_json);
        const from = policy.dateOnly(filters.fromDate || filters.date || filters.bookingDate);
        const to = policy.dateOnly(filters.toDate || filters.date || filters.bookingDate);
        // A bill is a derived cache, not an original entry. Invalidate overlapping totals.
        if (removed(from) || removed(to) || (from && to && state.deletedDates.some((date) => date >= from && date <= to))) {
          db.prepare('DELETE FROM local_generated_bills WHERE bill_key = ?').run(row.bill_key);
          report.removed.local_generated_bills = (report.removed.local_generated_bills || 0) + 1;
        }
      } catch (_) { report.review.push(`bill:${row.bill_key}`); }
    }
    for (const row of db.prepare('SELECT * FROM local_browser_storage').all()) {
      const cleaned = policy.cleanStorageValue(row.key, row.value, state.deletedDates);
      if (cleaned === null) db.prepare('DELETE FROM local_browser_storage WHERE key = ?').run(row.key);
      else if (cleaned !== row.value) db.prepare('UPDATE local_browser_storage SET value = ? WHERE key = ?').run(cleaned, row.key);
    }
    return report;
  }

  function snapshot() {
    checkRoot();
    const days = new Map();
    function add(date, kind, row) {
      const day = policy.dateOnly(date) || '_undated';
      if (removed(day)) return;
      if (!days.has(day)) days.set(day, {});
      const data = days.get(day);
      if (!data[kind]) data[kind] = [];
      data[kind].push(row);
    }
    for (const [table, column] of Object.entries(SIMPLE_TABLES)) {
      db.prepare(`SELECT * FROM ${table}`).all().forEach((row) => add(row[column], table, row));
    }
    for (const table of DRAFT_TABLES) {
      db.prepare(`SELECT * FROM ${table}`).all().forEach((row) => {
        try {
          JSON.parse(row.rows_json).forEach((item) => add(policy.selectedDate(item, row.booking_date), table,
            { ...row, rows_json: JSON.stringify([item]) }));
        } catch (_) { add('', table, row); }
      });
    }
    db.prepare('SELECT * FROM local_browser_storage').all().forEach(({ key, value }) => {
      try {
        const parsed = JSON.parse(value);
        const fallback = key.startsWith('lottery.localDraft:') ? key.split(':')[5] : policy.selectedDate(parsed);
        const rows = Array.isArray(parsed) ? parsed : parsed.rows || parsed.resultRows || [];
        if (Array.isArray(rows) && rows.length) {
          rows.forEach((row) => add(policy.selectedDate(row, fallback), 'browser_entries', { key, row }));
        }
      } catch (_) { add('', 'browser_unparsed', { key, value }); }
    });
    db.prepare('SELECT * FROM sync_queue').all().forEach((row) => {
      try {
        const dates = queueDates(row);
        add(dates.length === 1 ? dates[0] : '', 'sync_queue', row);
      } catch (_) { add('', 'sync_queue', row); }
    });
    db.prepare('SELECT * FROM local_generated_bills').all().forEach((row) => {
      try {
        const filters = JSON.parse(row.filters_json);
        add(filters.fromDate === filters.toDate ? filters.fromDate : '', 'generated_bills', row);
      } catch (_) { add('', 'generated_bills', row); }
    });
    const signature = JSON.stringify([...days]);
    if (signature === lastSnapshot) return;
    // Known empty dates retain an empty file; only the user removes date directories.
    for (const day of state.knownDates) {
      if (!removed(day) && !days.has(day)) days.set(day, {});
    }
    for (const [day, data] of days) {
      const folder = path.join(root, day);
      if (state.knownDates.includes(day) && !fs.existsSync(folder)) {
        throw new Error('A date folder was deleted while the app was running. Restart the app to apply deletion.');
      }
      directory(folder);
      const content = JSON.stringify(data);
      if (writtenDays.get(day) !== content) {
        atomicJson(path.join(folder, 'entries.json'), { selectedDate: day, data });
        writtenDays.set(day, content);
      }
    }
    state.knownDates = [...new Set([...state.knownDates, ...days.keys()].filter((day) => policy.dateOnly(day)))];
    saveState();
    lastSnapshot = signature;
  }

  async function initialize() {
    state = readState();
    if (!state) {
      directory(root);
      const markerPath = path.join(root, '.lottery-data.json');
      if (fs.readdirSync(root).length && !fs.existsSync(markerPath)) throw new Error(`Please rename the existing unrelated folder: ${root}`);
      const marker = fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath, 'utf8')) : { id: crypto.randomUUID() };
      state = { id: marker.id, knownDates: [], deletedDates: [], migrated: false };
      atomicJson(markerPath, { id: state.id });
      saveState();
    }
    checkRoot();
    directory(backupRoot);
    if (!state.migrated) {
      // SQLite backup API includes committed WAL data; copying only the .db would not.
      const target = path.join(backupRoot, 'before-cleanup.db');
      if (!fs.existsSync(target)) {
        const temp = `${target}.pending`;
        await db.backup(temp);
        fs.renameSync(temp, target);
      }
    }
    state.deletedDates = [...new Set([...state.deletedDates, ...state.knownDates.filter((day) => !fs.existsSync(path.join(root, day)))])];
    db.function('retention_removed', (date) => removed(date) ? 1 : 0);
    db.exec('CREATE TABLE IF NOT EXISTS local_browser_storage (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // Exact dry-run using a rollback, then execute the identical plan in a transaction.
    db.exec('BEGIN');
    let preview;
    try { preview = cleanup(); } finally { db.exec('ROLLBACK'); }
    atomicJson(path.join(backupRoot, 'cleanup-preview.json'), preview);
    const firstPreview = path.join(backupRoot, 'initial-cleanup-preview.json');
    if (!state.migrated && !fs.existsSync(firstPreview)) atomicJson(firstPreview, preview);
    db.transaction(() => {
      cleanup();
      state.migrated = true;
      saveState();
    })();
    for (const [table, column] of Object.entries(SIMPLE_TABLES)) {
      for (const operation of ['INSERT', 'UPDATE']) {
        db.exec(`CREATE TEMP TRIGGER retention_${table}_${operation} BEFORE ${operation} ON ${table}
          WHEN retention_removed(NEW.${column}) = 1 BEGIN SELECT RAISE(IGNORE); END`);
      }
    }
    const readme = path.join(root, 'READ-ME.txt');
    fs.writeFileSync(readme, 'Lottery Booking 2.5.0\r\nDate folders use the SELECTED booking/draw/result date, not the creation date.\r\nClose the app completely, then delete a YYYY-MM-DD folder to remove that date locally on next launch.\r\nThat date will stay excluded from local downloads. Do not delete/move this whole folder or its marker.\r\nentries.json is an automatically maintained view of local data; editing it does not edit entries.\r\n_undated contains records whose date cannot safely be determined; deleting it is not supported.\r\nServer records and original uploaded files are not deleted.\r\nInitial recovery backup: ' + backupRoot + '\r\n', 'utf8');
    snapshot();
  }

  function register(ipcMain) {
    ipcMain.handle('local-data:initialize-browser', (_event, values = {}) => {
      const managed = Object.fromEntries(Object.entries(values).filter(([key, value]) => policy.managedStorageKey(key) && typeof value === 'string'));
      const backup = path.join(backupRoot, 'before-cleanup-localStorage.json');
      if (!fs.existsSync(backup)) atomicJson(backup, managed);
      db.transaction(() => {
        for (const [key, raw] of Object.entries(managed)) {
          if (state.browserMigrated) continue; // Never overwrite durable data with stale browser copies.
          const cleaned = policy.cleanStorageValue(key, raw, state.deletedDates);
          if (cleaned === null) db.prepare('DELETE FROM local_browser_storage WHERE key = ?').run(key);
          else db.prepare('INSERT INTO local_browser_storage VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, cleaned);
        }
        state.browserMigrated = true;
        saveState();
      })();
      snapshot();
      const result = Object.fromEntries(db.prepare('SELECT key, value FROM local_browser_storage').all().map((row) => [row.key, row.value]));
      return { values: result, cutoff: policy.CUTOFF, deletedDates: state.deletedDates, folder: root };
    });
    // Synchronous bridge: booking/localStorage saves must reach the date folder before returning.
    ipcMain.on('local-data:save-browser', (event, { key, value }) => {
      try {
        if (!policy.managedStorageKey(key)) throw new Error('Unsupported storage key');
        const cleaned = value === null ? null : policy.cleanStorageValue(key, value, state.deletedDates);
        const prior = db.prepare('SELECT value FROM local_browser_storage WHERE key = ?').get(key)?.value;
        if (cleaned === null) db.prepare('DELETE FROM local_browser_storage WHERE key = ?').run(key);
        else db.prepare('INSERT INTO local_browser_storage VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, cleaned);
        // Changing a text input/filter must not re-export the entire purchase history.
        let changedEntries = prior !== cleaned;
        if (key.endsWith('.ui')) {
          try { changedEntries = JSON.stringify(JSON.parse(prior || '{}').resultRows || []) !== JSON.stringify(JSON.parse(cleaned || '{}').resultRows || []); }
          catch (_) { changedEntries = true; }
        }
        if (changedEntries) snapshot();
        event.returnValue = { value: cleaned };
      } catch (error) { event.returnValue = { error: error.message }; }
    });
  }

  // Existing IPC stays intact; maintenance runs after successful mutations, before sync reads.
  function wrap(ipcMain) {
    return { handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        const writes = /:(save-|clear-|upsert-|remove-|purge-|apply-|enqueue-|update-)/.test(channel);
        let result;
        if (writes) {
          db.transaction(() => { result = handler(event, ...args); cleanup(); })();
          snapshot();
        } else result = handler(event, ...args);
        return result;
      });
    } };
  }
  return { initialize, register, wrap };
}

module.exports = { createDateStorage };
