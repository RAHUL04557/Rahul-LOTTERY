const { query, getClient } = require('../config/database');
const { generateUniqueCode, isWithinTimeLimit, calculateUserLevel, getIndiaNowParts } = require('../utils/helpers');

const VALID_SESSION_MODES = ['MORNING', 'NIGHT'];
const isAdminRole = (role) => String(role || '').trim().toLowerCase() === 'admin';
const DATE_VALUE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PURCHASE_ENTRY_SOURCE = 'purchase';
const ADMIN_PURCHASE_ENTRY_SOURCE = 'admin_purchase';
const BOOKING_ENTRY_SOURCE = 'booking';
const VALID_PURCHASE_CATEGORIES = ['M', 'D', 'E'];
const UNSOLD_LOCAL_STATUS = 'unsold_saved';
const UNSOLD_SENT_STATUS = 'unsold_sent';
const UNSOLD_ACCEPTED_STATUS = 'unsold';
const PURCHASE_SEM_OPTIONS_BY_AMOUNT = {
  '7': ['5', '10', '25', '50', '100', '200'],
  '12': ['5', '10', '15', '20', '30', '50', '100', '200']
};
const SELLER_TYPE_SELLER = 'seller';
const SELLER_TYPE_SUB_SELLER = 'sub_seller';
const SELLER_TYPE_NORMAL_SELLER = 'normal_seller';

const normalizeSellerType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return [SELLER_TYPE_SELLER, SELLER_TYPE_SUB_SELLER, SELLER_TYPE_NORMAL_SELLER].includes(normalized)
    ? normalized
    : SELLER_TYPE_SELLER;
};

const getAllowedChildSellerTypes = (user) => {
  if (!user || user.role === 'admin') {
    return [SELLER_TYPE_SELLER, SELLER_TYPE_SUB_SELLER, SELLER_TYPE_NORMAL_SELLER];
  }

  const sellerType = normalizeSellerType(user.sellerType || user.seller_type);
  if (sellerType === SELLER_TYPE_SELLER) {
    return [SELLER_TYPE_SUB_SELLER, SELLER_TYPE_NORMAL_SELLER];
  }
  if (sellerType === SELLER_TYPE_SUB_SELLER) {
    return [SELLER_TYPE_NORMAL_SELLER];
  }
  return [];
};

const validatePurchaseTarget = ({ currentUser, targetUser, allowSelf = true, allowNormalSellerStockTransfer = true }) => {
  const currentUserIsAdmin = isAdminRole(currentUser?.role);
  const isSelfTransfer = Number(targetUser?.id) === Number(currentUser?.id);

  if (!targetUser || String(targetUser.role).toLowerCase() !== 'seller') {
    return 'Seller not found';
  }

  if (isSelfTransfer) {
    if (!allowSelf) {
      return 'Self transfer allowed nahi hai';
    }
    if (normalizeSellerType(currentUser?.sellerType || currentUser?.seller_type) === SELLER_TYPE_NORMAL_SELLER) {
      return 'Seller stock transfer nahi kar sakta';
    }
    return '';
  }

  if (!currentUserIsAdmin && Number(targetUser.parent_id || 0) !== Number(currentUser.id)) {
    return 'You can send purchase only to your direct stokist';
  }

  const targetSellerType = normalizeSellerType(targetUser.seller_type);
  if (!getAllowedChildSellerTypes(currentUser).includes(targetSellerType)) {
    return 'Is seller type ko aap purchase nahi bhej sakte';
  }

  if (!allowNormalSellerStockTransfer && targetSellerType === SELLER_TYPE_NORMAL_SELLER) {
    return 'Seller ko stock transfer nahi hoga; Purchase Send se direct F10 me bhejo';
  }

  return '';
};

const normalizeSessionMode = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  return VALID_SESSION_MODES.includes(normalized) ? normalized : null;
};

const normalizePurchaseCategory = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  return VALID_PURCHASE_CATEGORIES.includes(normalized) ? normalized : null;
};

const getDefaultPurchaseCategory = (sessionMode) => (sessionMode === 'NIGHT' ? 'E' : 'M');

const normalizePurchaseAmount = (value) => String(value ?? '').trim();

const normalizePurchaseBoxValue = (value) => String(value ?? '').trim();

const getPurchaseShiftKey = ({ sessionMode, purchaseCategory }) => {
  const normalizedCategory = normalizePurchaseCategory(purchaseCategory);
  if (normalizedCategory === 'D') {
    return 'DAY';
  }
  if (normalizedCategory === 'E' || normalizeSessionMode(sessionMode) === 'NIGHT') {
    return 'EVENING';
  }
  return 'MORNING';
};

const getUnsoldAutoAcceptDeadline = ({ sellerType, sessionMode, purchaseCategory }) => {
  const normalizedSellerType = normalizeSellerType(sellerType);
  const shiftKey = getPurchaseShiftKey({ sessionMode, purchaseCategory });

  if (normalizedSellerType === SELLER_TYPE_SUB_SELLER) {
    if (shiftKey === 'DAY') {
      return { hour: 17, minute: 50, second: 0 };
    }
    if (shiftKey === 'EVENING') {
      return { hour: 19, minute: 50, second: 0 };
    }
    return { hour: 12, minute: 50, second: 0 };
  }

  if (normalizedSellerType === SELLER_TYPE_SELLER) {
    if (shiftKey === 'DAY') {
      return { hour: 17, minute: 55, second: 0 };
    }
    if (shiftKey === 'EVENING') {
      return { hour: 19, minute: 50, second: 0 };
    }
    return { hour: 12, minute: 55, second: 0 };
  }

  return null;
};

const isWithinUnsoldAutoAcceptTime = ({ sellerType, bookingDate, sessionMode, purchaseCategory }) => {
  const deadline = getUnsoldAutoAcceptDeadline({ sellerType, sessionMode, purchaseCategory });
  if (!deadline) {
    return false;
  }

  const indiaNow = getIndiaNowParts();
  if (bookingDate && bookingDate !== indiaNow.date) {
    return false;
  }

  const currentTotalSeconds = (indiaNow.hour * 60 * 60) + (indiaNow.minute * 60) + indiaNow.second;
  const deadlineTotalSeconds = (deadline.hour * 60 * 60) + (deadline.minute * 60) + (deadline.second || 0);
  return currentTotalSeconds <= deadlineTotalSeconds;
};

const getPurchaseSemValidationError = (amount, boxValue) => {
  const normalizedAmount = normalizePurchaseAmount(amount);
  const normalizedBoxValue = normalizePurchaseBoxValue(boxValue);
  const allowedOptions = PURCHASE_SEM_OPTIONS_BY_AMOUNT[normalizedAmount] || [];

  if (!normalizedBoxValue) {
    return 'SEM is required';
  }

  if (allowedOptions.length === 0) {
    return '';
  }

  if (!allowedOptions.includes(normalizedBoxValue)) {
    return `Amount ${normalizedAmount} me sirf SEM ${allowedOptions.join(', ')} allowed hai`;
  }

  return '';
};

const shouldDirectAssignPurchaseToTarget = ({ currentUser, targetSeller }) => {
  if (!currentUser || !targetSeller) {
    return false;
  }

  if (Number(targetSeller.id) === Number(currentUser.id)) {
    return true;
  }

  return normalizeSellerType(targetSeller.seller_type) === SELLER_TYPE_NORMAL_SELLER;
};

const getPurchaseCategoryFromRequest = (req, sessionMode) => (
  normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory || req.headers['x-purchase-category'])
  || getDefaultPurchaseCategory(sessionMode)
);

const getRequiredSessionMode = (req, res) => {
  const sessionMode = normalizeSessionMode(req.body.sessionMode || req.query.sessionMode || req.headers['x-session-mode']);

  if (!sessionMode) {
    res.status(400).json({ message: 'Valid session mode is required' });
    return null;
  }

  return sessionMode;
};

const getOptionalSessionMode = (req) => normalizeSessionMode(req.body.sessionMode || req.query.sessionMode || req.headers['x-session-mode']);

const getTodayDateValue = () => {
  return getIndiaNowParts().date;
};

const normalizeBookingDate = (value) => {
  if (!value) {
    return getTodayDateValue();
  }

  const normalized = String(value).trim();
  if (!DATE_VALUE_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
};

const normalizeFiveDigitNumber = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 5);
  return digits.length === 5 ? digits : null;
};

const normalizePurchaseTicketNumber = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 5);
  return digits.length === 5 ? digits : null;
};

const normalizeRangeEndNumber = (startValue, endValue) => {
  const startNumber = normalizeFiveDigitNumber(startValue);
  const endDigits = String(endValue ?? '').replace(/\D/g, '').slice(0, 5);

  if (!startNumber) {
    return { error: 'Start number must be 5 digits' };
  }

  if (endDigits.length === 0 || endDigits.length > 5) {
    return { error: 'End number must be 1 to 5 digits' };
  }

  if (endDigits.length === 5) {
    return { value: endDigits };
  }

  const suffixLength = endDigits.length;
  const basePrefix = startNumber.slice(0, 5 - suffixLength);
  let candidateValue = Number(`${basePrefix}${endDigits}`);
  const startNumericValue = Number(startNumber);
  const step = 10 ** suffixLength;

  while (candidateValue < startNumericValue && candidateValue <= 99999) {
    candidateValue += step;
  }

  const candidate = String(candidateValue).padStart(5, '0');
  if (candidate.length !== 5 || candidateValue > 99999) {
    return { error: 'End number could not be resolved from the selected suffix' };
  }

  return { value: candidate };
};

const buildConsecutiveNumbers = (startValue, endValue) => {
  const startNumber = normalizeFiveDigitNumber(startValue);
  const normalizedEnd = normalizeRangeEndNumber(startValue, endValue);

  if (normalizedEnd.error) {
    return { error: normalizedEnd.error };
  }

  const endNumber = normalizedEnd.value;

  if (!startNumber || !endNumber) {
    return { error: 'Start number must be 5 digits' };
  }

  const start = Number(startNumber);
  const end = Number(endNumber);

  if (start > end) {
    return { error: 'End number must be greater than or equal to start number' };
  }

  if ((end - start) + 1 > 500) {
    return { error: 'Maximum 500 consecutive numbers allowed at once' };
  }

  return {
    numbers: Array.from({ length: (end - start) + 1 }, (_, index) => String(start + index).padStart(5, '0'))
  };
};

const buildPurchaseNumbers = (startValue, endValue) => {
  const startNumber = normalizePurchaseTicketNumber(startValue);
  const normalizedEnd = normalizeRangeEndNumber(startValue, endValue);

  if (normalizedEnd.error) {
    return { error: normalizedEnd.error };
  }

  const endNumber = normalizedEnd.value;

  if (!startNumber || !endNumber) {
    return { error: 'Start number must be exactly 5 digits (00000 to 99999)' };
  }

  const start = Number(startNumber);
  const end = Number(endNumber);

  if (start > end) {
    return { error: 'End number must be greater than or equal to start number' };
  }

  if ((end - start) + 1 > 100000) {
    return { error: 'Purchase range must be between 00000 and 99999' };
  }

  return {
    numbers: Array.from({ length: (end - start) + 1 }, (_, index) => String(start + index).padStart(startNumber.length, '0'))
  };
};

const getTraceTokens = (...values) => {
  const tokens = values
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\s,\\/|_-]+/))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(tokens)];
};

const buildDateFilter = ({ date, fromDate, toDate }, params, columnName = 'created_at', applyDefaultCurrentDate = false) => {
  let dateFilter = applyDefaultCurrentDate ? `AND DATE(${columnName}) = CURRENT_DATE` : '';

  if (fromDate && toDate) {
    if (fromDate > toDate) {
      return { error: 'From date cannot be after to date' };
    }

    params.push(fromDate, toDate);
    dateFilter = `AND DATE(${columnName}) BETWEEN $${params.length - 1}::date AND $${params.length}::date`;
  } else if (date) {
    params.push(date);
    dateFilter = `AND DATE(${columnName}) = $${params.length}::date`;
  } else if (fromDate || toDate) {
    return { error: 'Both from and to dates are required for range filter' };
  }

  return { dateFilter };
};

const formatDuplicateNumberLabel = (numbers = []) => (
  numbers.length > 5
    ? `${numbers.slice(0, 5).join(', ')} +${numbers.length - 5} more`
    : numbers.join(', ')
);

const formatDuplicateSellerLabel = (rows = []) => {
  const sellerNames = [...new Set(
    rows
      .map((row) => String(row.seller_name || row.username || '').trim())
      .filter(Boolean)
  )];

  if (sellerNames.length === 0) {
    return 'another seller';
  }

  if (sellerNames.length > 5) {
    return `${sellerNames.slice(0, 5).join(', ')} +${sellerNames.length - 5} more`;
  }

  return sellerNames.join(', ');
};

const findExistingPurchaseNumbers = async ({
  db,
  numbers,
  bookingDate,
  sessionMode,
  purchaseCategory,
  amount,
  excludeEntryIds = [],
  ignoreAmount = false
}) => {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return [];
  }

  const params = [
    [PURCHASE_ENTRY_SOURCE, ADMIN_PURCHASE_ENTRY_SOURCE],
    bookingDate,
    sessionMode,
    purchaseCategory,
    numbers
  ];
  let amountClause = '';
  let excludeClause = '';

  if (!ignoreAmount) {
    params.splice(4, 0, amount);
    amountClause = `AND amount = $5::numeric`;
  }

  const numbersParamIndex = ignoreAmount ? 5 : 6;

  if (excludeEntryIds.length > 0) {
    params.push(excludeEntryIds);
    excludeClause = `AND id <> ALL($${params.length}::int[])`;
  }

  const result = await db.query(
    `SELECT DISTINCT number
     FROM lottery_entries
     WHERE entry_source = ANY($1::varchar[])
       AND booking_date = $2::date
       AND session_mode = $3
       AND purchase_category = $4
       ${amountClause}
       AND number = ANY($${numbersParamIndex}::varchar[])
       ${excludeClause}
     ORDER BY number ASC`,
    params
  );

  return result.rows.map((row) => row.number);
};

const findExistingPurchaseAllocations = async ({
  db,
  numbers,
  bookingDate,
  sessionMode,
  purchaseCategory,
  amount,
  excludeEntryIds = []
}) => {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return [];
  }

  const params = [
    [PURCHASE_ENTRY_SOURCE, ADMIN_PURCHASE_ENTRY_SOURCE],
    bookingDate,
    sessionMode,
    purchaseCategory,
    amount,
    numbers
  ];
  let excludeClause = '';

  if (excludeEntryIds.length > 0) {
    params.push(excludeEntryIds);
    excludeClause = `AND le.id <> ALL($${params.length}::int[])`;
  }

  const result = await db.query(
    `SELECT DISTINCT le.number, le.memo_number, COALESCE(u.username, 'Unknown') AS seller_name
     FROM lottery_entries le
     LEFT JOIN users u ON u.id = le.user_id
     WHERE le.entry_source = ANY($1::varchar[])
       AND le.booking_date = $2::date
       AND le.session_mode = $3
       AND le.purchase_category = $4
       AND le.amount = $5::numeric
       AND le.number = ANY($6::varchar[])
       ${excludeClause}
     ORDER BY seller_name ASC, le.number ASC`,
    params
  );

  return result.rows;
};

const ensureAdminPurchaseNumbersAreAssignable = async ({
  db,
  numbers,
  bookingDate,
  sessionMode,
  purchaseCategory,
  amount
}) => {
  const duplicateAllocations = await findExistingPurchaseAllocations({
    db,
    numbers,
    bookingDate,
    sessionMode,
    purchaseCategory,
    amount
  });

  if (duplicateAllocations.length > 0) {
    return {
      error: `You already send this stock to ${formatDuplicateSellerLabel(duplicateAllocations)}`
    };
  }

  return { ok: true };
};

const findSellerOwnedPurchaseStockEntries = async ({
  db,
  ownerUserId,
  bookingDate,
  sessionMode,
  purchaseCategory,
  amount,
  boxValue,
  numbers
}) => db.query(
  `SELECT *
   FROM lottery_entries
   WHERE user_id = $1
     AND entry_source = $2
     AND status = $3
     AND booking_date = $4::date
     AND session_mode = $5
     AND purchase_category = $6
     AND amount = $7::numeric
     AND box_value = $8
     AND number = ANY($9::varchar[])
     AND NOT (forwarded_by = $10 AND memo_number IS NOT NULL)
   ORDER BY number ASC`,
  [
    ownerUserId,
    PURCHASE_ENTRY_SOURCE,
    'accepted',
    bookingDate,
    sessionMode,
    purchaseCategory,
    amount,
    boxValue,
    numbers,
    ownerUserId
  ]
);

const mapLotteryEntry = (row) => ({
  id: row.id,
  userId: row.user_id,
  username: row.username || null,
  parentUsername: row.parent_username || null,
  forwardedBy: row.forwarded_by || null,
  forwardedByUsername: row.forwarded_by_username || null,
  series: row.series,
  number: row.number,
  boxValue: row.box_value,
  uniqueCode: row.unique_code,
  amount: Number(row.amount),
  sessionMode: row.session_mode,
  status: row.status,
  entrySource: row.entry_source || BOOKING_ENTRY_SOURCE,
  memoNumber: row.memo_number,
  purchaseMemoNumber: row.purchase_memo_number || row.memo_number,
  purchaseCategory: row.purchase_category || getDefaultPurchaseCategory(row.session_mode),
  sentToParent: row.sent_to_parent,
  bookingDate: row.booking_date,
  createdAt: row.created_at,
  sentAt: row.sent_at
});

const mapTraceRecord = (row) => ({
  id: row.id,
  uniqueCode: row.unique_code,
  number: row.number,
  boxValue: row.box_value,
  amount: Number(row.amount),
  sessionMode: row.session_mode,
  status: row.status,
  entrySource: row.entry_source || BOOKING_ENTRY_SOURCE,
  purchaseCategory: row.purchase_category || getDefaultPurchaseCategory(row.session_mode),
  bookedBy: row.booked_by_username,
  currentHolder: row.current_holder_username,
  forwardedBy: row.forwarded_by_display || row.forwarded_by_username,
  sentTo: row.initial_sent_to_username || row.sent_to_username,
  createdAt: row.created_at,
  sentAt: row.sent_at
});

const mapHistoryRecord = (row) => ({
  id: row.id,
  entryId: row.entry_id,
  uniqueCode: row.unique_code,
  number: row.number,
  boxValue: row.box_value,
  amount: Number(row.amount),
  bookingDate: row.booking_date,
  fromUserId: row.from_user_id,
  fromUsername: row.from_username,
  toUserId: row.to_user_id,
  toUsername: row.to_username,
  actorUserId: row.actor_user_id,
  actorUsername: row.actor_username,
  actionType: row.action_type,
  statusBefore: row.status_before,
  statusAfter: row.status_after,
  memoNumber: row.memo_number,
  sessionMode: row.session_mode,
  purchaseCategory: row.purchase_category || getDefaultPurchaseCategory(row.session_mode),
  createdAt: row.created_at
});

