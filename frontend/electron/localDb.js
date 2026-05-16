const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');

let db;

const DRAFT_TABLES = {
  purchase_send: 'local_purchase_send_drafts',
  unsold: 'local_unsold_drafts',
  unsold_remove: 'local_unsold_remove_drafts'
};

const PRIZE_CONFIG = {
  first: { label: 'First Prize', fullPrizeAmount: 25000, digitLength: 5 },
  second: { label: 'Second Prize', fullPrizeAmount: 20000, digitLength: 5 },
  third: { label: 'Third Prize', fullPrizeAmount: 2000, digitLength: 4 },
  fourth: { label: 'Fourth Prize', fullPrizeAmount: 700, digitLength: 4 },
  fifth: { label: 'Fifth Prize', fullPrizeAmount: 300, digitLength: 4 }
};

const getLocalDbPath = () => path.join(app.getPath('userData'), 'lottery-local.db');

const ensureColumn = (database, tableName, columnName, definition) => {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const initLocalDb = () => {
  if (db) {
    return db;
  }

  db = new Database(getLocalDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_purchase_entries (
      local_id TEXT PRIMARY KEY,
      server_id INTEGER,
      user_id INTEGER NOT NULL,
      owner_user_id INTEGER,
      forwarded_by INTEGER,
      sent_to_parent INTEGER,
      series TEXT,
      number TEXT NOT NULL,
      box_value TEXT NOT NULL,
      unique_code TEXT,
      amount TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      session_mode TEXT NOT NULL,
      purchase_category TEXT NOT NULL,
      status TEXT NOT NULL,
      memo_number INTEGER,
      purchase_memo_number INTEGER,
      memo_row_order INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    CREATE TABLE IF NOT EXISTS local_prize_results (
      local_id TEXT PRIMARY KEY,
      server_id INTEGER,
      prize_key TEXT NOT NULL,
      prize_label TEXT NOT NULL,
      full_prize_amount TEXT NOT NULL,
      digit_length INTEGER NOT NULL,
      winning_number TEXT NOT NULL,
      session_mode TEXT NOT NULL,
      purchase_category TEXT NOT NULL,
      result_for_date TEXT NOT NULL,
      uploaded_by INTEGER,
      result_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    CREATE TABLE IF NOT EXISTS local_users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      keyword TEXT,
      role TEXT NOT NULL,
      seller_type TEXT,
      parent_id INTEGER,
      owner_admin_id INTEGER,
      can_login INTEGER,
      rate_amount_6 REAL,
      rate_amount_12 REAL,
      created_at TEXT,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_purchase_send_drafts (
      local_id TEXT PRIMARY KEY,
      draft_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      target_seller_id INTEGER,
      memo_number INTEGER,
      rows_json TEXT NOT NULL,
      booking_date TEXT,
      session_mode TEXT,
      purchase_category TEXT,
      amount TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_unsold_drafts (
      local_id TEXT PRIMARY KEY,
      draft_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      target_seller_id INTEGER,
      memo_number INTEGER,
      rows_json TEXT NOT NULL,
      booking_date TEXT,
      session_mode TEXT,
      purchase_category TEXT,
      amount TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_unsold_remove_drafts (
      local_id TEXT PRIMARY KEY,
      draft_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      target_seller_id INTEGER,
      memo_number INTEGER,
      rows_json TEXT NOT NULL,
      booking_date TEXT,
      session_mode TEXT,
      purchase_category TEXT,
      amount TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_manual_unsold_entries (
      local_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      box_value TEXT NOT NULL,
      amount TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      session_mode TEXT NOT NULL,
      purchase_category TEXT NOT NULL,
      memo_number INTEGER,
      memo_row_order INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'synced'
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      local_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      operation_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_generated_bills (
      bill_key TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      filters_json TEXT NOT NULL,
      bill_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_purchase_lookup
    ON local_purchase_entries (user_id, booking_date, session_mode, purchase_category, amount, box_value, status, number);

    CREATE INDEX IF NOT EXISTS idx_local_purchase_memo
    ON local_purchase_entries (user_id, booking_date, session_mode, purchase_category, amount, memo_number);

    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
    ON sync_queue (status, created_at);

    CREATE INDEX IF NOT EXISTS idx_local_generated_bills_user
    ON local_generated_bills (user_id, updated_at);
  `);

  ensureColumn(db, 'local_purchase_entries', 'series', 'TEXT');
  ensureColumn(db, 'local_purchase_entries', 'unique_code', 'TEXT');
  ensureColumn(db, 'local_purchase_entries', 'entry_source', "TEXT NOT NULL DEFAULT 'purchase'");
  ensureColumn(db, 'local_purchase_entries', 'memo_row_order', 'INTEGER');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_local_purchase_server_id
    ON local_purchase_entries (server_id)
    WHERE server_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_local_purchase_entry_source
    ON local_purchase_entries (entry_source, booking_date, session_mode, purchase_category, amount);

    CREATE INDEX IF NOT EXISTS idx_local_manual_unsold_lookup
    ON local_manual_unsold_entries (actor_user_id, user_id, booking_date, session_mode, purchase_category, amount, box_value, number);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_local_prize_server_id
    ON local_prize_results (server_id)
    WHERE server_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_local_prize_lookup
    ON local_prize_results (result_for_date, session_mode, purchase_category, digit_length, winning_number);
  `);

  return db;
};

const createLocalId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeBillFilters = (filters = {}) => ({
  fromDate: toLocalDate(filters.fromDate || filters.date || filters.bookingDate),
  toDate: toLocalDate(filters.toDate || filters.date || filters.bookingDate),
  shift: String(filters.shift || filters.sessionMode || '').trim().toUpperCase(),
  amount: String(filters.amount || '').trim(),
  purchaseCategory: String(filters.purchaseCategory || '').trim().toUpperCase(),
  seller: String(filters.seller || filters.sellerName || filters.historySellerFilter || '').trim()
});

const createBillKey = ({ userId, filters = {} }) => {
  const normalized = normalizeBillFilters(filters);
  return [
    Number(userId || 0),
    normalized.fromDate,
    normalized.toDate,
    normalized.shift,
    normalized.purchaseCategory,
    normalized.amount,
    normalized.seller
  ].join('|');
};

const getDraftTable = (type) => {
  const tableName = DRAFT_TABLES[type];
  if (!tableName) {
    throw new Error('Invalid draft type');
  }

  return tableName;
};

const toLocalDate = (value) => {
  if (!value) {
    return '';
  }

  return String(value).slice(0, 10);
};

const normalizePurchaseEntry = (entry) => {
  const serverId = entry?.id ? Number(entry.id) : null;
  const now = new Date().toISOString();

  return {
    localId: serverId ? `server-${serverId}` : (entry?.localId || createLocalId('purchase')),
    serverId,
    userId: Number(entry?.userId || entry?.user_id || 0),
    ownerUserId: entry?.ownerUserId ? Number(entry.ownerUserId) : null,
    forwardedBy: entry?.forwardedBy || entry?.forwarded_by ? Number(entry.forwardedBy || entry.forwarded_by) : null,
    sentToParent: entry?.sentToParent || entry?.sent_to_parent ? Number(entry.sentToParent || entry.sent_to_parent) : null,
    series: entry?.series || null,
    number: String(entry?.number || ''),
    boxValue: String(entry?.boxValue || entry?.box_value || ''),
    uniqueCode: entry?.uniqueCode || entry?.unique_code || null,
    amount: String(entry?.amount || ''),
    bookingDate: toLocalDate(entry?.bookingDate || entry?.booking_date),
    sessionMode: String(entry?.sessionMode || entry?.session_mode || ''),
    purchaseCategory: String(entry?.purchaseCategory || entry?.purchase_category || ''),
    status: String(entry?.status || ''),
    memoNumber: entry?.memoNumber || entry?.memo_number ? Number(entry.memoNumber || entry.memo_number) : null,
    purchaseMemoNumber: entry?.purchaseMemoNumber || entry?.purchase_memo_number
      ? Number(entry.purchaseMemoNumber || entry.purchase_memo_number)
      : null,
    memoRowOrder: entry?.memoRowOrder ?? entry?.memo_row_order ?? null,
    entrySource: String(entry?.entrySource || entry?.entry_source || 'purchase'),
    createdAt: entry?.createdAt || entry?.created_at || now,
    updatedAt: entry?.updatedAt || entry?.updated_at || now
  };
};

const mapLocalPurchaseEntry = (row) => ({
  id: row.server_id,
  localId: row.local_id,
  userId: row.user_id,
  forwardedBy: row.forwarded_by,
  sentToParent: row.sent_to_parent,
  series: row.series,
  number: row.number,
  boxValue: row.box_value,
  uniqueCode: row.unique_code,
  amount: Number(row.amount),
  bookingDate: row.booking_date,
  sessionMode: row.session_mode,
  purchaseCategory: row.purchase_category,
  status: row.status,
  memoNumber: row.memo_number,
  purchaseMemoNumber: row.purchase_memo_number || row.memo_number,
  memoRowOrder: row.memo_row_order,
  entrySource: row.entry_source || 'purchase',
  createdAt: row.created_at,
  sentAt: row.updated_at,
  syncStatus: row.sync_status
});

const mapLocalManualUnsoldEntry = (row) => ({
  id: row.local_id,
  localId: row.local_id,
  userId: row.user_id,
  forwardedBy: row.actor_user_id,
  sentToParent: row.actor_user_id,
  series: null,
  number: row.number,
  boxValue: row.box_value,
  uniqueCode: null,
  amount: Number(row.amount),
  bookingDate: row.booking_date,
  sessionMode: row.session_mode,
  purchaseCategory: row.purchase_category,
  status: 'unsold_saved',
  memoNumber: row.memo_number,
  purchaseMemoNumber: row.memo_number,
  memoRowOrder: row.memo_row_order,
  entrySource: 'purchase',
  createdAt: row.created_at,
  sentAt: row.updated_at,
  syncStatus: row.sync_status
});

const normalizePrizeResult = (result) => {
  const serverId = result?.id ? Number(result.id) : null;
  const now = new Date().toISOString();

  return {
    localId: serverId ? `server-prize-${serverId}` : (result?.localId || createLocalId('prize')),
    serverId,
    prizeKey: String(result?.prizeKey || result?.prize_key || ''),
    prizeLabel: String(result?.prizeLabel || result?.prize_label || ''),
    fullPrizeAmount: String(result?.fullPrizeAmount || result?.full_prize_amount || result?.prize_amount || 0),
    digitLength: Number(result?.digitLength || result?.digit_length || 0),
    winningNumber: String(result?.winningNumber || result?.winning_number || ''),
    sessionMode: String(result?.sessionMode || result?.session_mode || ''),
    purchaseCategory: String(result?.purchaseCategory || result?.purchase_category || ''),
    resultForDate: toLocalDate(result?.resultForDate || result?.result_for_date),
    uploadedBy: result?.uploadedBy || result?.uploaded_by ? Number(result.uploadedBy || result.uploaded_by) : null,
    resultDate: result?.resultDate || result?.result_date || null,
    createdAt: result?.createdAt || result?.created_at || now,
    updatedAt: now
  };
};

const upsertPrizeResultsLocal = (results = [], syncStatus = 'synced') => {
  const database = initLocalDb();
  const normalizedResults = (Array.isArray(results) ? results : [])
    .map(normalizePrizeResult)
    .filter((result) => result.prizeKey && result.winningNumber && result.sessionMode && result.purchaseCategory && result.resultForDate);

  const statement = database.prepare(`
    INSERT INTO local_prize_results (
      local_id, server_id, prize_key, prize_label, full_prize_amount, digit_length,
      winning_number, session_mode, purchase_category, result_for_date, uploaded_by,
      result_date, created_at, updated_at, sync_status
    )
    VALUES (
      @localId, @serverId, @prizeKey, @prizeLabel, @fullPrizeAmount, @digitLength,
      @winningNumber, @sessionMode, @purchaseCategory, @resultForDate, @uploadedBy,
      @resultDate, @createdAt, @updatedAt, @syncStatus
    )
    ON CONFLICT(local_id) DO UPDATE SET
      server_id = excluded.server_id,
      prize_key = excluded.prize_key,
      prize_label = excluded.prize_label,
      full_prize_amount = excluded.full_prize_amount,
      digit_length = excluded.digit_length,
      winning_number = excluded.winning_number,
      session_mode = excluded.session_mode,
      purchase_category = excluded.purchase_category,
      result_for_date = excluded.result_for_date,
      uploaded_by = excluded.uploaded_by,
      result_date = excluded.result_date,
      updated_at = excluded.updated_at,
      sync_status = excluded.sync_status
  `);
  const deleteMatchingPendingPrize = database.prepare(`
    DELETE FROM local_prize_results
    WHERE server_id IS NULL
      AND prize_key = @prizeKey
      AND winning_number = @winningNumber
      AND session_mode = @sessionMode
      AND purchase_category = @purchaseCategory
      AND result_for_date = @resultForDate
      AND local_id <> @localId
  `);

  const writeMany = database.transaction((rows) => {
    rows.forEach((row) => {
      if (row.serverId) {
        deleteMatchingPendingPrize.run(row);
      }
      statement.run({
        ...row,
        syncStatus
      });
    });
  });

  writeMany(normalizedResults);

  return { ok: true, saved: normalizedResults.length };
};

const mapLocalPrizeResult = (row) => ({
  id: row.server_id,
  localId: row.local_id,
  prizeKey: row.prize_key,
  prizeLabel: row.prize_label,
  fullPrizeAmount: Number(row.full_prize_amount || 0),
  digitLength: Number(row.digit_length || 0),
  winningNumber: row.winning_number,
  sessionMode: row.session_mode,
  purchaseCategory: row.purchase_category,
  resultShift: row.purchase_category === 'D' ? 'DAY' : row.purchase_category === 'E' ? 'EVENING' : 'MORNING',
  resultForDate: row.result_for_date,
  uploadedBy: row.uploaded_by,
  resultDate: row.result_date,
  createdAt: row.created_at,
  syncStatus: row.sync_status
});

const normalizeUser = (user = {}) => {
  const id = Number(user.id || 0);
  const now = new Date().toISOString();

  return {
    id,
    username: String(user.username || ''),
    keyword: user.keyword || '',
    role: String(user.role || ''),
    sellerType: String(user.sellerType || user.seller_type || user.role || ''),
    parentId: user.parentId || user.parent_id ? Number(user.parentId || user.parent_id) : null,
    ownerAdminId: user.ownerAdminId || user.owner_admin_id ? Number(user.ownerAdminId || user.owner_admin_id) : null,
    canLogin: typeof user.canLogin === 'boolean' ? (user.canLogin ? 1 : 0) : typeof user.can_login === 'boolean' ? (user.can_login ? 1 : 0) : null,
    rateAmount6: Number(user.rateAmount6 || user.rate_amount_6 || 0),
    rateAmount12: Number(user.rateAmount12 || user.rate_amount_12 || 0),
    createdAt: user.createdAt || user.created_at || null,
    updatedAt: user.updatedAt || user.updated_at || now,
    rawJson: JSON.stringify(user)
  };
};

const mapLocalUser = (row) => ({
  id: row.id,
  username: row.username,
  keyword: row.keyword || '',
  role: row.role,
  sellerType: row.seller_type || row.role,
  parentId: row.parent_id,
  ownerAdminId: row.owner_admin_id,
  canLogin: row.can_login === null || typeof row.can_login === 'undefined' ? undefined : Boolean(row.can_login),
  rateAmount6: Number(row.rate_amount_6 || 0),
  rateAmount12: Number(row.rate_amount_12 || 0),
  createdAt: row.created_at
});

const getLocalUsers = () => initLocalDb()
  .prepare('SELECT * FROM local_users ORDER BY username ASC')
  .all()
  .map(mapLocalUser);

const upsertLocalUsers = (users = []) => {
  const database = initLocalDb();
  const normalizedUsers = (Array.isArray(users) ? users : [])
    .map(normalizeUser)
    .filter((user) => user.id && user.username && user.role);

  const deleteMatchingPendingUser = database.prepare(`
    DELETE FROM local_users
    WHERE id < 0
      AND username = @username
      AND COALESCE(parent_id, 0) = COALESCE(@parentId, 0)
      AND id <> @id
  `);
  const statement = database.prepare(`
    INSERT INTO local_users (
      id, username, keyword, role, seller_type, parent_id, owner_admin_id,
      can_login, rate_amount_6, rate_amount_12, created_at, updated_at, raw_json
    )
    VALUES (
      @id, @username, @keyword, @role, @sellerType, @parentId, @ownerAdminId,
      @canLogin, @rateAmount6, @rateAmount12, @createdAt, @updatedAt, @rawJson
    )
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      keyword = excluded.keyword,
      role = excluded.role,
      seller_type = excluded.seller_type,
      parent_id = excluded.parent_id,
      owner_admin_id = excluded.owner_admin_id,
      can_login = excluded.can_login,
      rate_amount_6 = excluded.rate_amount_6,
      rate_amount_12 = excluded.rate_amount_12,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      raw_json = excluded.raw_json
  `);

  const writeMany = database.transaction((rows) => {
    rows.forEach((row) => {
      if (row.id > 0) {
        deleteMatchingPendingUser.run(row);
      }
      statement.run(row);
    });
  });

  writeMany(normalizedUsers);

  return { ok: true, saved: normalizedUsers.length };
};

const getPrizeMultiplier = (amountValue, semValue) => {
  const amount = Number(amountValue);
  const sem = Number(semValue);

  if (!amount || !sem) {
    return 0;
  }

  return sem * (amount <= 7 ? 0.5 : 1);
};

const isUnsoldStatus = (status) => ['unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold'].includes(String(status || '').trim().toLowerCase());

const buildEntryPrizeLookupKey = ({
  userId,
  bookingDate,
  sessionMode,
  purchaseCategory,
  amount,
  boxValue,
  number
}) => ([
  Number(userId || 0),
  toLocalDate(bookingDate),
  String(sessionMode || ''),
  String(purchaseCategory || ''),
  String(amount || ''),
  String(boxValue || ''),
  String(number || '')
].join('|'));

const getManualUnsoldLookup = ({ actorUserId, filters = {} }) => {
  const normalizedActorUserId = Number(actorUserId || filters.currentUserId || filters.userId || filters.user?.id || 0);
  if (!normalizedActorUserId) {
    return new Set();
  }

  const params = [normalizedActorUserId];
  const conditions = ['actor_user_id = ?'];
  const { fromDate, toDate } = getDateRange(filters);

  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    conditions.push('booking_date BETWEEN ? AND ?');
  }

  if (filters.bookingDate) {
    params.push(toLocalDate(filters.bookingDate));
    conditions.push('booking_date = ?');
  }

  addCommonPurchaseFilters(conditions, params, {
    sessionMode: filters.sessionMode || filters.shift,
    purchaseCategory: filters.purchaseCategory,
    amount: filters.amount,
    boxValue: filters.sem || filters.boxValue
  });

  if (filters.sellerId) {
    params.push(Number(filters.sellerId));
    conditions.push('user_id = ?');
  }

  const rows = initLocalDb()
    .prepare(`
      SELECT user_id, booking_date, session_mode, purchase_category, amount, box_value, number
      FROM local_manual_unsold_entries
      WHERE ${conditions.join(' AND ')}
    `)
    .all(...params);

  return new Set(rows.map((row) => buildEntryPrizeLookupKey({
    userId: row.user_id,
    bookingDate: row.booking_date,
    sessionMode: row.session_mode,
    purchaseCategory: row.purchase_category,
    amount: row.amount,
    boxValue: row.box_value,
    number: row.number
  })));
};

const buildPrizeFilters = (filters = {}) => {
  const params = [];
  const conditions = ['1 = 1'];
  const { fromDate, toDate } = getDateRange({
    date: filters.date || filters.resultForDate,
    fromDate: filters.fromDate,
    toDate: filters.toDate
  });

  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    conditions.push('result_for_date BETWEEN ? AND ?');
  }

  if (filters.sessionMode || filters.shift) {
    const shift = String(filters.sessionMode || filters.shift).trim().toUpperCase();
    if (shift && shift !== 'ALL') {
      params.push(shift === 'DAY' ? 'MORNING' : shift === 'EVENING' ? 'NIGHT' : shift);
      conditions.push('session_mode = ?');
    }
  }

  if (filters.purchaseCategory) {
    params.push(String(filters.purchaseCategory));
    conditions.push('purchase_category = ?');
  }

  return { params, conditions };
};

const listLocalPrizeResults = (filters = {}) => {
  const { params, conditions } = buildPrizeFilters(filters);
  return initLocalDb()
    .prepare(`
      SELECT *
      FROM local_prize_results
      WHERE ${conditions.join(' AND ')}
      ORDER BY result_for_date DESC, session_mode ASC, CAST(full_prize_amount AS REAL) DESC, created_at DESC
    `)
    .all(...params)
    .map(mapLocalPrizeResult);
};

const listLocalPurchaseRowsForPrize = (filters = {}) => {
  const params = [];
  const conditions = ["entry_source = 'purchase'"];
  const { fromDate, toDate } = getDateRange(filters);

  if (fromDate && toDate) {
    params.push(fromDate, toDate);
    conditions.push('booking_date BETWEEN ? AND ?');
  }

  addCommonPurchaseFilters(conditions, params, {
    sessionMode: filters.sessionMode || filters.shift,
    purchaseCategory: filters.purchaseCategory,
    amount: filters.amount,
    boxValue: filters.sem || filters.boxValue
  });

  if (filters.sellerId) {
    params.push(Number(filters.sellerId));
    conditions.push('user_id = ?');
  }

  const usersById = new Map(getSavedVisibleUsers().map((user) => [Number(user.id), user]));
  const manualUnsoldLookup = getManualUnsoldLookup({ filters });

  return initLocalDb()
    .prepare(`
      SELECT *
      FROM local_purchase_entries
      WHERE ${conditions.join(' AND ')}
      ORDER BY booking_date DESC, session_mode ASC, user_id ASC, amount ASC, box_value ASC, number ASC
    `)
    .all(...params)
    .map((row) => {
      const manualUnsoldKey = buildEntryPrizeLookupKey({
        userId: row.user_id,
        bookingDate: row.booking_date,
        sessionMode: row.session_mode,
        purchaseCategory: row.purchase_category,
        amount: row.amount,
        boxValue: row.box_value,
        number: row.number
      });
      const sellerUser = usersById.get(Number(row.user_id)) || {};

      return {
        ...row,
        status: manualUnsoldLookup.has(manualUnsoldKey) ? 'unsold_saved' : row.status,
        seller_username: sellerUser.username || null
      };
    });
};

const calculatePrizeRows = ({ purchases, prizes }) => purchases.flatMap((entry) => {
  const bookedNumber = String(entry.number || '');
  if (isUnsoldStatus(entry.status)) {
    return [];
  }

  return prizes
    .filter((prize) => (
      prize.resultForDate === entry.booking_date
      && prize.sessionMode === entry.session_mode
      && prize.purchaseCategory === entry.purchase_category
      && bookedNumber.endsWith(prize.winningNumber)
    ))
    .map((prize) => ({
      id: `${prize.id || prize.localId}-${entry.server_id || entry.local_id}`,
      prizeId: prize.id || prize.localId,
      entryId: entry.server_id || entry.local_id,
      sellerId: entry.user_id,
      sellerUsername: entry.seller_username || entry.username || null,
      bookedNumber,
      number: bookedNumber,
      amount: Number(entry.amount),
      sem: Number(entry.box_value),
      status: entry.status,
      prizeKey: prize.prizeKey,
      prizeLabel: prize.prizeLabel,
      winningNumber: prize.winningNumber,
      fullPrizeAmount: prize.fullPrizeAmount,
      calculatedPrize: prize.fullPrizeAmount * getPrizeMultiplier(entry.amount, entry.box_value),
      sessionMode: prize.sessionMode,
      purchaseCategory: prize.purchaseCategory,
      resultForDate: prize.resultForDate,
      soldStatus: isUnsoldStatus(entry.status) ? 'UNSOLD' : 'SOLD'
    }));
});

const getSavedVisibleUsers = () => {
  const localUsers = getLocalUsers();

  if (localUsers.length > 0) {
    return localUsers;
  }

  const row = initLocalDb()
    .prepare("SELECT value FROM local_metadata WHERE key = 'visibleUsers' LIMIT 1")
    .get();

  if (!row) {
    return [];
  }

  try {
    return JSON.parse(row.value || '[]');
  } catch (error) {
    return [];
  }
};

const buildLocalUserTree = (currentUser = {}) => {
  const currentUserId = Number(currentUser.id || 0);
  const users = getSavedVisibleUsers();
  const nodes = new Map(users.map((user) => [
    Number(user.id),
    {
      ...user,
      children: [],
      canDelete: String(currentUser.role || '').toLowerCase() === 'admin'
        ? Number(user.id) !== currentUserId && String(user.role || '').toLowerCase() !== 'admin'
        : Number(user.parentId) === currentUserId
    }
  ]));
  const root = nodes.get(currentUserId) || {
    ...currentUser,
    children: [],
    canDelete: false
  };

  if (!nodes.has(currentUserId)) {
    nodes.set(currentUserId, root);
  }

  nodes.forEach((node) => {
    if (Number(node.id) === currentUserId) {
      return;
    }

    const parentNode = nodes.get(Number(node.parentId));
    if (parentNode) {
      parentNode.children.push(node);
    }
  });

  const decorate = (node, level = 0) => {
    node.level = level;
    node.children.sort((left, right) => String(left.username || '').localeCompare(String(right.username || '')));
    let totalDescendants = 0;
    node.children.forEach((child) => {
      totalDescendants += 1 + decorate(child, level + 1);
    });
    node.directChildrenCount = node.children.length;
    node.totalDescendants = totalDescendants;
    return totalDescendants;
  };

  decorate(root, 0);
  return root;
};

const getNumericPieceSql = (columnName = 'box_value') => (
  `CASE WHEN ${columnName} GLOB '[0-9]*' THEN CAST(${columnName} AS REAL) ELSE 0 END`
);

const getDirectChildRootId = (userId, currentUserId, usersById) => {
  let user = usersById.get(Number(userId));
  let root = null;
  const visited = new Set();

  while (user && !visited.has(Number(user.id))) {
    visited.add(Number(user.id));
    if (Number(user.parentId) === Number(currentUserId)) {
      root = user;
      break;
    }
    user = usersById.get(Number(user.parentId));
  }

  return root?.id || null;
};

const getLocalPieceSummary = (filters = {}) => {
  const currentUser = filters.user || {};
  const currentUserId = Number(currentUser.id || filters.userId || 0);
  if (!currentUserId) {
    return [];
  }

  const users = getSavedVisibleUsers();
  const usersById = new Map(users.map((user) => [Number(user.id), user]));
  const currentUserFromStore = usersById.get(currentUserId) || currentUser;
  const isAdmin = String(currentUserFromStore.role || currentUser.role || '').toLowerCase() === 'admin';
  const directChildren = users
    .filter((user) => Number(user.parentId) === currentUserId && String(user.role || '').toLowerCase() === 'seller')
    .sort((left, right) => String(left.username || '').localeCompare(String(right.username || '')));
  const sellers = isAdmin
    ? directChildren
    : [
      currentUserFromStore,
      ...directChildren.filter((seller) => Number(seller.id) !== currentUserId)
    ];

  if (sellers.length === 0) {
    return [];
  }

  const params = [];
  const conditions = [
    "entry_source = 'purchase'",
    "LOWER(TRIM(status)) IN ('accepted', 'unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold')"
  ];
  addCommonPurchaseFilters(conditions, params, filters);

  const rows = initLocalDb()
    .prepare(`
      SELECT *
      FROM local_purchase_entries
      WHERE ${conditions.join(' AND ')}
    `)
    .all(...params);

  const sellerIds = new Set(sellers.map((seller) => Number(seller.id)));
  const summaryMap = new Map();
  rows.forEach((row) => {
    const rowUserId = Number(row.user_id);
    const summaryUserId = isAdmin ? getDirectChildRootId(rowUserId, currentUserId, usersById) : rowUserId;
    if (!summaryUserId || !sellerIds.has(Number(summaryUserId))) {
      return;
    }
    if (!isAdmin) {
      const currentSellerType = String(currentUserFromStore.sellerType || currentUser.sellerType || '').toLowerCase();
      const isNormalSeller = currentSellerType === 'normal_seller';
      const isForwardedSelfMemo = Number(row.forwarded_by) === currentUserId && row.memo_number !== null && typeof row.memo_number !== 'undefined';
      if (rowUserId === currentUserId && !isNormalSeller && !isForwardedSelfMemo) {
        return;
      }
    }

    const piece = /^\d+(\.\d+)?$/.test(String(row.box_value || '')) ? Number(row.box_value) : 0;
    const status = String(row.status || '').trim().toLowerCase();
    const isUnsold = isAdmin
      ? ['unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold'].includes(status)
      : (
        status === 'unsold_accepted'
        || (status === 'unsold_saved' && (rowUserId === currentUserId || Number(row.sent_to_parent) === currentUserId))
        || (status === 'unsold_sent' && Number(row.forwarded_by) === currentUserId)
      );
    const summary = summaryMap.get(Number(summaryUserId)) || { totalPiece: 0, unsoldPiece: 0 };
    summary.totalPiece += piece;
    if (isUnsold) {
      summary.unsoldPiece += piece;
    }
    summaryMap.set(Number(summaryUserId), summary);
  });

  const untransferredSource = isAdmin ? 'admin_purchase' : 'purchase';
  const untransferredStatus = isAdmin ? 'available' : 'accepted';
  const untransferredParams = [currentUserId, untransferredSource, untransferredStatus];
  const untransferredConditions = ['user_id = ?', 'entry_source = ?', 'status = ?'];
  addCommonPurchaseFilters(untransferredConditions, untransferredParams, filters);
  const untransferredRow = initLocalDb()
    .prepare(`
      SELECT COALESCE(SUM(${getNumericPieceSql()}), 0) AS stock_not_transferred_piece
      FROM local_purchase_entries
      WHERE ${untransferredConditions.join(' AND ')}
    `)
    .get(...untransferredParams);
  const stockNotTransferredPiece = Number(untransferredRow?.stock_not_transferred_piece || 0);

  return sellers.map((seller) => {
    const summary = summaryMap.get(Number(seller.id)) || {};
    return {
      sellerId: seller.id,
      sellerName: seller.username,
      isSelf: Number(seller.id) === currentUserId,
      totalPiece: Number(summary.totalPiece || 0),
      unsoldPiece: Number(summary.unsoldPiece || 0),
      stockNotTransferredPiece
    };
  });
};

const buildConsecutiveNumbers = (startValue, endValue) => {
  const start = String(startValue || '').trim();
  const end = String(endValue || startValue || '').trim();

  if (!start || !end || !/^\d+$/.test(start) || !/^\d+$/.test(end)) {
    return [];
  }

  const width = Math.max(start.length, end.length);
  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber) || endNumber < startNumber) {
    return [];
  }

  const numbers = [];
  for (let value = startNumber; value <= endNumber; value += 1) {
    numbers.push(String(value).padStart(width, '0'));
  }

  return numbers;
};

const getPayloadNumbers = (payload) => {
  if (payload?.rangeStart || payload?.rangeEnd) {
    return buildConsecutiveNumbers(payload.rangeStart, payload.rangeEnd);
  }

  return String(payload?.number || '')
    .split(',')
    .map((number) => number.trim())
    .filter(Boolean);
};

const saveManualUnsoldLocal = ({ payload = {}, userId, syncStatus = 'pending', replaceMemo = false }) => {
  const actorUserId = Number(userId || 0);
  const targetUserId = Number(payload.sellerId || payload.sellerUserId || userId || 0);
  const bookingDate = toLocalDate(payload.bookingDate);
  const sessionMode = String(payload.sessionMode || '');
  const purchaseCategory = String(payload.purchaseCategory || '');
  const amount = String(payload.amount || '');
  const boxValue = String(payload.boxValue || '');
  const memoNumber = payload.memoNumber ? Number(payload.memoNumber) : null;
  const numbers = getPayloadNumbers(payload);
  const now = new Date().toISOString();

  if (!actorUserId || !targetUserId || actorUserId === targetUserId || !bookingDate || !sessionMode || !purchaseCategory || !amount || !boxValue || numbers.length === 0) {
    return { saved: 0 };
  }

  const database = initLocalDb();
  const deleteStatement = replaceMemo
    ? database.prepare(`
      DELETE FROM local_manual_unsold_entries
      WHERE actor_user_id = @actorUserId
        AND user_id = @targetUserId
        AND booking_date = @bookingDate
        AND session_mode = @sessionMode
        AND purchase_category = @purchaseCategory
        AND amount = @amount
        AND memo_number = @memoNumber
    `)
    : database.prepare(`
      DELETE FROM local_manual_unsold_entries
      WHERE actor_user_id = @actorUserId
        AND user_id = @targetUserId
        AND booking_date = @bookingDate
        AND session_mode = @sessionMode
        AND purchase_category = @purchaseCategory
        AND amount = @amount
        AND box_value = @boxValue
        AND number = @number
    `);
  const insertStatement = database.prepare(`
    INSERT INTO local_manual_unsold_entries (
      local_id, user_id, actor_user_id, number, box_value, amount,
      booking_date, session_mode, purchase_category, memo_number, memo_row_order,
      created_at, updated_at, sync_status
    )
    VALUES (
      @localId, @targetUserId, @actorUserId, @number, @boxValue, @amount,
      @bookingDate, @sessionMode, @purchaseCategory, @memoNumber, @memoRowOrder,
      @createdAt, @updatedAt, @syncStatus
    )
    ON CONFLICT(local_id) DO UPDATE SET
      memo_number = excluded.memo_number,
      memo_row_order = excluded.memo_row_order,
      updated_at = excluded.updated_at,
      sync_status = excluded.sync_status
  `);

  const writeRows = database.transaction((rows) => {
    if (replaceMemo && memoNumber) {
      deleteStatement.run({
        actorUserId,
        targetUserId,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount,
        memoNumber
      });
    }

    rows.forEach((number, index) => {
      if (!replaceMemo) {
        deleteStatement.run({
          actorUserId,
          targetUserId,
          bookingDate,
          sessionMode,
          purchaseCategory,
          amount,
          boxValue,
          number
        });
      }

      insertStatement.run({
        localId: `manual-unsold-${actorUserId}-${targetUserId}-${bookingDate}-${sessionMode}-${purchaseCategory}-${amount}-${boxValue}-${number}`,
        actorUserId,
        targetUserId,
        number,
        boxValue,
        amount,
        bookingDate,
        sessionMode,
        purchaseCategory,
        memoNumber,
        memoRowOrder: payload.memoRowOrder ?? index,
        createdAt: now,
        updatedAt: now,
        syncStatus
      });
    });
  });

  writeRows(numbers);
  return { saved: numbers.length };
};

const removeManualUnsoldLocal = ({ payload = {}, userId }) => {
  const actorUserId = Number(userId || 0);
  const targetUserId = Number(payload.sellerId || payload.sellerUserId || userId || 0);
  const bookingDate = toLocalDate(payload.bookingDate);
  const sessionMode = String(payload.sessionMode || '');
  const purchaseCategory = String(payload.purchaseCategory || '');
  const amount = String(payload.amount || '');
  const boxValue = String(payload.boxValue || '');
  const memoNumber = payload.memoNumber ? Number(payload.memoNumber) : null;
  const numbers = getPayloadNumbers(payload);

  if (!actorUserId || !targetUserId || actorUserId === targetUserId || !bookingDate || !sessionMode || !purchaseCategory || numbers.length === 0) {
    return { removed: 0 };
  }

  const params = [actorUserId, targetUserId, bookingDate, sessionMode, purchaseCategory, numbers];
  const conditions = [
    'actor_user_id = ?',
    'user_id = ?',
    'booking_date = ?',
    'session_mode = ?',
    'purchase_category = ?',
    `number IN (${numbers.map(() => '?').join(', ')})`
  ];
  params.pop();
  params.push(...numbers);

  if (amount) {
    params.push(amount);
    conditions.push('amount = ?');
  }
  if (boxValue) {
    params.push(boxValue);
    conditions.push('box_value = ?');
  }
  if (memoNumber) {
    params.push(memoNumber);
    conditions.push('memo_number = ?');
  }

  const result = initLocalDb()
    .prepare(`DELETE FROM local_manual_unsold_entries WHERE ${conditions.join(' AND ')}`)
    .run(...params);

  return { removed: result.changes || 0 };
};

const addCommonPurchaseFilters = (conditions, params, filters) => {
  if (filters.bookingDate) {
    params.push(toLocalDate(filters.bookingDate));
    conditions.push('booking_date = ?');
  }

  if (filters.sessionMode || filters.shift) {
    params.push(String(filters.sessionMode || filters.shift));
    conditions.push('session_mode = ?');
  }

  if (filters.purchaseCategory) {
    params.push(String(filters.purchaseCategory));
    conditions.push('purchase_category = ?');
  }

  if (filters.amount) {
    params.push(String(filters.amount));
    conditions.push('amount = ?');
  }

  if (filters.boxValue || filters.sem) {
    params.push(String(filters.boxValue || filters.sem));
    conditions.push('box_value = ?');
  }
};

const getDateRange = (filters) => ({
  fromDate: toLocalDate(filters.fromDate || filters.date || filters.bookingDate),
  toDate: toLocalDate(filters.toDate || filters.date || filters.bookingDate)
});

const setupLocalDbIpc = (ipcMain) => {
  ipcMain.handle('local-db:get-info', () => {
    initLocalDb();
    return {
      path: getLocalDbPath()
    };
  });

  ipcMain.handle('local-db:get-metadata', (_event, key) => {
    const row = initLocalDb()
      .prepare('SELECT value FROM local_metadata WHERE key = ?')
      .get(String(key || ''));

    return row ? JSON.parse(row.value) : null;
  });

  ipcMain.handle('local-db:set-metadata', (_event, { key, value }) => {
    const now = new Date().toISOString();
    initLocalDb()
      .prepare(`
        INSERT INTO local_metadata (key, value, updated_at)
        VALUES (@key, @value, @updatedAt)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run({
        key: String(key || ''),
        value: JSON.stringify(value ?? null),
        updatedAt: now
      });

    return { ok: true };
  });

  ipcMain.handle('local-db:upsert-users', (_event, users = []) => {
    return upsertLocalUsers(users);
  });

  ipcMain.handle('local-db:list-users', () => getSavedVisibleUsers());

  ipcMain.handle('local-db:purge-users', (_event, { userIds } = {}) => {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [])
      .map((userId) => Number(userId))
      .filter((userId) => Number.isInteger(userId) && userId > 0))];

    if (ids.length === 0) {
      return { ok: true, deletedCount: 0 };
    }

    const database = initLocalDb();
    const placeholders = ids.map(() => '?').join(', ');
    const runDelete = (sql, repeatCount = 1) => database.prepare(sql).run(
      ...Array.from({ length: repeatCount }).flatMap(() => ids)
    );

    database.transaction(() => {
      runDelete(`DELETE FROM local_purchase_entries WHERE user_id IN (${placeholders}) OR owner_user_id IN (${placeholders}) OR forwarded_by IN (${placeholders}) OR sent_to_parent IN (${placeholders})`, 4);
      runDelete(`DELETE FROM local_prize_results WHERE uploaded_by IN (${placeholders})`);
      runDelete(`DELETE FROM local_purchase_send_drafts WHERE user_id IN (${placeholders}) OR target_seller_id IN (${placeholders})`, 2);
      runDelete(`DELETE FROM local_unsold_drafts WHERE user_id IN (${placeholders}) OR target_seller_id IN (${placeholders})`, 2);
      runDelete(`DELETE FROM local_unsold_remove_drafts WHERE user_id IN (${placeholders}) OR target_seller_id IN (${placeholders})`, 2);
      runDelete(`DELETE FROM local_manual_unsold_entries WHERE user_id IN (${placeholders}) OR actor_user_id IN (${placeholders})`, 2);
      runDelete(`DELETE FROM sync_queue WHERE user_id IN (${placeholders})`);
      runDelete(`DELETE FROM local_generated_bills WHERE user_id IN (${placeholders})`);
      runDelete(`DELETE FROM local_users WHERE id IN (${placeholders}) OR owner_admin_id IN (${placeholders}) OR parent_id IN (${placeholders})`, 3);
    })();

    return { ok: true, deletedCount: ids.length };
  });

  ipcMain.handle('local-db:get-user-tree', (_event, { user } = {}) => buildLocalUserTree(user));

  ipcMain.handle('local-db:load-draft', (_event, { type, draftKey }) => {
    const tableName = getDraftTable(type);
    const row = initLocalDb()
      .prepare(`SELECT * FROM ${tableName} WHERE draft_key = ? LIMIT 1`)
      .get(String(draftKey || ''));

    if (!row) {
      return null;
    }

    return {
      ...row,
      rows: JSON.parse(row.rows_json || '[]')
    };
  });

  ipcMain.handle('local-db:list-drafts', (_event, { type, userId } = {}) => {
    const tableName = getDraftTable(type);
    const params = [];
    const conditions = [];

    if (userId) {
      conditions.push('user_id = ?');
      params.push(Number(userId));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = initLocalDb()
      .prepare(`SELECT * FROM ${tableName} ${whereClause} ORDER BY updated_at DESC`)
      .all(...params);

    return rows.map((row) => ({
      ...row,
      draftKey: row.draft_key,
      targetSellerId: row.target_seller_id,
      memoNumber: row.memo_number,
      bookingDate: row.booking_date,
      sessionMode: row.session_mode,
      purchaseCategory: row.purchase_category,
      amount: row.amount,
      updatedAt: row.updated_at,
      rows: JSON.parse(row.rows_json || '[]')
    }));
  });

  ipcMain.handle('local-db:save-draft', (_event, payload) => {
    const tableName = getDraftTable(payload?.type);
    const now = new Date().toISOString();
    const draftKey = String(payload?.draftKey || '');

    if (!draftKey) {
      throw new Error('Draft key required');
    }

    initLocalDb()
      .prepare(`
        INSERT INTO ${tableName} (
          local_id, draft_key, user_id, target_seller_id, memo_number,
          rows_json, booking_date, session_mode, purchase_category, amount,
          status, created_at, updated_at
        )
        VALUES (
          @localId, @draftKey, @userId, @targetSellerId, @memoNumber,
          @rowsJson, @bookingDate, @sessionMode, @purchaseCategory, @amount,
          @status, @createdAt, @updatedAt
        )
        ON CONFLICT(draft_key) DO UPDATE SET
          target_seller_id = excluded.target_seller_id,
          memo_number = excluded.memo_number,
          rows_json = excluded.rows_json,
          booking_date = excluded.booking_date,
          session_mode = excluded.session_mode,
          purchase_category = excluded.purchase_category,
          amount = excluded.amount,
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
      .run({
        localId: payload.localId || createLocalId(payload.type),
        draftKey,
        userId: Number(payload.userId || 0),
        targetSellerId: payload.targetSellerId ? Number(payload.targetSellerId) : null,
        memoNumber: payload.memoNumber ? Number(payload.memoNumber) : null,
        rowsJson: JSON.stringify(Array.isArray(payload.rows) ? payload.rows : []),
        bookingDate: payload.bookingDate || null,
        sessionMode: payload.sessionMode || null,
        purchaseCategory: payload.purchaseCategory || null,
        amount: payload.amount || null,
        status: payload.status || 'draft',
        createdAt: now,
        updatedAt: now
      });

    return { ok: true };
  });

  ipcMain.handle('local-db:clear-draft', (_event, { type, draftKey }) => {
    const tableName = getDraftTable(type);
    initLocalDb()
      .prepare(`DELETE FROM ${tableName} WHERE draft_key = ?`)
      .run(String(draftKey || ''));

    return { ok: true };
  });

  ipcMain.handle('local-db:upsert-purchases', (_event, entries = []) => {
    const database = initLocalDb();
    const normalizedEntries = (Array.isArray(entries) ? entries : [])
      .map(normalizePurchaseEntry)
      .filter((entry) => entry.userId && entry.number && entry.boxValue && entry.amount && entry.bookingDate && entry.sessionMode);

    const statement = database.prepare(`
      INSERT INTO local_purchase_entries (
        local_id, server_id, user_id, owner_user_id, forwarded_by, sent_to_parent,
        series, number, box_value, unique_code, amount, booking_date, session_mode,
        purchase_category, status, memo_number, purchase_memo_number, memo_row_order, entry_source,
        created_at, updated_at, sync_status
      )
      VALUES (
        @localId, @serverId, @userId, @ownerUserId, @forwardedBy, @sentToParent,
        @series, @number, @boxValue, @uniqueCode, @amount, @bookingDate, @sessionMode,
        @purchaseCategory, @status, @memoNumber, @purchaseMemoNumber, @memoRowOrder, @entrySource,
        @createdAt, @updatedAt, 'synced'
      )
      ON CONFLICT(local_id) DO UPDATE SET
        server_id = excluded.server_id,
        user_id = excluded.user_id,
        owner_user_id = excluded.owner_user_id,
        forwarded_by = excluded.forwarded_by,
        sent_to_parent = excluded.sent_to_parent,
        series = excluded.series,
        number = excluded.number,
        box_value = excluded.box_value,
        unique_code = excluded.unique_code,
        amount = excluded.amount,
        booking_date = excluded.booking_date,
        session_mode = excluded.session_mode,
        purchase_category = excluded.purchase_category,
        status = excluded.status,
        memo_number = excluded.memo_number,
        purchase_memo_number = excluded.purchase_memo_number,
        memo_row_order = excluded.memo_row_order,
        entry_source = excluded.entry_source,
        updated_at = excluded.updated_at,
        sync_status = excluded.sync_status
    `);

    const writeMany = database.transaction((rows) => {
      rows.forEach((row) => statement.run(row));
    });

    writeMany(normalizedEntries);

    return { ok: true, saved: normalizedEntries.length };
  });

  ipcMain.handle('local-db:list-purchases', (_event, filters = {}) => {
    const params = [];
    const conditions = ["entry_source = 'purchase'"];

    if (filters.bookingDate) {
      params.push(toLocalDate(filters.bookingDate));
      conditions.push(`booking_date = ?`);
    }

    if (filters.sessionMode) {
      params.push(String(filters.sessionMode));
      conditions.push(`session_mode = ?`);
    }

    if (filters.sellerId) {
      params.push(Number(filters.sellerId));
      conditions.push(`user_id = ?`);
    }

    if (filters.purchaseCategory) {
      params.push(String(filters.purchaseCategory));
      conditions.push(`purchase_category = ?`);
    }

    if (filters.amount) {
      params.push(String(filters.amount));
      conditions.push(`amount = ?`);
    }

    if (filters.boxValue) {
      params.push(String(filters.boxValue));
      conditions.push(`box_value = ?`);
    }

    if (filters.status) {
      const status = String(filters.status).trim().toLowerCase();
      if (status === 'unsold' || status === 'unsold_accepted') {
        conditions.push(`LOWER(TRIM(status)) IN ('unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold')`);
      } else {
        params.push(status);
        conditions.push(`LOWER(TRIM(status)) = ?`);
      }
    }

    const rows = initLocalDb()
      .prepare(`
        SELECT *
        FROM local_purchase_entries
        WHERE ${conditions.join(' AND ')}
        ORDER BY booking_date DESC, created_at DESC, local_id DESC
        LIMIT 20000
      `)
      .all(...params);

    const mappedRows = rows.map(mapLocalPurchaseEntry);
    const currentUserId = Number(filters.currentUserId || 0);
    const requestedStatus = String(filters.status || '').trim().toLowerCase();

    if (currentUserId && (!requestedStatus || requestedStatus === 'unsold' || requestedStatus === 'unsold_accepted')) {
      const manualParams = [currentUserId];
      const manualConditions = ['actor_user_id = ?'];

      if (filters.sellerId) {
        manualParams.push(Number(filters.sellerId));
        manualConditions.push('user_id = ?');
      }
      if (filters.bookingDate) {
        manualParams.push(toLocalDate(filters.bookingDate));
        manualConditions.push('booking_date = ?');
      }
      if (filters.sessionMode) {
        manualParams.push(String(filters.sessionMode));
        manualConditions.push('session_mode = ?');
      }
      if (filters.purchaseCategory) {
        manualParams.push(String(filters.purchaseCategory));
        manualConditions.push('purchase_category = ?');
      }
      if (filters.amount) {
        manualParams.push(String(filters.amount));
        manualConditions.push('amount = ?');
      }
      if (filters.boxValue) {
        manualParams.push(String(filters.boxValue));
        manualConditions.push('box_value = ?');
      }

      const manualRows = initLocalDb()
        .prepare(`
          SELECT *
          FROM local_manual_unsold_entries
          WHERE ${manualConditions.join(' AND ')}
          ORDER BY booking_date DESC, created_at DESC, local_id DESC
          LIMIT 20000
        `)
        .all(...manualParams)
        .map(mapLocalManualUnsoldEntry);

      return [...mappedRows, ...manualRows];
    }

    return mappedRows;
  });

  ipcMain.handle('local-db:upsert-prize-results', (_event, results = []) => {
    return upsertPrizeResultsLocal(results, 'synced');
  });

  ipcMain.handle('local-db:list-prize-results', (_event, filters = {}) => listLocalPrizeResults(filters));

  ipcMain.handle('local-db:get-bill-prizes', (_event, filters = {}) => {
    const prizes = listLocalPrizeResults(filters);
    const purchases = listLocalPurchaseRowsForPrize({
      ...filters,
      currentUserId: filters.currentUserId || filters.userId || filters.user?.id
    });

    return calculatePrizeRows({ purchases, prizes });
  });

  ipcMain.handle('local-db:get-purchase-piece-summary', (_event, filters = {}) => getLocalPieceSummary(filters));

  ipcMain.handle('local-db:save-generated-bill', (_event, payload = {}) => {
    const now = new Date().toISOString();
    const userId = Number(payload.userId || payload.user?.id || 0);
    const filters = normalizeBillFilters(payload.filters || {});
    const bill = payload.bill || {};
    const billKey = payload.billKey || createBillKey({ userId, filters });

    if (!userId || !billKey) {
      throw new Error('Bill user required');
    }

    initLocalDb()
      .prepare(`
        INSERT INTO local_generated_bills (
          bill_key, user_id, filters_json, bill_json, generated_at, updated_at
        )
        VALUES (
          @billKey, @userId, @filtersJson, @billJson, @generatedAt, @updatedAt
        )
        ON CONFLICT(bill_key) DO UPDATE SET
          filters_json = excluded.filters_json,
          bill_json = excluded.bill_json,
          generated_at = excluded.generated_at,
          updated_at = excluded.updated_at
      `)
      .run({
        billKey,
        userId,
        filtersJson: JSON.stringify(filters),
        billJson: JSON.stringify(bill),
        generatedAt: payload.generatedAt || now,
        updatedAt: now
      });

    return { ok: true, billKey };
  });

  ipcMain.handle('local-db:load-generated-bill', (_event, payload = {}) => {
    const userId = Number(payload.userId || payload.user?.id || 0);
    const filters = normalizeBillFilters(payload.filters || {});
    const billKey = payload.billKey || createBillKey({ userId, filters });
    const row = initLocalDb()
      .prepare('SELECT * FROM local_generated_bills WHERE bill_key = ? LIMIT 1')
      .get(billKey);

    if (!row) {
      return null;
    }

    return {
      billKey: row.bill_key,
      userId: row.user_id,
      filters: JSON.parse(row.filters_json || '{}'),
      bill: JSON.parse(row.bill_json || '{}'),
      generatedAt: row.generated_at,
      updatedAt: row.updated_at
    };
  });

  ipcMain.handle('local-db:check-prize', (_event, filters = {}) => {
    const number = String(filters.number || '').trim();
    const purchases = listLocalPurchaseRowsForPrize({
      date: filters.date,
      sessionMode: filters.sessionMode,
      purchaseCategory: filters.purchaseCategory,
      amount: String(filters.amount || '').toUpperCase() === 'ALL' ? '' : filters.amount,
      sem: String(filters.sem || '').toUpperCase() === 'ALL' ? '' : filters.sem,
      currentUserId: filters.currentUserId || filters.userId || filters.user?.id
    }).filter((entry) => {
      const entryNumber = String(entry.number || '');
      return number.length === 5 ? entryNumber === number : entryNumber.endsWith(number);
    });

    const prizes = listLocalPrizeResults({
      resultForDate: filters.date,
      sessionMode: filters.sessionMode,
      purchaseCategory: filters.purchaseCategory
    });
    const matches = calculatePrizeRows({ purchases, prizes }).map((row) => ({
      ...row,
      matchedAgainstNumber: row.bookedNumber,
      ownedEntryId: row.entryId,
      ownedBy: row.sellerUsername || null,
      same: row.sem
    }));

    return {
      matches,
      searchedNumber: number,
      resultForDate: filters.date,
      sessionMode: filters.sessionMode,
      message: matches.length > 0 ? 'Prize found' : purchases.length > 0 ? 'No Price' : 'Not your number',
      resultType: matches.length > 0 ? 'matched' : purchases.length > 0 ? 'no_price' : 'not_owned'
    };
  });

  ipcMain.handle('local-db:get-filtered-prize-results', (_event, filters = {}) => {
    const prizeRows = calculatePrizeRows({
      purchases: listLocalPurchaseRowsForPrize({
        date: filters.date,
        shift: filters.shift === 'ALL' ? '' : filters.shift,
        sellerId: filters.sellerId,
        currentUserId: filters.currentUserId || filters.userId || filters.user?.id
      }),
      prizes: listLocalPrizeResults({
        resultForDate: filters.date,
        shift: filters.shift === 'ALL' ? '' : filters.shift
      })
    }).filter((row) => {
      const soldStatus = String(filters.soldStatus || 'ALL').toUpperCase();
      return soldStatus === 'ALL' || row.soldStatus === soldStatus;
    }).map((row) => ({
      ...row,
      prizeId: row.prizeId,
      sellerId: row.sellerId,
      sellerUsername: row.sellerUsername,
      bookingDate: row.resultForDate,
      number: row.bookedNumber
    }));

    return {
      rows: prizeRows,
      totalPrize: prizeRows.reduce((sum, row) => sum + Number(row.calculatedPrize || 0), 0)
    };
  });

  ipcMain.handle('local-db:apply-offline-purchase-mutation', (_event, { operationType, payload = {}, userId } = {}) => {
    const now = new Date().toISOString();
    if (operationType === 'create_seller') {
      const currentUser = getLocalUsers().find((user) => Number(user.id) === Number(userId)) || {};
      const sellerType = String(payload.sellerType || payload.seller_type || 'seller');
      const tempId = -Math.abs(Date.now());
      const seller = {
        id: tempId,
        username: String(payload.username || '').trim(),
        keyword: String(payload.keyword || '').trim(),
        role: 'seller',
        sellerType,
        parentId: Number(userId || 0) || null,
        ownerAdminId: currentUser.ownerAdminId || (String(currentUser.role || '').toLowerCase() === 'admin' ? Number(userId || 0) : null),
        canLogin: sellerType !== 'normal_seller',
        rateAmount6: Number(payload.rateAmount6 || payload.rate_amount_6 || 0),
        rateAmount12: Number(payload.rateAmount12 || payload.rate_amount_12 || 0),
        createdAt: now,
        updatedAt: now
      };

      if (seller.username) {
        upsertLocalUsers([seller]);
      }

      return { ok: true, seller };
    }

    if (operationType === 'price_upload') {
      const resultForDate = toLocalDate(payload.resultForDate);
      const sessionMode = String(payload.sessionMode || '');
      const purchaseCategory = String(payload.purchaseCategory || '');
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const results = entries.map((entry) => {
        const prizeKey = String(entry.prizeKey || '').trim().toLowerCase();
        const config = PRIZE_CONFIG[prizeKey] || {};
        const winningNumber = String(entry.winningNumber || '').replace(/\D/g, '');
        return {
          localId: `offline-prize-${resultForDate}-${sessionMode}-${purchaseCategory}-${prizeKey}-${winningNumber}`,
          prizeKey,
          prizeLabel: config.label || prizeKey,
          fullPrizeAmount: config.fullPrizeAmount || 0,
          digitLength: config.digitLength || winningNumber.length,
          winningNumber,
          sessionMode,
          purchaseCategory,
          resultForDate,
          uploadedBy: Number(userId || 0) || null,
          resultDate: now,
          createdAt: now,
          updatedAt: now
        };
      });

      const saved = upsertPrizeResultsLocal(results, 'pending');
      return { ok: true, results, saved: saved.saved };
    }

    const numbers = getPayloadNumbers(payload);
    const targetSellerId = Number(payload.sellerId || payload.sellerUserId || userId || 0);
    const params = [];
    const conditions = ["entry_source = 'purchase'"];

    addCommonPurchaseFilters(conditions, params, payload);

    if (targetSellerId) {
      params.push(targetSellerId);
      conditions.push('user_id = ?');
    }

    if (numbers.length > 0) {
      const placeholders = numbers.map(() => '?').join(', ');
      params.push(...numbers);
      conditions.push(`number IN (${placeholders})`);
    }

    if (operationType === 'unsold_save') {
      if (Number(targetSellerId) === Number(userId)) {
        initLocalDb()
          .prepare(`
            UPDATE local_purchase_entries
            SET status = 'unsold_saved',
                memo_number = COALESCE(?, memo_number),
                purchase_memo_number = COALESCE(?, purchase_memo_number, memo_number),
                memo_row_order = COALESCE(?, memo_row_order),
                updated_at = ?,
                sync_status = 'pending'
            WHERE ${conditions.join(' AND ')}
              AND LOWER(TRIM(status)) = 'accepted'
          `)
          .run(
            payload.memoNumber ? Number(payload.memoNumber) : null,
            payload.memoNumber ? Number(payload.memoNumber) : null,
            payload.memoRowOrder !== undefined && payload.memoRowOrder !== null ? Number(payload.memoRowOrder) : null,
            now,
            ...params
          );
      } else {
        saveManualUnsoldLocal({
          payload,
          userId,
          syncStatus: payload.serverSynced ? 'synced' : 'pending'
        });
      }
    }

    if (operationType === 'unsold_remove') {
      if (Number(targetSellerId) !== Number(userId)) {
        removeManualUnsoldLocal({ payload, userId });
        return { ok: true };
      }

      initLocalDb()
        .prepare(`
          UPDATE local_purchase_entries
          SET status = 'accepted',
              updated_at = ?,
              sync_status = 'pending'
          WHERE ${conditions.join(' AND ')}
            AND LOWER(TRIM(status)) IN ('unsold_saved', 'unsold_sent', 'unsold')
        `)
        .run(now, ...params);
    }

    if (operationType === 'unsold_send') {
      const serverEntries = Array.isArray(payload.serverEntries) ? payload.serverEntries : [];
      if (payload.serverSynced && serverEntries.length > 0) {
        const selectedRows = serverEntries
          .map(normalizePurchaseEntry)
          .filter((entry) => entry.userId && entry.number && entry.boxValue && entry.amount && entry.bookingDate && entry.sessionMode);
        const selectedKeys = new Set(selectedRows.map((entry) => [
          entry.userId,
          entry.bookingDate,
          entry.sessionMode,
          entry.purchaseCategory,
          entry.amount,
          entry.boxValue,
          entry.number
        ].join('|')));
        const selectedUserIds = [...new Set(selectedRows.map((entry) => Number(entry.userId)).filter(Boolean))];
        const staleParams = [];
        const staleConditions = [
          "entry_source = 'purchase'",
          "LOWER(TRIM(status)) IN ('unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold')"
        ];
        addCommonPurchaseFilters(staleConditions, staleParams, payload);
        if (selectedUserIds.length > 0) {
          staleConditions.push(`user_id IN (${selectedUserIds.map(() => '?').join(', ')})`);
          staleParams.push(...selectedUserIds);
        }

        const staleRows = initLocalDb()
          .prepare(`SELECT * FROM local_purchase_entries WHERE ${staleConditions.join(' AND ')}`)
          .all(...staleParams)
          .filter((row) => !selectedKeys.has([
            row.user_id,
            row.booking_date,
            row.session_mode,
            row.purchase_category,
            row.amount,
            row.box_value,
            row.number
          ].join('|')));

        if (staleRows.length > 0) {
          initLocalDb()
            .prepare(`
              UPDATE local_purchase_entries
              SET status = 'accepted',
                  sent_to_parent = NULL,
                  forwarded_by = NULL,
                  memo_number = COALESCE(purchase_memo_number, memo_number),
                  updated_at = ?,
                  sync_status = 'synced'
              WHERE local_id IN (${staleRows.map(() => '?').join(', ')})
            `)
            .run(now, ...staleRows.map((row) => row.local_id));
        }

        const manualParams = [Number(userId || 0)];
        const manualConditions = ['actor_user_id = ?'];
        addCommonPurchaseFilters(manualConditions, manualParams, payload);
        if (selectedUserIds.length > 0) {
          manualConditions.push(`user_id IN (${selectedUserIds.map(() => '?').join(', ')})`);
          manualParams.push(...selectedUserIds);
        }
        const staleManualRows = initLocalDb()
          .prepare(`SELECT * FROM local_manual_unsold_entries WHERE ${manualConditions.join(' AND ')}`)
          .all(...manualParams)
          .filter((row) => !selectedKeys.has([
            row.user_id,
            row.booking_date,
            row.session_mode,
            row.purchase_category,
            row.amount,
            row.box_value,
            row.number
          ].join('|')));

        if (staleManualRows.length > 0) {
          initLocalDb()
            .prepare(`DELETE FROM local_manual_unsold_entries WHERE local_id IN (${staleManualRows.map(() => '?').join(', ')})`)
            .run(...staleManualRows.map((row) => row.local_id));
        }

        return { ok: true, reset: staleRows.length, manualReset: staleManualRows.length };
      }

      initLocalDb()
        .prepare(`
          UPDATE local_purchase_entries
          SET status = 'unsold_sent',
              sent_to_parent = COALESCE(sent_to_parent, forwarded_by),
              updated_at = ?,
              sync_status = ?
          WHERE ${conditions.join(' AND ')}
            AND LOWER(TRIM(status)) IN ('unsold_saved', 'unsold')
        `)
        .run(now, payload.serverSynced ? 'synced' : 'pending', ...params);
    }

    if (operationType === 'purchase_send') {
      const targetUserId = Number(payload.sellerId || payload.sellerUserId || 0);
      const purchaseNumbers = getPayloadNumbers(payload);
      const bookingDate = toLocalDate(payload.bookingDate);
      const sessionMode = String(payload.sessionMode || '');
      const purchaseCategory = String(payload.purchaseCategory || '');
      const amount = String(payload.amount || '');
      const boxValue = String(payload.boxValue || '');
      const memoNumber = payload.memoNumber ? Number(payload.memoNumber) : null;

      if (targetUserId && purchaseNumbers.length > 0 && bookingDate && sessionMode && purchaseCategory && amount && boxValue) {
        const insertPurchase = initLocalDb().prepare(`
          INSERT INTO local_purchase_entries (
            local_id, server_id, user_id, owner_user_id, forwarded_by, sent_to_parent,
            series, number, box_value, unique_code, amount, booking_date, session_mode,
            purchase_category, status, memo_number, purchase_memo_number, memo_row_order, entry_source,
            created_at, updated_at, sync_status
          )
          VALUES (
            @localId, NULL, @userId, @ownerUserId, @forwardedBy, @sentToParent,
            NULL, @number, @boxValue, NULL, @amount, @bookingDate, @sessionMode,
            @purchaseCategory, 'accepted', @memoNumber, @memoNumber, @memoRowOrder, 'purchase',
            @createdAt, @updatedAt, 'pending'
          )
          ON CONFLICT(local_id) DO UPDATE SET
            user_id = excluded.user_id,
            forwarded_by = excluded.forwarded_by,
            sent_to_parent = excluded.sent_to_parent,
            box_value = excluded.box_value,
            amount = excluded.amount,
            booking_date = excluded.booking_date,
            session_mode = excluded.session_mode,
            purchase_category = excluded.purchase_category,
            status = excluded.status,
            memo_number = excluded.memo_number,
            purchase_memo_number = excluded.purchase_memo_number,
            memo_row_order = excluded.memo_row_order,
            updated_at = excluded.updated_at,
            sync_status = excluded.sync_status
        `);

        const writePurchaseRows = initLocalDb().transaction((rows) => {
          rows.forEach((number) => {
            insertPurchase.run({
              localId: `offline-purchase-${targetUserId}-${bookingDate}-${sessionMode}-${purchaseCategory}-${amount}-${boxValue}-${number}`,
              userId: targetUserId,
              ownerUserId: Number(userId || 0) || null,
              forwardedBy: Number(userId || 0) || null,
              sentToParent: Number(userId || 0) || null,
              number,
              boxValue,
              amount,
              bookingDate,
              sessionMode,
              purchaseCategory,
              memoNumber,
              memoRowOrder: payload.memoRowOrder ?? 0,
              createdAt: now,
              updatedAt: now
            });
          });
        });

        writePurchaseRows(purchaseNumbers);
      }
    }

    if (operationType === 'replace_purchase_send_memo') {
      const currentUser = getLocalUsers().find((user) => Number(user.id) === Number(userId)) || {};
      const targetUserId = Number(payload.sellerId || payload.sellerUserId || 0);
      const memoNumber = Number(payload.deletedMemoNumber || payload.memoNumber || 0);
      const bookingDate = toLocalDate(payload.bookingDate);
      const sessionMode = String(payload.sessionMode || '');
      const purchaseCategory = String(payload.purchaseCategory || '');
      const amount = String(payload.amount || '');
      const isAdmin = String(currentUser.role || '').toLowerCase() === 'admin';

      if (targetUserId && memoNumber && bookingDate && sessionMode && purchaseCategory && amount) {
        const whereParams = [
          targetUserId,
          Number(userId || 0),
          memoNumber,
          memoNumber,
          bookingDate,
          sessionMode,
          purchaseCategory,
          amount
        ];
        const whereClause = `
          user_id = ?
          AND entry_source = 'purchase'
          AND forwarded_by = ?
          AND (memo_number = ? OR purchase_memo_number = ?)
          AND booking_date = ?
          AND session_mode = ?
          AND purchase_category = ?
          AND amount = ?
          AND LOWER(TRIM(status)) IN ('accepted', 'unsold', 'unsold_saved')
        `;

        if (isAdmin) {
          initLocalDb()
            .prepare(`DELETE FROM local_purchase_entries WHERE ${whereClause}`)
            .run(targetUserId, Number(userId || 0), memoNumber, memoNumber, bookingDate, sessionMode, purchaseCategory, amount);
        } else {
          initLocalDb()
            .prepare(`
              UPDATE local_purchase_entries
              SET user_id = ?,
                  sent_to_parent = NULL,
                  forwarded_by = ?,
                  memo_number = NULL,
                  purchase_memo_number = NULL,
                  updated_at = ?,
                  sync_status = ?
              WHERE ${whereClause}
            `)
            .run(
              Number(userId || 0),
              Number(userId || 0),
              now,
              payload.serverSynced ? 'synced' : 'pending',
              ...whereParams
            );
        }
      }
    }

    if (operationType === 'replace_unsold_memo') {
      const targetUserId = Number(payload.sellerId || payload.sellerUserId || userId || 0);
      const memoNumber = Number(payload.deletedMemoNumber || payload.memoNumber || 0);
      const bookingDate = toLocalDate(payload.bookingDate);
      const sessionMode = String(payload.sessionMode || '');
      const purchaseCategory = String(payload.purchaseCategory || '');
      const amount = String(payload.amount || '');

      if (targetUserId && memoNumber && bookingDate && sessionMode && purchaseCategory && amount) {
        if (Number(targetUserId) !== Number(userId)) {
          initLocalDb()
            .prepare(`
              DELETE FROM local_manual_unsold_entries
              WHERE actor_user_id = ?
                AND user_id = ?
                AND memo_number = ?
                AND booking_date = ?
                AND session_mode = ?
                AND purchase_category = ?
                AND amount = ?
            `)
            .run(Number(userId || 0), targetUserId, memoNumber, bookingDate, sessionMode, purchaseCategory, amount);

          (Array.isArray(payload.rows) ? payload.rows : []).forEach((row, index) => {
            saveManualUnsoldLocal({
              payload: {
                ...payload,
                rangeStart: row.rangeStart,
                rangeEnd: row.rangeEnd,
                boxValue: row.boxValue,
                amount: row.amount || amount,
                bookingDate: row.bookingDate || bookingDate,
                sessionMode: row.sessionMode || sessionMode,
                purchaseCategory: row.purchaseCategory || purchaseCategory,
                memoRowOrder: row.memoRowOrder ?? index
              },
              userId,
              syncStatus: payload.serverSynced ? 'synced' : 'pending'
            });
          });
          return { ok: true };
        }

        initLocalDb()
          .prepare(`
            UPDATE local_purchase_entries
            SET status = 'accepted',
                memo_number = COALESCE(purchase_memo_number, memo_number),
                updated_at = ?,
                sync_status = ?
            WHERE user_id = ?
              AND entry_source = 'purchase'
              AND forwarded_by = ?
              AND (memo_number = ? OR purchase_memo_number = ?)
              AND booking_date = ?
              AND session_mode = ?
              AND purchase_category = ?
              AND amount = ?
              AND LOWER(TRIM(status)) IN ('unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold')
          `)
          .run(
            now,
            payload.serverSynced ? 'synced' : 'pending',
            targetUserId,
            Number(userId || 0),
            memoNumber,
            memoNumber,
            bookingDate,
            sessionMode,
            purchaseCategory,
            amount
          );

        (Array.isArray(payload.rows) ? payload.rows : []).forEach((row, index) => {
          const numbers = getPayloadNumbers({
            rangeStart: row.rangeStart,
            rangeEnd: row.rangeEnd,
            number: row.number
          });

          if (numbers.length === 0) {
            return;
          }

          const rowBookingDate = toLocalDate(row.bookingDate || bookingDate);
          const rowSessionMode = String(row.sessionMode || sessionMode || '');
          const rowPurchaseCategory = String(row.purchaseCategory || purchaseCategory || '');
          const rowAmount = String(row.amount || amount || '');
          const rowBoxValue = String(row.boxValue || '');
          const placeholders = numbers.map(() => '?').join(', ');

          initLocalDb()
            .prepare(`
              UPDATE local_purchase_entries
              SET status = 'unsold_saved',
                  memo_number = ?,
                  purchase_memo_number = COALESCE(purchase_memo_number, memo_number, ?),
                  memo_row_order = ?,
                  updated_at = ?,
                  sync_status = ?
              WHERE user_id = ?
                AND entry_source = 'purchase'
                AND booking_date = ?
                AND session_mode = ?
                AND purchase_category = ?
                AND amount = ?
                AND box_value = ?
                AND number IN (${placeholders})
                AND LOWER(TRIM(status)) = 'accepted'
            `)
            .run(
              memoNumber,
              memoNumber,
              row.memoRowOrder ?? index,
              now,
              payload.serverSynced ? 'synced' : 'pending',
              targetUserId,
              rowBookingDate,
              rowSessionMode,
              rowPurchaseCategory,
              rowAmount,
              rowBoxValue,
              ...numbers
            );
        });
      }
    }

    if (operationType === 'stock_transfer') {
      const targetUserId = Number(payload.sellerId || payload.sellerUserId || 0);
      if (targetUserId) {
        initLocalDb()
          .prepare(`
            UPDATE local_purchase_entries
            SET user_id = ?,
                forwarded_by = ?,
                sent_to_parent = ?,
                status = 'accepted',
                updated_at = ?,
                sync_status = 'pending'
            WHERE entry_source IN ('purchase', 'admin_purchase')
              AND booking_date = ?
              AND session_mode = ?
              AND purchase_category = ?
              AND amount = ?
              AND user_id = ?
              AND LOWER(TRIM(status)) IN ('accepted', 'available')
          `)
          .run(
            targetUserId,
            Number(userId || 0) || null,
            Number(userId || 0) || null,
            now,
            toLocalDate(payload.bookingDate),
            String(payload.sessionMode || ''),
            String(payload.purchaseCategory || ''),
            String(payload.amount || ''),
            Number(userId || 0)
          );
      }
    }

    return { ok: true };
  });

  ipcMain.handle('local-db:get-purchase-bill-summary', (_event, filters = {}) => {
    const params = [];
    const conditions = ["entry_source = 'purchase'", "LOWER(TRIM(status)) IN ('accepted', 'unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold')"];
    const { fromDate, toDate } = getDateRange(filters);
    const currentUser = filters.user || {};
    const currentUserId = Number(currentUser.id || filters.userId || 0);
    const users = getSavedVisibleUsers();
    const usersById = new Map(users.map((user) => [Number(user.id), user]));

    if (fromDate && toDate) {
      params.push(fromDate, toDate);
      conditions.push('booking_date BETWEEN ? AND ?');
    }

    addCommonPurchaseFilters(conditions, params, filters);

    const rows = initLocalDb()
      .prepare(`
        SELECT
          user_id,
          session_mode,
          purchase_category,
          amount,
          box_value,
          SUM(CASE WHEN box_value GLOB '[0-9]*' THEN CAST(box_value AS REAL) ELSE 0 END) AS total_piece,
          SUM(CASE WHEN LOWER(TRIM(status)) IN ('unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold')
            AND box_value GLOB '[0-9]*'
            THEN CAST(box_value AS REAL) ELSE 0 END) AS unsold_piece,
          COUNT(*) AS entry_count,
          MIN(number) AS range_from,
          MAX(number) AS range_to
        FROM local_purchase_entries
        WHERE ${conditions.join(' AND ')}
        GROUP BY user_id, session_mode, purchase_category, amount, box_value
        ORDER BY user_id ASC, session_mode ASC, amount ASC, box_value ASC
      `)
      .all(...params);

    const groupedRows = new Map();
    rows.forEach((row) => {
      const groupUserId = currentUserId
        ? getDirectChildRootId(row.user_id, currentUserId, usersById)
        : Number(row.user_id);

      if (!groupUserId) {
        return;
      }

      const key = [groupUserId, row.session_mode, row.purchase_category, row.amount, row.box_value].join('|');
      const current = groupedRows.get(key) || {
        ...row,
        user_id: groupUserId,
        total_piece: 0,
        unsold_piece: 0,
        entry_count: 0,
        range_from: row.range_from,
        range_to: row.range_to
      };

      current.total_piece += Number(row.total_piece || 0);
      current.unsold_piece += Number(row.unsold_piece || 0);
      current.entry_count += Number(row.entry_count || 0);
      current.range_from = String(current.range_from || row.range_from) < String(row.range_from || current.range_from)
        ? current.range_from
        : row.range_from;
      current.range_to = String(current.range_to || row.range_to) > String(row.range_to || current.range_to)
        ? current.range_to
        : row.range_to;
      groupedRows.set(key, current);
    });

    if (currentUserId) {
      const sentScopeRows = initLocalDb()
        .prepare(`
          SELECT DISTINCT user_id, booking_date, session_mode, purchase_category, amount
          FROM local_purchase_entries
          WHERE LOWER(TRIM(status)) IN ('unsold_sent', 'unsold_accepted', 'unsold')
            AND (sent_to_parent = ? OR forwarded_by = ?)
            ${fromDate && toDate ? 'AND booking_date BETWEEN ? AND ?' : ''}
            ${filters.shift || filters.sessionMode ? 'AND session_mode = ?' : ''}
            ${filters.purchaseCategory ? 'AND purchase_category = ?' : ''}
            ${filters.amount ? 'AND amount = ?' : ''}
        `)
        .all(
          currentUserId,
          currentUserId,
          ...[
            ...(fromDate && toDate ? [fromDate, toDate] : []),
            ...(filters.shift || filters.sessionMode ? [String(filters.shift || filters.sessionMode)] : []),
            ...(filters.purchaseCategory ? [String(filters.purchaseCategory)] : []),
            ...(filters.amount ? [String(filters.amount)] : [])
          ]
        );
      const sentScopeSet = new Set(sentScopeRows.map((row) => {
        const groupUserId = getDirectChildRootId(row.user_id, currentUserId, usersById);
        return [groupUserId, row.session_mode, row.purchase_category, row.amount].join('|');
      }));

      sentScopeSet.forEach((scopeKey) => {
        [...groupedRows.entries()].forEach(([rowKey, row]) => {
          const rowScopeKey = [row.user_id, row.session_mode, row.purchase_category, row.amount].join('|');
          if (rowScopeKey === scopeKey) {
            groupedRows.set(rowKey, {
              ...row,
              unsold_piece: 0
            });
          }
        });
      });

      const rawUnsoldParams = [currentUserId, currentUserId];
      const rawUnsoldConditions = [
        "entry_source = 'purchase'",
        "LOWER(TRIM(status)) IN ('unsold_sent', 'unsold_accepted', 'unsold')",
        '(sent_to_parent = ? OR forwarded_by = ?)'
      ];
      if (fromDate && toDate) {
        rawUnsoldParams.push(fromDate, toDate);
        rawUnsoldConditions.push('booking_date BETWEEN ? AND ?');
      }
      addCommonPurchaseFilters(rawUnsoldConditions, rawUnsoldParams, filters);
      const rawUnsoldRows = initLocalDb()
        .prepare(`
          SELECT user_id, session_mode, purchase_category, amount, box_value,
                 SUM(CASE WHEN box_value GLOB '[0-9]*' THEN CAST(box_value AS REAL) ELSE 0 END) AS unsold_piece
          FROM local_purchase_entries
          WHERE ${rawUnsoldConditions.join(' AND ')}
          GROUP BY user_id, session_mode, purchase_category, amount, box_value
        `)
        .all(...rawUnsoldParams);

      rawUnsoldRows.forEach((row) => {
        const groupUserId = getDirectChildRootId(row.user_id, currentUserId, usersById);
        const scopeKey = [groupUserId, row.session_mode, row.purchase_category, row.amount].join('|');
        if (!sentScopeSet.has(scopeKey)) {
          return;
        }

        const key = [groupUserId, row.session_mode, row.purchase_category, row.amount, row.box_value].join('|');
        const current = groupedRows.get(key);
        if (!current) {
          return;
        }

        groupedRows.set(key, {
          ...current,
          unsold_piece: Number(current.unsold_piece || 0) + Number(row.unsold_piece || 0)
        });
      });

      const manualParams = [currentUserId];
      const manualConditions = ['actor_user_id = ?'];

      if (fromDate && toDate) {
        manualParams.push(fromDate, toDate);
        manualConditions.push('booking_date BETWEEN ? AND ?');
      }
      addCommonPurchaseFilters(manualConditions, manualParams, filters);

      const manualRows = initLocalDb()
        .prepare(`
          SELECT
            user_id,
            session_mode,
            purchase_category,
            amount,
            box_value,
            SUM(CASE WHEN box_value GLOB '[0-9]*' THEN CAST(box_value AS REAL) ELSE 0 END) AS manual_unsold_piece,
            COUNT(*) AS entry_count,
            MIN(number) AS range_from,
            MAX(number) AS range_to
          FROM local_manual_unsold_entries
          WHERE ${manualConditions.join(' AND ')}
          GROUP BY user_id, session_mode, purchase_category, amount, box_value
        `)
        .all(...manualParams);

      manualRows.forEach((row) => {
        const groupUserId = getDirectChildRootId(row.user_id, currentUserId, usersById);

        if (!groupUserId) {
          return;
        }

        const scopeKey = [groupUserId, row.session_mode, row.purchase_category, row.amount].join('|');
        if (sentScopeSet.has(scopeKey)) {
          return;
        }

        const key = [groupUserId, row.session_mode, row.purchase_category, row.amount, row.box_value].join('|');
        const current = groupedRows.get(key) || {
          ...row,
          user_id: groupUserId,
          total_piece: 0,
          unsold_piece: 0,
          entry_count: 0,
          range_from: row.range_from,
          range_to: row.range_to
        };

        current.unsold_piece += Number(row.manual_unsold_piece || 0);
        current.entry_count += Number(row.entry_count || 0);
        current.range_from = String(current.range_from || row.range_from) < String(row.range_from || current.range_from)
          ? current.range_from
          : row.range_from;
        current.range_to = String(current.range_to || row.range_to) > String(row.range_to || current.range_to)
          ? current.range_to
          : row.range_to;
        groupedRows.set(key, current);
      });
    }

    return [...groupedRows.values()].map((row) => {
      const user = usersById.get(Number(row.user_id)) || {};
      const totalPiece = Number(row.total_piece || 0);
      const unsoldPiece = Number(row.unsold_piece || 0);
      const soldPiece = Math.max(totalPiece - unsoldPiece, 0);
      const appliedRate = String(row.amount) === '7' ? Number(user.rateAmount6 || 0) : Number(user.rateAmount12 || 0);

      return {
        id: `${row.user_id}-${row.session_mode}-${row.purchase_category}-${row.amount}-${row.box_value}`,
        sellerId: row.user_id,
        sellerName: user.username || `User ${row.user_id}`,
        billRootUsername: user.username || `User ${row.user_id}`,
        billSellerDisplayName: user.username || `User ${row.user_id}`,
        actorUsername: user.username || `User ${row.user_id}`,
        sessionMode: row.session_mode,
        purchaseCategory: row.purchase_category,
        amount: Number(row.amount || 0),
        boxValue: row.box_value,
        sentPiece: totalPiece,
        unsoldPiece,
        soldPiece,
        totalPiece: soldPiece,
        appliedRate,
        billValue: soldPiece * appliedRate,
        entryCount: Number(row.entry_count || 0),
        numberRangeLabel: row.range_from === row.range_to ? row.range_from : `${row.range_from} to ${row.range_to}`
      };
    });
  });

  ipcMain.handle('local-db:trace-purchases', (_event, filters = {}) => {
    const params = [];
    const conditions = ['1 = 1'];
    const tokens = [
      ...String(filters.number || '').split(','),
      ...String(filters.uniqueCode || '').split(',')
    ].map((value) => value.trim()).filter(Boolean);
    const { fromDate, toDate } = getDateRange(filters);

    if (tokens.length > 0) {
      const placeholders = tokens.map(() => '?').join(', ');
      params.push(...tokens, ...tokens);
      conditions.push(`(number IN (${placeholders}) OR unique_code IN (${placeholders}))`);
    }

    if (fromDate && toDate) {
      params.push(fromDate, toDate);
      conditions.push('booking_date BETWEEN ? AND ?');
    }

    addCommonPurchaseFilters(conditions, params, {
      sessionMode: filters.sessionMode,
      amount: filters.amount,
      sem: filters.sem
    });

    return initLocalDb()
      .prepare(`
        SELECT *
        FROM local_purchase_entries
        WHERE ${conditions.join(' AND ')}
        ORDER BY booking_date DESC, updated_at DESC
        LIMIT 2000
      `)
      .all(...params)
      .map((row) => ({
        id: row.server_id || row.local_id,
        uniqueCode: row.unique_code,
        number: row.number,
        boxValue: row.box_value,
        amount: Number(row.amount),
        sessionMode: row.session_mode,
        status: row.status,
        entrySource: row.entry_source || 'purchase',
        purchaseCategory: row.purchase_category,
        bookedBy: null,
        currentHolder: null,
        forwardedBy: row.forwarded_by,
        sentTo: row.sent_to_parent,
        createdAt: row.created_at,
        sentAt: row.updated_at
      }));
  });

  ipcMain.handle('local-db:enqueue-sync', (_event, payload) => {
    const now = new Date().toISOString();
    const localId = payload?.localId || createLocalId('sync');

    initLocalDb()
      .prepare(`
        INSERT INTO sync_queue (
          local_id, user_id, operation_type, payload_json,
          status, attempt_count, last_error, created_at, updated_at
        )
        VALUES (
          @localId, @userId, @operationType, @payloadJson,
          'pending', 0, NULL, @createdAt, @updatedAt
        )
      `)
      .run({
        localId,
        userId: Number(payload?.userId || 0),
        operationType: String(payload?.operationType || ''),
        payloadJson: JSON.stringify(payload?.payload || {}),
        createdAt: now,
        updatedAt: now
      });

    return { ok: true, localId };
  });

  ipcMain.handle('local-db:list-sync-queue', (_event, { status = 'pending', limit = 100 } = {}) => (
    initLocalDb()
      .prepare('SELECT * FROM sync_queue WHERE status = ? ORDER BY created_at ASC LIMIT ?')
      .all(String(status), Number(limit) || 100)
      .map((row) => ({
        ...row,
        payload: JSON.parse(row.payload_json || '{}')
      }))
  ));

  ipcMain.handle('local-db:update-sync-item', (_event, { localId, status, lastError = null }) => {
    const now = new Date().toISOString();
    initLocalDb()
      .prepare(`
        UPDATE sync_queue
        SET status = @status,
            last_error = @lastError,
            attempt_count = attempt_count + 1,
            updated_at = @updatedAt
        WHERE local_id = @localId
      `)
      .run({
        localId: String(localId || ''),
        status: String(status || 'pending'),
        lastError,
        updatedAt: now
      });

    return { ok: true };
  });
};

module.exports = {
  initLocalDb,
  setupLocalDbIpc,
  getLocalDbPath
};
