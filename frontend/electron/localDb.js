const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');

let db;

const DRAFT_TABLES = {
  purchase_send: 'local_purchase_send_drafts',
  unsold: 'local_unsold_drafts',
  unsold_remove: 'local_unsold_remove_drafts'
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

    CREATE INDEX IF NOT EXISTS idx_local_purchase_lookup
    ON local_purchase_entries (user_id, booking_date, session_mode, purchase_category, amount, box_value, status, number);

    CREATE INDEX IF NOT EXISTS idx_local_purchase_memo
    ON local_purchase_entries (user_id, booking_date, session_mode, purchase_category, amount, memo_number);

    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
    ON sync_queue (status, created_at);
  `);

  ensureColumn(db, 'local_purchase_entries', 'series', 'TEXT');
  ensureColumn(db, 'local_purchase_entries', 'unique_code', 'TEXT');
  ensureColumn(db, 'local_purchase_entries', 'entry_source', "TEXT NOT NULL DEFAULT 'purchase'");

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_local_purchase_server_id
    ON local_purchase_entries (server_id)
    WHERE server_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_local_purchase_entry_source
    ON local_purchase_entries (entry_source, booking_date, session_mode, purchase_category, amount);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_local_prize_server_id
    ON local_prize_results (server_id)
    WHERE server_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_local_prize_lookup
    ON local_prize_results (result_for_date, session_mode, purchase_category, digit_length, winning_number);
  `);

  return db;
};

const createLocalId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
  entrySource: row.entry_source || 'purchase',
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

const getPrizeMultiplier = (amountValue, semValue) => {
  const amount = Number(amountValue);
  const sem = Number(semValue);

  if (!amount || !sem) {
    return 0;
  }

  return sem * (amount <= 7 ? 0.5 : 1);
};

const isUnsoldStatus = (status) => ['unsold_saved', 'unsold_sent', 'unsold_accepted', 'unsold'].includes(String(status || '').trim().toLowerCase());

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

  return initLocalDb()
    .prepare(`
      SELECT *
      FROM local_purchase_entries
      WHERE ${conditions.join(' AND ')}
      ORDER BY booking_date DESC, session_mode ASC, user_id ASC, amount ASC, box_value ASC, number ASC
    `)
    .all(...params);
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
      sellerUsername: null,
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
        purchase_category, status, memo_number, purchase_memo_number, entry_source,
        created_at, updated_at, sync_status
      )
      VALUES (
        @localId, @serverId, @userId, @ownerUserId, @forwardedBy, @sentToParent,
        @series, @number, @boxValue, @uniqueCode, @amount, @bookingDate, @sessionMode,
        @purchaseCategory, @status, @memoNumber, @purchaseMemoNumber, @entrySource,
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

    return rows.map(mapLocalPurchaseEntry);
  });

  ipcMain.handle('local-db:upsert-prize-results', (_event, results = []) => {
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
        @resultDate, @createdAt, @updatedAt, 'synced'
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

    const writeMany = database.transaction((rows) => {
      rows.forEach((row) => statement.run(row));
    });

    writeMany(normalizedResults);

    return { ok: true, saved: normalizedResults.length };
  });

  ipcMain.handle('local-db:list-prize-results', (_event, filters = {}) => listLocalPrizeResults(filters));

  ipcMain.handle('local-db:get-bill-prizes', (_event, filters = {}) => {
    const prizes = listLocalPrizeResults(filters);
    const purchases = listLocalPurchaseRowsForPrize(filters);

    return calculatePrizeRows({ purchases, prizes });
  });

  ipcMain.handle('local-db:check-prize', (_event, filters = {}) => {
    const number = String(filters.number || '').trim();
    const purchases = listLocalPurchaseRowsForPrize({
      date: filters.date,
      sessionMode: filters.sessionMode,
      purchaseCategory: filters.purchaseCategory,
      amount: String(filters.amount || '').toUpperCase() === 'ALL' ? '' : filters.amount,
      sem: String(filters.sem || '').toUpperCase() === 'ALL' ? '' : filters.sem
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
        sellerId: filters.sellerId
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
      initLocalDb()
        .prepare(`
          UPDATE local_purchase_entries
          SET status = 'unsold_saved',
              memo_number = COALESCE(?, memo_number),
              purchase_memo_number = COALESCE(?, purchase_memo_number, memo_number),
              updated_at = ?,
              sync_status = 'pending'
          WHERE ${conditions.join(' AND ')}
            AND LOWER(TRIM(status)) = 'accepted'
        `)
        .run(
          payload.memoNumber ? Number(payload.memoNumber) : null,
          payload.memoNumber ? Number(payload.memoNumber) : null,
          now,
          ...params
        );
    }

    if (operationType === 'unsold_remove') {
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
      initLocalDb()
        .prepare(`
          UPDATE local_purchase_entries
          SET status = 'unsold_sent',
              sent_to_parent = COALESCE(sent_to_parent, forwarded_by),
              updated_at = ?,
              sync_status = 'pending'
          WHERE ${conditions.join(' AND ')}
            AND LOWER(TRIM(status)) IN ('unsold_saved', 'unsold')
        `)
        .run(now, ...params);
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
            purchase_category, status, memo_number, purchase_memo_number, entry_source,
            created_at, updated_at, sync_status
          )
          VALUES (
            @localId, NULL, @userId, @ownerUserId, @forwardedBy, @sentToParent,
            NULL, @number, @boxValue, NULL, @amount, @bookingDate, @sessionMode,
            @purchaseCategory, 'accepted', @memoNumber, @memoNumber, 'purchase',
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
              createdAt: now,
              updatedAt: now
            });
          });
        });

        writePurchaseRows(purchaseNumbers);
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

    if (fromDate && toDate) {
      params.push(fromDate, toDate);
      conditions.push('booking_date BETWEEN ? AND ?');
    }

    addCommonPurchaseFilters(conditions, params, filters);

    const usersById = new Map(getSavedVisibleUsers().map((user) => [Number(user.id), user]));
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

    return rows.map((row) => {
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