const getLatestAcceptedUnsoldSnapshotRows = async ({
  targetSellerId,
  viewerUserId,
  bookingDate = null,
  sessionMode = null,
  purchaseCategory = null,
  amount = '',
  boxValue = ''
}) => {
  const params = [targetSellerId];
  const historyConditions = [
    "h.action_type IN ('unsold_accepted', 'unsold_auto_accepted')",
    'le.user_id = $1'
  ];
  const rowConditions = ['snapshot.user_id = $1'];

  if (bookingDate) {
    params.push(bookingDate);
    historyConditions.push(`h.booking_date = $${params.length}::date`);
    rowConditions.push(`snapshot.booking_date = $${params.length}::date`);
  }

  if (sessionMode) {
    params.push(sessionMode);
    historyConditions.push(`h.session_mode = $${params.length}`);
    rowConditions.push(`snapshot.session_mode = $${params.length}`);
  }

  if (purchaseCategory) {
    params.push(purchaseCategory);
    historyConditions.push(`h.purchase_category = $${params.length}`);
    rowConditions.push(`snapshot.purchase_category = $${params.length}`);
  }

  if (amount) {
    params.push(amount);
    historyConditions.push(`h.amount = $${params.length}::numeric`);
    rowConditions.push(`snapshot.amount = $${params.length}::numeric`);
  }

  if (boxValue) {
    params.push(boxValue);
    historyConditions.push(`h.box_value = $${params.length}`);
    rowConditions.push(`snapshot.box_value = $${params.length}`);
  }

  params.push(viewerUserId);
  const viewerParamIndex = params.length;

  const result = await query(
    `WITH latest_memo_batches AS (
       SELECT
         le.user_id,
         h.memo_number,
         h.booking_date,
         h.session_mode,
         h.purchase_category,
         h.amount,
         MAX(h.created_at) AS latest_created_at
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       WHERE ${historyConditions.join(' AND ')}
       GROUP BY le.user_id, h.memo_number, h.booking_date, h.session_mode, h.purchase_category, h.amount
     ),
     snapshot AS (
       SELECT
         h.entry_id AS id,
         le.user_id,
         seller_user.username,
         parent_user.username AS parent_username,
         $${viewerParamIndex}::int AS forwarded_by,
         actor_user.username AS forwarded_by_username,
         NULL::varchar AS series,
         h.number,
         h.box_value,
         h.unique_code,
         h.amount,
         h.session_mode,
         '${UNSOLD_ACCEPTED_STATUS}'::varchar AS status,
         '${PURCHASE_ENTRY_SOURCE}'::varchar AS entry_source,
         h.memo_number,
         h.memo_number AS purchase_memo_number,
         h.purchase_category,
         $${viewerParamIndex}::int AS sent_to_parent,
         h.booking_date,
         h.created_at,
         h.created_at AS sent_at
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       INNER JOIN latest_memo_batches batch
        ON batch.user_id = le.user_id
       AND batch.memo_number = h.memo_number
       AND batch.booking_date = h.booking_date
       AND batch.session_mode = h.session_mode
       AND batch.purchase_category = h.purchase_category
       AND batch.amount = h.amount
       AND batch.latest_created_at = h.created_at
       LEFT JOIN users seller_user ON seller_user.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = $${viewerParamIndex}
       LEFT JOIN users actor_user ON actor_user.id = h.actor_user_id
       WHERE h.action_type IN ('unsold_accepted', 'unsold_auto_accepted')
     )
     SELECT *
     FROM snapshot
     WHERE ${rowConditions.join(' AND ')}
     ORDER BY snapshot.booking_date DESC, snapshot.session_mode ASC, snapshot.number ASC`,
    params
  );

  return result.rows;
};

let historyStorageReadyPromise = null;

