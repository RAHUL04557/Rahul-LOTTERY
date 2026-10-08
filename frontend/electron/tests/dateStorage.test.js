const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const appRoot = process.env.LOTTERY_TEST_APP_ASAR || path.resolve(__dirname, '../..');
const { createDateStorage } = require(path.join(appRoot, 'electron/dateStorage'));
const policy = require(path.join(appRoot, 'src/utils/localDataPolicy'));

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lottery-retention-test-'));
  const desktop = path.join(temp, 'Desktop');
  const userData = path.join(temp, 'userData');
  fs.mkdirSync(desktop);
  fs.mkdirSync(userData);
  const originalLoad = Module._load;
  Module._load = function(name, ...args) {
    return name === 'electron' ? { app: { getPath: () => userData } } : originalLoad.call(this, name, ...args);
  };
  const { initLocalDb, setupLocalDbIpc } = require(path.join(appRoot, 'electron/localDb'));
  Module._load = originalLoad;
  const db = initLocalDb();
  const handlers = new Map();
  const listeners = new Map();
  const ipc = { handle: (key, handler) => handlers.set(key, handler), on: (key, handler) => listeners.set(key, handler) };
  const call = (key, value) => handlers.get(`local-db:${key}`)({}, value);
  setupLocalDbIpc(ipc);
  const purchase = (id, bookingDate, createdAt) => ({ id, userId: 1, number: '12345', boxValue: '1', amount: '7', bookingDate,
    sessionMode: 'DAY', purchaseCategory: 'M', status: 'accepted', createdAt });
  const protectedDate = '2026-10-05';
  call('upsert-purchases', [purchase(1, '2026-09-30', '2026-10-08T10:00:00Z'),
    purchase(2, '2026-10-01', '2026-09-01T10:00:00Z'), purchase(3, protectedDate, '2026-10-08T10:00:00Z'),
    purchase(4, 'bad-date', '2020-01-01T00:00:00Z')]);
  call('upsert-prize-results', ['2026-09-30', '2026-10-01'].map((date, i) => ({ id: i + 1, prizeKey: 'first',
    winningNumber: '12345', resultForDate: date, sessionMode: 'DAY', purchaseCategory: 'M', uploadedBy: 1 })));
  call('save-draft', { type: 'unsold', draftKey: 'mixed', userId: 1, bookingDate: '2026-09-30', rows: [
    { drawDate: '30/09/2026', number: 'old' }, { drawDate: '01/10/2026', number: 'keep' },
    { drawDate: 'invalid', number: 'unknown' }
  ] });
  call('save-generated-bill', { userId: 1, filters: { fromDate: '2026-09-30', toDate: '2026-10-05' }, bill: { total: 100 } });
  call('save-generated-bill', { userId: 1, filters: { fromDate: '2026-10-01', toDate: '2026-10-01' }, bill: { total: 200 } });
  const enqueue = (id, body, url = '/lottery/purchases') => call('enqueue-sync', { localId: id, userId: 1, operationType: 'purchase_send',
    payload: { method: 'POST', url, body } });
  enqueue('old', { bookingDate: '2026-09-30' });
  enqueue('new', { bookingDate: '2026-10-01' });
  enqueue('old-id', {}, '/lottery/received-entries/1');
  enqueue('mixed', { rows: [{ bookingDate: '2026-09-30' }, { bookingDate: '2026-10-01' }] });
  enqueue('undated', { number: '99999' });
  enqueue('old-with-invalid-row', { bookingDate: '2026-09-30', rows: [{ bookingDate: 'invalid', number: 'keep-unknown' }] });
  db.prepare("INSERT INTO local_metadata VALUES ('unrelated', 'true', '2020-01-01')").run();
  const preserved = db.prepare('SELECT * FROM local_purchase_entries WHERE server_id IN (2,3,4) ORDER BY server_id').all();
  const originalCount = db.prepare('SELECT COUNT(*) AS n FROM local_purchase_entries').get().n;

  let storage = createDateStorage(db, { desktop, userData });
  await storage.initialize();
  storage.register(ipc);
  setupLocalDbIpc(storage.wrap(ipc));
  assert.deepEqual(db.prepare('SELECT * FROM local_purchase_entries ORDER BY server_id').all(), preserved);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_prize_results').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_generated_bills').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE local_id IN ('old','old-id')").get().n, 0);
  assert.equal(db.prepare("SELECT status FROM sync_queue WHERE local_id = 'mixed'").get().status, 'needs_review');
  assert.equal(db.prepare("SELECT status FROM sync_queue WHERE local_id = 'old-with-invalid-row'").get().status, 'needs_review');
  assert.equal(db.prepare("SELECT value FROM local_metadata WHERE key = 'unrelated'").get().value, 'true');
  assert.deepEqual(JSON.parse(db.prepare("SELECT rows_json FROM local_unsold_drafts WHERE draft_key = 'mixed'").get().rows_json),
    [{ drawDate: '01/10/2026', number: 'keep' }, { drawDate: 'invalid', number: 'unknown' }]);
  const Database = require('better-sqlite3');
  const backup = new Database(path.join(userData, 'recovery-2.5.0', 'before-cleanup.db'), { readonly: true });
  assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM local_purchase_entries').get().n, originalCount);
  backup.close();

  const key = 'lottery.adminBooking.1.book-numbers.entries';
  const values = { [key]: JSON.stringify([
    { bookingDate: '2026-09-30', createdAt: '2026-10-08' },
    { bookingDate: '2026-10-01', createdAt: '2020-01-01' },
    { bookingDate: protectedDate }, { bookingDate: 'invalid' }
  ]) };
  const initialized = handlers.get('local-data:initialize-browser')({}, values);
  assert.deepEqual(JSON.parse(initialized.values[key]), JSON.parse(values[key]).slice(1));
  const root = path.join(desktop, 'Lottery Booking Data');
  assert.equal(fs.existsSync(path.join(root, '2026-09-30')), false);
  assert.ok(fs.existsSync(path.join(root, '2026-10-01', 'entries.json')));
  const exported = JSON.parse(fs.readFileSync(path.join(root, protectedDate, 'entries.json'), 'utf8'));
  assert.equal(exported.data.local_purchase_entries[0].server_id, 3);
  assert.equal(exported.data.browser_entries[0].row.bookingDate, protectedDate);
  // Once migrated, an empty browser store must not erase durable booking data.
  assert.equal(handlers.get('local-data:initialize-browser')({}, {}).values[key], initialized.values[key]);
  assert.equal(handlers.get('local-data:initialize-browser')({}, { [key]: '[]' }).values[key], initialized.values[key]);

  // Server re-download and direct offline writes cannot recreate September records.
  call('upsert-purchases', [purchase(5, '2026-09-29', '2026-10-09')]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_purchase_entries WHERE server_id = 5').get().n, 0);
  call('save-draft', { type: 'unsold', draftKey: 'old-only', userId: 1, bookingDate: '2026-09-30', rows: [{ number: 'old' }] });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM local_unsold_drafts WHERE draft_key = 'old-only'").get().n, 0);

  // Restart is simulated on the same connection by dropping TEMP guards.
  for (const row of db.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'trigger'").all()) db.exec(`DROP TRIGGER ${row.name}`);
  const deletionTarget = path.resolve(root, protectedDate);
  assert.ok(deletionTarget.startsWith(path.resolve(temp) + path.sep));
  fs.rmSync(deletionTarget, { recursive: true });
  storage = createDateStorage(db, { desktop, userData });
  await storage.initialize();
  storage.register(ipc);
  setupLocalDbIpc(storage.wrap(ipc));
  const result = handlers.get('local-data:initialize-browser')({}, { [key]: initialized.values[key] });
  assert.equal(JSON.parse(result.values[key]).some((row) => row.bookingDate === protectedDate), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_purchase_entries WHERE booking_date = ?').get(protectedDate).n, 0);
  call('upsert-purchases', [purchase(3, protectedDate, '2026-10-09')]);
  assert.equal(fs.existsSync(deletionTarget), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_purchase_entries WHERE booking_date = ?').get(protectedDate).n, 0);
  assert.deepEqual(db.prepare('SELECT * FROM local_purchase_entries WHERE server_id = 2').get(), preserved[0]);

  // Missing entire Desktop root aborts instead of interpreting it as mass deletion.
  fs.renameSync(root, `${root}-moved`);
  const beforeFailure = db.prepare('SELECT * FROM local_purchase_entries').all();
  await assert.rejects(createDateStorage(db, { desktop, userData }).initialize(), /Data folder missing/);
  assert.deepEqual(db.prepare('SELECT * FROM local_purchase_entries').all(), beforeFailure);
  db.close();
  assert.equal(policy.dateOnly('2026-02-30'), '');
  assert.equal(policy.dateOnly('01/10/2026'), '2026-10-01');
  assert.equal(policy.selectedDate({ createdAt: '2020-01-01', updatedAt: '2020-01-02' }), '');
  assert.equal(policy.isRemoved('2026-10-01'), false);
  assert.equal(policy.cleanStorageValue('token', 'unchanged'), 'unchanged');
  console.log('PASS: cutoff boundaries, selected-date semantics, mixed drafts, unknown dates, backups, queue safety, browser storage, exports, restart deletion, re-download protection, missing-folder safety.');
  console.log(`Isolated test files: ${temp}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