const ensureHistoryStorage = async () => {
  if (historyStorageReadyPromise) {
    return historyStorageReadyPromise;
  }

  historyStorageReadyPromise = (async () => {
  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS forwarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING'
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS booking_date DATE NOT NULL DEFAULT CURRENT_DATE
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS entry_source VARCHAR(20) NOT NULL DEFAULT 'booking'
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS memo_number INTEGER
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS purchase_memo_number INTEGER
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS purchase_category VARCHAR(1)
  `);

  await query(`
    UPDATE lottery_entries
    SET session_mode = CASE
      WHEN EXTRACT(HOUR FROM COALESCE(sent_at, created_at)) < 15 THEN 'MORNING'
      ELSE 'NIGHT'
    END
    WHERE session_mode IS NULL OR session_mode = ''
  `);

  await query(`
    UPDATE lottery_entries
    SET booking_date = DATE(created_at)
    WHERE booking_date IS NULL
  `);

  await query(`
    UPDATE lottery_entries
    SET entry_source = 'booking'
    WHERE entry_source IS NULL OR TRIM(entry_source) = ''
  `);

  await query(`
    UPDATE lottery_entries
    SET purchase_category = CASE
      WHEN session_mode = 'NIGHT' THEN 'E'
      ELSE 'M'
    END
    WHERE purchase_category IS NULL OR TRIM(purchase_category) = ''
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS lottery_entry_history (
      id SERIAL PRIMARY KEY,
      entry_id INTEGER REFERENCES lottery_entries(id) ON DELETE SET NULL,
      unique_code VARCHAR(255) NOT NULL,
      number VARCHAR(10) NOT NULL,
      box_value VARCHAR(20) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      from_username VARCHAR(255) NOT NULL,
      to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      to_username VARCHAR(255) NOT NULL,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_username VARCHAR(255) NOT NULL,
      action_type VARCHAR(50) NOT NULL,
      status_before VARCHAR(20),
      status_after VARCHAR(20),
      session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING',
      booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    ALTER TABLE lottery_entry_history
    ADD COLUMN IF NOT EXISTS session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING'
  `);

  await query(`
    ALTER TABLE lottery_entry_history
    ADD COLUMN IF NOT EXISTS booking_date DATE NOT NULL DEFAULT CURRENT_DATE
  `);

  await query(`
    ALTER TABLE lottery_entry_history
    ADD COLUMN IF NOT EXISTS memo_number INTEGER
  `);

  await query(`
    ALTER TABLE lottery_entry_history
    ADD COLUMN IF NOT EXISTS purchase_category VARCHAR(1)
  `);

  await query(`
    UPDATE lottery_entries le
    SET purchase_memo_number = purchase_history.memo_number
    FROM (
      SELECT DISTINCT ON (h.entry_id)
        h.entry_id,
        h.memo_number
      FROM lottery_entry_history h
      WHERE h.entry_id IS NOT NULL
        AND h.memo_number IS NOT NULL
        AND h.action_type IN (
          'purchase_self_memo_created',
          'purchase_sent',
          'purchase_forwarded',
          'purchase_memo_updated',
          'purchase_forward_memo_updated'
        )
      ORDER BY h.entry_id, h.created_at ASC, h.id ASC
    ) AS purchase_history
    WHERE le.id = purchase_history.entry_id
      AND le.entry_source = 'purchase'
      AND (
        le.purchase_memo_number IS NULL
        OR le.purchase_memo_number <> purchase_history.memo_number
      )
  `);

  await query(`
    UPDATE lottery_entries
    SET purchase_memo_number = memo_number
    WHERE entry_source = 'purchase'
      AND memo_number IS NOT NULL
      AND purchase_memo_number IS NULL
  `);

  await query(`
    UPDATE lottery_entry_history
    SET session_mode = CASE
      WHEN EXTRACT(HOUR FROM created_at) < 15 THEN 'MORNING'
      ELSE 'NIGHT'
    END
    WHERE session_mode IS NULL OR session_mode = ''
  `);

  await query(`
    UPDATE lottery_entry_history
    SET booking_date = DATE(created_at)
    WHERE booking_date IS NULL
  `);

  await query(`
    UPDATE lottery_entry_history
    SET purchase_category = CASE
      WHEN session_mode = 'NIGHT' THEN 'E'
      ELSE 'M'
    END
    WHERE purchase_category IS NULL OR TRIM(purchase_category) = ''
  `);

  await query(`
    UPDATE lottery_entry_history h
    SET booking_date = le.booking_date
    FROM lottery_entries le
    WHERE h.entry_id = le.id
      AND h.booking_date <> le.booking_date
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_lottery_entries_purchase_stock_lookup
    ON lottery_entries (
      user_id,
      entry_source,
      status,
      booking_date,
      session_mode,
      purchase_category,
      amount,
      box_value,
      number
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_lottery_entries_purchase_uniqueness_lookup
    ON lottery_entries (
      entry_source,
      booking_date,
      session_mode,
      purchase_category,
      amount,
      box_value,
      number
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_lottery_entries_purchase_memo_lookup
    ON lottery_entries (
      user_id,
      entry_source,
      forwarded_by,
      memo_number,
      booking_date,
      status
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_lottery_entry_history_entry_date
    ON lottery_entry_history (entry_id, booking_date)
  `);

  await query(`
    UPDATE lottery_entries le
    SET forwarded_by = h.actor_user_id,
        sent_to_parent = h.actor_user_id,
        sent_at = COALESCE(le.sent_at, h.created_at)
    FROM lottery_entry_history h
    WHERE h.entry_id = le.id
      AND le.user_id = h.actor_user_id
      AND h.to_user_id = h.actor_user_id
      AND le.entry_source = 'purchase'
      AND le.status = 'accepted'
      AND le.memo_number IS NOT NULL
      AND (
        le.forwarded_by IS DISTINCT FROM h.actor_user_id
        OR le.sent_to_parent IS DISTINCT FROM h.actor_user_id
      )
  `);
  })();

  try {
    await historyStorageReadyPromise;
  } catch (error) {
    historyStorageReadyPromise = null;
    throw error;
  }
};

const getUsernamesByIds = async (userIds) => {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return {};
  }

  const result = await query('SELECT id, username FROM users WHERE id = ANY($1::int[])', [uniqueIds]);
  return result.rows.reduce((acc, row) => {
    acc[row.id] = row.username;
    return acc;
  }, {});
};

const insertHistoryRecords = async ({
  entries,
  actionType,
  statusBefore,
  statusAfter,
  actorUserId,
  actorUsername,
  toUserId,
  toUsername,
  memoNumber = null,
  client = null
}) => {
  if (!entries || entries.length === 0) {
    return;
  }

  await ensureHistoryStorage();

  const db = client || { query };
  const columnsPerRow = 18;
  const chunkSize = 1000;

  for (let chunkStart = 0; chunkStart < entries.length; chunkStart += chunkSize) {
    const chunk = entries.slice(chunkStart, chunkStart + chunkSize);
    const values = [];
    const placeholders = chunk.map((entry, index) => {
      const offset = index * columnsPerRow;
      values.push(
        entry.id,
        entry.unique_code,
        entry.number,
        entry.box_value,
        entry.amount,
        actorUserId,
        actorUsername || 'Unknown',
        toUserId,
        toUsername || 'Unknown',
        actorUserId,
        actorUsername || 'Unknown',
        actionType,
        statusBefore,
        statusAfter,
        entry.session_mode || 'MORNING',
        entry.booking_date || getTodayDateValue(),
        memoNumber || entry.memo_number || null,
        entry.purchase_category || getDefaultPurchaseCategory(entry.session_mode)
      );

      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}::date, $${offset + 17}, $${offset + 18})`;
    });

    await db.query(
      `INSERT INTO lottery_entry_history (
        entry_id, unique_code, number, box_value, amount,
        from_user_id, from_username, to_user_id, to_username,
        actor_user_id, actor_username, action_type, status_before, status_after, session_mode, booking_date, memo_number, purchase_category
      )
      VALUES ${placeholders.join(', ')}`,
      values
    );
  }
};

const deleteUnsoldRemoveHistoryForEntries = async (entries = [], client = null) => {
  const entryIds = [...new Set(
    entries
      .map((entry) => Number(entry.id || entry.entry_id || 0))
      .filter((entryId) => Number.isInteger(entryId) && entryId > 0)
  )];

  if (entryIds.length === 0) {
    return;
  }

  await ensureHistoryStorage();
  const db = client || { query };
  await db.query(
    "DELETE FROM lottery_entry_history WHERE action_type = 'unsold_removed' AND entry_id = ANY($1::int[])",
    [entryIds]
  );
};

const getVisibleBranchIds = async (rootUserId, includeSelf = false) => {
  const result = await query(
    `WITH RECURSIVE branch_users AS (
      SELECT id, parent_id
      FROM users
      WHERE id = $1
      UNION ALL
      SELECT u.id, u.parent_id
      FROM users u
      INNER JOIN branch_users bu ON u.parent_id = bu.id
    )
    SELECT id FROM branch_users`,
    [rootUserId]
  );

  return result.rows
    .map((row) => row.id)
    .filter((id) => includeSelf || id !== rootUserId);
};

const getDirectSellerBranchIds = async (ownerUserId, sellerId) => {
  const result = await query(
    `WITH RECURSIVE branch_users AS (
       SELECT id, parent_id
       FROM users
       WHERE id = $2
         AND parent_id = $1
         AND role = 'seller'
       UNION ALL
       SELECT u.id, u.parent_id
       FROM users u
       INNER JOIN branch_users bu ON u.parent_id = bu.id
       WHERE u.role = 'seller'
     )
     SELECT id FROM branch_users`,
    [ownerUserId, sellerId]
  );

  return result.rows.map((row) => Number(row.id)).filter(Boolean);
};

const normalizeQueuedEntries = async (visibleUserIds = []) => {
  const params = [];
  let visibilityFilter = '';

  if (visibleUserIds.length > 0) {
    params.push(visibleUserIds);
    visibilityFilter = `AND le.user_id = ANY($1::int[])`;
  }

  const queuedForSellerResult = await query(
    `UPDATE lottery_entries le
     SET status = 'sent'
     FROM users parent_user
     WHERE le.sent_to_parent = parent_user.id
       AND le.status = 'queued'
       AND LOWER(TRIM(parent_user.role)) <> 'admin'
       AND le.booking_date <= CURRENT_DATE
       ${visibilityFilter}
     RETURNING le.id, le.user_id, le.unique_code, le.number, le.box_value, le.amount, le.session_mode, le.booking_date`,
    params
  );

  const queuedForAdminResult = await query(
    `UPDATE lottery_entries le
     SET status = 'accepted'
     FROM users parent_user
     WHERE le.sent_to_parent = parent_user.id
       AND le.status = 'queued'
       AND LOWER(TRIM(parent_user.role)) = 'admin'
       AND le.booking_date <= CURRENT_DATE
       ${visibilityFilter}
     RETURNING le.id, le.user_id, le.unique_code, le.number, le.box_value, le.amount, le.session_mode, le.booking_date`,
    params
  );

  if (queuedForSellerResult.rows.length > 0) {
    await insertHistoryRecords({
      entries: queuedForSellerResult.rows,
      actionType: 'queue_released',
      statusBefore: 'queued',
      statusAfter: 'sent',
      actorUserId: null,
      actorUsername: 'System',
      toUserId: null,
      toUsername: 'Queue Date Reached'
    });
  }

  if (queuedForAdminResult.rows.length > 0) {
    await insertHistoryRecords({
      entries: queuedForAdminResult.rows,
      actionType: 'auto_accepted',
      statusBefore: 'queued',
      statusAfter: 'accepted',
      actorUserId: null,
      actorUsername: 'System',
      toUserId: null,
      toUsername: 'Admin'
    });
  }
};

const normalizeAdminAcceptedEntries = async (visibleUserIds = []) => {
  await normalizeQueuedEntries(visibleUserIds);

  const params = [];
  let visibilityFilter = '';

  if (visibleUserIds.length > 0) {
    params.push(visibleUserIds);
    visibilityFilter = `AND le.user_id = ANY($1::int[])`;
  }

  await query(
    `UPDATE lottery_entries le
     SET status = 'accepted'
     FROM users parent_user
     WHERE le.sent_to_parent = parent_user.id
       AND le.status = 'sent'
       AND LOWER(TRIM(parent_user.role)) = 'admin'
       ${visibilityFilter}`,
    params
  );
};

const addLotteryEntry = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const {
      series,
      number: rawNumber,
      rangeStart,
      rangeEnd,
      boxValue,
      amount,
      uniqueCode: requestedUniqueCode,
      bookingDate: rawBookingDate
    } = req.body;
    const userId = req.user.id;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const number = normalizeFiveDigitNumber(rawNumber);
    const hasRangeInput = rangeStart !== undefined || rangeEnd !== undefined;
    const rangeResult = hasRangeInput ? buildConsecutiveNumbers(rangeStart, rangeEnd) : null;
    const numbersToBook = rangeResult?.numbers || (number ? [number] : []);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if ((!number && !hasRangeInput) || !boxValue || amount === undefined || amount === null) {
      return res.status(400).json({ message: 'Number, box value and amount required' });
    }

    const normalizedAmount = String(amount).trim();
    const amountRateMap = {
      '7': Number(req.user.rateAmount6 || 0),
      '12': Number(req.user.rateAmount12 || 0)
    };

    if (Object.prototype.hasOwnProperty.call(amountRateMap, normalizedAmount) && amountRateMap[normalizedAmount] <= 0) {
      return res.status(403).json({
        message: `Amount ${normalizedAmount} booking is not enabled for this seller`
      });
    }

    if (hasRangeInput && rangeResult?.error) {
      return res.status(400).json({ message: rangeResult.error });
    }

    if (numbersToBook.length === 0) {
      return res.status(400).json({ message: 'Valid 5-digit number is required' });
    }

    if (bookingDate === getTodayDateValue() && !isWithinTimeLimit(sessionMode)) {
      return res.status(400).json({ message: 'Time limit exceeded for posting entries' });
    }

    const duplicateCheck = await query(
      `SELECT number FROM lottery_entries
       WHERE number = ANY($1::varchar[])
       AND session_mode = $2
       AND booking_date = $3::date
       AND amount = $4::numeric
       ORDER BY number ASC`,
      [numbersToBook, sessionMode, bookingDate, normalizedAmount]
    );
    if (duplicateCheck.rows.length > 0) {
      const duplicateNumbers = duplicateCheck.rows.map((row) => row.number);
      const duplicateLabel = duplicateNumbers.length > 5
        ? `${duplicateNumbers.slice(0, 5).join(', ')} +${duplicateNumbers.length - 5} more`
        : duplicateNumbers.join(', ');
      return res.status(400).json({ message: `Already Sold: ${duplicateLabel}` });
    }

    if (requestedUniqueCode && numbersToBook.length === 1) {
      const codeResult = await query('SELECT id FROM lottery_entries WHERE unique_code = $1 LIMIT 1', [requestedUniqueCode]);
      if (codeResult.rows.length > 0) {
        return res.status(400).json({ message: 'Unique code already exists' });
      }
    }

    const insertedEntries = [];

    for (const currentNumber of numbersToBook) {
      let uniqueCode = numbersToBook.length === 1 ? requestedUniqueCode || null : null;

      if (!uniqueCode) {
        let exists = true;
        while (exists) {
          uniqueCode = generateUniqueCode();
          const codeResult = await query('SELECT id FROM lottery_entries WHERE unique_code = $1 LIMIT 1', [uniqueCode]);
          exists = codeResult.rows.length > 0 || insertedEntries.some((entry) => entry.unique_code === uniqueCode);
        }
      }

      const entryResult = await query(
        `INSERT INTO lottery_entries (user_id, series, number, box_value, unique_code, amount, status, session_mode, booking_date, entry_source)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8::date, $9)
         RETURNING *`,
        [userId, series || null, currentNumber, boxValue, uniqueCode, amount, sessionMode, bookingDate, BOOKING_ENTRY_SOURCE]
      );

      insertedEntries.push(entryResult.rows[0]);
    }

    await insertHistoryRecords({
      entries: insertedEntries,
      actionType: 'booked',
      statusBefore: null,
      statusAfter: 'pending',
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: req.user.id,
      toUsername: req.user.username
    });

    res.status(201).json({
      message: insertedEntries.length === 1 ? 'Entry added successfully' : `${insertedEntries.length} entries added successfully`,
      entry: mapLotteryEntry(insertedEntries[0]),
      entries: insertedEntries.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const assignPurchasedEntries = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const {
      sellerId,
      sellerUserId,
      series,
      rangeStart,
      rangeEnd,
      boxValue,
      amount,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const targetSellerId = Number(sellerId || sellerUserId);
    const rangeResult = buildPurchaseNumbers(rangeStart, rangeEnd);
    const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory || req.headers['x-purchase-category']);
    const normalizedBoxValue = normalizePurchaseBoxValue(boxValue);
    const normalizedAmount = normalizePurchaseAmount(amount);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!targetSellerId || !boxValue || amount === undefined || amount === null || !rangeStart || !rangeEnd) {
      return res.status(400).json({ message: 'Seller, range, box value and amount are required' });
    }

    if (rangeResult.error) {
      return res.status(400).json({ message: rangeResult.error });
    }

    const sellerResult = await query(
      'SELECT id, username, role, parent_id, rate_amount_6, rate_amount_12 FROM users WHERE id = $1 LIMIT 1',
      [targetSellerId]
    );
    const targetSeller = sellerResult.rows[0];

    if (!targetSeller || String(targetSeller.role).toLowerCase() !== 'seller') {
      return res.status(404).json({ message: 'Seller not found' });
    }

    const semValidationError = getPurchaseSemValidationError(normalizedAmount, normalizedBoxValue);
    if (semValidationError) {
      return res.status(400).json({ message: semValidationError });
    }

    const amountRateMap = {
      '7': Number(targetSeller.rate_amount_6 || 0),
      '12': Number(targetSeller.rate_amount_12 || 0)
    };

    if (Object.prototype.hasOwnProperty.call(amountRateMap, normalizedAmount) && amountRateMap[normalizedAmount] <= 0) {
      return res.status(400).json({ message: `Selected seller cannot use amount ${normalizedAmount}` });
    }

    const duplicateNumbers = await findExistingPurchaseNumbers({
      db: { query },
      numbers: rangeResult.numbers,
      bookingDate,
      sessionMode,
      purchaseCategory,
      amount: normalizedAmount,
      boxValue: normalizedBoxValue
    });

    if (duplicateNumbers.length > 0) {
      return res.status(400).json({
        message: `Ye number selected date, shift, rate me pehle se use ho chuka hai: ${formatDuplicateNumberLabel(duplicateNumbers)}`
      });
    }

    const insertedEntries = [];
    const isSelfTransfer = Number(targetSeller.id) === Number(req.user.id);
    const sentToParent = isSelfTransfer ? req.user.id : (targetSeller.parent_id || req.user.id);

    for (const currentNumber of rangeResult.numbers) {
      let uniqueCode = null;
      let exists = true;

      while (exists) {
        uniqueCode = generateUniqueCode();
        const codeResult = await query('SELECT id FROM lottery_entries WHERE unique_code = $1 LIMIT 1', [uniqueCode]);
        exists = codeResult.rows.length > 0 || insertedEntries.some((entry) => entry.unique_code === uniqueCode);
      }

      const entryResult = await query(
        `INSERT INTO lottery_entries (
          user_id, series, number, box_value, unique_code, amount, status,
          sent_to_parent, forwarded_by, session_mode, booking_date, sent_at, entry_source, purchase_category
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'accepted', $7, $8, $9, $10::date, CURRENT_TIMESTAMP, $11, $12)
        RETURNING *`,
        [
          targetSeller.id,
          series || null,
          currentNumber,
          normalizedBoxValue,
          uniqueCode,
          normalizedAmount,
          sentToParent,
          req.user.id,
          sessionMode,
          bookingDate,
          PURCHASE_ENTRY_SOURCE,
          purchaseCategory
        ]
      );

      insertedEntries.push(entryResult.rows[0]);
    }

    await insertHistoryRecords({
      entries: insertedEntries,
      actionType: 'purchase_assigned',
      statusBefore: null,
      statusAfter: 'accepted',
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: targetSeller.id,
      toUsername: targetSeller.username
    });

    res.status(201).json({
      message: `${insertedEntries.length} purchase numbers assigned successfully`,
      entries: insertedEntries.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const addAdminPurchaseEntries = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const {
      series,
      rangeStart,
      rangeEnd,
      boxValue,
      amount,
      memoNumber,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const rangeResult = buildPurchaseNumbers(rangeStart, rangeEnd);
    const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory || req.headers['x-purchase-category']);
    const normalizedBoxValue = normalizePurchaseBoxValue(boxValue);
    const normalizedAmount = normalizePurchaseAmount(amount);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!boxValue || amount === undefined || amount === null || !rangeStart || !rangeEnd) {
      return res.status(400).json({ message: 'Range, box value and amount are required' });
    }

    const normalizedMemoNumber = memoNumber === undefined || memoNumber === null || String(memoNumber).trim() === ''
      ? null
      : Number(memoNumber);

    if (normalizedMemoNumber !== null && (!Number.isInteger(normalizedMemoNumber) || normalizedMemoNumber <= 0)) {
      return res.status(400).json({ message: 'Memo number must be a positive integer' });
    }

    const semValidationError = getPurchaseSemValidationError(normalizedAmount, normalizedBoxValue);
    if (semValidationError) {
      return res.status(400).json({ message: semValidationError });
    }

    if (rangeResult.error) {
      return res.status(400).json({ message: rangeResult.error });
    }

    const duplicateNumbers = await findExistingPurchaseNumbers({
      db: { query },
      numbers: rangeResult.numbers,
      bookingDate,
      sessionMode,
      purchaseCategory,
      amount: normalizedAmount,
      boxValue: normalizedBoxValue
    });

    if (duplicateNumbers.length > 0) {
      return res.status(400).json({
        message: `Ye number selected date, shift, rate me pehle se use ho chuka hai: ${formatDuplicateNumberLabel(duplicateNumbers)}`
      });
    }

    const insertedEntries = [];

    for (const currentNumber of rangeResult.numbers) {
      let uniqueCode = null;
      let exists = true;

      while (exists) {
        uniqueCode = generateUniqueCode();
        const codeResult = await query('SELECT id FROM lottery_entries WHERE unique_code = $1 LIMIT 1', [uniqueCode]);
        exists = codeResult.rows.length > 0 || insertedEntries.some((entry) => entry.unique_code === uniqueCode);
      }

      const entryResult = await query(
        `INSERT INTO lottery_entries (
          user_id, series, number, box_value, unique_code, amount, status,
          sent_to_parent, forwarded_by, session_mode, booking_date, entry_source, memo_number, purchase_category
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'available', NULL, $7, $8, $9::date, $10, $11, $12)
        RETURNING *`,
        [
          req.user.id,
          series || null,
          currentNumber,
          normalizedBoxValue,
          uniqueCode,
          normalizedAmount,
          req.user.id,
          sessionMode,
          bookingDate,
          ADMIN_PURCHASE_ENTRY_SOURCE,
          normalizedMemoNumber,
          purchaseCategory
        ]
      );

      insertedEntries.push(entryResult.rows[0]);
    }

    await insertHistoryRecords({
      entries: insertedEntries,
      actionType: 'purchase_stocked',
      statusBefore: null,
      statusAfter: 'available',
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: req.user.id,
      toUsername: req.user.username
    });

    res.status(201).json({
      message: insertedEntries.length === 1 ? '1 purchase saved in admin stock' : `${insertedEntries.length} purchases saved in admin stock`,
      entries: insertedEntries.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const replaceAdminPurchaseMemoEntries = async (req, res) => {
  const client = await getClient();

  try {
    await ensureHistoryStorage();

    const {
      memoNumber,
      rows,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const normalizedMemoNumber = Number(memoNumber);
    const normalizedRows = Array.isArray(rows) ? rows : [];

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!Number.isInteger(normalizedMemoNumber) || normalizedMemoNumber <= 0) {
      return res.status(400).json({ message: 'Memo number must be a positive integer' });
    }

    if (normalizedRows.length === 0) {
      return res.status(400).json({ message: 'Memo rows are required' });
    }

    const invalidRow = normalizedRows.find((row) => !row.boxValue || row.amount === undefined || row.amount === null);
    if (invalidRow) {
      return res.status(400).json({ message: 'Each memo row needs box value and amount' });
    }

    const invalidSemRow = normalizedRows.find((row) => getPurchaseSemValidationError(row.amount, row.boxValue));
    if (invalidSemRow) {
      return res.status(400).json({ message: getPurchaseSemValidationError(invalidSemRow.amount, invalidSemRow.boxValue) });
    }

    const invalidRangeRow = normalizedRows
      .map((row) => buildPurchaseNumbers(row.rangeStart, row.rangeEnd))
      .find((rangeResult) => rangeResult.error);

    if (invalidRangeRow) {
      return res.status(400).json({ message: invalidRangeRow.error });
    }

    const replacementNumbers = normalizedRows.flatMap((row) => {
      const rangeResult = buildPurchaseNumbers(row.rangeStart, row.rangeEnd);
      return rangeResult.numbers;
    });

    if (replacementNumbers.length === 0) {
      return res.status(400).json({ message: 'At least one valid range is required' });
    }

    const memoContexts = normalizedRows.reduce((contexts, row) => {
      const resolvedSessionMode = normalizeSessionMode(row.sessionMode) || sessionMode;
      const resolvedPurchaseCategory = normalizePurchaseCategory(row.purchaseCategory) || getDefaultPurchaseCategory(resolvedSessionMode);
      const rowAmount = normalizePurchaseAmount(row.amount);
      const contextKey = `${resolvedSessionMode}|${resolvedPurchaseCategory}|${rowAmount}`;

      if (!contexts.some((context) => context.key === contextKey)) {
        contexts.push({
          key: contextKey,
          sessionMode: resolvedSessionMode,
          purchaseCategory: resolvedPurchaseCategory,
          amount: rowAmount
        });
      }

      return contexts;
    }, []);

    await client.query('BEGIN');

    for (const context of memoContexts) {
      await client.query(
        `DELETE FROM lottery_entries
         WHERE user_id = $1
           AND entry_source = $2
           AND memo_number = $3
           AND booking_date = $4::date
           AND session_mode = $5
           AND purchase_category = $6
           AND amount = $7::numeric`,
        [
          req.user.id,
          ADMIN_PURCHASE_ENTRY_SOURCE,
          normalizedMemoNumber,
          bookingDate,
          context.sessionMode,
          context.purchaseCategory,
          context.amount
        ]
      );
    }

    const insertedEntries = [];
    const shouldReturnInsertedEntries = replacementNumbers.length <= 5000;
    const generatedUniqueCodes = new Set();

    for (const row of normalizedRows) {
      const rangeResult = buildPurchaseNumbers(row.rangeStart, row.rangeEnd);

      if (rangeResult.error) {
        throw new Error(rangeResult.error);
      }

      const resolvedSessionMode = normalizeSessionMode(row.sessionMode) || sessionMode;
      const resolvedPurchaseCategory = normalizePurchaseCategory(row.purchaseCategory) || getDefaultPurchaseCategory(resolvedSessionMode);
      const rowBoxValue = normalizePurchaseBoxValue(row.boxValue);
      const rowAmount = normalizePurchaseAmount(row.amount);

      const duplicateNumbers = await findExistingPurchaseNumbers({
        db: client,
        numbers: rangeResult.numbers,
        bookingDate,
        sessionMode: resolvedSessionMode,
        purchaseCategory: resolvedPurchaseCategory,
        amount: rowAmount,
        boxValue: rowBoxValue
      });

      if (duplicateNumbers.length > 0) {
        throw new Error(`Ye number selected date, shift, rate me pehle se use ho chuka hai: ${formatDuplicateNumberLabel(duplicateNumbers)}`);
      }

      const insertChunkSize = 1000;
      for (let startIndex = 0; startIndex < rangeResult.numbers.length; startIndex += insertChunkSize) {
        const numberChunk = rangeResult.numbers.slice(startIndex, startIndex + insertChunkSize);
        const values = [];
        const placeholders = numberChunk.map((currentNumber, index) => {
          let uniqueCode = generateUniqueCode();
          while (generatedUniqueCodes.has(uniqueCode)) {
            uniqueCode = generateUniqueCode();
          }
          generatedUniqueCodes.add(uniqueCode);

          const offset = index * 12;
          values.push(
            req.user.id,
            row.series || null,
            currentNumber,
            rowBoxValue,
            uniqueCode,
            rowAmount,
            req.user.id,
            resolvedSessionMode,
            bookingDate,
            ADMIN_PURCHASE_ENTRY_SOURCE,
            normalizedMemoNumber,
            resolvedPurchaseCategory
          );

          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, 'available', NULL, $${offset + 7}, $${offset + 8}, $${offset + 9}::date, $${offset + 10}, $${offset + 11}, $${offset + 12})`;
        });

        const entryResult = await client.query(
          `INSERT INTO lottery_entries (
            user_id, series, number, box_value, unique_code, amount, status,
            sent_to_parent, forwarded_by, session_mode, booking_date, entry_source, memo_number, purchase_category
          )
          VALUES ${placeholders.join(', ')}
          ${shouldReturnInsertedEntries ? 'RETURNING *' : ''}`,
          values
        );

        if (shouldReturnInsertedEntries) {
          insertedEntries.push(...entryResult.rows);
        }
      }
    }

    await client.query('COMMIT');

    res.status(200).json({
      message: `Memo ${normalizedMemoNumber} updated successfully`,
      savedCount: replacementNumbers.length,
      entries: insertedEntries.map(mapLotteryEntry)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: error.message || 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const getAdminPurchaseEntries = async (req, res) => {
  try {
    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const amount = String(req.query.amount || '').trim();
    const boxValue = String(req.query.boxValue || '').trim();
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const params = [req.user.id, ADMIN_PURCHASE_ENTRY_SOURCE];
    const conditions = ['le.user_id = $1', 'le.entry_source = $2'];

    if (bookingDate) {
      params.push(bookingDate);
      conditions.push(`le.booking_date = $${params.length}::date`);
    }

    if (sessionMode) {
      params.push(sessionMode);
      conditions.push(`le.session_mode = $${params.length}`);
    }

    if (purchaseCategory) {
      params.push(purchaseCategory);
      conditions.push(`le.purchase_category = $${params.length}`);
    }

    if (amount) {
      params.push(amount);
      conditions.push(`le.amount = $${params.length}::numeric`);
    }

    if (boxValue) {
      params.push(boxValue);
      conditions.push(`le.box_value = $${params.length}`);
    }

    const result = await query(
      `SELECT le.*, u.username, forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY le.booking_date DESC, le.session_mode ASC, le.number ASC`,
      params
    );

    res.json(result.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const insertDirectPurchaseEntries = async ({
  db,
  currentUser,
  targetSeller,
  numbers,
  boxValue,
  amount,
  bookingDate,
  sessionMode,
  purchaseCategory,
  memoNumber
}) => {
  const insertedEntries = [];
  const usedCodes = new Set();
  const chunkSize = 1000;
  const columnsPerRow = 15;
  const shouldDirectAssign = shouldDirectAssignPurchaseToTarget({ currentUser, targetSeller });
  const effectiveMemoNumber = shouldDirectAssign ? memoNumber : null;
  const sentToParent = Number(targetSeller.id) === Number(currentUser.id)
    ? currentUser.id
    : (targetSeller.parent_id || currentUser.id);

  for (let chunkStart = 0; chunkStart < numbers.length; chunkStart += chunkSize) {
    const chunk = numbers.slice(chunkStart, chunkStart + chunkSize);
    const values = [];
    const placeholders = chunk.map((currentNumber, index) => {
      let uniqueCode = generateUniqueCode();
      while (usedCodes.has(uniqueCode)) {
        uniqueCode = generateUniqueCode();
      }
      usedCodes.add(uniqueCode);

      const offset = index * columnsPerRow;
      values.push(
        targetSeller.id,
        null,
        currentNumber,
        boxValue,
        uniqueCode,
        amount,
        sentToParent,
        currentUser.id,
        sessionMode,
        bookingDate,
        PURCHASE_ENTRY_SOURCE,
        effectiveMemoNumber,
        effectiveMemoNumber,
        purchaseCategory,
        'accepted'
      );

      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::date, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`;
    });

    const insertedResult = await db.query(
      `INSERT INTO lottery_entries (
        user_id, series, number, box_value, unique_code, amount,
        sent_to_parent, forwarded_by, session_mode, booking_date,
        entry_source, memo_number, purchase_memo_number, purchase_category, status
      )
      VALUES ${placeholders.join(', ')}
      RETURNING *`,
      values
    );
    insertedEntries.push(...insertedResult.rows);
  }

  return insertedEntries;
};

const forwardSellerOwnedPurchaseEntries = async ({
  db,
  currentUser,
  targetSeller,
  numbers,
  boxValue,
  amount,
  bookingDate,
  sessionMode,
  purchaseCategory,
  memoNumber
}) => {
  const stockEntriesResult = await findSellerOwnedPurchaseStockEntries({
    db,
    ownerUserId: currentUser.id,
    bookingDate,
    sessionMode,
    purchaseCategory,
    amount,
    boxValue,
    numbers
  });

  if (stockEntriesResult.rows.length !== numbers.length) {
    const availableNumbers = new Set(stockEntriesResult.rows.map((stockRow) => stockRow.number));
    const missingNumbers = numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));
    return {
      error: `Ye number seller ke stock me nahi hai: ${formatDuplicateNumberLabel(missingNumbers)}`
    };
  }

  const selectedIds = stockEntriesResult.rows.map((stockRow) => stockRow.id);
  const shouldDirectAssign = shouldDirectAssignPurchaseToTarget({ currentUser, targetSeller });
  const effectiveMemoNumber = shouldDirectAssign ? memoNumber : null;
  const sentToParent = Number(targetSeller.id) === Number(currentUser.id)
    ? currentUser.id
    : (targetSeller.parent_id || currentUser.id);

  const updatedResult = await db.query(
    `UPDATE lottery_entries
     SET user_id = $2,
         sent_to_parent = $3,
         forwarded_by = $4,
         memo_number = $5,
         purchase_memo_number = $5,
         sent_at = CURRENT_TIMESTAMP
     WHERE id = ANY($1::int[])
     RETURNING *`,
    [
      selectedIds,
      targetSeller.id,
      sentToParent,
      currentUser.id,
      effectiveMemoNumber
    ]
  );

  return { entries: updatedResult.rows };
};

const sendAdminPurchaseEntries = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const {
      sellerId,
      sellerUserId,
      rangeStart,
      rangeEnd,
      boxValue,
      amount,
      memoNumber,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const targetSellerId = Number(sellerId || sellerUserId);
    const rangeResult = buildPurchaseNumbers(rangeStart, rangeEnd);
    const currentUserIsAdmin = isAdminRole(req.user.role);
    const purchaseCategory = getPurchaseCategoryFromRequest(req, sessionMode);
    const normalizedBoxValue = normalizePurchaseBoxValue(boxValue);
    const normalizedAmount = normalizePurchaseAmount(amount);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!targetSellerId || !boxValue || amount === undefined || amount === null || !rangeStart || !rangeEnd) {
      return res.status(400).json({ message: 'Seller, range, box value and amount are required' });
    }

    const normalizedMemoNumber = memoNumber === undefined || memoNumber === null || String(memoNumber).trim() === ''
      ? null
      : Number(memoNumber);

    if (normalizedMemoNumber !== null && (!Number.isInteger(normalizedMemoNumber) || normalizedMemoNumber <= 0)) {
      return res.status(400).json({ message: 'Memo number must be a positive integer' });
    }

    const semValidationError = getPurchaseSemValidationError(normalizedAmount, normalizedBoxValue);
    if (semValidationError) {
      return res.status(400).json({ message: semValidationError });
    }

    if (rangeResult.error) {
      return res.status(400).json({ message: rangeResult.error });
    }

    const sellerResult = await query(
      'SELECT id, username, role, seller_type, parent_id, rate_amount_6, rate_amount_12 FROM users WHERE id = $1 LIMIT 1',
      [targetSellerId]
    );
    const targetSeller = sellerResult.rows[0];

    const targetError = validatePurchaseTarget({ currentUser: req.user, targetUser: targetSeller, allowSelf: true });
    if (targetError) {
      return res.status(targetError === 'Seller not found' ? 404 : 403).json({ message: targetError });
    }

    const amountRateMap = {
      '7': Number(targetSeller.rate_amount_6 || 0),
      '12': Number(targetSeller.rate_amount_12 || 0)
    };

    if (Object.prototype.hasOwnProperty.call(amountRateMap, normalizedAmount) && amountRateMap[normalizedAmount] <= 0) {
      return res.status(400).json({ message: `Selected seller cannot use amount ${normalizedAmount}` });
    }

    if (currentUserIsAdmin) {
      // Admin is the source of purchase stock. We only block numbers that are
      // already assigned for the same date/session/category/rate/SIM.
      const duplicateValidation = await ensureAdminPurchaseNumbersAreAssignable({
        db: { query },
        numbers: rangeResult.numbers,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount: normalizedAmount,
        boxValue: normalizedBoxValue
      });

      if (duplicateValidation.error) {
        return res.status(400).json({ message: duplicateValidation.error });
      }

      const insertedEntries = await insertDirectPurchaseEntries({
        db: { query },
        currentUser: req.user,
        targetSeller,
        numbers: rangeResult.numbers,
        boxValue: normalizedBoxValue,
        amount: normalizedAmount,
        bookingDate,
        sessionMode,
        purchaseCategory,
        memoNumber: normalizedMemoNumber
      });

      await insertHistoryRecords({
        entries: insertedEntries,
        actionType: 'purchase_sent',
        statusBefore: null,
        statusAfter: 'accepted',
        actorUserId: req.user.id,
        actorUsername: req.user.username,
        toUserId: targetSeller.id,
        toUsername: targetSeller.username
      });

      return res.status(201).json({
        message: `${insertedEntries.length} purchase numbers sent to ${targetSeller.username}`,
        entries: insertedEntries.map(mapLotteryEntry)
      });
    }

    const forwardResult = await forwardSellerOwnedPurchaseEntries({
      db: { query },
      currentUser: req.user,
      targetSeller,
      numbers: rangeResult.numbers,
      boxValue: normalizedBoxValue,
      amount: normalizedAmount,
      bookingDate,
      sessionMode,
      purchaseCategory,
      memoNumber: normalizedMemoNumber
    });

    if (forwardResult.error) {
      return res.status(400).json({ message: forwardResult.error });
    }

    const insertedEntries = forwardResult.entries;

    await insertHistoryRecords({
      entries: insertedEntries,
      actionType: 'purchase_forwarded',
      statusBefore: 'accepted',
      statusAfter: 'accepted',
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: targetSeller.id,
      toUsername: targetSeller.username
    });

    res.status(201).json({
      message: `${insertedEntries.length} purchase numbers sent to ${targetSeller.username}`,
      entries: insertedEntries.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const replacePurchaseSendMemoEntries = async (req, res) => {
  const client = await getClient();

  try {
    await ensureHistoryStorage();

    const {
      sellerId,
      sellerUserId,
      memoNumber,
      amount,
      purchaseCategory: rawPurchaseCategory,
      rows,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const targetSellerId = Number(sellerId || sellerUserId);
    const normalizedMemoNumber = Number(memoNumber);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const currentUserIsAdmin = isAdminRole(req.user.role);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!targetSellerId || !Number.isInteger(normalizedMemoNumber) || normalizedMemoNumber <= 0) {
      return res.status(400).json({ message: 'Seller and memo number are required' });
    }

    const invalidRow = normalizedRows.find((row) => !row.boxValue || row.amount === undefined || row.amount === null);
    if (invalidRow) {
      return res.status(400).json({ message: 'Each memo row needs box value and amount' });
    }

    const invalidSemRow = normalizedRows.find((row) => getPurchaseSemValidationError(row.amount, row.boxValue));
    if (invalidSemRow) {
      return res.status(400).json({ message: getPurchaseSemValidationError(invalidSemRow.amount, invalidSemRow.boxValue) });
    }

    const invalidRangeRow = normalizedRows
      .map((row) => buildPurchaseNumbers(row.rangeStart, row.rangeEnd))
      .find((rangeResult) => rangeResult.error);

    if (invalidRangeRow) {
      return res.status(400).json({ message: invalidRangeRow.error });
    }

    const sellerResult = await client.query(
      'SELECT id, username, role, seller_type, parent_id, rate_amount_6, rate_amount_12 FROM users WHERE id = $1 LIMIT 1',
      [targetSellerId]
    );
    const targetSeller = sellerResult.rows[0];

    const targetError = validatePurchaseTarget({ currentUser: req.user, targetUser: targetSeller, allowSelf: true });
    if (targetError) {
      return res.status(targetError === 'Seller not found' ? 404 : 403).json({ message: targetError });
    }

    const normalizedAmount = normalizePurchaseAmount(normalizedRows[0]?.amount ?? amount ?? '');
    const normalizedPurchaseCategory = normalizePurchaseCategory(normalizedRows[0]?.purchaseCategory || rawPurchaseCategory)
      || getDefaultPurchaseCategory(sessionMode);

    if (!normalizedAmount) {
      return res.status(400).json({ message: 'Amount is required' });
    }

    const targetRate = normalizedAmount === '7'
      ? Number(targetSeller.rate_amount_6 || 0)
      : normalizedAmount === '12'
        ? Number(targetSeller.rate_amount_12 || 0)
        : 0;

    if (['7', '12'].includes(normalizedAmount) && targetRate <= 0) {
      return res.status(400).json({ message: `Selected seller cannot use amount ${normalizedAmount}` });
    }

    await client.query('BEGIN');

    const existingMemoResult = await client.query(
      `SELECT *
       FROM lottery_entries
       WHERE user_id = $1
         AND entry_source = $2
         AND forwarded_by = $3
         AND memo_number = $4
         AND booking_date = $5::date
         AND session_mode = $6
         AND purchase_category = $7
         AND amount = $8::numeric
         AND status IN ('accepted', 'unsold')
       ORDER BY number ASC`,
      [targetSeller.id, PURCHASE_ENTRY_SOURCE, req.user.id, normalizedMemoNumber, bookingDate, sessionMode, normalizedPurchaseCategory, normalizedAmount]
    );

    if (existingMemoResult.rows.length > 0) {
      const existingIds = existingMemoResult.rows.map((row) => row.id);
      if (currentUserIsAdmin) {
        await client.query('DELETE FROM lottery_entries WHERE id = ANY($1::int[])', [existingIds]);
      } else {
        await client.query(
          `UPDATE lottery_entries
           SET user_id = $2,
               entry_source = $3,
               status = $4,
               sent_to_parent = NULL,
               forwarded_by = $2,
               memo_number = NULL,
               purchase_memo_number = NULL,
               sent_at = NULL
           WHERE id = ANY($1::int[])`,
          [
            existingIds,
            req.user.id,
            PURCHASE_ENTRY_SOURCE,
            'accepted'
          ]
        );
      }
    }

    if (normalizedRows.length === 0) {
      await client.query(
        `UPDATE lottery_entries
         SET purchase_memo_number = purchase_memo_number - 1
         WHERE user_id = $1
           AND entry_source = $2
           AND forwarded_by = $3
           AND booking_date = $4::date
           AND session_mode = $5
           AND purchase_category = $6
           AND amount = $7::numeric
           AND purchase_memo_number > $8
           AND status IN ('accepted', 'unsold')`,
        [
          targetSeller.id,
          PURCHASE_ENTRY_SOURCE,
          req.user.id,
          bookingDate,
          sessionMode,
          normalizedPurchaseCategory,
          normalizedAmount,
          normalizedMemoNumber
        ]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        message: `Memo ${normalizedMemoNumber} deleted successfully`,
        deletedMemoNumber: normalizedMemoNumber,
        entries: []
      });
    }

    const updatedEntries = [];

    for (const row of normalizedRows) {
      const rangeResult = buildPurchaseNumbers(row.rangeStart, row.rangeEnd);
      const rowBookingDate = normalizeBookingDate(row.bookingDate || bookingDate);
      const resolvedSessionMode = normalizeSessionMode(row.sessionMode) || sessionMode;
      const resolvedPurchaseCategory = normalizePurchaseCategory(row.purchaseCategory) || getDefaultPurchaseCategory(resolvedSessionMode);
      const rowBoxValue = normalizePurchaseBoxValue(row.boxValue);
      const rowAmount = normalizePurchaseAmount(row.amount);

      if (!rowBookingDate) {
        throw new Error('Valid row booking date is required');
      }

      if (currentUserIsAdmin) {
        // Memo edit for admin also bypasses stock ownership checks. Only
        // duplicate allocation for the same shift context is prevented.
        const duplicateValidation = await ensureAdminPurchaseNumbersAreAssignable({
          db: client,
          numbers: rangeResult.numbers,
          bookingDate: rowBookingDate,
          sessionMode: resolvedSessionMode,
          purchaseCategory: resolvedPurchaseCategory,
          amount: rowAmount,
          boxValue: rowBoxValue
        });

        if (duplicateValidation.error) {
          throw new Error(duplicateValidation.error);
        }

        const insertedEntries = await insertDirectPurchaseEntries({
          db: client,
          currentUser: req.user,
          targetSeller,
          numbers: rangeResult.numbers,
          boxValue: rowBoxValue,
          amount: rowAmount,
          bookingDate: rowBookingDate,
          sessionMode: resolvedSessionMode,
          purchaseCategory: resolvedPurchaseCategory,
          memoNumber: normalizedMemoNumber
        });
        updatedEntries.push(...insertedEntries);
        continue;
      }

      const forwardResult = await forwardSellerOwnedPurchaseEntries({
        db: client,
        currentUser: req.user,
        targetSeller,
        numbers: rangeResult.numbers,
        boxValue: rowBoxValue,
        amount: rowAmount,
        bookingDate: rowBookingDate,
        sessionMode: resolvedSessionMode,
        purchaseCategory: resolvedPurchaseCategory,
        memoNumber: normalizedMemoNumber
      });

      if (forwardResult.error) {
        throw new Error(forwardResult.error);
      }

      updatedEntries.push(...forwardResult.entries);
    }

    await insertHistoryRecords({
      entries: updatedEntries,
      actionType: currentUserIsAdmin ? 'purchase_memo_updated' : 'purchase_forward_memo_updated',
      statusBefore: 'accepted',
      statusAfter: 'accepted',
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: targetSeller.id,
      toUsername: targetSeller.username,
      client
    });

    await client.query('COMMIT');

    res.status(200).json({
      message: `Memo ${normalizedMemoNumber} updated successfully`,
      entries: updatedEntries.map(mapLotteryEntry)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: error.message || 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const transferRemainingPurchaseStock = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const {
      sellerId,
      sellerUserId,
      bookingDate: rawBookingDate,
      amount
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const targetUserId = Number(sellerId || sellerUserId);
    const currentUserIsAdmin = isAdminRole(req.user.role);
    const purchaseCategory = getPurchaseCategoryFromRequest(req, sessionMode);
    const normalizedAmount = String(amount || '').trim();

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!targetUserId || !normalizedAmount) {
      return res.status(400).json({ message: 'Seller and amount are required' });
    }

    const targetResult = await query(
      'SELECT id, username, role, seller_type, parent_id, rate_amount_6, rate_amount_12 FROM users WHERE id = $1 LIMIT 1',
      [targetUserId]
    );
    const targetUser = targetResult.rows[0];
    const isSelfTransfer = Number(targetUserId) === Number(req.user.id);

    const targetError = validatePurchaseTarget({
      currentUser: req.user,
      targetUser,
      allowSelf: true,
      allowNormalSellerStockTransfer: normalizeSellerType(req.user.sellerType || req.user.seller_type) === SELLER_TYPE_SUB_SELLER
    });
    if (targetError) {
      return res.status(targetError === 'Seller not found' ? 404 : 403).json({ message: targetError });
    }

    if (!isSelfTransfer) {
      const targetRate = normalizedAmount === '7'
        ? Number(targetUser.rate_amount_6 || 0)
        : normalizedAmount === '12'
          ? Number(targetUser.rate_amount_12 || 0)
          : 0;

      if (['7', '12'].includes(normalizedAmount) && targetRate <= 0) {
        return res.status(400).json({ message: `Selected seller cannot use amount ${normalizedAmount}` });
      }
    }

    const stockResult = await query(
      `SELECT *
       FROM lottery_entries
       WHERE user_id = $1
         AND entry_source = $2
         AND status = $3
         AND booking_date = $4::date
         AND session_mode = $5
         AND purchase_category = $6
         AND amount = $7::numeric
         ${currentUserIsAdmin ? '' : 'AND NOT (forwarded_by = $8 AND memo_number IS NOT NULL)'}
       ORDER BY box_value ASC, number ASC`,
      [
        req.user.id,
        currentUserIsAdmin ? ADMIN_PURCHASE_ENTRY_SOURCE : PURCHASE_ENTRY_SOURCE,
        currentUserIsAdmin ? 'available' : 'accepted',
        bookingDate,
        sessionMode,
        purchaseCategory,
        normalizedAmount
      ].concat(currentUserIsAdmin ? [] : [req.user.id])
    );

    if (stockResult.rows.length === 0) {
      return res.status(404).json({ message: 'No remaining stock found for selected date/category/amount' });
    }

    const nextMemoResult = await query(
      `SELECT COALESCE(MAX(memo_number), 0) + 1 AS next_memo_number
       FROM lottery_entries
       WHERE user_id = $1
         AND entry_source = $2
         AND forwarded_by = $3
         AND booking_date = $4::date
         AND session_mode = $5
         AND purchase_category = $6
         AND amount = $7::numeric`,
      [
        targetUser.id,
        PURCHASE_ENTRY_SOURCE,
        req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        normalizedAmount
      ]
    );
    const transferMemoNumber = Number(nextMemoResult.rows[0]?.next_memo_number || 1);
    const selectedIds = stockResult.rows.map((row) => row.id);
    const updatedResult = await query(
      `UPDATE lottery_entries
       SET user_id = $2,
           entry_source = $3,
           status = 'accepted',
           sent_to_parent = $4,
           forwarded_by = $5,
           memo_number = $6,
           purchase_memo_number = $6,
           sent_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])
       RETURNING *`,
      [
        selectedIds,
        targetUser.id,
        PURCHASE_ENTRY_SOURCE,
        isSelfTransfer ? req.user.id : (targetUser.parent_id || req.user.id),
        req.user.id,
        transferMemoNumber
      ]
    );
    const updatedRows = updatedResult.rows;

    await insertHistoryRecords({
      entries: updatedRows,
      actionType: isSelfTransfer
        ? 'purchase_self_memo_created'
        : currentUserIsAdmin
          ? 'purchase_sent'
          : 'purchase_forwarded',
      statusBefore: currentUserIsAdmin ? 'available' : 'accepted',
      statusAfter: 'accepted',
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: targetUser.id,
      toUsername: targetUser.username
    });

    res.json({
      message: isSelfTransfer
        ? `${updatedRows.length} remaining stock saved in ${targetUser.username} memo ${transferMemoNumber}`
        : `${updatedRows.length} remaining stock transferred to ${targetUser.username} in memo ${transferMemoNumber}`,
      memoNumber: transferMemoNumber,
      entries: updatedRows.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPurchaseEntries = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const status = String(req.query.status || '').trim().toLowerCase();
    const sellerId = Number(req.query.sellerId || 0);
    const amount = String(req.query.amount || '').trim();
    const boxValue = String(req.query.boxValue || '').trim();
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const remainingOnly = String(req.query.remaining || '').trim().toLowerCase() === 'true';
    const params = [PURCHASE_ENTRY_SOURCE];
    const conditions = ['le.entry_source = $1'];
    let childSellerVisibilityParamIndex = null;
    let adminScopedBranchIds = [];

    if (req.user.role === 'admin') {
      if (sellerId) {
        adminScopedBranchIds = await getDirectSellerBranchIds(req.user.id, sellerId);

        if (adminScopedBranchIds.length === 0) {
          return res.status(404).json({ message: 'Seller not found' });
        }

        params.push(adminScopedBranchIds);
        conditions.push(`le.user_id = ANY($${params.length}::int[])`);
      }
    } else if (sellerId && sellerId !== Number(req.user.id)) {
      const childSellerResult = await query(
        "SELECT id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
        [sellerId, req.user.id]
      );

      if (childSellerResult.rows.length === 0) {
        return res.status(403).json({ message: 'You can view purchase only for your direct sub stokist' });
      }

      params.push(sellerId);
      conditions.push(`le.user_id = $${params.length}`);
      params.push(req.user.id);
      childSellerVisibilityParamIndex = params.length;
      params.push(sellerId);
      const childSelfSentParamIndex = params.length;
      params.push(sellerId);
      const childSelfForwardedParamIndex = params.length;
      conditions.push(`(
        le.sent_to_parent = $${childSellerVisibilityParamIndex}
        OR le.forwarded_by = $${childSellerVisibilityParamIndex}
        OR (
          le.sent_to_parent = $${childSelfSentParamIndex}
          AND le.forwarded_by = $${childSelfForwardedParamIndex}
        )
      )`);
    } else {
      params.push(req.user.id);
      conditions.push(`le.user_id = $${params.length}`);
    }

    if (bookingDate) {
      params.push(bookingDate);
      conditions.push(`le.booking_date = $${params.length}::date`);
    }

    if (sessionMode) {
      params.push(sessionMode);
      conditions.push(`le.session_mode = $${params.length}`);
    }

    if (purchaseCategory) {
      params.push(purchaseCategory);
      conditions.push(`le.purchase_category = $${params.length}`);
    }

    if (amount) {
      params.push(amount);
      conditions.push(`le.amount = $${params.length}::numeric`);
    }

    if (boxValue) {
      params.push(boxValue);
      conditions.push(`le.box_value = $${params.length}`);
    }

    const shouldUseAcceptedSnapshotView = (
      status === UNSOLD_ACCEPTED_STATUS
      && req.user.role !== 'admin'
      && sellerId
      && sellerId !== Number(req.user.id)
    );

    if (shouldUseAcceptedSnapshotView) {
      const [snapshotRows, localSavedResult] = await Promise.all([
        getLatestAcceptedUnsoldSnapshotRows({
          targetSellerId: sellerId,
          viewerUserId: req.user.id,
          bookingDate,
          sessionMode,
          purchaseCategory,
          amount,
          boxValue
        }),
        query(
          `SELECT le.*, u.username, parent_user.username AS parent_username, forwarded_user.username AS forwarded_by_username
           FROM lottery_entries le
           LEFT JOIN users u ON u.id = le.user_id
           LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
           LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
           WHERE le.entry_source = $1
             AND le.user_id = $2
             AND LOWER(TRIM(le.status)) = $3
             AND (le.sent_to_parent = $4 OR le.forwarded_by = $4)
             ${bookingDate ? 'AND le.booking_date = $5::date' : ''}
             ${sessionMode ? `AND le.session_mode = $${bookingDate ? 6 : 5}` : ''}
             ${purchaseCategory ? `AND le.purchase_category = $${(bookingDate ? 1 : 0) + (sessionMode ? 1 : 0) + 5}` : ''}
             ${amount ? `AND le.amount = $${(bookingDate ? 1 : 0) + (sessionMode ? 1 : 0) + (purchaseCategory ? 1 : 0) + 5}::numeric` : ''}
             ${boxValue ? `AND le.box_value = $${(bookingDate ? 1 : 0) + (sessionMode ? 1 : 0) + (purchaseCategory ? 1 : 0) + (amount ? 1 : 0) + 5}` : ''}
           ORDER BY le.booking_date DESC, le.session_mode ASC, u.username ASC, le.number ASC`,
          [
            PURCHASE_ENTRY_SOURCE,
            sellerId,
            UNSOLD_LOCAL_STATUS,
            req.user.id,
            ...[
              bookingDate,
              sessionMode,
              purchaseCategory,
              amount,
              boxValue
            ].filter(Boolean)
          ]
        )
      ]);

      const combinedRows = [...snapshotRows, ...localSavedResult.rows];
      res.json(combinedRows.map(mapLotteryEntry));
      return;
    }

    if (status) {
      if (status === UNSOLD_ACCEPTED_STATUS) {
        conditions.push(`LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`);
        if (req.user.role === 'admin' && sellerId && adminScopedBranchIds.length === 0) {
          params.push(sellerId);
          const selectedSellerParamIndex = params.length;
          params.push(req.user.id);
          const adminUserParamIndex = params.length;
          conditions.push(`(
            le.forwarded_by = $${selectedSellerParamIndex}
            OR le.sent_to_parent = $${selectedSellerParamIndex}
            OR le.forwarded_by = $${adminUserParamIndex}
            OR le.sent_to_parent = $${adminUserParamIndex}
          )`);
        }
      } else {
        params.push(status);
        conditions.push(`LOWER(TRIM(le.status)) = $${params.length}`);
      }
    }

    if (remainingOnly && req.user.role !== 'admin' && (!sellerId || sellerId === Number(req.user.id))) {
      params.push(req.user.id);
      conditions.push(`NOT (le.forwarded_by = $${params.length} AND le.memo_number IS NOT NULL)`);
    }

    const result = await query(
      `SELECT le.*, u.username, parent_user.username AS parent_username, forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY le.booking_date DESC, le.session_mode ASC, u.username ASC, le.number ASC`,
      params
    );

    res.json(result.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getSellerPurchaseView = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const amount = String(req.query.amount || '').trim();
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const requestedSellerId = Number(req.query.sellerId || 0);
    let targetUserId = Number(req.user.id);

    if (requestedSellerId && requestedSellerId !== Number(req.user.id)) {
      const childSellerResult = await query(
        "SELECT id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
        [requestedSellerId, req.user.id]
      );

      if (childSellerResult.rows.length === 0) {
        return res.status(403).json({ message: 'You can view purchase only for yourself or your direct sub stokist' });
      }

      targetUserId = requestedSellerId;
    }

    const receivedParams = [targetUserId];
    const sentParams = [targetUserId];
    const currentParams = [targetUserId, PURCHASE_ENTRY_SOURCE];
    const historyFilters = [];
    const currentFilters = [];

    if (bookingDate) {
      receivedParams.push(bookingDate);
      sentParams.push(bookingDate);
      historyFilters.push(`h.booking_date = $${receivedParams.length}::date`);
      currentParams.push(bookingDate);
      currentFilters.push(`le.booking_date = $${currentParams.length}::date`);
    }

    if (sessionMode) {
      receivedParams.push(sessionMode);
      sentParams.push(sessionMode);
      historyFilters.push(`h.session_mode = $${receivedParams.length}`);
      currentParams.push(sessionMode);
      currentFilters.push(`le.session_mode = $${currentParams.length}`);
    }

    if (purchaseCategory) {
      receivedParams.push(purchaseCategory);
      sentParams.push(purchaseCategory);
      historyFilters.push(`h.purchase_category = $${receivedParams.length}`);
      currentParams.push(purchaseCategory);
      currentFilters.push(`le.purchase_category = $${currentParams.length}`);
    }

    if (amount) {
      receivedParams.push(amount);
      sentParams.push(amount);
      historyFilters.push(`h.amount = $${receivedParams.length}::numeric`);
      currentParams.push(amount);
      currentFilters.push(`le.amount = $${currentParams.length}::numeric`);
    }

    const historyFilterSql = historyFilters.length ? `AND ${historyFilters.join(' AND ')}` : '';
    const currentFilterSql = currentFilters.length ? `AND ${currentFilters.join(' AND ')}` : '';
    const receivedScopeSql = targetUserId === Number(req.user.id)
      ? ''
      : `AND h.actor_user_id = $${receivedParams.length + 1}`;
    const receivedQueryParams = targetUserId === Number(req.user.id)
      ? receivedParams
      : [...receivedParams, req.user.id];

    const [receivedResult, sentResult, availableResult] = await Promise.all([
      query(
        `SELECT h.*
         FROM lottery_entry_history h
         WHERE h.to_user_id = $1
           AND h.action_type IN ('purchase_sent', 'purchase_forwarded')
           ${receivedScopeSql}
           ${historyFilterSql}
         ORDER BY h.booking_date DESC, h.session_mode ASC, h.number ASC`,
        receivedQueryParams
      ),
      query(
        `SELECT h.*
         FROM lottery_entry_history h
         WHERE h.actor_user_id = $1
           AND h.action_type IN ('purchase_sent', 'purchase_forwarded')
           ${historyFilterSql}
         ORDER BY h.booking_date DESC, h.session_mode ASC, h.to_username ASC, h.number ASC`,
        sentParams
      ),
      query(
        `SELECT le.*, u.username, parent_user.username AS parent_username, forwarded_user.username AS forwarded_by_username
         FROM lottery_entries le
         LEFT JOIN users u ON u.id = le.user_id
         LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
         LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
         WHERE le.user_id = $1
           AND le.entry_source = $2
           AND LOWER(TRIM(le.status)) = 'accepted'
           AND NOT (le.forwarded_by = $1 AND le.memo_number IS NOT NULL)
           ${currentFilterSql}
         ORDER BY le.booking_date DESC, le.session_mode ASC, le.number ASC`,
        currentParams
      )
    ]);

    res.json({
      received: receivedResult.rows.map(mapHistoryRecord),
      sent: sentResult.rows.map(mapHistoryRecord),
      available: availableResult.rows.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const markPurchaseEntriesUnsold = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const { number, rangeStart, rangeEnd, bookingDate: rawBookingDate, sellerId, sellerUserId, memoNumber, amount, boxValue } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const purchaseCategory = getPurchaseCategoryFromRequest(req, sessionMode);
    const targetSellerId = Number(sellerId || sellerUserId || req.user.id);
    const numbersToMark = rangeStart || rangeEnd
      ? buildPurchaseNumbers(rangeStart, rangeEnd)
      : { numbers: [normalizePurchaseTicketNumber(number)].filter(Boolean) };
    const normalizedMemoNumber = memoNumber === undefined || memoNumber === null || String(memoNumber).trim() === ''
      ? null
      : Number(memoNumber);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (numbersToMark.error) {
      return res.status(400).json({ message: numbersToMark.error });
    }

    if (!numbersToMark.numbers || numbersToMark.numbers.length === 0) {
      return res.status(400).json({ message: 'Number or range is required' });
    }

    if (!targetSellerId) {
      return res.status(400).json({ message: 'Party name is required' });
    }

    if (normalizedMemoNumber !== null && (!Number.isInteger(normalizedMemoNumber) || normalizedMemoNumber <= 0)) {
      return res.status(400).json({ message: 'Memo number must be a positive integer' });
    }

    let targetSeller = {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      seller_type: req.user.sellerType
    };

    if (targetSellerId !== Number(req.user.id)) {
      const childSellerResult = await query(
        "SELECT id, username, role, seller_type FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
        [targetSellerId, req.user.id]
      );

      if (childSellerResult.rows.length === 0) {
        return res.status(403).json({ message: 'You can mark unsold only for yourself or your direct sub stokist' });
      }

      targetSeller = childSellerResult.rows[0];
    }

    const selectedEntriesParams = [
      targetSellerId,
      PURCHASE_ENTRY_SOURCE,
      sessionMode,
      purchaseCategory,
      bookingDate,
      numbersToMark.numbers
    ];
    const stockFilters = [];
    const normalizedAmount = String(amount || '').trim();
    const normalizedBoxValue = String(boxValue || '').trim();
    if (normalizedAmount) {
      stockFilters.push(`AND le.amount = $${selectedEntriesParams.push(normalizedAmount)}::numeric`);
    }
    if (normalizedBoxValue) {
      stockFilters.push(`AND le.box_value = $${selectedEntriesParams.push(normalizedBoxValue)}`);
    }
    let ownerStockFilter = '';
    if (targetSellerId === Number(req.user.id)) {
      if (!isAdminRole(req.user.role)) {
        ownerStockFilter = `AND le.forwarded_by = $${selectedEntriesParams.push(req.user.id)}`;
      }
    } else {
      ownerStockFilter = `AND (
           le.sent_to_parent = $${selectedEntriesParams.push(req.user.id)}
           OR (
             le.sent_to_parent = $${selectedEntriesParams.push(targetSellerId)}
             AND le.forwarded_by = $${selectedEntriesParams.push(targetSellerId)}
           )
         )`;
    }

    const selectedEntriesResult = await query(
      `SELECT le.*
       FROM lottery_entries le
       WHERE le.user_id = $1
         AND le.entry_source = $2
         AND le.status = 'accepted'
         AND le.session_mode = $3
         AND le.purchase_category = $4
         AND le.booking_date = $5::date
         AND le.number = ANY($6::varchar[])
         AND le.memo_number IS NOT NULL
         ${stockFilters.join('\n         ')}
         ${ownerStockFilter}
       ORDER BY le.number ASC`,
      selectedEntriesParams
    );

    if (selectedEntriesResult.rows.length === 0) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (selectedEntriesResult.rows.length !== numbersToMark.numbers.length) {
      const availableNumbers = new Set(selectedEntriesResult.rows.map((row) => row.number));
      const missingNumbers = numbersToMark.numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));
      const missingLabel = missingNumbers.length > 5
        ? `${missingNumbers.slice(0, 5).join(', ')} +${missingNumbers.length - 5} more`
        : missingNumbers.join(', ');
      return res.status(400).json({ message: `Ye number selected party ke purchase stock me nahi hai: ${missingLabel}` });
    }

    let resolvedMemoNumber = normalizedMemoNumber;

    if (!resolvedMemoNumber) {
      const nextMemoResult = await query(
        `SELECT COALESCE(MAX(memo_number), 0) + 1 AS next_memo_number
         FROM lottery_entries
         WHERE user_id = $1
           AND entry_source = $2
           AND forwarded_by = $3
           AND booking_date = $4::date
           AND session_mode = $5
           AND purchase_category = $6
           AND amount = (
             SELECT amount FROM lottery_entries WHERE id = $7 LIMIT 1
           )`,
        [targetSellerId, PURCHASE_ENTRY_SOURCE, req.user.id, bookingDate, sessionMode, purchaseCategory, selectedEntriesResult.rows[0].id]
      );
      resolvedMemoNumber = Number(nextMemoResult.rows[0]?.next_memo_number || 1);
    }

    const selectedIds = selectedEntriesResult.rows.map((row) => row.id);
    const updatedEntriesResult = await query(
      `UPDATE lottery_entries
       SET status = $4,
           sent_to_parent = $2,
           forwarded_by = $2,
           memo_number = $3,
           purchase_memo_number = COALESCE(purchase_memo_number, memo_number),
           sent_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])
       RETURNING *`,
      [selectedIds, req.user.id, resolvedMemoNumber, UNSOLD_LOCAL_STATUS]
    );

    await deleteUnsoldRemoveHistoryForEntries(updatedEntriesResult.rows);

    await insertHistoryRecords({
      entries: updatedEntriesResult.rows,
      actionType: 'saved_unsold',
      statusBefore: 'accepted',
      statusAfter: UNSOLD_LOCAL_STATUS,
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: req.user.id,
      toUsername: req.user.username
    });

    res.json({
      message: `${updatedEntriesResult.rows.length} purchase numbers saved as unsold`,
      memoNumber: resolvedMemoNumber,
      entries: updatedEntriesResult.rows.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const removePurchaseUnsoldEntries = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const { number, rangeStart, rangeEnd, bookingDate: rawBookingDate, sellerId, sellerUserId, memoNumber, amount, boxValue } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const purchaseCategory = getPurchaseCategoryFromRequest(req, sessionMode);
    const targetSellerId = Number(sellerId || sellerUserId || req.user.id);
    const normalizedMemoNumber = Number(memoNumber);
    const numbersToRemove = rangeStart || rangeEnd
      ? buildPurchaseNumbers(rangeStart, rangeEnd)
      : { numbers: [normalizePurchaseTicketNumber(number)].filter(Boolean) };

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (numbersToRemove.error) {
      return res.status(400).json({ message: numbersToRemove.error });
    }

    if (!numbersToRemove.numbers || numbersToRemove.numbers.length === 0) {
      return res.status(400).json({ message: 'Number or range is required' });
    }

    if (!targetSellerId) {
      return res.status(400).json({ message: 'Party name is required' });
    }

    if (!Number.isInteger(normalizedMemoNumber) || normalizedMemoNumber <= 0) {
      return res.status(400).json({ message: 'Unsold memo number is required' });
    }

    let targetSeller = {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      seller_type: req.user.sellerType,
      parent_id: req.user.parentId
    };

    if (targetSellerId !== Number(req.user.id)) {
      const childSellerResult = await query(
        "SELECT id, username, role, seller_type, parent_id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
        [targetSellerId, req.user.id]
      );

      if (childSellerResult.rows.length === 0) {
        return res.status(403).json({ message: 'You can remove unsold only for yourself or your direct sub stokist' });
      }

      targetSeller = childSellerResult.rows[0];
    }

    const params = [
      targetSellerId,
      PURCHASE_ENTRY_SOURCE,
      sessionMode,
      purchaseCategory,
      bookingDate,
      numbersToRemove.numbers
    ];
    const stockFilters = [];
    const normalizedAmount = String(amount || '').trim();
    const normalizedBoxValue = String(boxValue || '').trim();
    if (normalizedAmount) {
      stockFilters.push(`AND le.amount = $${params.push(normalizedAmount)}::numeric`);
    }
    if (normalizedBoxValue) {
      stockFilters.push(`AND le.box_value = $${params.push(normalizedBoxValue)}`);
    }
    const ownershipFilter = isAdminRole(req.user.role) || targetSellerId === Number(req.user.id)
      ? ''
      : `AND (
           le.forwarded_by = $${params.push(req.user.id)}
           OR le.sent_to_parent = $${params.push(req.user.id)}
           OR (
             le.sent_to_parent = $${params.push(targetSellerId)}
             AND le.forwarded_by = $${params.push(targetSellerId)}
           )
         )`;

    const selectedEntriesResult = await query(
      `SELECT le.*
       FROM lottery_entries le
       WHERE le.user_id = $1
         AND le.entry_source = $2
         AND le.session_mode = $3
         AND le.purchase_category = $4
         AND le.booking_date = $5::date
         AND le.number = ANY($6::varchar[])
         AND LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
         ${stockFilters.join('\n         ')}
         ${ownershipFilter}
       ORDER BY le.number ASC`,
      params
    );

    if (selectedEntriesResult.rows.length === 0) {
      return res.status(404).json({ message: 'Selected number current unsold me nahi mila' });
    }

    if (selectedEntriesResult.rows.length !== numbersToRemove.numbers.length) {
      const availableNumbers = new Set(selectedEntriesResult.rows.map((row) => row.number));
      const missingNumbers = numbersToRemove.numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));
      const missingLabel = missingNumbers.length > 5
        ? `${missingNumbers.slice(0, 5).join(', ')} +${missingNumbers.length - 5} more`
        : missingNumbers.join(', ');
      return res.status(400).json({ message: `Ye number current unsold me nahi hai: ${missingLabel}` });
    }

    const selectedIds = selectedEntriesResult.rows.map((row) => row.id);
    const updatedEntriesResult = await query(
      `UPDATE lottery_entries
       SET status = 'accepted',
           sent_to_parent = $2,
           forwarded_by = $3,
           memo_number = COALESCE(purchase_memo_number, memo_number),
           sent_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])
       RETURNING *`,
      [
        selectedIds,
        Number(targetSeller.id) === Number(req.user.id) ? req.user.id : (targetSeller.parent_id || req.user.id),
        Number(targetSeller.id) === Number(req.user.id) ? req.user.id : req.user.id
      ]
    );

    await insertHistoryRecords({
      entries: updatedEntriesResult.rows,
      actionType: 'unsold_removed',
      statusBefore: 'unsold',
      statusAfter: 'accepted',
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: targetSeller.id,
      toUsername: targetSeller.username,
      memoNumber: normalizedMemoNumber
    });

    return res.json({
      message: `${updatedEntriesResult.rows.length} unsold numbers removed`,
      memoNumber: normalizedMemoNumber,
      entries: updatedEntriesResult.rows.map(mapLotteryEntry)
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const checkPurchaseUnsoldRemoveEntries = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const { number, rangeStart, rangeEnd, bookingDate: rawBookingDate, sellerId, sellerUserId, amount, boxValue } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const purchaseCategory = getPurchaseCategoryFromRequest(req, sessionMode);
    const targetSellerId = Number(sellerId || sellerUserId || req.user.id);
    const numbersToRemove = rangeStart || rangeEnd
      ? buildPurchaseNumbers(rangeStart, rangeEnd)
      : { numbers: [normalizePurchaseTicketNumber(number)].filter(Boolean) };

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (numbersToRemove.error) {
      return res.status(400).json({ message: numbersToRemove.error });
    }

    if (!numbersToRemove.numbers || numbersToRemove.numbers.length === 0) {
      return res.status(400).json({ message: 'Number or range is required' });
    }

    if (!targetSellerId) {
      return res.status(400).json({ message: 'Party name is required' });
    }

    let targetSeller = {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      seller_type: req.user.sellerType,
      parent_id: req.user.parentId
    };

    if (targetSellerId !== Number(req.user.id)) {
      const childSellerResult = await query(
        "SELECT id, username, role, seller_type, parent_id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
        [targetSellerId, req.user.id]
      );

      if (childSellerResult.rows.length === 0) {
        return res.status(403).json({ message: 'You can remove unsold only for yourself or your direct sub stokist' });
      }

      targetSeller = childSellerResult.rows[0];
    }

    const params = [
      targetSellerId,
      PURCHASE_ENTRY_SOURCE,
      sessionMode,
      purchaseCategory,
      bookingDate,
      numbersToRemove.numbers
    ];
    const stockFilters = [];
    const normalizedAmount = String(amount || '').trim();
    const normalizedBoxValue = String(boxValue || '').trim();
    if (normalizedAmount) {
      stockFilters.push(`AND le.amount = $${params.push(normalizedAmount)}::numeric`);
    }
    if (normalizedBoxValue) {
      stockFilters.push(`AND le.box_value = $${params.push(normalizedBoxValue)}`);
    }
    const ownershipFilter = isAdminRole(req.user.role) || targetSellerId === Number(req.user.id)
      ? ''
      : `AND (
           le.forwarded_by = $${params.push(req.user.id)}
           OR le.sent_to_parent = $${params.push(req.user.id)}
           OR (
             le.sent_to_parent = $${params.push(targetSellerId)}
             AND le.forwarded_by = $${params.push(targetSellerId)}
           )
         )`;

    const selectedEntriesResult = await query(
      `SELECT le.*
       FROM lottery_entries le
       WHERE le.user_id = $1
         AND le.entry_source = $2
         AND le.session_mode = $3
         AND le.purchase_category = $4
         AND le.booking_date = $5::date
         AND le.number = ANY($6::varchar[])
         AND LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
         ${stockFilters.join('\n         ')}
         ${ownershipFilter}
       ORDER BY le.number ASC`,
      params
    );

    if (selectedEntriesResult.rows.length === 0) {
      return res.status(404).json({ message: 'Selected number current unsold me nahi mila' });
    }

    if (selectedEntriesResult.rows.length !== numbersToRemove.numbers.length) {
      const availableNumbers = new Set(selectedEntriesResult.rows.map((row) => row.number));
      const missingNumbers = numbersToRemove.numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));
      const missingLabel = missingNumbers.length > 5
        ? `${missingNumbers.slice(0, 5).join(', ')} +${missingNumbers.length - 5} more`
        : missingNumbers.join(', ');
      return res.status(400).json({ message: `Ye number current unsold me nahi hai: ${missingLabel}` });
    }

    return res.json({
      ok: true,
      message: `${selectedEntriesResult.rows.length} unsold numbers available`,
      entries: selectedEntriesResult.rows.map(mapLotteryEntry)
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPurchaseUnsoldRemoveMemoEntries = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const amount = String(req.query.amount || '').trim();
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const requestedSellerId = Number(req.query.sellerId || 0);
    let targetSellerId = requestedSellerId || Number(req.user.id);

    if (!isAdminRole(req.user.role)) {
      if (requestedSellerId && requestedSellerId !== Number(req.user.id)) {
        const childSellerResult = await query(
          "SELECT id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
          [requestedSellerId, req.user.id]
        );

        if (childSellerResult.rows.length === 0) {
          return res.status(403).json({ message: 'You can view unsold remove memo only for yourself or your direct sub stokist' });
        }
      }
    }

    const params = [targetSellerId, PURCHASE_ENTRY_SOURCE, 'unsold_removed'];
    const conditions = [
      'h.to_user_id = $1',
      'le.entry_source = $2',
      'h.action_type = $3'
    ];

    if (bookingDate) {
      params.push(bookingDate);
      conditions.push(`h.booking_date = $${params.length}::date`);
    }

    if (sessionMode) {
      params.push(sessionMode);
      conditions.push(`h.session_mode = $${params.length}`);
    }

    if (purchaseCategory) {
      params.push(purchaseCategory);
      conditions.push(`h.purchase_category = $${params.length}`);
    }

    if (amount) {
      params.push(amount);
      conditions.push(`h.amount = $${params.length}::numeric`);
    }

    const result = await query(
      `SELECT h.*
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY h.memo_number ASC NULLS LAST, h.created_at ASC, h.number ASC`,
      params
    );

    return res.json(result.rows.map(mapHistoryRecord));
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const replacePurchaseUnsoldMemoEntries = async (req, res) => {
  const client = await getClient();

  try {
    await ensureHistoryStorage();

    const {
      sellerId,
      sellerUserId,
      memoNumber,
      amount,
      purchaseCategory: rawPurchaseCategory,
      rows,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const targetSellerId = Number(sellerId || sellerUserId || req.user.id);
    const normalizedMemoNumber = Number(memoNumber);
    const normalizedRows = Array.isArray(rows) ? rows : [];

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!targetSellerId || !Number.isInteger(normalizedMemoNumber) || normalizedMemoNumber <= 0) {
      return res.status(400).json({ message: 'Seller and memo number are required' });
    }

    const invalidRow = normalizedRows.find((row) => !row.boxValue || row.amount === undefined || row.amount === null);
    if (invalidRow) {
      return res.status(400).json({ message: 'Each memo row needs box value and amount' });
    }

    const invalidSemRow = normalizedRows.find((row) => getPurchaseSemValidationError(row.amount, row.boxValue));
    if (invalidSemRow) {
      return res.status(400).json({ message: getPurchaseSemValidationError(invalidSemRow.amount, invalidSemRow.boxValue) });
    }

    const invalidRangeRow = normalizedRows
      .map((row) => buildPurchaseNumbers(row.rangeStart, row.rangeEnd))
      .find((rangeResult) => rangeResult.error);

    if (invalidRangeRow) {
      return res.status(400).json({ message: invalidRangeRow.error });
    }

    let targetSeller = {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      seller_type: req.user.sellerType,
      parent_id: req.user.parentId
    };

    if (targetSellerId !== Number(req.user.id)) {
      const targetSellerResult = isAdminRole(req.user.role)
        ? await client.query(
          "SELECT id, username, role, seller_type, parent_id FROM users WHERE id = $1 AND role = 'seller' LIMIT 1",
          [targetSellerId]
        )
        : await client.query(
          "SELECT id, username, role, seller_type, parent_id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
          [targetSellerId, req.user.id]
        );

      if (targetSellerResult.rows.length === 0) {
        return res.status(403).json({
          message: isAdminRole(req.user.role)
            ? 'Selected seller not found'
            : 'You can update unsold only for yourself or your direct sub stokist'
        });
      }

      targetSeller = targetSellerResult.rows[0];
    }

    const normalizedAmount = normalizePurchaseAmount(normalizedRows[0]?.amount ?? amount ?? '');
    const normalizedPurchaseCategory = normalizePurchaseCategory(normalizedRows[0]?.purchaseCategory || rawPurchaseCategory)
      || getDefaultPurchaseCategory(sessionMode);

    if (!normalizedAmount) {
      return res.status(400).json({ message: 'Amount is required' });
    }

    await client.query('BEGIN');

    const existingMemoResult = await client.query(
      `SELECT *
       FROM lottery_entries
       WHERE user_id = $1
         AND entry_source = $2
         AND forwarded_by = $3
         AND memo_number = $4
         AND booking_date = $5::date
         AND session_mode = $6
         AND purchase_category = $7
         AND amount = $8::numeric
         AND LOWER(TRIM(status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
       ORDER BY number ASC`,
      [targetSeller.id, PURCHASE_ENTRY_SOURCE, req.user.id, normalizedMemoNumber, bookingDate, sessionMode, normalizedPurchaseCategory, normalizedAmount]
    );

    const existingIds = existingMemoResult.rows.map((row) => row.id);
    if (existingIds.length > 0) {
      await client.query(
        `UPDATE lottery_entries
         SET status = 'accepted',
             sent_to_parent = $2,
             forwarded_by = $3,
             memo_number = COALESCE(purchase_memo_number, memo_number),
             sent_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::int[])`,
        [
          existingIds,
          Number(targetSeller.id) === Number(req.user.id) ? req.user.id : (targetSeller.parent_id || req.user.id),
          Number(targetSeller.id) === Number(req.user.id) ? req.user.id : req.user.id
        ]
      );
    }

    if (normalizedRows.length === 0) {
      await client.query('COMMIT');
      return res.status(200).json({
        message: `Unsold memo ${normalizedMemoNumber} deleted successfully`,
        deletedMemoNumber: normalizedMemoNumber,
        entries: []
      });
    }

    const updatedEntries = [];
    for (const row of normalizedRows) {
      const rangeResult = buildPurchaseNumbers(row.rangeStart, row.rangeEnd);
      const rowBookingDate = normalizeBookingDate(row.bookingDate || bookingDate);
      const resolvedSessionMode = normalizeSessionMode(row.sessionMode) || sessionMode;
      const resolvedPurchaseCategory = normalizePurchaseCategory(row.purchaseCategory) || normalizedPurchaseCategory;
      const rowBoxValue = normalizePurchaseBoxValue(row.boxValue);
      const rowAmount = normalizePurchaseAmount(row.amount);

      if (!rowBookingDate) {
        throw new Error('Valid row booking date is required');
      }

      const stockParams = [
        targetSeller.id,
        PURCHASE_ENTRY_SOURCE,
        resolvedSessionMode,
        resolvedPurchaseCategory,
        rowBookingDate,
        rowAmount,
        rowBoxValue,
        rangeResult.numbers
      ];
      let ownerStockFilter = '';
      if (targetSellerId === Number(req.user.id)) {
        if (!isAdminRole(req.user.role)) {
          ownerStockFilter = `AND le.forwarded_by = $${stockParams.push(req.user.id)}`;
        }
      } else {
        ownerStockFilter = `AND (
             le.sent_to_parent = $${stockParams.push(req.user.id)}
             OR (
               le.sent_to_parent = $${stockParams.push(targetSellerId)}
               AND le.forwarded_by = $${stockParams.push(targetSellerId)}
             )
           )`;
      }

      const stockEntriesResult = await client.query(
        `SELECT *
         FROM lottery_entries le
         WHERE le.user_id = $1
           AND le.entry_source = $2
           AND le.status = 'accepted'
           AND le.session_mode = $3
           AND le.purchase_category = $4
           AND le.booking_date = $5::date
           AND le.amount = $6::numeric
           AND le.box_value = $7
           AND le.number = ANY($8::varchar[])
           AND le.memo_number IS NOT NULL
           ${ownerStockFilter}
         ORDER BY le.number ASC`,
        stockParams
      );

      if (stockEntriesResult.rows.length !== rangeResult.numbers.length) {
        const availableNumbers = new Set(stockEntriesResult.rows.map((stockRow) => stockRow.number));
        const missingNumbers = rangeResult.numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));
        const missingLabel = missingNumbers.length > 5
          ? `${missingNumbers.slice(0, 5).join(', ')} +${missingNumbers.length - 5} more`
          : missingNumbers.join(', ');
        throw new Error(`Ye number selected party ke purchase stock me nahi hai: ${missingLabel}`);
      }

      const selectedIds = stockEntriesResult.rows.map((stockRow) => stockRow.id);
      const updatedEntriesResult = await client.query(
        `UPDATE lottery_entries
         SET status = $4,
             sent_to_parent = $2,
             forwarded_by = $2,
             memo_number = $3,
             purchase_memo_number = COALESCE(purchase_memo_number, memo_number),
             sent_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::int[])
         RETURNING *`,
        [selectedIds, req.user.id, normalizedMemoNumber, UNSOLD_LOCAL_STATUS]
      );
      updatedEntries.push(...updatedEntriesResult.rows);
    }

    await deleteUnsoldRemoveHistoryForEntries(updatedEntries, client);

    await insertHistoryRecords({
      entries: updatedEntries,
      actionType: 'saved_unsold',
      statusBefore: 'accepted',
      statusAfter: UNSOLD_LOCAL_STATUS,
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: req.user.id,
      toUsername: req.user.username,
      client
    });

    await client.query('COMMIT');

    return res.status(200).json({
      message: `Unsold memo ${normalizedMemoNumber} updated successfully`,
      entries: updatedEntries.map(mapLotteryEntry)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: error.message || 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const getPurchaseUnsoldSendSummary = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const amount = String(req.query.amount || '').trim();
    const normalizedAmount = /^\d+(\.\d+)?$/.test(amount) ? amount : '';

    if (!req.user.parentId) {
      return res.status(400).json({ message: 'Parent seller/admin nahi hai' });
    }

    const parentResult = await query('SELECT id, username, role FROM users WHERE id = $1 LIMIT 1', [req.user.parentId]);
    const parentUser = parentResult.rows[0];
    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const params = [visibleUserIds, PURCHASE_ENTRY_SOURCE];
    const filters = [
      'le.user_id = ANY($1::int[])',
      'le.entry_source = $2',
      `LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`
    ];

    if (bookingDate) {
      params.push(bookingDate);
      filters.push(`le.booking_date = $${params.length}::date`);
    }

    if (sessionMode) {
      params.push(sessionMode);
      filters.push(`le.session_mode = $${params.length}`);
    }

    if (purchaseCategory) {
      params.push(purchaseCategory);
      filters.push(`le.purchase_category = $${params.length}`);
    }

    if (normalizedAmount) {
      params.push(normalizedAmount);
      filters.push(`le.amount = $${params.length}::numeric`);
    }

    const entriesResult = await query(
      `SELECT le.*, u.username AS seller_name
       FROM lottery_entries le
       INNER JOIN users u ON u.id = le.user_id
       WHERE ${filters.join(' AND ')}
       ORDER BY u.username ASC, le.number ASC`,
      params
    );

    const numericPiece = (entry) => (String(entry.box_value || '').match(/^\d+(\.\d+)?$/) ? Number(entry.box_value) : 0);
    const buildEntryKey = (entry) => ([
      entry.user_id,
      entry.booking_date instanceof Date ? entry.booking_date.toISOString().slice(0, 10) : String(entry.booking_date || ''),
      String(entry.session_mode || ''),
      String(entry.purchase_category || ''),
      String(entry.amount || ''),
      String(entry.box_value || ''),
      String(entry.number || '')
    ].join('|'));
    const isCurrentUnsoldEntry = (entry) => {
      const normalizedStatus = String(entry.status || '').trim().toLowerCase();
      if (normalizedStatus === UNSOLD_LOCAL_STATUS) {
        return Number(entry.user_id) === Number(req.user.id) || Number(entry.sent_to_parent) === Number(req.user.id);
      }

      if (normalizedStatus === UNSOLD_ACCEPTED_STATUS) {
        return (
          Number(entry.sent_to_parent || 0) === Number(req.user.id)
          || Number(entry.user_id) === Number(req.user.id)
          || !entry.sent_to_parent
        ) && !(
          Number(entry.forwarded_by || 0) === Number(req.user.id)
          && entry.sent_to_parent
          && Number(entry.sent_to_parent) !== Number(req.user.id)
        );
      }

      return false;
    };
    const isAlreadySentEntry = (entry) => {
      const normalizedStatus = String(entry.status || '').trim().toLowerCase();
      return (
        (normalizedStatus === UNSOLD_SENT_STATUS && Number(entry.forwarded_by || 0) === Number(req.user.id))
        || (
          normalizedStatus === UNSOLD_ACCEPTED_STATUS
          && Number(entry.forwarded_by || 0) === Number(req.user.id)
          && entry.sent_to_parent
          && Number(entry.sent_to_parent) !== Number(req.user.id)
        )
      );
    };

    const allEntries = entriesResult.rows || [];
    const currentUnsoldEntries = allEntries.filter(isCurrentUnsoldEntry);
    const alreadySentEntries = allEntries.filter(isAlreadySentEntry);
    const alreadySentKeySet = new Set(alreadySentEntries.map(buildEntryKey));
    const alreadySentCurrentEntries = currentUnsoldEntries.filter((entry) => alreadySentKeySet.has(buildEntryKey(entry)));
    const pendingSendEntries = currentUnsoldEntries.filter((entry) => !alreadySentKeySet.has(buildEntryKey(entry)));

    const totalPiece = allEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const unsoldPiece = currentUnsoldEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const alreadySentPiece = alreadySentCurrentEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const pendingSendPiece = pendingSendEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const unsoldCount = currentUnsoldEntries.length;
    const aggregatedRow = totalPiece > 0 || unsoldPiece > 0 || alreadySentPiece > 0 || pendingSendPiece > 0
      ? [{
        sellerId: req.user.id,
        sellerName: req.user.username,
        totalPiece,
        unsoldPiece,
        alreadySentPiece,
        pendingSendPiece,
        soldPiece: Math.max(totalPiece - unsoldPiece, 0),
        unsoldCount
      }]
      : [];

    const autoAccept = Boolean(parentUser && isAdminRole(parentUser.role) && isWithinUnsoldAutoAcceptTime({
      sellerType: req.user.sellerType || req.user.seller_type,
      bookingDate,
      sessionMode,
      purchaseCategory
    }));

    res.json({
      fromSeller: req.user.username,
      toSeller: parentUser?.username || 'Parent',
      autoAccept,
      totalPiece,
      unsoldPiece,
      alreadySentPiece,
      pendingSendPiece,
      soldPiece: Math.max(totalPiece - unsoldPiece, 0),
      rows: aggregatedRow
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const sendPurchaseUnsoldToParent = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.body.bookingDate || req.query.bookingDate);
    const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory || req.headers['x-purchase-category']);
    const amount = String(req.body.amount || req.query.amount || '').trim();
    const normalizedAmount = /^\d+(\.\d+)?$/.test(amount) ? amount : '';

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (!req.user.parentId) {
      return res.status(400).json({ message: 'Parent seller/admin nahi hai' });
    }

    const parentResult = await query('SELECT id, username, role FROM users WHERE id = $1 LIMIT 1', [req.user.parentId]);
    const parentUser = parentResult.rows[0];
    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const params = [
      visibleUserIds,
      PURCHASE_ENTRY_SOURCE,
      bookingDate,
      sessionMode,
      purchaseCategory
    ];
    const filters = [
      'user_id = ANY($1::int[])',
      'entry_source = $2',
      'booking_date = $3::date',
      'session_mode = $4',
      '($5::text IS NULL OR purchase_category = $5)',
      `(
        (
          LOWER(TRIM(status)) = '${UNSOLD_LOCAL_STATUS}'
          AND (user_id = $6 OR sent_to_parent = $6)
        )
        OR (
          LOWER(TRIM(status)) = '${UNSOLD_ACCEPTED_STATUS}'
          AND (
            sent_to_parent IS NULL
            OR sent_to_parent = $6
            OR user_id = $6
          )
          AND NOT (
            forwarded_by = $6
            AND sent_to_parent IS NOT NULL
            AND sent_to_parent <> $6
          )
        )
      )`
    ];
    params.push(req.user.id);

    if (normalizedAmount) {
      params.push(normalizedAmount);
      filters.push(`amount = $${params.length}::numeric`);
    }

    const selectedResult = await query(
      `SELECT *
       FROM lottery_entries
       WHERE ${filters.join(' AND ')}
       ORDER BY user_id ASC, number ASC`,
      params
    );

    if (selectedResult.rows.length === 0) {
      return res.status(400).json({ message: 'Send karne ke liye unsold entry nahi hai' });
    }

    const shouldAutoAcceptToAdmin = Boolean(parentUser && isAdminRole(parentUser.role) && isWithinUnsoldAutoAcceptTime({
      sellerType: req.user.sellerType || req.user.seller_type,
      bookingDate,
      sessionMode,
      purchaseCategory
    }));
    const targetStatus = shouldAutoAcceptToAdmin ? UNSOLD_ACCEPTED_STATUS : UNSOLD_SENT_STATUS;
    const selectedIds = selectedResult.rows.map((row) => row.id);
    const updatedResult = await query(
      `UPDATE lottery_entries
       SET status = $2,
           sent_to_parent = $3,
           forwarded_by = $4,
           sent_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])
       RETURNING *`,
      [selectedIds, targetStatus, req.user.parentId, req.user.id]
    );

    await insertHistoryRecords({
      entries: updatedResult.rows,
      actionType: targetStatus === UNSOLD_ACCEPTED_STATUS ? 'unsold_auto_accepted' : 'unsold_sent',
      statusBefore: 'unsold',
      statusAfter: targetStatus,
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: req.user.parentId,
      toUsername: parentUser?.username || 'Parent'
    });

    res.json({
      message: targetStatus === UNSOLD_ACCEPTED_STATUS
        ? `Unsold admin ko send ho gaya aur auto accepted ho gaya`
        : `Unsold ${parentUser?.username || 'parent'} ko send ho gaya`,
      entriesSent: updatedResult.rows.length,
      autoAccepted: targetStatus === UNSOLD_ACCEPTED_STATUS
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPurchasePieceSummary = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const amount = String(req.query.amount || '').trim();
    const normalizedAmount = /^\d+(\.\d+)?$/.test(amount) ? amount : '';
    const currentUserIsAdmin = isAdminRole(req.user.role);

    const sellersResult = await query(
      "SELECT id, username FROM users WHERE parent_id = $1 AND role = 'seller' ORDER BY username ASC",
      [req.user.id]
    );
    const sellers = currentUserIsAdmin
      ? sellersResult.rows
      : [
        { id: req.user.id, username: req.user.username },
        ...sellersResult.rows.filter((seller) => Number(seller.id) !== Number(req.user.id))
      ];

    if (sellers.length === 0) {
      return res.json([]);
    }

    let summaryResult;

    if (currentUserIsAdmin) {
      const adminParams = [req.user.id, PURCHASE_ENTRY_SOURCE];
      const adminConditions = [
        'le.entry_source = $2',
        `LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`
      ];

      if (bookingDate) {
        adminParams.push(bookingDate);
        adminConditions.push(`le.booking_date = $${adminParams.length}::date`);
      }

      if (sessionMode) {
        adminParams.push(sessionMode);
        adminConditions.push(`le.session_mode = $${adminParams.length}`);
      }

      if (purchaseCategory) {
        adminParams.push(purchaseCategory);
        adminConditions.push(`le.purchase_category = $${adminParams.length}`);
      }

      if (normalizedAmount) {
        adminParams.push(normalizedAmount);
        adminConditions.push(`le.amount = $${adminParams.length}::numeric`);
      }

      summaryResult = await query(
        `WITH RECURSIVE branch_users AS (
          SELECT id, id AS root_seller_id
          FROM users
          WHERE parent_id = $1 AND role = 'seller'
          UNION ALL
          SELECT u.id, bu.root_seller_id
          FROM users u
          INNER JOIN branch_users bu ON u.parent_id = bu.id
        )
        SELECT bu.root_seller_id AS user_id,
               COALESCE(SUM(CASE WHEN le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS total_piece,
               COALESCE(SUM(CASE WHEN LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
                 AND le.box_value ~ '^\\d+(\\.\\d+)?$'
                 THEN le.box_value::numeric ELSE 0 END), 0) AS unsold_piece
        FROM lottery_entries le
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${adminConditions.join(' AND ')}
        GROUP BY bu.root_seller_id`,
        adminParams
      );
    } else {
      const sellerIds = sellers.map((seller) => seller.id);
      const currentSellerType = normalizeSellerType(req.user.sellerType);
      const params = [sellerIds, PURCHASE_ENTRY_SOURCE];
      const conditions = [
        'le.user_id = ANY($1::int[])',
        'le.entry_source = $2',
        `LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`
      ];

      if (bookingDate) {
        params.push(bookingDate);
        conditions.push(`le.booking_date = $${params.length}::date`);
      }

      if (sessionMode) {
        params.push(sessionMode);
        conditions.push(`le.session_mode = $${params.length}`);
      }

      if (purchaseCategory) {
        params.push(purchaseCategory);
        conditions.push(`le.purchase_category = $${params.length}`);
      }

      if (normalizedAmount) {
        params.push(normalizedAmount);
        conditions.push(`le.amount = $${params.length}::numeric`);
      }

      const selfUnsoldParamIndex = params.length + 1;
      summaryResult = await query(
        `SELECT le.user_id,
                COALESCE(SUM(CASE WHEN le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS total_piece,
                COALESCE(SUM(CASE WHEN (
                  LOWER(TRIM(le.status)) = '${UNSOLD_ACCEPTED_STATUS}'
                  OR (
                    LOWER(TRIM(le.status)) = '${UNSOLD_LOCAL_STATUS}'
                    AND (le.user_id = $${selfUnsoldParamIndex} OR le.sent_to_parent = $${selfUnsoldParamIndex})
                  )
                  OR (
                    LOWER(TRIM(le.status)) = '${UNSOLD_SENT_STATUS}'
                    AND le.forwarded_by = $${selfUnsoldParamIndex}
                  )
                ) AND le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS unsold_piece
         FROM lottery_entries le
         WHERE ${conditions.join(' AND ')}
           AND (
             le.user_id <> $${selfUnsoldParamIndex}
             ${currentSellerType === SELLER_TYPE_NORMAL_SELLER ? 'OR TRUE' : ''}
             OR (
               le.forwarded_by = $${selfUnsoldParamIndex}
               AND le.memo_number IS NOT NULL
             )
           )
         GROUP BY le.user_id`,
        [...params, req.user.id]
      );
    }
    const summaryMap = new Map(summaryResult.rows.map((row) => [Number(row.user_id), row]));
    const untransferredParams = [req.user.id, currentUserIsAdmin ? ADMIN_PURCHASE_ENTRY_SOURCE : PURCHASE_ENTRY_SOURCE];
    const currentUserSellerType = normalizeSellerType(req.user.sellerType);
    const untransferredConditions = [
      'le.user_id = $1',
      'le.entry_source = $2',
      currentUserIsAdmin ? "le.status = 'available'" : "le.status = 'accepted'",
      currentUserIsAdmin
        ? 'TRUE'
        : currentUserSellerType === SELLER_TYPE_NORMAL_SELLER
          ? 'FALSE'
          : 'NOT (le.forwarded_by = $1 AND le.memo_number IS NOT NULL)'
    ];

    if (bookingDate) {
      untransferredParams.push(bookingDate);
      untransferredConditions.push(`le.booking_date = $${untransferredParams.length}::date`);
    }

    if (sessionMode) {
      untransferredParams.push(sessionMode);
      untransferredConditions.push(`le.session_mode = $${untransferredParams.length}`);
    }

    if (purchaseCategory) {
      untransferredParams.push(purchaseCategory);
      untransferredConditions.push(`le.purchase_category = $${untransferredParams.length}`);
    }

    if (normalizedAmount) {
      untransferredParams.push(normalizedAmount);
      untransferredConditions.push(`le.amount = $${untransferredParams.length}::numeric`);
    }

    const untransferredResult = await query(
      `SELECT COALESCE(SUM(CASE WHEN le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS stock_not_transferred_piece
       FROM lottery_entries le
       WHERE ${untransferredConditions.join(' AND ')}`,
      untransferredParams
    );
    const stockNotTransferredPiece = Number(untransferredResult.rows[0]?.stock_not_transferred_piece || 0);
    const sellerChildSnapshotUnsoldMap = new Map();

    if (!currentUserIsAdmin) {
      await Promise.all(
        sellers
          .filter((seller) => Number(seller.id) !== Number(req.user.id))
          .map(async (seller) => {
            const [snapshotRows, localSavedResult] = await Promise.all([
              getLatestAcceptedUnsoldSnapshotRows({
                targetSellerId: seller.id,
                viewerUserId: req.user.id,
                bookingDate,
                sessionMode,
                purchaseCategory,
                amount: normalizedAmount,
                boxValue: ''
              }),
              query(
                `SELECT box_value
                 FROM lottery_entries
                 WHERE user_id = $1
                   AND entry_source = $2
                   AND LOWER(TRIM(status)) = $3
                   AND (sent_to_parent = $4 OR forwarded_by = $4)
                   ${bookingDate ? 'AND booking_date = $5::date' : ''}
                   ${sessionMode ? `AND session_mode = $${bookingDate ? 6 : 5}` : ''}
                   ${purchaseCategory ? `AND purchase_category = $${(bookingDate ? 1 : 0) + (sessionMode ? 1 : 0) + 5}` : ''}
                   ${normalizedAmount ? `AND amount = $${(bookingDate ? 1 : 0) + (sessionMode ? 1 : 0) + (purchaseCategory ? 1 : 0) + 5}::numeric` : ''}`,
                [
                  seller.id,
                  PURCHASE_ENTRY_SOURCE,
                  UNSOLD_LOCAL_STATUS,
                  req.user.id,
                  ...[
                    bookingDate,
                    sessionMode,
                    purchaseCategory,
                    normalizedAmount
                  ].filter(Boolean)
                ]
              )
            ]);

            const snapshotPiece = snapshotRows.reduce((sum, row) => (
              sum + (String(row.box_value || '').match(/^\d+(\.\d+)?$/) ? Number(row.box_value) : 0)
            ), 0);
            const localSavedPiece = localSavedResult.rows.reduce((sum, row) => (
              sum + (String(row.box_value || '').match(/^\d+(\.\d+)?$/) ? Number(row.box_value) : 0)
            ), 0);

            sellerChildSnapshotUnsoldMap.set(Number(seller.id), snapshotPiece + localSavedPiece);
          })
      );
    }

    res.json(sellers.map((seller) => {
      const summary = summaryMap.get(Number(seller.id)) || {};
      const resolvedUnsoldPiece = currentUserIsAdmin || Number(seller.id) === Number(req.user.id)
        ? Number(summary.unsold_piece || 0)
        : Number(sellerChildSnapshotUnsoldMap.get(Number(seller.id)) || 0);
      return {
        sellerId: seller.id,
        sellerName: seller.username,
        isSelf: Number(seller.id) === Number(req.user.id),
        totalPiece: Number(summary.total_piece || 0),
        unsoldPiece: resolvedUnsoldPiece,
        stockNotTransferredPiece
      };
    }));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPurchaseBillSummary = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const { date, fromDate, toDate, shift, amount, purchaseCategory } = req.query;
    const sessionMode = normalizeSessionMode(shift);
    const normalizedAmount = String(amount || '').trim();
    const normalizedPurchaseCategory = normalizePurchaseCategory(purchaseCategory);
    const params = [req.user.id, PURCHASE_ENTRY_SOURCE];
    const dateFilterResult = buildDateFilter({ date, fromDate, toDate }, params, 'le.booking_date', true);

    if (dateFilterResult.error) {
      return res.status(400).json({ message: dateFilterResult.error });
    }

    const conditions = [
      'le.entry_source = $2',
      `LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`
    ];

    if (dateFilterResult.dateFilter) {
      conditions.push(dateFilterResult.dateFilter.replace(/^AND\s+/i, ''));
    }

    if (sessionMode) {
      params.push(sessionMode);
      conditions.push(`le.session_mode = $${params.length}`);
    }

    if (normalizedPurchaseCategory) {
      params.push(normalizedPurchaseCategory);
      conditions.push(`le.purchase_category = $${params.length}`);
    }

    if (normalizedAmount) {
      params.push(normalizedAmount);
      conditions.push(`le.amount = $${params.length}::numeric`);
    }

    const result = await query(
      `WITH RECURSIVE branch_users AS (
        SELECT
          id,
          username,
          id AS root_seller_id,
          username AS root_seller_name,
          rate_amount_6 AS root_rate_amount_6,
          rate_amount_12 AS root_rate_amount_12
        FROM users
        WHERE parent_id = $1 AND role = 'seller'
        UNION ALL
        SELECT
          u.id,
          u.username,
          bu.root_seller_id,
          bu.root_seller_name,
          bu.root_rate_amount_6,
          bu.root_rate_amount_12
        FROM users u
        INNER JOIN branch_users bu ON u.parent_id = bu.id
      )
      SELECT
        bu.root_seller_id,
        bu.root_seller_name,
        le.session_mode,
        le.purchase_category,
        le.amount,
        le.box_value,
        CASE WHEN le.amount = 7 THEN bu.root_rate_amount_6 ELSE bu.root_rate_amount_12 END AS applied_rate,
        COALESCE(SUM(CASE WHEN le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS total_piece,
        COALESCE(SUM(CASE WHEN LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
          AND le.box_value ~ '^\\d+(\\.\\d+)?$'
          THEN le.box_value::numeric ELSE 0 END), 0) AS unsold_piece,
        COUNT(*) AS entry_count,
        MIN(le.number) AS range_from,
        MAX(le.number) AS range_to
      FROM lottery_entries le
      INNER JOIN branch_users bu ON bu.id = le.user_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY
        bu.root_seller_id,
        bu.root_seller_name,
        bu.root_rate_amount_6,
        bu.root_rate_amount_12,
        le.session_mode,
        le.purchase_category,
        le.amount,
        le.box_value
      ORDER BY bu.root_seller_name ASC, le.session_mode ASC, le.amount ASC, le.box_value ASC`,
      params
    );

    res.json(result.rows.map((row) => {
      const totalPiece = Number(row.total_piece || 0);
      const unsoldPiece = Number(row.unsold_piece || 0);
      const soldPiece = Math.max(totalPiece - unsoldPiece, 0);
      const appliedRate = Number(row.applied_rate || 0);

      return {
        id: `${row.root_seller_id}-${row.session_mode}-${row.purchase_category}-${row.amount}-${row.box_value}`,
        sellerId: row.root_seller_id,
        sellerName: row.root_seller_name,
        billRootUsername: row.root_seller_name,
        billSellerDisplayName: row.root_seller_name,
        actorUsername: row.root_seller_name,
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
    }));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPendingEntries = async (req, res) => {
  try {
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const amount = String(req.query.amount || '').trim();

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    const params = [req.user.id, sessionMode, bookingDate];
    const amountFilter = amount ? `AND amount = $${params.push(amount)}::numeric` : '';

    const entriesResult = await query(
      `SELECT * FROM lottery_entries
       WHERE user_id = $1
         AND status = 'pending'
         AND session_mode = $2
         AND booking_date = $3::date
         ${amountFilter}
       ORDER BY created_at DESC`,
      params
    );
    res.json(entriesResult.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const deletePendingEntry = async (req, res) => {
  try {
    const { entryId } = req.params;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    const entryResult = await query(
      "SELECT * FROM lottery_entries WHERE id = $1 AND user_id = $2 AND status = 'pending' AND session_mode = $3 AND booking_date = $4::date LIMIT 1",
      [entryId, req.user.id, sessionMode, bookingDate]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    await query('DELETE FROM lottery_entries WHERE id = $1', [entryId]);
    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const sendEntries = async (req, res) => {
  try {
    const userId = req.user.id;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.body.bookingDate || req.query.bookingDate);
    const amount = String(req.body.amount || req.query.amount || '').trim();

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (bookingDate === getTodayDateValue() && !isWithinTimeLimit(sessionMode)) {
      const cleanupParams = [userId, sessionMode, bookingDate];
      const cleanupAmountFilter = amount ? `AND amount = $${cleanupParams.push(amount)}::numeric` : '';
      await query(
        `DELETE FROM lottery_entries
         WHERE user_id = $1
           AND status = 'pending'
           AND session_mode = $2
           AND booking_date = $3::date
           ${cleanupAmountFilter}`,
        cleanupParams
      );
      return res.status(400).json({ message: 'Time limit exceeded. Pending entries have been deleted.' });
    }

    const userResult = await query('SELECT id, parent_id FROM users WHERE id = $1 LIMIT 1', [userId]);
    const user = userResult.rows[0];

    if (!user || !user.parent_id) {
      return res.status(400).json({ message: 'Cannot send entries without a parent user' });
    }

    const parentResult = await query('SELECT id, role, username FROM users WHERE id = $1 LIMIT 1', [user.parent_id]);
    const parentUser = parentResult.rows[0];
    const isFutureBooking = bookingDate > getTodayDateValue();
    const nextStatus = isFutureBooking
      ? 'queued'
      : parentUser && isAdminRole(parentUser.role) ? 'accepted' : 'sent';

    const ownEntriesParams = [nextStatus, user.parent_id, userId, sessionMode, bookingDate];
    const ownAmountFilter = amount ? `AND amount = $${ownEntriesParams.push(amount)}::numeric` : '';
    const ownEntriesResult = await query(
      `UPDATE lottery_entries
       SET status = $1, sent_to_parent = $2, forwarded_by = $3, sent_at = CURRENT_TIMESTAMP
       WHERE user_id = $3 AND status = 'pending' AND session_mode = $4 AND booking_date = $5::date
       ${ownAmountFilter}
       RETURNING id, user_id, unique_code, number, box_value, amount, session_mode, booking_date`,
      ownEntriesParams
    );

    const acceptedChildParams = [nextStatus, user.parent_id, userId, userId, sessionMode, bookingDate];
    const acceptedChildAmountFilter = amount ? `AND amount = $${acceptedChildParams.push(amount)}::numeric` : '';
    const acceptedChildEntriesResult = await query(
      `UPDATE lottery_entries
       SET status = $1, sent_to_parent = $2, forwarded_by = $3, sent_at = CURRENT_TIMESTAMP
       WHERE sent_to_parent = $4 AND status = 'accepted' AND session_mode = $5 AND booking_date = $6::date
       ${acceptedChildAmountFilter}
       RETURNING id, user_id, unique_code, number, box_value, amount, session_mode, booking_date`,
      acceptedChildParams
    );

    const totalEntriesSent = ownEntriesResult.rowCount + acceptedChildEntriesResult.rowCount;

    await insertHistoryRecords({
      entries: ownEntriesResult.rows,
      actionType: isFutureBooking ? 'queued' : 'sent',
      statusBefore: 'pending',
      statusAfter: nextStatus,
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: user.parent_id,
      toUsername: parentUser ? parentUser.username : 'Unknown'
    });

    await insertHistoryRecords({
      entries: acceptedChildEntriesResult.rows,
      actionType: isFutureBooking ? 'queue_forwarded' : 'forwarded',
      statusBefore: 'accepted',
      statusAfter: nextStatus,
      actorUserId: req.user.id,
      actorUsername: req.user.username,
      toUserId: user.parent_id,
      toUsername: parentUser ? parentUser.username : 'Unknown'
    });

    res.json({
      message: isFutureBooking
        ? `Entries queued for ${bookingDate}`
        : parentUser && isAdminRole(parentUser.role) ? 'Entries sent and auto accepted by admin' : 'Entries sent successfully to parent',
      entriesSent: totalEntriesSent
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getReceivedEntries = async (req, res) => {
  try {
    const sessionMode = getRequiredSessionMode(req, res);
    const amount = String(req.query.amount || '').trim();

    if (!sessionMode) {
      return;
    }

    await normalizeQueuedEntries([req.user.id]);

    const params = [req.user.id, sessionMode, PURCHASE_ENTRY_SOURCE, UNSOLD_SENT_STATUS];
    const amountFilter = amount ? `AND le.amount = $${params.push(amount)}::numeric` : '';

    const entriesResult = await query(
      `SELECT le.*, u.username, parent_user.username AS parent_username
       , forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE le.sent_to_parent = $1
         AND le.session_mode = $2
         AND le.booking_date = CURRENT_DATE
         AND (
           le.status = 'sent'
           OR (le.entry_source = $3 AND le.status = $4)
         )
         ${amountFilter}
       ORDER BY le.sent_at DESC NULLS LAST`,
      params
    );

    res.json(entriesResult.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateReceivedEntryStatus = async (req, res) => {
  try {
    const { entryId } = req.params;
    const { action } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const amount = String(req.body.amount || req.query.amount || '').trim();

    if (!sessionMode) {
      return;
    }

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const params = [entryId, req.user.id, sessionMode, PURCHASE_ENTRY_SOURCE, UNSOLD_SENT_STATUS];
    const amountFilter = amount ? `AND le.amount = $${params.push(amount)}::numeric` : '';

    const entryResult = await query(
      `SELECT le.*, parent_user.parent_id AS current_user_parent_id
       FROM lottery_entries le
       LEFT JOIN users parent_user ON parent_user.id = $2
       WHERE le.id = $1
         AND le.sent_to_parent = $2
         AND le.session_mode = $3
         AND (
           le.status = 'sent'
           OR (le.entry_source = $4 AND le.status = $5)
         )
         ${amountFilter}
       LIMIT 1`,
      params
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const entry = entryResult.rows[0];
    const isPurchaseUnsoldEntry = entry.entry_source === PURCHASE_ENTRY_SOURCE && entry.status === UNSOLD_SENT_STATUS;

    if (isPurchaseUnsoldEntry) {
      const memoScopeResult = await query(
        `SELECT *
         FROM lottery_entries
         WHERE user_id = $1
           AND memo_number = $2
           AND booking_date = $3::date
           AND session_mode = $4
           AND purchase_category = $8
           AND amount = $9::numeric
           AND sent_to_parent = $5
           AND entry_source = $6
           AND status = $7
         ORDER BY number ASC`,
        [
          entry.user_id,
          entry.memo_number,
          entry.booking_date,
          entry.session_mode,
          req.user.id,
          PURCHASE_ENTRY_SOURCE,
          UNSOLD_SENT_STATUS,
          entry.purchase_category,
          entry.amount
        ]
      );

      const scopedIds = memoScopeResult.rows.map((row) => row.id);
      const updatedResult = await query(
        `UPDATE lottery_entries
         SET status = $2,
             sent_to_parent = $3,
             forwarded_by = $4,
             sent_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::int[])
         RETURNING *`,
        [
          scopedIds,
          action === 'accept' ? UNSOLD_ACCEPTED_STATUS : 'accepted',
          req.user.id,
          action === 'accept' ? req.user.id : entry.forwarded_by
        ]
      );

      await insertHistoryRecords({
        entries: updatedResult.rows,
        actionType: action === 'accept' ? 'unsold_accepted' : 'unsold_rejected',
        statusBefore: UNSOLD_SENT_STATUS,
        statusAfter: action === 'accept' ? UNSOLD_ACCEPTED_STATUS : 'accepted',
        actorUserId: req.user.id,
        actorUsername: req.user.username,
        toUserId: req.user.id,
        toUsername: req.user.username
      });

      return res.json({
        message: action === 'accept' ? 'Unsold accepted successfully' : 'Unsold rejected successfully',
        entry: mapLotteryEntry(updatedResult.rows[0])
      });
    }

    if (action === 'reject') {
      const rejectedResult = await query(
        `UPDATE lottery_entries
         SET status = 'rejected'
         WHERE id = $1
         RETURNING *`,
        [entryId]
      );

      await insertHistoryRecords({
        entries: rejectedResult.rows,
        actionType: 'rejected',
        statusBefore: 'sent',
        statusAfter: 'rejected',
        actorUserId: req.user.id,
        actorUsername: req.user.username,
        toUserId: req.user.id,
        toUsername: req.user.username
      });

      return res.json({
        message: 'Entry rejected successfully',
        entry: mapLotteryEntry(rejectedResult.rows[0])
      });
    }

    const acceptedResult = await query(
      `UPDATE lottery_entries
       SET status = 'accepted'
       WHERE id = $1
       RETURNING *`,
      [entryId]
    );

    res.json({
      message: 'Entry accepted successfully',
      entry: mapLotteryEntry(acceptedResult.rows[0])
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getAcceptedEntriesForBookLottery = async (req, res) => {
  try {
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const amount = String(req.query.amount || '').trim();

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    await normalizeQueuedEntries([req.user.id]);

    const params = [req.user.id, sessionMode, bookingDate];
    const amountFilter = amount ? `AND le.amount = $${params.push(amount)}::numeric` : '';

    const entriesResult = await query(
      `SELECT le.*, u.username, parent_user.username AS parent_username
       , forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE le.sent_to_parent = $1 AND le.status = 'accepted' AND le.session_mode = $2 AND le.booking_date = $3::date
       ${amountFilter}
       ORDER BY u.username ASC, le.sent_at DESC NULLS LAST`,
      params
    );

    res.json(entriesResult.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getSentEntries = async (req, res) => {
  try {
    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const sessionMode = getOptionalSessionMode(req);
    const { date, fromDate, toDate } = req.query;
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);

    if (visibleUserIds.length === 0) {
      return res.json([]);
    }

    const params = [visibleUserIds];
    let sessionFilter = '';
    const dateFilterResult = buildDateFilter({ date, fromDate, toDate }, params, 'h.booking_date', true);

    if (dateFilterResult.error) {
      return res.status(400).json({ message: dateFilterResult.error });
    }

    if (sessionMode) {
      params.push(sessionMode);
      sessionFilter = `AND h.session_mode = $${params.length}`;
    }

    let purchaseCategoryFilter = '';
    if (purchaseCategory) {
      params.push(purchaseCategory);
      purchaseCategoryFilter = `AND h.purchase_category = $${params.length}`;
    }

    const entriesResult = await query(
      `SELECT h.*
       FROM lottery_entry_history h
       WHERE h.actor_user_id = ANY($1::int[])
         AND h.action_type IN ('sent', 'forwarded', 'queued', 'queue_forwarded')
       ${dateFilterResult.dateFilter}
       ${sessionFilter}
       ${purchaseCategoryFilter}
       ORDER BY h.created_at DESC`,
      params
    );
    res.json(entriesResult.rows.map(mapHistoryRecord));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getMySentEntries = async (req, res) => {
  try {
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const amount = String(req.query.amount || '').trim();

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    await normalizeQueuedEntries([req.user.id]);

    const params = [req.user.id, sessionMode, bookingDate];
    const amountFilter = amount ? `AND le.amount = $${params.push(amount)}::numeric` : '';

    const entriesResult = await query(
      `SELECT le.*, u.username, parent_user.username AS parent_username
       , forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE (le.user_id = $1 OR le.forwarded_by = $1) AND le.status IN ('queued', 'sent', 'accepted', 'rejected') AND le.session_mode = $2 AND le.booking_date = $3::date
       ${amountFilter}
       ORDER BY le.sent_at DESC NULLS LAST`,
      params
    );

    res.json(entriesResult.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getTransferHistory = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const { date, fromDate, toDate, shift, amount, purchaseCategory, includeBookings } = req.query;
    const params = [visibleUserIds];
    const dateFilterResult = buildDateFilter({ date, fromDate, toDate }, params, 'h.booking_date', true);

    if (dateFilterResult.error) {
      return res.status(400).json({ message: dateFilterResult.error });
    }

    const normalizedShift = normalizeSessionMode(shift);
    let shiftFilter = '';
    if (normalizedShift) {
      params.push(normalizedShift);
      shiftFilter = `AND h.session_mode = $${params.length}`;
    }

    const normalizedAmount = String(amount || '').trim();
    let amountFilter = '';
    if (normalizedAmount) {
      params.push(normalizedAmount);
      amountFilter = `AND h.amount = $${params.length}::numeric`;
    }

    const normalizedPurchaseCategory = normalizePurchaseCategory(purchaseCategory);
    let purchaseCategoryFilter = '';
    if (normalizedPurchaseCategory) {
      params.push(normalizedPurchaseCategory);
      purchaseCategoryFilter = `AND h.purchase_category = $${params.length}`;
    }

    const includeBookedActions = String(includeBookings || '').trim().toLowerCase() === 'true';
    const actionFilter = includeBookedActions ? '' : "AND h.action_type <> 'booked'";

    const historyResult = await query(
      `SELECT h.*
       FROM lottery_entry_history h
       WHERE h.actor_user_id = ANY($1::int[])
       ${dateFilterResult.dateFilter}
       ${shiftFilter}
       ${amountFilter}
       ${purchaseCategoryFilter}
       ${actionFilter}
       ORDER BY h.created_at DESC`,
      params
    );

    res.json(historyResult.rows.map(mapHistoryRecord));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const searchNumberTrace = async (req, res) => {
  try {
    await ensureHistoryStorage();

    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const {
      number: rawNumber,
      uniqueCode: rawUniqueCode,
      date,
      fromDate,
      toDate,
      amount,
      sem
    } = req.query;
    const sessionMode = getOptionalSessionMode(req);
    const number = rawNumber ? String(rawNumber).trim() : '';
    const uniqueCode = rawUniqueCode ? String(rawUniqueCode).trim() : '';
    const traceTokens = getTraceTokens(number, uniqueCode);

    if (!number && !uniqueCode) {
      return res.status(400).json({ message: 'Number or unique code is required' });
    }

    const params = [visibleUserIds];
    const conditions = ['le.user_id = ANY($1::int[])'];
    const dateFilterResult = buildDateFilter({ date, fromDate, toDate }, params, 'le.booking_date');

    if (dateFilterResult.error) {
      return res.status(400).json({ message: dateFilterResult.error });
    }

    if (traceTokens.length > 0) {
      params.push(traceTokens);
      conditions.push(`(le.number = ANY($${params.length}::text[]) OR le.unique_code = ANY($${params.length}::text[]))`);
    } else if (number && uniqueCode) {
      params.push(number, uniqueCode);
      conditions.push(`(le.number = $${params.length - 1} OR le.unique_code = $${params.length})`);
    } else if (number) {
      params.push(number);
      conditions.push(`le.number = $${params.length}`);
    } else if (uniqueCode) {
      params.push(uniqueCode);
      conditions.push(`le.unique_code = $${params.length}`);
    }

    if (sessionMode) {
      params.push(sessionMode);
      conditions.push(`le.session_mode = $${params.length}`);
    }

    if (amount) {
      params.push(amount);
      conditions.push(`le.amount = $${params.length}::numeric`);
    }

    if (sem) {
      params.push(sem);
      conditions.push(`le.box_value = $${params.length}`);
    }

    const traceResult = await query(
      `SELECT le.*,
              booked_user.username AS booked_by_username,
              parent_user.username AS sent_to_username,
              forwarded_user.username AS forwarded_by_username,
              first_sent.to_username AS initial_sent_to_username,
              latest_forward.actor_username AS latest_forwarded_by_username,
              latest_forward.to_username AS latest_forwarded_to_username,
              CASE
                WHEN latest_forward.actor_username IS NOT NULL AND latest_forward.to_username IS NOT NULL
                  THEN latest_forward.actor_username || ' -> ' || latest_forward.to_username
                WHEN latest_forward.actor_username IS NOT NULL
                  THEN latest_forward.actor_username
                ELSE NULL
              END AS forwarded_by_display,
              CASE
                WHEN le.status = 'pending' THEN booked_user.username
                WHEN le.entry_source = 'purchase' AND le.status = 'accepted' THEN booked_user.username
                WHEN parent_user.username IS NOT NULL THEN parent_user.username
                ELSE booked_user.username
              END AS current_holder_username
       FROM lottery_entries le
       LEFT JOIN users booked_user ON booked_user.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       LEFT JOIN LATERAL (
         SELECT h.to_username
         FROM lottery_entry_history h
         WHERE h.entry_id = le.id AND h.action_type = 'sent'
         ORDER BY h.created_at ASC
         LIMIT 1
       ) AS first_sent ON TRUE
       LEFT JOIN LATERAL (
         SELECT h.actor_username, h.to_username
         FROM lottery_entry_history h
         WHERE h.entry_id = le.id AND h.action_type = 'forwarded'
         ORDER BY h.created_at DESC
         LIMIT 1
       ) AS latest_forward ON TRUE
       WHERE ${conditions.join(' AND ')}
       ${dateFilterResult.dateFilter}
       ORDER BY le.booking_date DESC, COALESCE(le.sent_at, le.created_at) DESC`,
      params
    );

    res.json(traceResult.rows.map(mapTraceRecord));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  addLotteryEntry,
  addAdminPurchaseEntries,
  replaceAdminPurchaseMemoEntries,
  assignPurchasedEntries,
  getAdminPurchaseEntries,
  getPurchaseEntries,
  getSellerPurchaseView,
  getPurchasePieceSummary,
  getPurchaseBillSummary,
  getPurchaseUnsoldSendSummary,
  markPurchaseEntriesUnsold,
  removePurchaseUnsoldEntries,
  checkPurchaseUnsoldRemoveEntries,
  getPurchaseUnsoldRemoveMemoEntries,
  replacePurchaseUnsoldMemoEntries,
  sendPurchaseUnsoldToParent,
  sendAdminPurchaseEntries,
  replacePurchaseSendMemoEntries,
  transferRemainingPurchaseStock,
  getPendingEntries,
  deletePendingEntry,
  sendEntries,
  getSentEntries,
  getMySentEntries,
  getReceivedEntries,
  updateReceivedEntryStatus,
  getAcceptedEntriesForBookLottery,
  getTransferHistory,
  searchNumberTrace
};
