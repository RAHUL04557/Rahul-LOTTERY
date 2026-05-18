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
      return { hour: 19, minute: 55, second: 0 };
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
  boxValue = '',
  ownerUserId = null,
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
    purchaseCategory
  ];
  let amountClause = '';
  let boxValueClause = '';
  let ownerClause = '';
  let excludeClause = '';

  if (!ignoreAmount) {
    params.push(amount);
    amountClause = `AND amount = $${params.length}::numeric`;
  }

  if (boxValue) {
    params.push(boxValue);
    boxValueClause = `AND box_value = $${params.length}`;
  }

  if (ownerUserId) {
    params.push(ADMIN_PURCHASE_ENTRY_SOURCE, PURCHASE_ENTRY_SOURCE, ownerUserId);
    const adminSourceIndex = params.length - 2;
    const purchaseSourceIndex = params.length - 1;
    const ownerIndex = params.length;
    ownerClause = `AND (
         (entry_source = $${adminSourceIndex} AND user_id = $${ownerIndex})
         OR (entry_source = $${purchaseSourceIndex} AND forwarded_by = $${ownerIndex})
       )`;
  }

  params.push(numbers);
  const numbersParamIndex = params.length;

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
       ${boxValueClause}
       ${ownerClause}
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
  boxValue = '',
  ownerUserId = null,
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
  let boxValueClause = '';
  let ownerClause = '';
  let excludeClause = '';

  if (boxValue) {
    params.push(boxValue);
    boxValueClause = `AND le.box_value = $${params.length}`;
  }

  if (ownerUserId) {
    params.push(ADMIN_PURCHASE_ENTRY_SOURCE, PURCHASE_ENTRY_SOURCE, ownerUserId);
    const adminSourceIndex = params.length - 2;
    const purchaseSourceIndex = params.length - 1;
    const ownerIndex = params.length;
    ownerClause = `AND (
         (le.entry_source = $${adminSourceIndex} AND le.user_id = $${ownerIndex})
         OR (le.entry_source = $${purchaseSourceIndex} AND le.forwarded_by = $${ownerIndex})
       )`;
  }

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
       ${boxValueClause}
       ${ownerClause}
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
  amount,
  boxValue = '',
  ownerUserId = null
}) => {
  const duplicateAllocations = await findExistingPurchaseAllocations({
    db,
    numbers,
    bookingDate,
    sessionMode,
    purchaseCategory,
    amount,
    boxValue,
    ownerUserId
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
  entryId: row.entry_id || row.entryId || null,
  userId: row.user_id,
  branchUserId: row.branch_user_id || null,
  username: row.username || null,
  branchUsername: row.branch_username || null,
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
  memoScopeKey: row.memo_scope_key || null,
  purchaseMemoNumber: row.purchase_memo_number || row.memo_number,
  memoRowOrder: row.memo_row_order,
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
  currentToUsername: row.current_to_username || null,
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

const buildUnsoldIdentityKey = (row = {}) => ([
  Number(row.user_id || row.userId || row.to_user_id || row.toUserId || 0),
  row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || row.bookingDate || '').slice(0, 10),
  String(row.session_mode || row.sessionMode || ''),
  String(row.purchase_category || row.purchaseCategory || ''),
  String(row.amount || ''),
  String(row.box_value || row.boxValue || row.sem || ''),
  String(row.number || '').padStart(5, '0')
].join('|'));

const repairMissingPurchaseMemoNumbers = async (db = { query }) => {
  await db.query(`
    UPDATE lottery_entries le
    SET memo_number = NULL,
        purchase_memo_number = NULL,
        memo_row_order = NULL
    FROM users owner_user
    WHERE owner_user.id = le.user_id
      AND le.entry_source = 'purchase'
      AND LOWER(TRIM(le.status)) = 'accepted'
      AND LOWER(TRIM(COALESCE(owner_user.seller_type, 'seller'))) <> 'normal_seller'
      AND le.forwarded_by IS NOT NULL
      AND le.forwarded_by <> le.user_id
      AND COALESCE(le.purchase_memo_number, le.memo_number) IS NOT NULL
  `);

  await db.query(`
    WITH missing_groups AS (
      SELECT
        le.user_id,
        le.forwarded_by,
        le.booking_date,
        le.session_mode,
        le.purchase_category,
        le.amount,
        COALESCE((
          SELECT MAX(COALESCE(existing.purchase_memo_number, existing.memo_number))
          FROM lottery_entries existing
          WHERE existing.user_id = le.user_id
            AND existing.entry_source = le.entry_source
            AND existing.forwarded_by = le.forwarded_by
            AND existing.booking_date = le.booking_date
            AND existing.session_mode = le.session_mode
            AND existing.purchase_category = le.purchase_category
            AND existing.amount = le.amount
            AND COALESCE(existing.purchase_memo_number, existing.memo_number) IS NOT NULL
        ), 0) + 1 AS memo_number
      FROM lottery_entries le
      INNER JOIN users owner_user ON owner_user.id = le.user_id
      WHERE le.entry_source = 'purchase'
        AND LOWER(TRIM(le.status)) IN ('accepted', 'unsold')
        AND COALESCE(le.purchase_memo_number, le.memo_number) IS NULL
        AND (
          le.forwarded_by = le.user_id
          OR LOWER(TRIM(COALESCE(owner_user.seller_type, 'seller'))) = 'normal_seller'
        )
      GROUP BY le.user_id, le.forwarded_by, le.booking_date, le.session_mode, le.purchase_category, le.amount, le.entry_source
    )
    UPDATE lottery_entries le
    SET memo_number = missing_groups.memo_number,
        purchase_memo_number = missing_groups.memo_number
    FROM missing_groups
    WHERE le.user_id = missing_groups.user_id
      AND le.forwarded_by IS NOT DISTINCT FROM missing_groups.forwarded_by
      AND le.booking_date = missing_groups.booking_date
      AND le.session_mode = missing_groups.session_mode
      AND le.purchase_category = missing_groups.purchase_category
      AND le.amount = missing_groups.amount
      AND le.entry_source = 'purchase'
      AND LOWER(TRIM(le.status)) IN ('accepted', 'unsold')
      AND COALESCE(le.purchase_memo_number, le.memo_number) IS NULL
  `);
};

const getLatestAcceptedUnsoldSnapshotRows = async ({
  targetSellerId,
  viewerUserId,
  bookingDate = null,
  sessionMode = null,
  purchaseCategory = null,
  amount = '',
  boxValue = '',
  respectLiveMemoState = false
}) => {
  const params = [targetSellerId];
  const historyConditions = [
    "h.action_type IN ('unsold_sent', 'unsold_auto_accepted')",
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

  if (respectLiveMemoState) {
    historyConditions.push(`LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold')`);
  }

  params.push(viewerUserId);
  const viewerParamIndex = params.length;

  const result = await query(
    `WITH latest_send_batches AS (
     SELECT
         le.user_id,
         h.booking_date,
         h.session_mode,
         h.purchase_category,
         h.amount,
         MAX(h.created_at) AS latest_created_at
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       WHERE ${historyConditions.join(' AND ')}
        AND h.to_user_id = $${viewerParamIndex}
       GROUP BY le.user_id, h.booking_date, h.session_mode, h.purchase_category, h.amount
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
       INNER JOIN latest_send_batches batch
        ON batch.user_id = le.user_id
       AND batch.booking_date = h.booking_date
       AND batch.session_mode = h.session_mode
       AND batch.purchase_category = h.purchase_category
       AND batch.amount = h.amount
       AND batch.latest_created_at = h.created_at
       LEFT JOIN users seller_user ON seller_user.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = $${viewerParamIndex}
       LEFT JOIN users actor_user ON actor_user.id = h.actor_user_id
       WHERE h.action_type IN ('unsold_sent', 'unsold_auto_accepted')
         AND h.to_user_id = $${viewerParamIndex}
         AND NOT EXISTS (
           SELECT 1
           FROM lottery_entry_history removed_h
           WHERE removed_h.entry_id = h.entry_id
             AND removed_h.action_type = 'unsold_removed'
             AND removed_h.actor_user_id = $${viewerParamIndex}
             AND removed_h.created_at >= h.created_at
         )
     )
     SELECT *
     FROM snapshot
     WHERE ${rowConditions.join(' AND ')}
     ORDER BY snapshot.booking_date DESC, snapshot.session_mode ASC, snapshot.number ASC`,
    params
  );

  return result.rows;
};

const getManualSavedUnsoldRows = async ({
  targetSellerId,
  actorUserId,
  bookingDate = null,
  sessionMode = null,
  purchaseCategory = null,
  amount = '',
  boxValue = ''
}) => {
  const params = [targetSellerId, actorUserId, PURCHASE_ENTRY_SOURCE, 'saved_unsold'];
  const conditions = [
    '(le.user_id = $1 OR (h.to_user_id = $1 AND h.to_user_id <> h.actor_user_id))',
    'h.actor_user_id = $2',
    'le.entry_source = $3',
    'h.action_type = $4',
    latestSavedUnsoldHistoryCondition
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

  if (boxValue) {
    params.push(boxValue);
    conditions.push(`h.box_value = $${params.length}`);
  }

  const result = await query(
    `SELECT
       ('manual-unsold-' || h.id)::varchar AS id,
       CASE WHEN h.to_user_id <> h.actor_user_id THEN h.to_user_id ELSE le.user_id END AS user_id,
       COALESCE(target_user.username, seller_user.username) AS username,
       actor_user.username AS parent_username,
       h.actor_user_id AS forwarded_by,
       actor_user.username AS forwarded_by_username,
       le.series,
       h.number,
       h.box_value,
       h.unique_code,
       h.entry_id,
       h.amount,
       h.session_mode,
       '${UNSOLD_LOCAL_STATUS}'::varchar AS status,
       '${PURCHASE_ENTRY_SOURCE}'::varchar AS entry_source,
       h.memo_number,
       COALESCE(le.purchase_memo_number, le.memo_number, h.memo_number) AS purchase_memo_number,
       le.memo_row_order,
       h.purchase_category,
       h.actor_user_id AS sent_to_parent,
       h.booking_date,
       h.created_at,
       h.created_at AS sent_at
     FROM lottery_entry_history h
     INNER JOIN lottery_entries le ON le.id = h.entry_id
     LEFT JOIN users seller_user ON seller_user.id = le.user_id
     LEFT JOIN users target_user ON target_user.id = CASE WHEN h.to_user_id <> h.actor_user_id THEN h.to_user_id ELSE le.user_id END
     LEFT JOIN users actor_user ON actor_user.id = h.actor_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY h.memo_number ASC NULLS LAST, h.created_at ASC, h.number ASC`,
    params
  );

  return result.rows;
};

const latestSavedUnsoldHistoryCondition = `
  h.created_at = (
    SELECT MAX(latest_h.created_at)
    FROM lottery_entry_history latest_h
    INNER JOIN lottery_entries latest_le ON latest_le.id = latest_h.entry_id
    WHERE latest_h.actor_user_id = h.actor_user_id
      AND latest_h.action_type = h.action_type
      AND latest_le.user_id = le.user_id
      AND latest_le.entry_source = le.entry_source
      AND latest_h.booking_date = h.booking_date
      AND latest_h.session_mode = h.session_mode
      AND latest_h.purchase_category = h.purchase_category
      AND latest_h.amount = h.amount
      AND latest_h.memo_number IS NOT DISTINCT FROM h.memo_number
      AND latest_h.number = h.number
      AND latest_h.box_value IS NOT DISTINCT FROM h.box_value
  )
`;

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
    ADD COLUMN IF NOT EXISTS memo_row_order INTEGER
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
        entry.history_memo_number || memoNumber || entry.memo_number || null,
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
    console.error('sendPurchaseUnsoldToParent error:', error.message);
    res.status(500).json({ message: error.message || 'Server error', error: error.message });
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
    const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory || req.headers['x-purchase-category'])
      || getDefaultPurchaseCategory(sessionMode);
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
      boxValue: normalizedBoxValue,
      ownerUserId: req.user.id
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
      memoRowOrder,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const rangeResult = buildPurchaseNumbers(rangeStart, rangeEnd);
    const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory || req.headers['x-purchase-category'])
      || getDefaultPurchaseCategory(sessionMode);
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
      boxValue: normalizedBoxValue,
      ownerUserId: req.user.id
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

    for (const [rowIndex, row] of normalizedRows.entries()) {
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
        boxValue: rowBoxValue,
        ownerUserId: req.user.id
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
    const sellerId = Number(req.query.sellerId || 0);
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

const getAdminPurchaseSentHistory = async (req, res) => {
  try {
    await ensureHistoryStorage();
    await repairMissingPurchaseMemoNumbers();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const sellerId = Number(req.query.sellerId);
    const amount = String(req.query.amount || '').trim();
    const boxValue = String(req.query.boxValue || '').trim();
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const params = [req.user.id];
    const conditions = [
      'h.actor_user_id = $1',
      "h.action_type IN ('purchase_sent', 'purchase_forwarded')"
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

    if (Number.isFinite(sellerId) && sellerId > 0) {
      const branchIds = await getDirectSellerBranchIds(req.user.id, sellerId);
      if (branchIds.length === 0) {
        return res.status(404).json({ message: 'Seller not found' });
      }
      params.push(branchIds);
      conditions.push(`h.to_user_id = ANY($${params.length}::int[])`);
    }

    if (amount) {
      params.push(amount);
      conditions.push(`h.amount = $${params.length}::numeric`);
    }

    if (boxValue) {
      params.push(boxValue);
      conditions.push(`h.box_value = $${params.length}`);
    }

    const result = await query(
      `SELECT DISTINCT ON (h.entry_id) h.*,
              COALESCE(h.memo_number, le.purchase_memo_number, le.memo_number) AS memo_number,
              current_owner.username AS current_to_username
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       LEFT JOIN users current_owner ON current_owner.id = le.user_id
       WHERE ${conditions.join(' AND ')}
         AND le.entry_source = $${params.length + 1}
       ORDER BY h.entry_id, h.created_at DESC, h.id DESC`,
      [...params, PURCHASE_ENTRY_SOURCE]
    );

    res.json(result.rows.map(mapHistoryRecord)
      .sort((a, b) => (
        String(b.bookingDate || '').localeCompare(String(a.bookingDate || ''))
        || String(a.sessionMode || '').localeCompare(String(b.sessionMode || ''))
        || String(a.toUsername || '').localeCompare(String(b.toUsername || ''))
        || Number(a.memoNumber || 0) - Number(b.memoNumber || 0)
        || Number(a.number || 0) - Number(b.number || 0)
      )));
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
  memoNumber,
  memoRowOrder = null
}) => {
  const insertedEntries = [];
  const usedCodes = new Set();
  const chunkSize = 1000;
  const columnsPerRow = 16;
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
        memoRowOrder,
        purchaseCategory,
        'accepted'
      );

      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::date, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16})`;
    });

    const insertedResult = await db.query(
      `INSERT INTO lottery_entries (
        user_id, series, number, box_value, unique_code, amount,
        sent_to_parent, forwarded_by, session_mode, booking_date,
        entry_source, memo_number, purchase_memo_number, memo_row_order, purchase_category, status
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
  memoNumber,
  memoRowOrder = null
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
         memo_row_order = $6,
         sent_at = CURRENT_TIMESTAMP
     WHERE id = ANY($1::int[])
     RETURNING *`,
    [
      selectedIds,
      targetSeller.id,
      sentToParent,
      currentUser.id,
      effectiveMemoNumber,
      memoRowOrder
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
      memoRowOrder,
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
        boxValue: normalizedBoxValue,
        ownerUserId: req.user.id
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
        memoNumber: normalizedMemoNumber,
        memoRowOrder: Number.isInteger(Number(memoRowOrder)) ? Number(memoRowOrder) : 0
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
      memoNumber: normalizedMemoNumber,
      memoRowOrder: Number.isInteger(Number(memoRowOrder)) ? Number(memoRowOrder) : 0
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
      entryIds,
      rows,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const targetSellerId = Number(sellerId || sellerUserId);
    const normalizedMemoNumber = Number(memoNumber);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const memoEntryIds = [
      ...(Array.isArray(entryIds) ? entryIds : []),
      ...normalizedRows.flatMap((row) => Array.isArray(row.entryIds) ? row.entryIds : [])
    ]
      .map((entryId) => Number(entryId))
      .filter((entryId) => Number.isInteger(entryId) && entryId > 0);
    const uniqueMemoEntryIds = [...new Set(memoEntryIds)];
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

    const targetBranchIds = [Number(targetSeller.id)];

    if (Number(targetSeller.id) !== Number(req.user.id)) {
      const directBranchIds = await getDirectSellerBranchIds(req.user.id, targetSeller.id);
      if (!directBranchIds.includes(Number(targetSeller.id))) {
        return res.status(403).json({ message: 'Selected seller stock access nahi hai' });
      }
    }

    if (targetBranchIds.length === 0) {
      return res.status(403).json({ message: 'Selected seller stock access nahi hai' });
    }

    await client.query('BEGIN');

    const historyActionTypes = currentUserIsAdmin
      ? ['purchase_sent', 'purchase_memo_updated']
      : ['purchase_forwarded', 'purchase_forward_memo_updated', 'purchase_self_memo_created'];
    const shouldLookupMemoByEntryIds = normalizedRows.length > 0 && uniqueMemoEntryIds.length > 0;
    const existingMemoResult = shouldLookupMemoByEntryIds
      ? await client.query(
        `SELECT DISTINCT le.*
         FROM lottery_entries le
         INNER JOIN lottery_entry_history h ON h.entry_id = le.id
         WHERE le.id = ANY($1::int[])
           AND le.user_id = ANY($2::int[])
           AND le.entry_source = $3
           AND h.actor_user_id = $4
           AND h.to_user_id = $5
           AND h.action_type = ANY($6::varchar[])
           AND COALESCE(h.memo_number, le.purchase_memo_number, le.memo_number) = $7
           AND LOWER(TRIM(le.status)) IN ('accepted', 'unsold')
         ORDER BY le.number ASC`,
        [uniqueMemoEntryIds, targetBranchIds, PURCHASE_ENTRY_SOURCE, req.user.id, targetSeller.id, historyActionTypes, normalizedMemoNumber]
      )
      : await client.query(
        `SELECT DISTINCT le.*
         FROM lottery_entry_history h
         INNER JOIN lottery_entries le ON le.id = h.entry_id
         WHERE h.actor_user_id = $1
           AND h.to_user_id = $2
           AND h.action_type = ANY($3::varchar[])
           AND COALESCE(h.memo_number, le.purchase_memo_number, le.memo_number) = $4
           AND h.booking_date = $5::date
           AND h.session_mode = $6
           AND h.purchase_category = $7
           AND h.amount = $8::numeric
           AND le.user_id = ANY($9::int[])
           AND le.entry_source = $10
           AND LOWER(TRIM(le.status)) IN ('accepted', 'unsold')
         ORDER BY le.number ASC`,
        [req.user.id, targetSeller.id, historyActionTypes, normalizedMemoNumber, bookingDate, sessionMode, normalizedPurchaseCategory, normalizedAmount, targetBranchIds, PURCHASE_ENTRY_SOURCE]
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

    for (const [rowIndex, row] of normalizedRows.entries()) {
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
          boxValue: rowBoxValue,
          ownerUserId: req.user.id
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
          memoNumber: normalizedMemoNumber,
          memoRowOrder: Number.isInteger(Number(row.memoRowOrder)) ? Number(row.memoRowOrder) : rowIndex
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
        memoNumber: normalizedMemoNumber,
        memoRowOrder: Number.isInteger(Number(row.memoRowOrder)) ? Number(row.memoRowOrder) : rowIndex
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
      allowNormalSellerStockTransfer: true
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
    await repairMissingPurchaseMemoNumbers();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const status = String(req.query.status || '').trim().toLowerCase();
    const sellerId = Number(req.query.sellerId || 0);
    const amount = String(req.query.amount || '').trim();
    const boxValue = String(req.query.boxValue || '').trim();
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const remainingOnly = String(req.query.remaining || '').trim().toLowerCase() === 'true';
    const latestSentOnly = String(req.query.latestSentOnly || '').trim().toLowerCase() === 'true';
    const params = [PURCHASE_ENTRY_SOURCE];
    const conditions = ['le.entry_source = $1'];
    let childSellerVisibilityParamIndex = null;
    let adminScopedBranchIds = [];
    let childScopedBranchIds = [];

    if (req.user.role === 'admin') {
      if (sellerId) {
        adminScopedBranchIds = await getDirectSellerBranchIds(req.user.id, sellerId);

        if (adminScopedBranchIds.length === 0) {
          return res.status(404).json({ message: 'Seller not found' });
        }

        params.push(adminScopedBranchIds);
        conditions.push(`le.user_id = ANY($${params.length}::int[])`);
        params.push(req.user.id);
        conditions.push(`(
          le.forwarded_by IS NULL
          OR le.forwarded_by = $${params.length}
          OR le.sent_to_parent = $${params.length}
          OR le.user_id = ANY($${params.length - 1}::int[])
        )`);
      } else {
        params.push(req.user.id);
        conditions.push(`le.forwarded_by = $${params.length}`);
      }
    } else if (sellerId && sellerId !== Number(req.user.id)) {
      childScopedBranchIds = await getDirectSellerBranchIds(req.user.id, sellerId);

      if (childScopedBranchIds.length === 0) {
        return res.status(403).json({ message: 'You can view purchase only for your direct sub stokist' });
      }

      params.push(childScopedBranchIds);
      conditions.push(`le.user_id = ANY($${params.length}::int[])`);
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
      const snapshotSellerIds = childScopedBranchIds.length > 0 ? childScopedBranchIds : [sellerId];
      const [snapshotRows, manualSavedRows, localSavedResult] = await Promise.all([
        Promise.all(snapshotSellerIds.map((targetId) => getLatestAcceptedUnsoldSnapshotRows({
          targetSellerId: targetId,
          viewerUserId: req.user.id,
          bookingDate,
          sessionMode,
          purchaseCategory,
          amount,
          boxValue,
          respectLiveMemoState: true
        }))).then((rows) => rows.flat()),
        Promise.all(snapshotSellerIds.map((targetId) => getManualSavedUnsoldRows({
          targetSellerId: targetId,
          actorUserId: req.user.id,
          bookingDate,
          sessionMode,
          purchaseCategory,
          amount,
          boxValue
        }))).then((rows) => rows.flat()),
        query(
          `SELECT le.*, u.username, parent_user.username AS parent_username, forwarded_user.username AS forwarded_by_username
           FROM lottery_entries le
           LEFT JOIN users u ON u.id = le.user_id
           LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
           LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
           WHERE le.entry_source = $1
             AND le.user_id = ANY($2::int[])
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
            snapshotSellerIds,
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

      const buildUnsoldMemoScopeKey = (row = {}) => ([
        row.memo_number ?? row.purchase_memo_number ?? '',
        row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || '').slice(0, 10),
        row.session_mode || '',
        row.purchase_category || '',
        String(row.amount || '')
      ].join('|'));
      const manuallyReplacedMemoScopes = new Set(manualSavedRows.map(buildUnsoldMemoScopeKey));
      const shouldKeepSnapshotRow = (row = {}) => (
        manuallyReplacedMemoScopes.size === 0
        || !manuallyReplacedMemoScopes.has(buildUnsoldMemoScopeKey(row))
      );
      const buildUnsoldMemoIdentityKey = (row = {}) => ([
        row.memo_number ?? row.purchase_memo_number ?? row.memoNumber ?? row.purchaseMemoNumber ?? '',
        buildUnsoldIdentityKey(row)
      ].join('|'));
      const combinedRows = [
        ...manualSavedRows,
        ...snapshotRows.filter(shouldKeepSnapshotRow),
        ...localSavedResult.rows.filter(shouldKeepSnapshotRow)
      ].filter((row, index, rows) => {
        const rowKey = buildUnsoldMemoIdentityKey(row);
        return rows.findIndex((currentRow) => buildUnsoldMemoIdentityKey(currentRow) === rowKey) === index;
      });
      const scopedRows = combinedRows.map((row) => ({
        ...row,
        branch_user_id: row.user_id,
        branch_username: row.username,
        memo_scope_key: String(row.user_id || ''),
        user_id: sellerId
      }));
      res.json(scopedRows.map(mapLotteryEntry));
      return;
    }

    if (status) {
      if (status === UNSOLD_ACCEPTED_STATUS) {
        conditions.push(`LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`);
        if (req.user.role === 'admin') {
          params.push(req.user.id);
          const adminUserParamIndex = params.length;
          conditions.push(`(
            le.forwarded_by = $${adminUserParamIndex}
            OR le.sent_to_parent = $${adminUserParamIndex}
          )`);
        }
      } else {
        if (status === 'unsold') {
          conditions.push(`LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold')`);
          if (req.user.role !== 'admin' && (!sellerId || sellerId === Number(req.user.id))) {
            params.push(req.user.id);
            conditions.push(`(le.sent_to_parent = $${params.length} OR le.forwarded_by = $${params.length})`);
          }
        } else {
          params.push(status);
          conditions.push(`LOWER(TRIM(le.status)) = $${params.length}`);
        }
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

    const adminSnapshotSellerIds = req.user.role === 'admin' && sellerId
      ? (adminScopedBranchIds.length > 0 ? adminScopedBranchIds : [sellerId])
      : [];
    const adminAcceptedSnapshotRows = [UNSOLD_ACCEPTED_STATUS, 'unsold'].includes(status) && adminSnapshotSellerIds.length > 0
      ? (await Promise.all(adminSnapshotSellerIds.map((targetId) => getLatestAcceptedUnsoldSnapshotRows({
        targetSellerId: targetId,
        viewerUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount,
        boxValue
      })))).flat()
      : [];

    const manualSavedRows = [UNSOLD_ACCEPTED_STATUS, 'unsold', UNSOLD_LOCAL_STATUS].includes(status) && sellerId && sellerId !== Number(req.user.id)
      ? (await Promise.all((adminSnapshotSellerIds.length > 0 ? adminSnapshotSellerIds : [sellerId]).map((targetId) => getManualSavedUnsoldRows({
        targetSellerId: targetId,
        actorUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount,
        boxValue
      })))).flat()
      : [];

    if (latestSentOnly && req.user.role === 'admin' && sellerId && status === 'unsold') {
      const latestRows = [...adminAcceptedSnapshotRows, ...manualSavedRows].filter((row, index, rows) => {
        const rowKey = buildUnsoldIdentityKey(row);
        return rows.findIndex((currentRow) => buildUnsoldIdentityKey(currentRow) === rowKey) === index;
      });
      res.json(latestRows.map(mapLotteryEntry));
      return;
    }

    let liveRows = result.rows;
    if ([UNSOLD_ACCEPTED_STATUS, 'unsold'].includes(status) && result.rows.length > 0) {
      const liveEntryIds = result.rows
        .map((row) => Number(row.id))
        .filter((entryId) => Number.isInteger(entryId) && entryId > 0);
      if (liveEntryIds.length > 0) {
        const liveMemoResult = await query(
          `SELECT DISTINCT ON (entry_id) entry_id, memo_number
           FROM lottery_entry_history
           WHERE entry_id = ANY($1::int[])
             AND to_user_id = $2
             AND action_type IN ('unsold_sent', 'unsold_auto_accepted', 'unsold_accepted')
             AND memo_number IS NOT NULL
           ORDER BY entry_id, created_at DESC`,
          [liveEntryIds, req.user.id]
        );
        const liveMemoMap = new Map(liveMemoResult.rows.map((row) => [
          Number(row.entry_id),
          Number(row.memo_number)
        ]));
        liveRows = result.rows.map((row) => ({
          ...row,
          memo_number: liveMemoMap.get(Number(row.id)) || row.memo_number,
          purchase_memo_number: liveMemoMap.get(Number(row.id)) || row.purchase_memo_number || row.memo_number
        }));
      }
    }

    const uniqueRows = [...adminAcceptedSnapshotRows, ...manualSavedRows, ...liveRows].filter((row, index, rows) => {
      const rowKey = buildUnsoldIdentityKey(row);
      return rows.findIndex((currentRow) => buildUnsoldIdentityKey(currentRow) === rowKey) === index;
    });

    res.json(uniqueRows.map(mapLotteryEntry));
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
           AND h.actor_user_id <> h.to_user_id
           ${receivedScopeSql}
           ${historyFilterSql}
         ORDER BY h.booking_date DESC, h.session_mode ASC, h.number ASC`,
        receivedQueryParams
      ),
      query(
        `SELECT h.*, current_owner.username AS current_to_username
         FROM lottery_entry_history h
         LEFT JOIN lottery_entries le ON le.id = h.entry_id
         LEFT JOIN users current_owner ON current_owner.id = le.user_id
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

    const { number, rangeStart, rangeEnd, bookingDate: rawBookingDate, sellerId, sellerUserId, memoNumber, memoRowOrder, amount, boxValue } = req.body;
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
    } else if (!isAdminRole(req.user.role)) {
      ownerStockFilter = `AND (
           le.sent_to_parent = $${selectedEntriesParams.push(req.user.id)}
           OR (
             le.sent_to_parent = $${selectedEntriesParams.push(targetSellerId)}
             AND le.forwarded_by = $${selectedEntriesParams.push(targetSellerId)}
           )
         )`;
    }

    let selectedEntriesResult;
    if (isAdminRole(req.user.role) && targetSellerId !== Number(req.user.id)) {
      const adminSentParams = [
        req.user.id,
        targetSellerId,
        PURCHASE_ENTRY_SOURCE,
        'purchase_sent',
        sessionMode,
        purchaseCategory,
        bookingDate,
        numbersToMark.numbers
      ];
      const adminSentFilters = [];
      if (normalizedAmount) {
        adminSentFilters.push(`AND h.amount = $${adminSentParams.push(normalizedAmount)}::numeric`);
      }
      if (normalizedBoxValue) {
        adminSentFilters.push(`AND h.box_value = $${adminSentParams.push(normalizedBoxValue)}`);
      }

      selectedEntriesResult = await query(
        `SELECT DISTINCT ON (le.id) le.*
         FROM lottery_entry_history h
         INNER JOIN lottery_entries le ON le.id = h.entry_id
         WHERE h.actor_user_id = $1
           AND h.to_user_id = $2
           AND le.entry_source = $3
           AND h.action_type = $4
           AND h.session_mode = $5
           AND h.purchase_category = $6
           AND h.booking_date = $7::date
           AND h.number = ANY($8::varchar[])
           AND LOWER(TRIM(le.status)) = 'accepted'
           ${adminSentFilters.join('\n           ')}
         ORDER BY le.id, h.created_at DESC`,
        adminSentParams
      );
    } else {
      selectedEntriesResult = await query(
        `SELECT le.*
         FROM lottery_entries le
         WHERE le.user_id = $1
           AND le.entry_source = $2
           AND LOWER(TRIM(le.status)) = 'accepted'
           AND le.session_mode = $3
           AND le.purchase_category = $4
           AND le.booking_date = $5::date
           AND le.number = ANY($6::varchar[])
           ${isAdminRole(req.user.role) ? '' : 'AND le.memo_number IS NOT NULL'}
           ${stockFilters.join('\n           ')}
           ${ownerStockFilter}
         ORDER BY le.number ASC`,
        selectedEntriesParams
      );
    }

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

    if (isAdminRole(req.user.role) && targetSellerId !== Number(req.user.id)) {
      const sentUnsoldRows = await getLatestAcceptedUnsoldSnapshotRows({
        targetSellerId,
        viewerUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount: normalizedAmount,
        boxValue: normalizedBoxValue
      });
      const sentNumberSet = new Set(sentUnsoldRows.map((row) => String(row.number || '').padStart(5, '0')));
      const duplicateSentNumbers = numbersToMark.numbers.filter((currentNumber) => sentNumberSet.has(String(currentNumber).padStart(5, '0')));

      if (duplicateSentNumbers.length > 0) {
        return res.status(400).json({
          message: `Seller already send you this unsold number: ${formatMissingNumberLabel(duplicateSentNumbers)}`
        });
      }
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

    if (targetSellerId !== Number(req.user.id)) {
      const manualUnsoldToUserId = isAdminRole(req.user.role) ? targetSellerId : req.user.id;
      const manualUnsoldToUsername = isAdminRole(req.user.role) ? targetSeller.username : req.user.username;

      await insertHistoryRecords({
        entries: selectedEntriesResult.rows.map((row) => ({
          ...row,
          memo_number: resolvedMemoNumber,
          purchase_memo_number: row.purchase_memo_number || row.memo_number,
          memo_row_order: Number.isInteger(Number(memoRowOrder)) ? Number(memoRowOrder) : 0
        })),
        actionType: 'saved_unsold',
        statusBefore: 'accepted',
        statusAfter: UNSOLD_LOCAL_STATUS,
        actorUserId: req.user.id,
        actorUsername: req.user.username,
        toUserId: manualUnsoldToUserId,
        toUsername: manualUnsoldToUsername,
        memoNumber: resolvedMemoNumber
      });

      const manualRows = await getManualSavedUnsoldRows({
        targetSellerId,
        actorUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount: normalizedAmount,
        boxValue: normalizedBoxValue
      });

      return res.json({
        message: `${selectedEntriesResult.rows.length} purchase numbers saved as unsold`,
        memoNumber: resolvedMemoNumber,
        entries: manualRows.map(mapLotteryEntry)
      });
    }

    const selectedIds = selectedEntriesResult.rows.map((row) => row.id);
    const updatedEntriesResult = await query(
      `UPDATE lottery_entries
       SET status = $4,
           sent_to_parent = $2,
           forwarded_by = $2,
           memo_number = $3,
           purchase_memo_number = COALESCE(purchase_memo_number, memo_number),
           memo_row_order = $5,
           sent_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1::int[])
       RETURNING *`,
      [selectedIds, req.user.id, resolvedMemoNumber, UNSOLD_LOCAL_STATUS, Number.isInteger(Number(memoRowOrder)) ? Number(memoRowOrder) : 0]
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
    let targetBranchIds = [targetSellerId];

    if (targetSellerId !== Number(req.user.id)) {
      const childSellerResult = await query(
        "SELECT id, username, role, seller_type, parent_id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
        [targetSellerId, req.user.id]
      );

      if (childSellerResult.rows.length === 0) {
        return res.status(403).json({ message: 'You can remove unsold only for yourself or your direct sub stokist' });
      }

      targetSeller = childSellerResult.rows[0];
      targetBranchIds = await getDirectSellerBranchIds(req.user.id, targetSellerId);
    }

    const params = [
      targetBranchIds,
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

    if (targetSellerId !== Number(req.user.id)) {
      const manualRemoveParams = [
        targetBranchIds,
        PURCHASE_ENTRY_SOURCE,
        req.user.id,
        'saved_unsold',
        sessionMode,
        purchaseCategory,
        bookingDate,
        numbersToRemove.numbers
      ];
      const manualRemoveFilters = [];
      if (normalizedAmount) {
        manualRemoveFilters.push(`AND h.amount = $${manualRemoveParams.push(normalizedAmount)}::numeric`);
      }
      if (normalizedBoxValue) {
        manualRemoveFilters.push(`AND h.box_value = $${manualRemoveParams.push(normalizedBoxValue)}`);
      }

      const manualRemoveResult = await query(
        `DELETE FROM lottery_entry_history h
         USING lottery_entries le
         WHERE h.entry_id = le.id
           AND (
             le.user_id = ANY($1::int[])
             OR (h.to_user_id = ANY($1::int[]) AND h.to_user_id <> h.actor_user_id)
           )
           AND le.entry_source = $2
           AND h.actor_user_id = $3
           AND h.action_type = $4
           AND h.session_mode = $5
           AND h.purchase_category = $6
           AND h.booking_date = $7::date
           AND h.number = ANY($8::varchar[])
           AND ${latestSavedUnsoldHistoryCondition}
           ${manualRemoveFilters.join('\n           ')}
         RETURNING h.*`,
        manualRemoveParams
      );

      if (manualRemoveResult.rows.length === numbersToRemove.numbers.length) {
        return res.json({
          message: `${manualRemoveResult.rows.length} unsold numbers removed`,
          memoNumber: normalizedMemoNumber,
          entries: []
        });
      }
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
       WHERE le.user_id = ANY($1::int[])
         AND le.entry_source = $2
         AND le.session_mode = $3
         AND le.purchase_category = $4
         AND le.booking_date = $5::date
         AND le.number = ANY($6::varchar[])
         AND LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold')
         ${stockFilters.join('\n         ')}
         ${ownershipFilter}
       ORDER BY le.number ASC`,
      params
    );

    if (selectedEntriesResult.rows.length === 0 && targetSellerId !== Number(req.user.id)) {
      const manualParams = [
        targetBranchIds,
        PURCHASE_ENTRY_SOURCE,
        req.user.id,
        'saved_unsold',
        sessionMode,
        purchaseCategory,
        bookingDate,
        numbersToRemove.numbers
      ];
      const manualFilters = [];
      if (normalizedAmount) {
        manualFilters.push(`AND h.amount = $${manualParams.push(normalizedAmount)}::numeric`);
      }
      if (normalizedBoxValue) {
        manualFilters.push(`AND h.box_value = $${manualParams.push(normalizedBoxValue)}`);
      }

      const manualDeleteResult = await query(
        `DELETE FROM lottery_entry_history h
         USING lottery_entries le
         WHERE h.entry_id = le.id
           AND (
             le.user_id = ANY($1::int[])
             OR (h.to_user_id = ANY($1::int[]) AND h.to_user_id <> h.actor_user_id)
           )
           AND le.entry_source = $2
           AND h.actor_user_id = $3
           AND h.action_type = $4
           AND h.session_mode = $5
           AND h.purchase_category = $6
           AND h.booking_date = $7::date
           AND h.number = ANY($8::varchar[])
           AND LOWER(TRIM(le.status)) = 'accepted'
           ${manualFilters.join('\n           ')}
         RETURNING h.*`,
        manualParams
      );

      if (manualDeleteResult.rows.length === numbersToRemove.numbers.length) {
        return res.json({
          message: `${manualDeleteResult.rows.length} unsold numbers removed`,
          memoNumber: normalizedMemoNumber,
          entries: []
        });
      }

      const snapshotRows = (await Promise.all(targetBranchIds.map((branchSellerId) => getLatestAcceptedUnsoldSnapshotRows({
        targetSellerId: branchSellerId,
        viewerUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount: normalizedAmount,
        boxValue: normalizedBoxValue,
        respectLiveMemoState: true
      })))).flat();
      const requestedNumberSet = new Set(numbersToRemove.numbers);
      const matchingSnapshotRows = snapshotRows.filter((row) => requestedNumberSet.has(String(row.number || '').padStart(5, '0')));

      if (matchingSnapshotRows.length === numbersToRemove.numbers.length) {
        const snapshotIds = matchingSnapshotRows
          .map((row) => Number(row.id || row.entry_id || 0))
          .filter((entryId) => Number.isInteger(entryId) && entryId > 0);

        if (snapshotIds.length > 0) {
          await query(
            `UPDATE lottery_entries
             SET status = 'accepted',
                 sent_to_parent = $2,
                 forwarded_by = $3,
                 memo_number = COALESCE(purchase_memo_number, memo_number),
                 sent_at = CURRENT_TIMESTAMP
             WHERE id = ANY($1::int[])`,
            [
              snapshotIds,
              Number(targetSeller.id) === Number(req.user.id) ? req.user.id : (targetSeller.parent_id || req.user.id),
              req.user.id
            ]
          );
        }

        await insertHistoryRecords({
          entries: matchingSnapshotRows,
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
          message: `${matchingSnapshotRows.length} unsold numbers removed`,
          memoNumber: normalizedMemoNumber,
          entries: matchingSnapshotRows.map((row) => mapLotteryEntry({
            ...row,
            status: 'accepted',
            memo_number: row.purchase_memo_number || row.memo_number
          }))
        });
      }
    }

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
    let targetBranchIds = [targetSellerId];

    if (targetSellerId !== Number(req.user.id)) {
      const childSellerResult = await query(
        "SELECT id, username, role, seller_type, parent_id FROM users WHERE id = $1 AND parent_id = $2 AND role = 'seller' LIMIT 1",
        [targetSellerId, req.user.id]
      );

      if (childSellerResult.rows.length === 0) {
        return res.status(403).json({ message: 'You can remove unsold only for yourself or your direct sub stokist' });
      }

      targetSeller = childSellerResult.rows[0];
      targetBranchIds = await getDirectSellerBranchIds(req.user.id, targetSellerId);
    }

    const params = [
      targetBranchIds,
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

    if (targetSellerId !== Number(req.user.id)) {
      const manualRows = (await Promise.all(targetBranchIds.map((branchSellerId) => getManualSavedUnsoldRows({
        targetSellerId: branchSellerId,
        actorUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount: normalizedAmount,
        boxValue: normalizedBoxValue
      })))).flat();
      const requestedNumberSet = new Set(numbersToRemove.numbers);
      const matchingManualRows = manualRows.filter((row) => requestedNumberSet.has(String(row.number || '').padStart(5, '0')));

      if (matchingManualRows.length === numbersToRemove.numbers.length) {
        return res.json({
          ok: true,
          message: `${matchingManualRows.length} unsold numbers available`,
          entries: matchingManualRows.map(mapLotteryEntry)
        });
      }
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
       WHERE le.user_id = ANY($1::int[])
         AND le.entry_source = $2
         AND le.session_mode = $3
         AND le.purchase_category = $4
         AND le.booking_date = $5::date
         AND le.number = ANY($6::varchar[])
         AND LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold')
         ${stockFilters.join('\n         ')}
         ${ownershipFilter}
       ORDER BY le.number ASC`,
      params
    );

    if (selectedEntriesResult.rows.length === 0 && targetSellerId !== Number(req.user.id)) {
      const manualRows = (await Promise.all(targetBranchIds.map((branchSellerId) => getManualSavedUnsoldRows({
        targetSellerId: branchSellerId,
        actorUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount: normalizedAmount,
        boxValue: normalizedBoxValue
      })))).flat();
      const requestedNumberSet = new Set(numbersToRemove.numbers);
      const matchingManualRows = manualRows.filter((row) => requestedNumberSet.has(String(row.number || '')));

      if (matchingManualRows.length === numbersToRemove.numbers.length) {
        return res.json({
          ok: true,
          message: `${matchingManualRows.length} unsold numbers available`,
          entries: matchingManualRows.map(mapLotteryEntry)
        });
      }

      const snapshotRows = (await Promise.all(targetBranchIds.map((branchSellerId) => getLatestAcceptedUnsoldSnapshotRows({
        targetSellerId: branchSellerId,
        viewerUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory,
        amount: normalizedAmount,
        boxValue: normalizedBoxValue,
        respectLiveMemoState: true
      })))).flat();
      const matchingSnapshotRows = snapshotRows.filter((row) => requestedNumberSet.has(String(row.number || '').padStart(5, '0')));

      if (matchingSnapshotRows.length === numbersToRemove.numbers.length) {
        return res.json({
          ok: true,
          message: `${matchingSnapshotRows.length} unsold numbers available`,
          entries: matchingSnapshotRows.map(mapLotteryEntry)
        });
      }
    }

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
      entryIds,
      rows,
      deletedEntryIds,
      bookingDate: rawBookingDate
    } = req.body;
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(rawBookingDate);
    const targetSellerId = Number(sellerId || sellerUserId || req.user.id);
    const normalizedMemoNumber = Number(memoNumber);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const existingRowEntryIds = [...new Set(
      [
        ...(Array.isArray(entryIds) ? entryIds : []),
        ...normalizedRows.flatMap((row) => Array.isArray(row.entryIds) ? row.entryIds : []),
        ...(Array.isArray(deletedEntryIds) ? deletedEntryIds : [])
      ]
        .map((entryId) => Number(entryId))
        .filter((entryId) => Number.isInteger(entryId) && entryId > 0)
    )];

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

    if (targetSellerId !== Number(req.user.id)) {
      await client.query('BEGIN');

      const existingSnapshotResult = await client.query(
        `SELECT DISTINCT h.entry_id
         FROM lottery_entry_history h
         INNER JOIN lottery_entries le ON le.id = h.entry_id
         WHERE le.user_id = $1
           AND le.entry_source = $2
           AND h.to_user_id = $3
           AND h.action_type IN ('unsold_sent', 'unsold_auto_accepted', 'unsold_accepted')
           AND (
             h.memo_number = $4
             OR le.memo_number = $4
             OR le.purchase_memo_number = $4
             OR h.entry_id = ANY($9::int[])
           )
           AND h.booking_date = $5::date
           AND h.session_mode = $6
           AND h.purchase_category = $7
           AND h.amount = $8::numeric
           AND h.entry_id IS NOT NULL`,
        [targetSeller.id, PURCHASE_ENTRY_SOURCE, req.user.id, normalizedMemoNumber, bookingDate, sessionMode, normalizedPurchaseCategory, normalizedAmount, existingRowEntryIds]
      );

      await client.query(
        `DELETE FROM lottery_entry_history h
         USING lottery_entries le
         WHERE h.entry_id = le.id
           AND le.user_id = $1
           AND le.entry_source = $2
           AND (
             (h.actor_user_id = $3 AND h.action_type = 'saved_unsold')
             OR (h.to_user_id = $3 AND h.action_type IN ('unsold_sent', 'unsold_auto_accepted', 'unsold_accepted'))
           )
           AND (
             h.memo_number = $4
             OR le.memo_number = $4
             OR le.purchase_memo_number = $4
             OR h.entry_id = ANY($9::int[])
           )
           AND h.booking_date = $5::date
           AND h.session_mode = $6
           AND h.purchase_category = $7
           AND h.amount = $8::numeric`,
        [targetSeller.id, PURCHASE_ENTRY_SOURCE, req.user.id, normalizedMemoNumber, bookingDate, sessionMode, normalizedPurchaseCategory, normalizedAmount, existingRowEntryIds]
      );

      if (normalizedRows.length === 0) {
        const existingSnapshotIds = existingSnapshotResult.rows
          .map((row) => Number(row.entry_id))
          .filter((entryId) => Number.isInteger(entryId) && entryId > 0);
        const liveMemoResult = await client.query(
          `SELECT id
           FROM lottery_entries
           WHERE user_id = $1
             AND entry_source = $2
             AND booking_date = $3::date
             AND session_mode = $4
             AND purchase_category = $5
             AND amount = $6::numeric
             AND (
               memo_number = $7
               OR purchase_memo_number = $7
               OR id = ANY($8::int[])
             )
             AND LOWER(TRIM(status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold', 'unsold_accepted')`,
          [targetSeller.id, PURCHASE_ENTRY_SOURCE, bookingDate, sessionMode, normalizedPurchaseCategory, normalizedAmount, normalizedMemoNumber, existingSnapshotIds]
        );
        const idsToRestore = [...new Set([
          ...existingSnapshotIds,
          ...liveMemoResult.rows.map((row) => Number(row.id))
        ].filter((entryId) => Number.isInteger(entryId) && entryId > 0))];
        if (idsToRestore.length > 0) {
          await client.query(
            `UPDATE lottery_entries
             SET status = 'accepted',
                 sent_to_parent = $2,
                 forwarded_by = $3,
                 memo_number = COALESCE(purchase_memo_number, memo_number),
                 purchase_memo_number = NULL,
                 sent_at = CURRENT_TIMESTAMP
             WHERE id = ANY($1::int[])`,
            [idsToRestore, req.user.id, targetSeller.id]
          );
        }
        await client.query('COMMIT');
        return res.status(200).json({
          message: `Unsold memo ${normalizedMemoNumber} deleted successfully`,
          deletedMemoNumber: normalizedMemoNumber,
          entries: []
        });
      }

      const historyEntries = [];
      for (const [rowIndex, row] of normalizedRows.entries()) {
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
        if (!isAdminRole(req.user.role)) {
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
             AND LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
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

        historyEntries.push(...stockEntriesResult.rows.map((stockRow) => ({
          ...stockRow,
          memo_number: normalizedMemoNumber,
          memo_row_order: Number.isInteger(Number(row.memoRowOrder)) ? Number(row.memoRowOrder) : rowIndex
        })));
      }

      const keptEntryIds = new Set(historyEntries.map((entry) => Number(entry.id)));
      const staleSnapshotIds = existingSnapshotResult.rows
        .map((row) => Number(row.entry_id))
        .filter((entryId) => Number.isInteger(entryId) && entryId > 0 && !keptEntryIds.has(entryId));
      if (staleSnapshotIds.length > 0) {
        await client.query(
          `UPDATE lottery_entries
           SET status = 'accepted',
               sent_to_parent = $2,
               forwarded_by = $3,
               memo_number = COALESCE(purchase_memo_number, memo_number),
               sent_at = CURRENT_TIMESTAMP
           WHERE id = ANY($1::int[])`,
          [staleSnapshotIds, req.user.id, targetSeller.id]
        );
      }

      await insertHistoryRecords({
        entries: historyEntries,
        actionType: 'saved_unsold',
        statusBefore: 'accepted',
        statusAfter: UNSOLD_LOCAL_STATUS,
        actorUserId: req.user.id,
        actorUsername: req.user.username,
        toUserId: req.user.id,
        toUsername: req.user.username,
        memoNumber: normalizedMemoNumber,
        client
      });

      await client.query('COMMIT');

      const manualRows = await getManualSavedUnsoldRows({
        targetSellerId,
        actorUserId: req.user.id,
        bookingDate,
        sessionMode,
        purchaseCategory: normalizedPurchaseCategory,
        amount: normalizedAmount
      });

      return res.status(200).json({
        message: `Unsold memo ${normalizedMemoNumber} updated successfully`,
        entries: manualRows.map(mapLotteryEntry)
      });
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
         AND LOWER(TRIM(status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold', 'unsold_accepted')
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
    for (const [rowIndex, row] of normalizedRows.entries()) {
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
           AND LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
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
             memo_row_order = $5,
             sent_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::int[])
         RETURNING *`,
        [selectedIds, req.user.id, normalizedMemoNumber, UNSOLD_LOCAL_STATUS, Number.isInteger(Number(row.memoRowOrder)) ? Number(row.memoRowOrder) : rowIndex]
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

    const manualParams = [visibleUserIds, req.user.id, PURCHASE_ENTRY_SOURCE, 'saved_unsold'];
    const manualFilters = [
      'le.user_id = ANY($1::int[])',
      'le.user_id <> $2',
      'h.actor_user_id = $2',
      'le.entry_source = $3',
      'h.action_type = $4',
      latestSavedUnsoldHistoryCondition
    ];

    if (bookingDate) {
      manualParams.push(bookingDate);
      manualFilters.push(`h.booking_date = $${manualParams.length}::date`);
    }

    if (sessionMode) {
      manualParams.push(sessionMode);
      manualFilters.push(`h.session_mode = $${manualParams.length}`);
    }

    if (purchaseCategory) {
      manualParams.push(purchaseCategory);
      manualFilters.push(`h.purchase_category = $${manualParams.length}`);
    }

    if (normalizedAmount) {
      manualParams.push(normalizedAmount);
      manualFilters.push(`h.amount = $${manualParams.length}::numeric`);
    }

    const manualUnsoldResult = await query(
      `SELECT
         ('manual-unsold-' || h.id)::varchar AS id,
         le.user_id,
         seller_user.username AS seller_name,
         le.series,
         h.number,
         h.box_value,
         h.unique_code,
         h.amount,
         '${UNSOLD_LOCAL_STATUS}'::varchar AS status,
         h.actor_user_id AS sent_to_parent,
         h.actor_user_id AS forwarded_by,
         h.session_mode,
         h.booking_date,
         '${PURCHASE_ENTRY_SOURCE}'::varchar AS entry_source,
         h.memo_number,
         COALESCE(le.purchase_memo_number, le.memo_number, h.memo_number) AS purchase_memo_number,
         le.memo_row_order,
         h.purchase_category,
         h.created_at,
         h.created_at AS sent_at
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       LEFT JOIN users seller_user ON seller_user.id = le.user_id
       WHERE ${manualFilters.join(' AND ')}
       ORDER BY seller_user.username ASC, h.number ASC`,
      manualParams
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

      if (normalizedStatus === UNSOLD_SENT_STATUS) {
        return Number(entry.forwarded_by || 0) === Number(req.user.id)
          || Number(entry.sent_to_parent || 0) === Number(req.user.id);
      }

      if (normalizedStatus === UNSOLD_ACCEPTED_STATUS) {
        return (
          Number(entry.sent_to_parent || 0) === Number(req.user.id)
          || Number(entry.forwarded_by || 0) === Number(req.user.id)
          || (
            Number(entry.user_id) === Number(req.user.id)
            && (
              !entry.sent_to_parent
              || Number(entry.sent_to_parent || 0) === Number(req.user.id)
            )
          )
        );
      }

      return false;
    };
    const alreadySentParams = [visibleUserIds, PURCHASE_ENTRY_SOURCE, req.user.id, req.user.parentId];
    const alreadySentConditions = [
      'le.user_id = ANY($1::int[])',
      'le.entry_source = $2',
      'h.actor_user_id = $3',
      'h.to_user_id = $4',
      "h.action_type IN ('unsold_sent', 'unsold_auto_accepted')"
    ];

    if (bookingDate) {
      alreadySentParams.push(bookingDate);
      alreadySentConditions.push(`h.booking_date = $${alreadySentParams.length}::date`);
    }

    if (sessionMode) {
      alreadySentParams.push(sessionMode);
      alreadySentConditions.push(`h.session_mode = $${alreadySentParams.length}`);
    }

    if (purchaseCategory) {
      alreadySentParams.push(purchaseCategory);
      alreadySentConditions.push(`h.purchase_category = $${alreadySentParams.length}`);
    }

    if (normalizedAmount) {
      alreadySentParams.push(normalizedAmount);
      alreadySentConditions.push(`h.amount = $${alreadySentParams.length}::numeric`);
    }

    const alreadySentHistoryResult = await query(
      `WITH latest_send_batch AS (
        SELECT MAX(h.created_at) AS latest_created_at
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        WHERE ${alreadySentConditions.join(' AND ')}
      )
      SELECT DISTINCT ON (h.entry_id)
         h.entry_id AS id,
         le.user_id,
         h.number,
         h.box_value,
         h.amount,
         h.session_mode,
         h.booking_date,
         h.purchase_category,
         h.memo_number,
         h.created_at
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       CROSS JOIN latest_send_batch batch
       WHERE ${alreadySentConditions.join(' AND ')}
         AND batch.latest_created_at IS NOT NULL
         AND h.created_at = batch.latest_created_at
       ORDER BY h.entry_id, h.created_at DESC, h.id DESC`,
      alreadySentParams
    );

    const allEntries = entriesResult.rows || [];
    const alreadySentEntries = alreadySentHistoryResult.rows || [];
    const alreadySentKeySet = new Set(alreadySentEntries.map(buildEntryKey));
    const currentUnsoldByKey = new Map();
    allEntries.filter(isCurrentUnsoldEntry).forEach((entry) => {
      currentUnsoldByKey.set(buildEntryKey(entry), entry);
    });
    (manualUnsoldResult.rows || []).forEach((entry) => {
      currentUnsoldByKey.set(buildEntryKey(entry), entry);
    });
    const directChildSellersResult = await query(
      "SELECT id FROM users WHERE parent_id = $1 AND role = 'seller'",
      [req.user.id]
    );
    await Promise.all(
      directChildSellersResult.rows.map(async (seller) => {
        const [snapshotRows, manualRows] = await Promise.all([
          getLatestAcceptedUnsoldSnapshotRows({
            targetSellerId: seller.id,
            viewerUserId: req.user.id,
            bookingDate,
            sessionMode,
            purchaseCategory,
            amount: normalizedAmount,
            boxValue: ''
          }),
          getManualSavedUnsoldRows({
            targetSellerId: seller.id,
            actorUserId: req.user.id,
            bookingDate,
            sessionMode,
            purchaseCategory,
            amount: normalizedAmount,
            boxValue: ''
          })
        ]);

        [...snapshotRows, ...manualRows].forEach((entry) => {
          currentUnsoldByKey.set(buildEntryKey(entry), entry);
        });
      })
    );
    const currentUnsoldEntries = Array.from(currentUnsoldByKey.values());
    const currentUnsoldKeySet = new Set(currentUnsoldByKey.keys());
    const currentIsSubsetOfAlreadySent = currentUnsoldKeySet.size > 0
      && currentUnsoldKeySet.size < alreadySentKeySet.size
      && [...currentUnsoldKeySet].every((entryKey) => alreadySentKeySet.has(entryKey));
    const latestAlreadySentAt = alreadySentEntries.reduce((latestTime, entry) => {
      const entryTime = new Date(entry.created_at || 0).getTime();
      return Number.isFinite(entryTime) ? Math.max(latestTime, entryTime) : latestTime;
    }, 0);
    let hasRemoveAfterLatestSend = false;

    if (currentIsSubsetOfAlreadySent && latestAlreadySentAt > 0) {
      const removeCheckParams = [
        visibleUserIds,
        PURCHASE_ENTRY_SOURCE,
        req.user.id,
        new Date(latestAlreadySentAt).toISOString()
      ];
      const removeCheckConditions = [
        'le.user_id = ANY($1::int[])',
        'le.entry_source = $2',
        'h.actor_user_id = $3',
        "h.action_type = 'unsold_removed'",
        'h.created_at > $4::timestamp'
      ];

      if (bookingDate) {
        removeCheckParams.push(bookingDate);
        removeCheckConditions.push(`h.booking_date = $${removeCheckParams.length}::date`);
      }

      if (sessionMode) {
        removeCheckParams.push(sessionMode);
        removeCheckConditions.push(`h.session_mode = $${removeCheckParams.length}`);
      }

      if (purchaseCategory) {
        removeCheckParams.push(purchaseCategory);
        removeCheckConditions.push(`h.purchase_category = $${removeCheckParams.length}`);
      }

      if (normalizedAmount) {
        removeCheckParams.push(normalizedAmount);
        removeCheckConditions.push(`h.amount = $${removeCheckParams.length}::numeric`);
      }

      const removeCheckResult = await query(
        `SELECT 1
         FROM lottery_entry_history h
         INNER JOIN lottery_entries le ON le.id = h.entry_id
         WHERE ${removeCheckConditions.join(' AND ')}
         LIMIT 1`,
        removeCheckParams
      );
      hasRemoveAfterLatestSend = removeCheckResult.rows.length > 0;
    }

    const effectiveCurrentUnsoldEntries = currentIsSubsetOfAlreadySent && !hasRemoveAfterLatestSend
      ? alreadySentEntries
      : currentUnsoldEntries;
    const effectiveCurrentUnsoldKeySet = currentIsSubsetOfAlreadySent && !hasRemoveAfterLatestSend
      ? alreadySentKeySet
      : currentUnsoldKeySet;
    const currentUnsoldChanged = effectiveCurrentUnsoldKeySet.size !== alreadySentKeySet.size
      || [...effectiveCurrentUnsoldKeySet].some((entryKey) => !alreadySentKeySet.has(entryKey));
    const pendingSendEntries = currentUnsoldChanged ? effectiveCurrentUnsoldEntries : [];

    const totalPiece = allEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const unsoldPiece = effectiveCurrentUnsoldEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const alreadySentPiece = alreadySentEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const pendingSendPiece = pendingSendEntries.reduce((sum, entry) => sum + numericPiece(entry), 0);
    const unsoldCount = effectiveCurrentUnsoldEntries.length;
    const aggregatedRow = totalPiece > 0 || unsoldPiece > 0 || alreadySentPiece > 0 || pendingSendPiece > 0
      ? [{
        sellerId: req.user.id,
        sellerName: req.user.username,
        totalPiece,
        unsoldPiece,
        alreadySentPiece,
        pendingSendPiece,
        soldPiece: Math.max(totalPiece - unsoldPiece, 0),
        unsoldCount,
        hasPendingUpdate: currentUnsoldChanged
      }]
      : [];

    const autoAccept = Boolean(parentUser && isWithinUnsoldAutoAcceptTime({
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
      hasPendingUpdate: currentUnsoldChanged,
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
    const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory || req.headers['x-purchase-category'])
      || getDefaultPurchaseCategory(sessionMode);
    const amount = String(req.body.amount || req.query.amount || '').trim();
    const normalizedAmount = /^\d+(\.\d+)?$/.test(amount) ? amount : '';
    const desiredEntryIds = [...new Set((Array.isArray(req.body.desiredEntryIds) ? req.body.desiredEntryIds : [])
      .map((entryId) => Number(entryId))
      .filter((entryId) => Number.isInteger(entryId) && entryId > 0))];
    const desiredRows = (Array.isArray(req.body.desiredRows) ? req.body.desiredRows : [])
      .map((row) => ({
        entryId: Number(row.entryId || row.id || 0),
        userId: Number(row.sellerId || row.userId || 0),
        number: normalizeFiveDigitNumber(row.number),
        boxValue: String(row.boxValue || row.sem || '').trim(),
        amount: String(row.amount || normalizedAmount || '').trim(),
        bookingDate: normalizeBookingDate(row.bookingDate) || bookingDate,
        sessionMode: normalizeSessionMode(row.sessionMode) || sessionMode,
        purchaseCategory: normalizePurchaseCategory(row.purchaseCategory) || purchaseCategory,
        memoNumber: Number(row.memoNumber || row.memo_number || 0)
      }))
      .filter((row) => row.userId && row.number && row.boxValue && row.amount && row.bookingDate && row.sessionMode && row.purchaseCategory);
    const desiredRowNumbers = [...new Set(desiredRows.map((row) => row.number))];
    const desiredRowKeyMap = new Map(desiredRows.map((row) => ([
      [
        row.userId,
        row.bookingDate,
        row.sessionMode,
        row.purchaseCategory,
        String(Number(row.amount)),
        row.boxValue,
        row.number
      ].join('|'),
      row
    ])));
    const hasDesiredSelection = desiredEntryIds.length > 0 || desiredRows.length > 0;

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
    const filters = hasDesiredSelection
      ? [
        desiredRows.length > 0 ? 'number = ANY($6::varchar[])' : 'id = ANY($6::int[])',
        'user_id = ANY($1::int[])',
        'entry_source = $2',
        'booking_date = $3::date',
        'session_mode = $4',
        '($5::text IS NULL OR purchase_category = $5)',
        `LOWER(TRIM(status)) IN ('accepted', '${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold')`
      ]
      : [
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
          LOWER(TRIM(status)) = '${UNSOLD_SENT_STATUS}'
          AND (forwarded_by = $6 OR sent_to_parent = $6)
        )
        OR (
          LOWER(TRIM(status)) = '${UNSOLD_ACCEPTED_STATUS}'
          AND (
            sent_to_parent IS NULL
            OR sent_to_parent = $6
            OR user_id = $6
          )
        )
      )`
      ];
    params.push(desiredRows.length > 0 ? desiredRowNumbers : desiredEntryIds.length > 0 ? desiredEntryIds : req.user.id);

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

    const manualParams = [
      visibleUserIds,
      req.user.id,
      PURCHASE_ENTRY_SOURCE,
      'saved_unsold',
      bookingDate,
      sessionMode,
      purchaseCategory
    ];
    const manualFilters = [
      'le.user_id = ANY($1::int[])',
      'le.user_id <> $2',
      'h.actor_user_id = $2',
      'le.entry_source = $3',
      'h.action_type = $4',
      'h.booking_date = $5::date',
      'h.session_mode = $6',
      '($7::text IS NULL OR h.purchase_category = $7)',
      latestSavedUnsoldHistoryCondition,
      `LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`
    ];

    if (normalizedAmount) {
      manualParams.push(normalizedAmount);
      manualFilters.push(`h.amount = $${manualParams.length}::numeric`);
    }

    const manualSelectedResult = await query(
      `SELECT DISTINCT le.*, h.memo_number AS send_unsold_memo_number
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       WHERE ${manualFilters.join(' AND ')}
       ORDER BY le.user_id ASC, le.number ASC`,
      manualParams
    );
    const selectedRowsById = new Map();
    selectedResult.rows.forEach((row) => {
      if (desiredRows.length > 0) {
        const rowKey = [
          Number(row.user_id),
          row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
          String(row.session_mode || ''),
          String(row.purchase_category || ''),
          String(Number(row.amount || 0)),
          String(row.box_value || ''),
          String(row.number || '')
        ].join('|');
        const desiredRow = desiredRowKeyMap.get(rowKey);
        if (!desiredRow) {
          return;
        }
        selectedRowsById.set(Number(row.id), {
          ...row,
          send_unsold_memo_number: desiredRow.memoNumber || row.memo_number
        });
        return;
      }
      selectedRowsById.set(Number(row.id), row);
    });
    if (!hasDesiredSelection) {
      manualSelectedResult.rows.forEach((row) => selectedRowsById.set(Number(row.id), row));
      const directChildSellersResult = await query(
        "SELECT id FROM users WHERE parent_id = $1 AND role = 'seller'",
        [req.user.id]
      );
      await Promise.all(
        directChildSellersResult.rows.map(async (seller) => {
          const [snapshotRows, manualRows] = await Promise.all([
            getLatestAcceptedUnsoldSnapshotRows({
              targetSellerId: seller.id,
              viewerUserId: req.user.id,
              bookingDate,
              sessionMode,
              purchaseCategory,
              amount: normalizedAmount,
              boxValue: ''
            }),
            getManualSavedUnsoldRows({
              targetSellerId: seller.id,
              actorUserId: req.user.id,
              bookingDate,
              sessionMode,
              purchaseCategory,
              amount: normalizedAmount,
              boxValue: ''
            })
          ]);

          [...snapshotRows, ...manualRows].forEach((row) => {
            selectedRowsById.set(Number(row.entry_id || row.id), row);
          });
        })
      );
    }
    let selectedRows = Array.from(selectedRowsById.values());

    const buildSendEntryKey = (entry) => ([
      entry.user_id,
      entry.booking_date instanceof Date ? entry.booking_date.toISOString().slice(0, 10) : String(entry.booking_date || ''),
      String(entry.session_mode || ''),
      String(entry.purchase_category || ''),
      String(entry.amount || ''),
      String(entry.box_value || ''),
      String(entry.number || '')
    ].join('|'));
    const alreadySentHistoryParams = [
      visibleUserIds,
      PURCHASE_ENTRY_SOURCE,
      bookingDate,
      sessionMode,
      purchaseCategory,
      req.user.id,
      req.user.parentId
    ];
    const alreadySentHistoryFilters = [
      'le.user_id = ANY($1::int[])',
      'le.entry_source = $2',
      'h.booking_date = $3::date',
      'h.session_mode = $4',
      '($5::text IS NULL OR h.purchase_category = $5)',
      'h.actor_user_id = $6',
      'h.to_user_id = $7',
      "h.action_type IN ('unsold_sent', 'unsold_auto_accepted')"
    ];

    if (normalizedAmount) {
      alreadySentHistoryParams.push(normalizedAmount);
      alreadySentHistoryFilters.push(`h.amount = $${alreadySentHistoryParams.length}::numeric`);
    }

    const alreadySentResult = await query(
      `WITH latest_send_batch AS (
        SELECT MAX(h.created_at) AS latest_created_at
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        WHERE ${alreadySentHistoryFilters.join(' AND ')}
      )
      SELECT DISTINCT ON (h.entry_id)
         h.entry_id AS id,
         le.user_id,
         h.number,
         h.box_value,
         h.amount,
         h.session_mode,
         h.booking_date,
         h.purchase_category,
         le.memo_number,
         le.purchase_memo_number,
         h.created_at
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       CROSS JOIN latest_send_batch batch
       WHERE ${alreadySentHistoryFilters.join(' AND ')}
         AND batch.latest_created_at IS NOT NULL
         AND h.created_at = batch.latest_created_at
       ORDER BY h.entry_id, h.created_at DESC, h.id DESC`,
      alreadySentHistoryParams
    );

    if (hasDesiredSelection && alreadySentResult.rows.length > 0) {
      alreadySentResult.rows.forEach((row) => {
        const entryId = Number(row.id || 0);
        if (entryId > 0 && !selectedRowsById.has(entryId)) {
          selectedRowsById.set(entryId, row);
        }
      });
      selectedRows = Array.from(selectedRowsById.values());
    }

    if (selectedRows.length === 0) {
      return res.status(400).json({ message: 'Send karne ke liye unsold entry nahi hai' });
    }
    const selectedKeySet = new Set(selectedRows.map(buildSendEntryKey));
    const alreadySentKeySet = new Set((alreadySentResult.rows || []).map(buildSendEntryKey));
    const selectedIsSubsetOfAlreadySent = selectedKeySet.size > 0
      && selectedKeySet.size < alreadySentKeySet.size
      && [...selectedKeySet].every((entryKey) => alreadySentKeySet.has(entryKey));
    let hasRemoveAfterLatestSend = false;

    if (selectedIsSubsetOfAlreadySent) {
      const latestAlreadySentAt = (alreadySentResult.rows || []).reduce((latestTime, entry) => {
        const entryTime = new Date(entry.created_at || 0).getTime();
        return Number.isFinite(entryTime) ? Math.max(latestTime, entryTime) : latestTime;
      }, 0);

      if (latestAlreadySentAt > 0) {
        const removeCheckParams = [
          visibleUserIds,
          PURCHASE_ENTRY_SOURCE,
          req.user.id,
          new Date(latestAlreadySentAt).toISOString(),
          bookingDate,
          sessionMode,
          purchaseCategory
        ];
        const removeCheckFilters = [
          'le.user_id = ANY($1::int[])',
          'le.entry_source = $2',
          'h.actor_user_id = $3',
          "h.action_type = 'unsold_removed'",
          'h.created_at > $4::timestamp',
          'h.booking_date = $5::date',
          'h.session_mode = $6',
          '($7::text IS NULL OR h.purchase_category = $7)'
        ];

        if (normalizedAmount) {
          removeCheckParams.push(normalizedAmount);
          removeCheckFilters.push(`h.amount = $${removeCheckParams.length}::numeric`);
        }

        const removeCheckResult = await query(
          `SELECT 1
           FROM lottery_entry_history h
           INNER JOIN lottery_entries le ON le.id = h.entry_id
           WHERE ${removeCheckFilters.join(' AND ')}
           LIMIT 1`,
          removeCheckParams
        );
        hasRemoveAfterLatestSend = removeCheckResult.rows.length > 0;
      }
    }
    const sameAsAlreadySent = selectedKeySet.size > 0
      && selectedKeySet.size === alreadySentKeySet.size
      && [...selectedKeySet].every((entryKey) => alreadySentKeySet.has(entryKey));

    if (sameAsAlreadySent || (selectedIsSubsetOfAlreadySent && !hasRemoveAfterLatestSend)) {
      return res.status(400).json({ message: 'Ye unsold numbers already send ho chuke hain' });
    }

    const shouldAutoAcceptToParent = Boolean(parentUser && isWithinUnsoldAutoAcceptTime({
      sellerType: req.user.sellerType || req.user.seller_type,
      bookingDate,
      sessionMode,
      purchaseCategory
    }));
    const targetStatus = shouldAutoAcceptToParent ? UNSOLD_ACCEPTED_STATUS : UNSOLD_SENT_STATUS;
    const sendGroupMap = new Map();
    selectedRows.forEach((row) => {
      const sellerMemoNumber = Number(row.send_unsold_memo_number || row.memo_number || 0);
      const groupKey = [
        row.user_id,
        sellerMemoNumber,
        row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
        row.session_mode,
        row.purchase_category,
        String(row.amount)
      ].join('|');
      if (!sendGroupMap.has(groupKey)) {
        sendGroupMap.set(groupKey, {
          userId: row.user_id,
          sellerMemoNumber,
          bookingDate: row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
          sessionMode: row.session_mode,
          purchaseCategory: row.purchase_category,
          amount: row.amount,
          rows: []
        });
      }
      sendGroupMap.get(groupKey).rows.push(row);
    });

    const existingAdminMemoResult = await query(
      `SELECT
         le.user_id,
         le.memo_number AS seller_memo_number,
         h.booking_date,
         h.session_mode,
         h.purchase_category,
         h.amount,
         MIN(h.memo_number) AS admin_memo_number
       FROM lottery_entry_history h
       INNER JOIN lottery_entries le ON le.id = h.entry_id
       WHERE h.actor_user_id = $1
         AND h.to_user_id = $2
         AND h.action_type IN ('unsold_sent', 'unsold_auto_accepted', 'unsold_accepted')
         AND h.memo_number IS NOT NULL
       GROUP BY le.user_id, le.memo_number, h.booking_date, h.session_mode, h.purchase_category, h.amount`,
      [req.user.id, req.user.parentId]
    );
    const existingAdminMemoMap = new Map(existingAdminMemoResult.rows.map((row) => ([
      [
        row.user_id,
        Number(row.seller_memo_number || 0),
        row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
        row.session_mode,
        row.purchase_category,
        String(row.amount)
      ].join('|'),
      Number(row.admin_memo_number || 0)
    ])));

    const maxAdminMemoResult = await query(
      `SELECT COALESCE(MAX(h.memo_number), 0) AS max_memo_number
       FROM lottery_entry_history h
       WHERE h.memo_number IS NOT NULL
         AND h.booking_date = $1::date
         AND h.session_mode = $2
         AND h.purchase_category = $3
         AND h.amount = $4::numeric
         AND (
           h.actor_user_id = $5
           OR h.to_user_id = $5
           OR (h.actor_user_id = $6 AND h.to_user_id = $5)
         )
         AND h.action_type IN ('saved_unsold', 'unsold_sent', 'unsold_auto_accepted', 'unsold_accepted')`,
      [bookingDate, sessionMode, purchaseCategory, normalizedAmount || selectedRows[0].amount, req.user.parentId, req.user.id]
    );
    let nextAdminMemoNumber = Number(maxAdminMemoResult.rows[0]?.max_memo_number || 0) + 1;
    const adminMemoByGroup = new Map();
    Array.from(sendGroupMap.entries()).forEach(([groupKey]) => {
      const existingMemoNumber = existingAdminMemoMap.get(groupKey);
      if (Number.isInteger(existingMemoNumber) && existingMemoNumber > 0) {
        adminMemoByGroup.set(groupKey, existingMemoNumber);
        return;
      }
      adminMemoByGroup.set(groupKey, nextAdminMemoNumber);
      nextAdminMemoNumber += 1;
    });

    const getSelectedEntryId = (row = {}) => {
      const directId = Number(row.id || 0);
      if (Number.isInteger(directId) && directId > 0) {
        return directId;
      }

      const entryId = Number(row.entry_id || row.entryId || 0);
      return Number.isInteger(entryId) && entryId > 0 ? entryId : 0;
    };
    const validSelectedRows = selectedRows
      .map((row) => ({
        ...row,
        resolvedEntryId: getSelectedEntryId(row)
      }))
      .filter((row) => row.resolvedEntryId > 0);
    const selectedIds = validSelectedRows.map((row) => row.resolvedEntryId);
    if (validSelectedRows.length === 0) {
      return res.status(400).json({ message: 'Send karne ke liye valid unsold entry nahi mili' });
    }
    const getSendGroupKeyForRow = (row = {}) => {
      const memoNumber = Number(row.send_unsold_memo_number || row.memo_number || 0);
      return [
        row.user_id,
        Number.isInteger(memoNumber) && memoNumber > 0 ? memoNumber : 0,
        row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
        row.session_mode,
        row.purchase_category,
        String(row.amount)
      ].join('|');
    };
    const selectedMemoNumbers = validSelectedRows.map((row) => {
      const parentMemoNumber = adminMemoByGroup.get(getSendGroupKeyForRow(row));
      if (Number.isInteger(parentMemoNumber) && parentMemoNumber > 0) {
        return parentMemoNumber;
      }

      const sellerMemoNumber = Number(row.send_unsold_memo_number || row.memo_number || 0);
      return Number.isInteger(sellerMemoNumber) && sellerMemoNumber > 0 ? sellerMemoNumber : null;
    });
    const staleParams = [
      visibleUserIds,
      PURCHASE_ENTRY_SOURCE,
      bookingDate,
      sessionMode,
      purchaseCategory,
      selectedIds
    ];
    const staleFilters = [
      'user_id = ANY($1::int[])',
      'entry_source = $2',
      'booking_date = $3::date',
      'session_mode = $4',
      '($5::text IS NULL OR purchase_category = $5)',
      `LOWER(TRIM(status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold')`,
      'NOT (id = ANY($6::int[]))'
    ];

    if (normalizedAmount) {
      staleParams.push(normalizedAmount);
      staleFilters.push(`amount = $${staleParams.length}::numeric`);
    }

    await query(
      `UPDATE lottery_entries
       SET status = 'accepted',
           sent_to_parent = NULL,
           forwarded_by = NULL,
           memo_number = COALESCE(purchase_memo_number, memo_number),
           sent_at = NULL
       WHERE ${staleFilters.join(' AND ')}`,
      staleParams
    );

    const sentHistoryDeleteParams = [
      visibleUserIds,
      PURCHASE_ENTRY_SOURCE,
      bookingDate,
      sessionMode,
      purchaseCategory,
      req.user.id,
      req.user.parentId
    ];
    const sentHistoryDeleteConditions = [
      'le.user_id = ANY($1::int[])',
      'le.entry_source = $2',
      'h.booking_date = $3::date',
      'h.session_mode = $4',
      '($5::text IS NULL OR h.purchase_category = $5)',
      `(
        (h.actor_user_id = $6 AND h.to_user_id = $7 AND h.action_type IN ('unsold_sent', 'unsold_auto_accepted'))
        OR (h.to_user_id = $7 AND h.action_type = 'unsold_accepted')
      )`
    ];

    if (normalizedAmount) {
      sentHistoryDeleteParams.push(normalizedAmount);
      sentHistoryDeleteConditions.push(`h.amount = $${sentHistoryDeleteParams.length}::numeric`);
    }

    await query(
      `DELETE FROM lottery_entry_history h
       USING lottery_entries le
       WHERE h.entry_id = le.id
         AND ${sentHistoryDeleteConditions.join('\n         AND ')}`,
      sentHistoryDeleteParams
    );

    const updatedResult = await query(
      `UPDATE lottery_entries le
       SET status = $2,
           sent_to_parent = $3,
           forwarded_by = $4,
           purchase_memo_number = COALESCE(le.purchase_memo_number, le.memo_number),
           memo_number = COALESCE(selected_entries.memo_number, le.memo_number),
           sent_at = CURRENT_TIMESTAMP
       FROM (
         SELECT *
         FROM UNNEST($1::int[], $5::int[]) AS selected_entry(id, memo_number)
       ) AS selected_entries
       WHERE le.id = selected_entries.id
       RETURNING le.*`,
      [selectedIds, targetStatus, req.user.parentId, req.user.id, selectedMemoNumbers]
    );

    await insertHistoryRecords({
      entries: updatedResult.rows.map((row) => {
        const groupKey = [
          row.user_id,
          Number(row.memo_number || 0),
          row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
          row.session_mode,
          row.purchase_category,
          String(row.amount)
        ].join('|');
        return {
          ...row,
          history_memo_number: adminMemoByGroup.get(groupKey) || row.memo_number
        };
      }),
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
        ? `Unsold ${parentUser?.username || 'parent'} ko send ho gaya aur auto accepted ho gaya`
        : `Unsold ${parentUser?.username || 'parent'} ko send ho gaya`,
      entriesSent: updatedResult.rows.length,
      autoAccepted: targetStatus === UNSOLD_ACCEPTED_STATUS,
      entries: updatedResult.rows.map(mapLotteryEntry)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPurchasePieceSummary = async (req, res) => {
  try {
    await ensureHistoryStorage();
    await repairMissingPurchaseMemoNumbers();

    const sessionMode = getOptionalSessionMode(req);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);
    const purchaseCategory = normalizePurchaseCategory(req.query.purchaseCategory);
    const amount = String(req.query.amount || '').trim();
    const normalizedAmount = /^\d+(\.\d+)?$/.test(amount) ? amount : '';
    const currentUserIsAdmin = isAdminRole(req.user.role);
    const currentSellerType = normalizeSellerType(req.user.sellerType || req.user.seller_type);
    const sellersResult = await query(
      "SELECT id, username, seller_type FROM users WHERE parent_id = $1 AND role = 'seller' ORDER BY username ASC",
      [req.user.id]
    );
    const sellers = currentUserIsAdmin
      ? sellersResult.rows
      : [
        { id: req.user.id, username: req.user.username, seller_type: req.user.sellerType || req.user.seller_type },
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
               0 AS unsold_piece
        FROM lottery_entries le
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${adminConditions.join(' AND ')}
        GROUP BY bu.root_seller_id`,
        adminParams
      );
    } else {
      const sellerIds = sellers.map((seller) => seller.id);
      const params = [req.user.id, sellerIds, PURCHASE_ENTRY_SOURCE];
      const conditions = [
        'bu.root_seller_id = ANY($2::int[])',
        'le.entry_source = $3',
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
        `WITH RECURSIVE branch_users AS (
          SELECT id, parent_id, id AS root_seller_id
          FROM users
          WHERE id = $1
          UNION ALL
          SELECT u.id,
                 u.parent_id,
                 CASE WHEN branch_users.id = $1 THEN u.id ELSE branch_users.root_seller_id END AS root_seller_id
          FROM users u
          INNER JOIN branch_users ON u.parent_id = branch_users.id
          WHERE u.role = 'seller'
        )
        SELECT bu.root_seller_id AS user_id,
                COALESCE(SUM(CASE WHEN (
                  le.memo_number IS NOT NULL
                  OR le.user_id <> $${selfUnsoldParamIndex}
                  OR LOWER(TRIM(le.status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')
                ) AND le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS total_piece,
                COALESCE(SUM(CASE WHEN (
                  (
                    LOWER(TRIM(le.status)) = '${UNSOLD_ACCEPTED_STATUS}'
                    AND (
                      le.sent_to_parent = $${selfUnsoldParamIndex}
                      OR le.forwarded_by = $${selfUnsoldParamIndex}
                      OR (
                        le.user_id = $${selfUnsoldParamIndex}
                        AND (
                          le.sent_to_parent IS NULL
                          OR le.sent_to_parent = $${selfUnsoldParamIndex}
                        )
                      )
                    )
                  )
                  OR (
                    LOWER(TRIM(le.status)) = '${UNSOLD_SENT_STATUS}'
                    AND (le.forwarded_by = $${selfUnsoldParamIndex} OR le.sent_to_parent = $${selfUnsoldParamIndex})
                  )
                  OR (
                    LOWER(TRIM(le.status)) = '${UNSOLD_LOCAL_STATUS}'
                    AND (le.user_id = $${selfUnsoldParamIndex} OR le.sent_to_parent = $${selfUnsoldParamIndex})
                  )
                ) AND le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS unsold_piece
         FROM lottery_entries le
         INNER JOIN branch_users bu ON bu.id = le.user_id
         WHERE ${conditions.join(' AND ')}
           AND (
             le.user_id <> $${selfUnsoldParamIndex}
             ${currentSellerType === SELLER_TYPE_NORMAL_SELLER ? 'OR TRUE' : ''}
             OR le.user_id = $${selfUnsoldParamIndex}
             OR (
               le.forwarded_by = $${selfUnsoldParamIndex}
               AND le.memo_number IS NOT NULL
             )
           )
         GROUP BY bu.root_seller_id`,
        [...params, req.user.id]
      );
    }
    const summaryMap = new Map(summaryResult.rows.map((row) => [Number(row.user_id), row]));

    if (!currentUserIsAdmin) {
      const sentPurchaseParams = [req.user.id, sellers.map((seller) => seller.id), PURCHASE_ENTRY_SOURCE];
      const sentPurchaseConditions = [
        'h.actor_user_id = $1',
        'h.action_type IN (\'purchase_forwarded\', \'purchase_forward_memo_updated\', \'purchase_self_memo_created\')',
        'le.entry_source = $3',
        "LOWER(TRIM(le.status)) IN ('accepted', 'unsold')",
        'live_branch.root_seller_id = recipient_branch.root_seller_id',
        'recipient_branch.root_seller_id = ANY($2::int[])'
      ];

      if (bookingDate) {
        sentPurchaseParams.push(bookingDate);
        sentPurchaseConditions.push(`h.booking_date = $${sentPurchaseParams.length}::date`);
      }

      if (sessionMode) {
        sentPurchaseParams.push(sessionMode);
        sentPurchaseConditions.push(`h.session_mode = $${sentPurchaseParams.length}`);
      }

      if (purchaseCategory) {
        sentPurchaseParams.push(purchaseCategory);
        sentPurchaseConditions.push(`h.purchase_category = $${sentPurchaseParams.length}`);
      }

      if (normalizedAmount) {
        sentPurchaseParams.push(normalizedAmount);
        sentPurchaseConditions.push(`h.amount = $${sentPurchaseParams.length}::numeric`);
      }

      const sentPurchaseResult = await query(
        `WITH RECURSIVE branch_users AS (
          SELECT id, parent_id, id AS root_seller_id
          FROM users
          WHERE id = $1
          UNION ALL
          SELECT u.id,
                 u.parent_id,
                 CASE WHEN branch_users.id = $1 THEN u.id ELSE branch_users.root_seller_id END AS root_seller_id
          FROM users u
          INNER JOIN branch_users ON u.parent_id = branch_users.id
          WHERE u.role = 'seller'
        ),
        latest_sent_purchase AS (
          SELECT DISTINCT ON (h.entry_id)
                 h.entry_id,
                 h.to_user_id,
                 h.box_value
          FROM lottery_entry_history h
          INNER JOIN lottery_entries le ON le.id = h.entry_id
          INNER JOIN branch_users live_branch ON live_branch.id = le.user_id
          INNER JOIN branch_users recipient_branch ON recipient_branch.id = h.to_user_id
          WHERE ${sentPurchaseConditions.join(' AND ')}
          ORDER BY h.entry_id, h.created_at DESC
        )
        SELECT recipient_branch.root_seller_id AS user_id,
               COALESCE(SUM(CASE WHEN latest.box_value ~ '^\\d+(\\.\\d+)?$' THEN latest.box_value::numeric ELSE 0 END), 0) AS sent_purchase_piece
        FROM latest_sent_purchase latest
        INNER JOIN branch_users recipient_branch ON recipient_branch.id = latest.to_user_id
        GROUP BY recipient_branch.root_seller_id`,
        sentPurchaseParams
      );

      sentPurchaseResult.rows.forEach((row) => {
        const sellerId = Number(row.user_id);
        const existing = summaryMap.get(sellerId) || { user_id: sellerId, total_piece: 0, unsold_piece: 0 };
        existing.total_piece = Math.max(
          Number(existing.total_piece || 0),
          Number(row.sent_purchase_piece || 0)
        );
        summaryMap.set(sellerId, existing);
      });
    }

    const manualBranchUnsoldMap = new Map();

    if (!currentUserIsAdmin) {
      const manualBranchParams = [req.user.id, PURCHASE_ENTRY_SOURCE, 'saved_unsold'];
      const manualBranchConditions = [
        'le.entry_source = $2',
        'h.action_type = $3',
        'h.actor_user_id = $1',
        latestSavedUnsoldHistoryCondition
      ];

      if (bookingDate) {
        manualBranchParams.push(bookingDate);
        manualBranchConditions.push(`h.booking_date = $${manualBranchParams.length}::date`);
      }

      if (sessionMode) {
        manualBranchParams.push(sessionMode);
        manualBranchConditions.push(`h.session_mode = $${manualBranchParams.length}`);
      }

      if (purchaseCategory) {
        manualBranchParams.push(purchaseCategory);
        manualBranchConditions.push(`h.purchase_category = $${manualBranchParams.length}`);
      }

      if (normalizedAmount) {
        manualBranchParams.push(normalizedAmount);
        manualBranchConditions.push(`h.amount = $${manualBranchParams.length}::numeric`);
      }

      const manualBranchResult = await query(
        `WITH RECURSIVE branch_users AS (
          SELECT id, id AS root_seller_id
          FROM users
          WHERE (id = $1 AND role = 'seller') OR (parent_id = $1 AND role = 'seller')
          UNION ALL
          SELECT u.id, bu.root_seller_id
          FROM users u
          INNER JOIN branch_users bu ON u.parent_id = bu.id
          WHERE bu.id <> $1
        )
        SELECT bu.root_seller_id AS user_id,
               h.session_mode,
               h.purchase_category,
               h.amount,
               h.box_value,
               h.number,
               COALESCE(SUM(CASE WHEN h.box_value ~ '^\\d+(\\.\\d+)?$' THEN h.box_value::numeric ELSE 0 END), 0) AS manual_unsold_piece
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${manualBranchConditions.join(' AND ')}
        GROUP BY bu.root_seller_id, h.session_mode, h.purchase_category, h.amount, h.box_value, h.number`,
        manualBranchParams
      );

      manualBranchResult.rows.forEach((row) => {
        const sellerId = Number(row.user_id);
        manualBranchUnsoldMap.set(
          sellerId,
          Number(manualBranchUnsoldMap.get(sellerId) || 0) + Number(row.manual_unsold_piece || 0)
        );
      });
    }

    if (currentUserIsAdmin) {
      const sentUnsoldParams = [req.user.id, PURCHASE_ENTRY_SOURCE];
      const sentUnsoldConditions = [
        'le.entry_source = $2',
        "h.action_type IN ('unsold_sent', 'unsold_auto_accepted')",
        'h.to_user_id = $1'
      ];

      if (bookingDate) {
        sentUnsoldParams.push(bookingDate);
        sentUnsoldConditions.push(`h.booking_date = $${sentUnsoldParams.length}::date`);
      }

      if (sessionMode) {
        sentUnsoldParams.push(sessionMode);
        sentUnsoldConditions.push(`h.session_mode = $${sentUnsoldParams.length}`);
      }

      if (purchaseCategory) {
        sentUnsoldParams.push(purchaseCategory);
        sentUnsoldConditions.push(`h.purchase_category = $${sentUnsoldParams.length}`);
      }

      if (normalizedAmount) {
        sentUnsoldParams.push(normalizedAmount);
        sentUnsoldConditions.push(`h.amount = $${sentUnsoldParams.length}::numeric`);
      }

      const sentUnsoldResult = await query(
        `WITH RECURSIVE branch_users AS (
          SELECT id, id AS root_seller_id
          FROM users
          WHERE parent_id = $1 AND role = 'seller'
          UNION ALL
          SELECT u.id, bu.root_seller_id
          FROM users u
          INNER JOIN branch_users bu ON u.parent_id = bu.id
        ),
        latest_send_batches AS (
          SELECT
            le.user_id,
            h.booking_date,
            h.session_mode,
            h.purchase_category,
            h.amount,
            MAX(h.created_at) AS latest_created_at
          FROM lottery_entry_history h
          INNER JOIN lottery_entries le ON le.id = h.entry_id
          WHERE ${sentUnsoldConditions.join(' AND ')}
          GROUP BY le.user_id, h.booking_date, h.session_mode, h.purchase_category, h.amount
        )
        SELECT bu.root_seller_id AS user_id,
               h.session_mode,
               h.purchase_category,
               h.amount,
               h.box_value,
               h.number,
               COALESCE(SUM(CASE WHEN h.box_value ~ '^\\d+(\\.\\d+)?$' THEN h.box_value::numeric ELSE 0 END), 0) AS sent_unsold_piece
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        INNER JOIN latest_send_batches batch
          ON batch.user_id = le.user_id
         AND batch.booking_date = h.booking_date
         AND batch.session_mode = h.session_mode
         AND batch.purchase_category = h.purchase_category
         AND batch.amount = h.amount
         AND batch.latest_created_at = h.created_at
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${sentUnsoldConditions.join(' AND ')}
        GROUP BY bu.root_seller_id, h.session_mode, h.purchase_category, h.amount, h.box_value, h.number`,
        sentUnsoldParams
      );

      const sentUnsoldNumberSet = new Set(sentUnsoldResult.rows.map((row) => ([
        row.user_id,
        row.session_mode,
        row.purchase_category,
        String(row.amount),
        row.box_value,
        row.number
      ].join('|'))));
      sentUnsoldResult.rows.forEach((row) => {
        const sellerId = Number(row.user_id);
        const existing = summaryMap.get(sellerId) || { user_id: sellerId, total_piece: 0, unsold_piece: 0 };
        existing.unsold_piece = Number(existing.unsold_piece || 0) + Number(row.sent_unsold_piece || 0);
        summaryMap.set(sellerId, existing);
      });

      const manualParams = [req.user.id, PURCHASE_ENTRY_SOURCE, 'saved_unsold'];
      const manualConditions = [
        'h.actor_user_id = $1',
        'le.entry_source = $2',
        'h.action_type = $3',
        latestSavedUnsoldHistoryCondition
      ];

      if (bookingDate) {
        manualParams.push(bookingDate);
        manualConditions.push(`h.booking_date = $${manualParams.length}::date`);
      }

      if (sessionMode) {
        manualParams.push(sessionMode);
        manualConditions.push(`h.session_mode = $${manualParams.length}`);
      }

      if (purchaseCategory) {
        manualParams.push(purchaseCategory);
        manualConditions.push(`h.purchase_category = $${manualParams.length}`);
      }

      if (normalizedAmount) {
        manualParams.push(normalizedAmount);
        manualConditions.push(`h.amount = $${manualParams.length}::numeric`);
      }

      const manualUnsoldResult = await query(
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
               h.session_mode,
               h.purchase_category,
               h.amount,
               h.box_value,
               h.number,
               COALESCE(SUM(CASE WHEN h.box_value ~ '^\\d+(\\.\\d+)?$' THEN h.box_value::numeric ELSE 0 END), 0) AS manual_unsold_piece
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${manualConditions.join(' AND ')}
        GROUP BY bu.root_seller_id, h.session_mode, h.purchase_category, h.amount, h.box_value, h.number`,
        manualParams
      );

      manualUnsoldResult.rows.forEach((row) => {
        const numberKey = [
          row.user_id,
          row.session_mode,
          row.purchase_category,
          String(row.amount),
          row.box_value,
          row.number
        ].join('|');
        if (sentUnsoldNumberSet.has(numberKey)) {
          return;
        }

        const sellerId = Number(row.user_id);
        const existing = summaryMap.get(sellerId) || { user_id: sellerId, total_piece: 0, unsold_piece: 0 };
        existing.unsold_piece = Number(existing.unsold_piece || 0) + Number(row.manual_unsold_piece || 0);
        summaryMap.set(sellerId, existing);
      });
    }

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
      const billStyleUnsoldParams = [req.user.id, PURCHASE_ENTRY_SOURCE];
      const billStyleConditions = [
        'le.entry_source = $2',
        `LOWER(TRIM(le.status)) IN ('accepted', '${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`
      ];

      if (bookingDate) {
        billStyleUnsoldParams.push(bookingDate);
        billStyleConditions.push(`le.booking_date = $${billStyleUnsoldParams.length}::date`);
      }

      if (sessionMode) {
        billStyleUnsoldParams.push(sessionMode);
        billStyleConditions.push(`le.session_mode = $${billStyleUnsoldParams.length}`);
      }

      if (purchaseCategory) {
        billStyleUnsoldParams.push(purchaseCategory);
        billStyleConditions.push(`le.purchase_category = $${billStyleUnsoldParams.length}`);
      }

      if (normalizedAmount) {
        billStyleUnsoldParams.push(normalizedAmount);
        billStyleConditions.push(`le.amount = $${billStyleUnsoldParams.length}::numeric`);
      }

      const billStyleLiveResult = await query(
        `WITH RECURSIVE branch_users AS (
          SELECT id, id AS root_seller_id
          FROM users
          WHERE (id = $1 AND role = 'seller') OR (parent_id = $1 AND role = 'seller')
          UNION ALL
          SELECT u.id, bu.root_seller_id
          FROM users u
          INNER JOIN branch_users bu ON u.parent_id = bu.id
          WHERE bu.id <> $1
        )
        SELECT bu.root_seller_id AS user_id,
               COALESCE(SUM(CASE WHEN (
                 LOWER(TRIM(le.status)) = '${UNSOLD_ACCEPTED_STATUS}'
                 OR (
                   LOWER(TRIM(le.status)) = '${UNSOLD_SENT_STATUS}'
                   AND (le.forwarded_by = $1 OR le.sent_to_parent = $1)
                 )
                 OR (
                   LOWER(TRIM(le.status)) = '${UNSOLD_LOCAL_STATUS}'
                   AND (le.user_id = $1 OR le.sent_to_parent = $1)
                 )
               ) AND le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS live_unsold_piece
        FROM lottery_entries le
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${billStyleConditions.join(' AND ')}
        GROUP BY bu.root_seller_id`,
        billStyleUnsoldParams
      );
      const billStyleUnsoldMap = new Map(billStyleLiveResult.rows.map((row) => [
        Number(row.user_id),
        Number(row.live_unsold_piece || 0)
      ]));
      billStyleUnsoldMap.clear();

      const billSentUnsoldParams = [req.user.id, PURCHASE_ENTRY_SOURCE];
      const billSentUnsoldConditions = [
        'le.entry_source = $2',
        "h.action_type IN ('unsold_sent', 'unsold_auto_accepted')",
        'h.to_user_id = $1'
      ];

      if (bookingDate) {
        billSentUnsoldParams.push(bookingDate);
        billSentUnsoldConditions.push(`h.booking_date = $${billSentUnsoldParams.length}::date`);
      }

      if (sessionMode) {
        billSentUnsoldParams.push(sessionMode);
        billSentUnsoldConditions.push(`h.session_mode = $${billSentUnsoldParams.length}`);
      }

      if (purchaseCategory) {
        billSentUnsoldParams.push(purchaseCategory);
        billSentUnsoldConditions.push(`h.purchase_category = $${billSentUnsoldParams.length}`);
      }

      if (normalizedAmount) {
        billSentUnsoldParams.push(normalizedAmount);
        billSentUnsoldConditions.push(`h.amount = $${billSentUnsoldParams.length}::numeric`);
      }

      const billSentUnsoldResult = await query(
        `WITH RECURSIVE branch_users AS (
          SELECT id, id AS root_seller_id
          FROM users
          WHERE (id = $1 AND role = 'seller') OR (parent_id = $1 AND role = 'seller')
          UNION ALL
          SELECT u.id, bu.root_seller_id
          FROM users u
          INNER JOIN branch_users bu ON u.parent_id = bu.id
          WHERE bu.id <> $1
        ),
        latest_send_batches AS (
          SELECT le.user_id, h.booking_date, h.session_mode, h.purchase_category, h.amount, MAX(h.created_at) AS latest_created_at
          FROM lottery_entry_history h
          INNER JOIN lottery_entries le ON le.id = h.entry_id
          WHERE ${billSentUnsoldConditions.join(' AND ')}
          GROUP BY le.user_id, h.booking_date, h.session_mode, h.purchase_category, h.amount
        )
        SELECT bu.root_seller_id AS user_id,
               h.session_mode,
               h.purchase_category,
               h.amount,
               h.box_value,
               h.number,
               COALESCE(SUM(CASE WHEN h.box_value ~ '^\\d+(\\.\\d+)?$' THEN h.box_value::numeric ELSE 0 END), 0) AS sent_unsold_piece
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        INNER JOIN latest_send_batches batch
          ON batch.user_id = le.user_id
         AND batch.booking_date = h.booking_date
         AND batch.session_mode = h.session_mode
         AND batch.purchase_category = h.purchase_category
         AND batch.amount = h.amount
         AND batch.latest_created_at = h.created_at
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${billSentUnsoldConditions.join(' AND ')}
        GROUP BY bu.root_seller_id, h.session_mode, h.purchase_category, h.amount, h.box_value, h.number`,
        billSentUnsoldParams
      );
      const billSentUnsoldNumberSet = new Set(billSentUnsoldResult.rows.map((row) => ([
        row.user_id,
        row.session_mode,
        row.purchase_category,
        String(row.amount),
        row.box_value,
        row.number
      ].join('|'))));
      billSentUnsoldResult.rows.forEach((row) => {
        const sellerId = Number(row.user_id);
        billStyleUnsoldMap.set(sellerId, Number(billStyleUnsoldMap.get(sellerId) || 0) + Number(row.sent_unsold_piece || 0));
      });

      const billManualUnsoldParams = [req.user.id, PURCHASE_ENTRY_SOURCE, 'saved_unsold', req.user.id];
      const billManualUnsoldConditions = [
        'le.entry_source = $2',
        'h.action_type = $3',
        'h.actor_user_id = $4',
        latestSavedUnsoldHistoryCondition
      ];

      if (bookingDate) {
        billManualUnsoldParams.push(bookingDate);
        billManualUnsoldConditions.push(`h.booking_date = $${billManualUnsoldParams.length}::date`);
      }

      if (sessionMode) {
        billManualUnsoldParams.push(sessionMode);
        billManualUnsoldConditions.push(`h.session_mode = $${billManualUnsoldParams.length}`);
      }

      if (purchaseCategory) {
        billManualUnsoldParams.push(purchaseCategory);
        billManualUnsoldConditions.push(`h.purchase_category = $${billManualUnsoldParams.length}`);
      }

      if (normalizedAmount) {
        billManualUnsoldParams.push(normalizedAmount);
        billManualUnsoldConditions.push(`h.amount = $${billManualUnsoldParams.length}::numeric`);
      }

      const billManualUnsoldResult = await query(
        `WITH RECURSIVE branch_users AS (
          SELECT id, id AS root_seller_id
          FROM users
          WHERE (id = $1 AND role = 'seller') OR (parent_id = $1 AND role = 'seller')
          UNION ALL
          SELECT u.id, bu.root_seller_id
          FROM users u
          INNER JOIN branch_users bu ON u.parent_id = bu.id
          WHERE bu.id <> $1
        )
        SELECT bu.root_seller_id AS user_id,
               h.session_mode,
               h.purchase_category,
               h.amount,
               h.box_value,
               h.number,
               COALESCE(SUM(CASE WHEN h.box_value ~ '^\\d+(\\.\\d+)?$' THEN h.box_value::numeric ELSE 0 END), 0) AS manual_unsold_piece
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        INNER JOIN branch_users bu ON bu.id = le.user_id
        WHERE ${billManualUnsoldConditions.join(' AND ')}
        GROUP BY bu.root_seller_id, h.session_mode, h.purchase_category, h.amount, h.box_value, h.number`,
        billManualUnsoldParams
      );

      billManualUnsoldResult.rows.forEach((row) => {
        const numberKey = [
          row.user_id,
          row.session_mode,
          row.purchase_category,
          String(row.amount),
          row.box_value,
          row.number
        ].join('|');

        if (billSentUnsoldNumberSet.has(numberKey)) {
          return;
        }

        const sellerId = Number(row.user_id);
        billStyleUnsoldMap.set(sellerId, Number(billStyleUnsoldMap.get(sellerId) || 0) + Number(row.manual_unsold_piece || 0));
      });

      const selfSellerId = Number(req.user.id);
      const selfSummaryUnsoldPiece = Number(summaryMap.get(selfSellerId)?.unsold_piece || 0);
      sellerChildSnapshotUnsoldMap.set(
        selfSellerId,
        Math.max(
          selfSummaryUnsoldPiece,
          Number(manualBranchUnsoldMap.get(selfSellerId) || 0),
          Number(billStyleUnsoldMap.get(selfSellerId) || 0)
        )
      );

      await Promise.all(
        sellers
          .filter((seller) => Number(seller.id) !== Number(req.user.id))
          .map(async (seller) => {
            const localSavedParams = [seller.id, PURCHASE_ENTRY_SOURCE, req.user.id];
            const localSavedFilters = [
              'user_id = $1',
              'entry_source = $2',
              `LOWER(TRIM(status)) IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}')`,
              '(sent_to_parent = $3 OR forwarded_by = $3)'
            ];

            if (bookingDate) {
              localSavedParams.push(bookingDate);
              localSavedFilters.push(`booking_date = $${localSavedParams.length}::date`);
            }

            if (sessionMode) {
              localSavedParams.push(sessionMode);
              localSavedFilters.push(`session_mode = $${localSavedParams.length}`);
            }

            if (purchaseCategory) {
              localSavedParams.push(purchaseCategory);
              localSavedFilters.push(`purchase_category = $${localSavedParams.length}`);
            }

            if (normalizedAmount) {
              localSavedParams.push(normalizedAmount);
              localSavedFilters.push(`amount = $${localSavedParams.length}::numeric`);
            }

            const [snapshotRows, localSavedResult, manualRows] = await Promise.all([
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
                `SELECT user_id, booking_date, session_mode, purchase_category, amount, box_value, number
                 FROM lottery_entries
                 WHERE ${localSavedFilters.join(' AND ')}`,
                localSavedParams
              ),
              getManualSavedUnsoldRows({
                targetSellerId: seller.id,
                actorUserId: req.user.id,
                bookingDate,
                sessionMode,
                purchaseCategory,
                amount: normalizedAmount,
                boxValue: ''
              })
            ]);

            const unsoldRowsByKey = new Map();
            [...snapshotRows, ...(localSavedResult.rows || []), ...(manualRows || [])].forEach((row) => {
              const rowKey = [
                row.user_id,
                row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
                String(row.session_mode || ''),
                String(row.purchase_category || ''),
                String(row.amount || ''),
                String(row.box_value || ''),
                String(row.number || '')
              ].join('|');
              unsoldRowsByKey.set(rowKey, row);
            });
            const childUnsoldPiece = [...unsoldRowsByKey.values()].reduce((sum, row) => (
              sum + (String(row.box_value || '').match(/^\d+(\.\d+)?$/) ? Number(row.box_value) : 0)
            ), 0);

            const summaryUnsoldPiece = Number(summaryMap.get(Number(seller.id))?.unsold_piece || 0);
            const manualBranchUnsoldPiece = Number(manualBranchUnsoldMap.get(Number(seller.id)) || 0);
            const childSellerType = normalizeSellerType(seller.seller_type || seller.sellerType);
            const billStyleChildUnsoldPiece = childSellerType === SELLER_TYPE_SUB_SELLER
              ? Number(billStyleUnsoldMap.get(Number(seller.id)) || 0)
              : 0;
            const resolvedChildUnsoldPiece = childSellerType === SELLER_TYPE_SUB_SELLER
              ? Math.max(
                  childUnsoldPiece + manualBranchUnsoldPiece,
                  summaryUnsoldPiece,
                  billStyleChildUnsoldPiece
                )
              : childUnsoldPiece;
            sellerChildSnapshotUnsoldMap.set(
              Number(seller.id),
              resolvedChildUnsoldPiece
            );
          })
      );
    }

    res.json(sellers.map((seller) => {
      const summary = summaryMap.get(Number(seller.id)) || {};
      const resolvedUnsoldPiece = currentUserIsAdmin
        ? Number(summary.unsold_piece || 0)
        : sellerChildSnapshotUnsoldMap.has(Number(seller.id))
          ? Number(sellerChildSnapshotUnsoldMap.get(Number(seller.id)) || 0)
          : Number(summary.unsold_piece || 0);
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
    const currentUserIsAdmin = isAdminRole(req.user.role);
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

    if (!currentUserIsAdmin) {
      conditions.push(`(
        LOWER(TRIM(le.status)) NOT IN ('${UNSOLD_LOCAL_STATUS}', '${UNSOLD_SENT_STATUS}', '${UNSOLD_ACCEPTED_STATUS}', 'unsold')
        OR le.forwarded_by = $1
        OR le.sent_to_parent = $1
        OR (
          le.user_id = $1
          AND (
            le.forwarded_by IS NULL
            OR le.forwarded_by = $1
            OR le.sent_to_parent IS NULL
            OR le.sent_to_parent = $1
          )
        )
      )`);
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
        WHERE (id = $1 AND role = 'seller') OR (parent_id = $1 AND role = 'seller')
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
        WHERE bu.id <> $1
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
        0 AS unsold_piece,
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

    const sentUnsoldParams = [req.user.id, PURCHASE_ENTRY_SOURCE];
    const sentUnsoldConditions = [
      'le.entry_source = $2',
      "h.action_type IN ('unsold_sent', 'unsold_auto_accepted')",
      'h.to_user_id = $1'
    ];

    if (dateFilterResult.dateFilter) {
      const sentDateFilter = buildDateFilter({ date, fromDate, toDate }, sentUnsoldParams, 'h.booking_date', true);
      if (sentDateFilter.dateFilter) {
        sentUnsoldConditions.push(sentDateFilter.dateFilter.replace(/^AND\s+/i, ''));
      }
    }

    if (sessionMode) {
      sentUnsoldParams.push(sessionMode);
      sentUnsoldConditions.push(`h.session_mode = $${sentUnsoldParams.length}`);
    }

    if (normalizedPurchaseCategory) {
      sentUnsoldParams.push(normalizedPurchaseCategory);
      sentUnsoldConditions.push(`h.purchase_category = $${sentUnsoldParams.length}`);
    }

    if (normalizedAmount) {
      sentUnsoldParams.push(normalizedAmount);
      sentUnsoldConditions.push(`h.amount = $${sentUnsoldParams.length}::numeric`);
    }

    const sentUnsoldResult = await query(
      `WITH RECURSIVE branch_users AS (
        SELECT
          id,
          username,
          id AS root_seller_id,
          username AS root_seller_name
        FROM users
        WHERE (id = $1 AND role = 'seller') OR (parent_id = $1 AND role = 'seller')
        UNION ALL
        SELECT
          u.id,
          u.username,
          bu.root_seller_id,
          bu.root_seller_name
        FROM users u
        INNER JOIN branch_users bu ON u.parent_id = bu.id
        WHERE bu.id <> $1
      ),
      latest_send_batches AS (
        SELECT
          le.user_id,
          h.booking_date,
          h.session_mode,
          h.purchase_category,
          h.amount,
          MAX(h.created_at) AS latest_created_at
        FROM lottery_entry_history h
        INNER JOIN lottery_entries le ON le.id = h.entry_id
        WHERE ${sentUnsoldConditions.join(' AND ')}
        GROUP BY le.user_id, h.booking_date, h.session_mode, h.purchase_category, h.amount
      )
      SELECT
        bu.root_seller_id,
        h.session_mode,
        h.purchase_category,
        h.amount,
        h.box_value,
        h.number,
        COALESCE(SUM(CASE WHEN h.box_value ~ '^\\d+(\\.\\d+)?$' THEN h.box_value::numeric ELSE 0 END), 0) AS sent_unsold_piece
      FROM lottery_entry_history h
      INNER JOIN lottery_entries le ON le.id = h.entry_id
      INNER JOIN latest_send_batches batch
        ON batch.user_id = le.user_id
       AND batch.booking_date = h.booking_date
       AND batch.session_mode = h.session_mode
       AND batch.purchase_category = h.purchase_category
       AND batch.amount = h.amount
       AND batch.latest_created_at = h.created_at
      INNER JOIN branch_users bu ON bu.id = le.user_id
      WHERE ${sentUnsoldConditions.join(' AND ')}
      GROUP BY bu.root_seller_id, h.session_mode, h.purchase_category, h.amount, h.box_value, h.number`,
      sentUnsoldParams
    );

    const sentUnsoldMap = new Map();
    sentUnsoldResult.rows.forEach((row) => {
      const key = [row.root_seller_id, row.session_mode, row.purchase_category, String(row.amount), row.box_value].join('|');
      sentUnsoldMap.set(key, Number(sentUnsoldMap.get(key) || 0) + Number(row.sent_unsold_piece || 0));
    });
    const sentUnsoldNumberSet = new Set(sentUnsoldResult.rows.map((row) => ([
      row.root_seller_id,
      row.session_mode,
      row.purchase_category,
      String(row.amount),
      row.box_value,
      row.number
    ].join('|'))));

    const manualParams = [req.user.id, PURCHASE_ENTRY_SOURCE, 'saved_unsold', req.user.id];
    const manualConditions = [
      'le.entry_source = $2',
      'h.action_type = $3',
      'h.actor_user_id = $4',
      latestSavedUnsoldHistoryCondition
    ];

    if (dateFilterResult.dateFilter) {
      const manualDateFilter = buildDateFilter({ date, fromDate, toDate }, manualParams, 'h.booking_date', true);
      if (manualDateFilter.dateFilter) {
        manualConditions.push(manualDateFilter.dateFilter.replace(/^AND\s+/i, ''));
      }
    }

    if (sessionMode) {
      manualParams.push(sessionMode);
      manualConditions.push(`h.session_mode = $${manualParams.length}`);
    }

    if (normalizedPurchaseCategory) {
      manualParams.push(normalizedPurchaseCategory);
      manualConditions.push(`h.purchase_category = $${manualParams.length}`);
    }

    if (normalizedAmount) {
      manualParams.push(normalizedAmount);
      manualConditions.push(`h.amount = $${manualParams.length}::numeric`);
    }

    const manualUnsoldResult = await query(
      `WITH RECURSIVE branch_users AS (
        SELECT
          id,
          username,
          id AS root_seller_id,
          username AS root_seller_name
        FROM users
        WHERE (id = $1 AND role = 'seller') OR (parent_id = $1 AND role = 'seller')
        UNION ALL
        SELECT
          u.id,
          u.username,
          bu.root_seller_id,
          bu.root_seller_name
        FROM users u
        INNER JOIN branch_users bu ON u.parent_id = bu.id
        WHERE bu.id <> $1
      )
      SELECT
        bu.root_seller_id,
        h.session_mode,
        h.purchase_category,
        h.amount,
        h.box_value,
        h.number,
        COALESCE(SUM(CASE WHEN h.box_value ~ '^\\d+(\\.\\d+)?$' THEN h.box_value::numeric ELSE 0 END), 0) AS manual_unsold_piece
      FROM lottery_entry_history h
      INNER JOIN lottery_entries le ON le.id = h.entry_id
      INNER JOIN branch_users bu ON bu.id = le.user_id
      WHERE ${manualConditions.join(' AND ')}
      GROUP BY bu.root_seller_id, h.session_mode, h.purchase_category, h.amount, h.box_value, h.number`,
      manualParams
    );

    const manualUnsoldMap = new Map();
    manualUnsoldResult.rows.forEach((row) => {
      const numberKey = [
        row.root_seller_id,
        row.session_mode,
        row.purchase_category,
        String(row.amount),
        row.box_value,
        row.number
      ].join('|');

      if (sentUnsoldNumberSet.has(numberKey)) {
        return;
      }

      const key = [row.root_seller_id, row.session_mode, row.purchase_category, String(row.amount), row.box_value].join('|');
      manualUnsoldMap.set(key, Number(manualUnsoldMap.get(key) || 0) + Number(row.manual_unsold_piece || 0));
    });

    const selfCurrentUnsoldMap = new Map();
    if (!currentUserIsAdmin) {
      const selfUnsoldParams = [req.user.id, PURCHASE_ENTRY_SOURCE];
      const selfUnsoldConditions = [
        'le.user_id = $1',
        'le.entry_source = $2',
        `(
          LOWER(TRIM(le.status)) = '${UNSOLD_ACCEPTED_STATUS}'
          OR (
            LOWER(TRIM(le.status)) = '${UNSOLD_SENT_STATUS}'
            AND le.forwarded_by = $1
          )
          OR (
            LOWER(TRIM(le.status)) = '${UNSOLD_LOCAL_STATUS}'
            AND (le.user_id = $1 OR le.sent_to_parent = $1)
          )
        )`
      ];

      if (dateFilterResult.dateFilter) {
        const selfDateFilter = buildDateFilter({ date, fromDate, toDate }, selfUnsoldParams, 'le.booking_date', true);
        if (selfDateFilter.dateFilter) {
          selfUnsoldConditions.push(selfDateFilter.dateFilter.replace(/^AND\s+/i, ''));
        }
      }

      if (sessionMode) {
        selfUnsoldParams.push(sessionMode);
        selfUnsoldConditions.push(`le.session_mode = $${selfUnsoldParams.length}`);
      }

      if (normalizedPurchaseCategory) {
        selfUnsoldParams.push(normalizedPurchaseCategory);
        selfUnsoldConditions.push(`le.purchase_category = $${selfUnsoldParams.length}`);
      }

      if (normalizedAmount) {
        selfUnsoldParams.push(normalizedAmount);
        selfUnsoldConditions.push(`le.amount = $${selfUnsoldParams.length}::numeric`);
      }

      const selfCurrentUnsoldResult = await query(
        `SELECT
          le.user_id AS root_seller_id,
          le.session_mode,
          le.purchase_category,
          le.amount,
          le.box_value,
          COALESCE(SUM(CASE WHEN le.box_value ~ '^\\d+(\\.\\d+)?$' THEN le.box_value::numeric ELSE 0 END), 0) AS current_unsold_piece
         FROM lottery_entries le
         WHERE ${selfUnsoldConditions.join(' AND ')}
         GROUP BY le.user_id, le.session_mode, le.purchase_category, le.amount, le.box_value`,
        selfUnsoldParams
      );

      selfCurrentUnsoldResult.rows.forEach((row) => {
        const key = [row.root_seller_id, row.session_mode, row.purchase_category, String(row.amount), row.box_value].join('|');
        selfCurrentUnsoldMap.set(key, Number(row.current_unsold_piece || 0));
      });
    }

    const billPieceSummaryDate = date || (fromDate && toDate && fromDate === toDate ? fromDate : toDate || fromDate || '');
    const billPieceSummaryUnsoldMap = new Map();
    if (billPieceSummaryDate) {
      const pieceSummaryReq = {
        ...req,
        query: {
          bookingDate: billPieceSummaryDate,
          sessionMode,
          purchaseCategory: normalizedPurchaseCategory,
          amount: normalizedAmount
        }
      };
      let pieceSummaryRows = [];
      let pieceSummaryError = null;
      const pieceSummaryRes = {
        json: (data) => {
          pieceSummaryRows = Array.isArray(data) ? data : [];
          return data;
        },
        status: (statusCode) => ({
          json: (data) => {
            pieceSummaryError = { statusCode, data };
            return data;
          }
        })
      };

      await getPurchasePieceSummary(pieceSummaryReq, pieceSummaryRes);
      if (pieceSummaryError) {
        return res.status(pieceSummaryError.statusCode).json(pieceSummaryError.data);
      }

      pieceSummaryRows.forEach((row) => {
        const sellerId = Number(row.sellerId || row.seller_id || row.user_id || row.id);
        if (!sellerId) {
          return;
        }
        billPieceSummaryUnsoldMap.set(sellerId, Number(row.unsoldPiece || row.unsold_piece || 0));
      });
    }

    const appliedPieceSummarySellerIds = new Set();
    res.json(result.rows.map((row) => {
      const totalPiece = Number(row.total_piece || 0);
      const manualKey = [row.root_seller_id, row.session_mode, row.purchase_category, String(row.amount), row.box_value].join('|');
      const manualUnsoldPiece = Number(manualUnsoldMap.get(manualKey) || 0);
      const sellerId = Number(row.root_seller_id);
      const pieceSummaryUnsoldPiece = billPieceSummaryUnsoldMap.get(sellerId);
      const unsoldPiece = billPieceSummaryUnsoldMap.has(sellerId)
        ? appliedPieceSummarySellerIds.has(sellerId)
          ? 0
          : Number(pieceSummaryUnsoldPiece || 0)
        : !currentUserIsAdmin && sellerId === Number(req.user.id)
        ? Number(selfCurrentUnsoldMap.get(manualKey) || 0)
        : Number(row.unsold_piece || 0) + manualUnsoldPiece;
      appliedPieceSummarySellerIds.add(sellerId);
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

    const pendingAutoAcceptResult = await query(
      `SELECT le.*, sender_user.username AS sender_username, sender_user.seller_type AS sender_seller_type
       FROM lottery_entries le
       LEFT JOIN users sender_user ON sender_user.id = le.forwarded_by
       WHERE le.sent_to_parent = $1
         AND le.session_mode = $2
         AND le.booking_date = CURRENT_DATE
         AND le.entry_source = $3
         AND le.status = $4
         ${amountFilter}`,
      params
    );
    const autoAcceptRows = pendingAutoAcceptResult.rows.filter((row) => isWithinUnsoldAutoAcceptTime({
      sellerType: row.sender_seller_type,
      bookingDate: row.booking_date instanceof Date ? row.booking_date.toISOString().slice(0, 10) : String(row.booking_date || ''),
      sessionMode: row.session_mode,
      purchaseCategory: row.purchase_category
    }));
    const autoAcceptIds = autoAcceptRows.map((row) => Number(row.id)).filter((entryId) => Number.isInteger(entryId) && entryId > 0);

    if (autoAcceptIds.length > 0) {
      const autoAcceptedResult = await query(
        `UPDATE lottery_entries
         SET status = $2,
             sent_to_parent = $3,
             forwarded_by = $3,
             sent_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::int[])
         RETURNING *`,
        [autoAcceptIds, UNSOLD_ACCEPTED_STATUS, req.user.id]
      );
      const actorById = new Map(autoAcceptRows.map((row) => [Number(row.id), row]));
      const rowsByActor = new Map();
      autoAcceptedResult.rows.forEach((row) => {
        const actorRow = actorById.get(Number(row.id)) || {};
        const actorId = Number(actorRow.forwarded_by || 0);
        if (!actorId) {
          return;
        }
        const actorKey = `${actorId}|${actorRow.sender_username || 'Unknown'}`;
        if (!rowsByActor.has(actorKey)) {
          rowsByActor.set(actorKey, {
            actorId,
            actorUsername: actorRow.sender_username || 'Unknown',
            rows: []
          });
        }
        rowsByActor.get(actorKey).rows.push(row);
      });
      await Promise.all([...rowsByActor.values()].map((group) => insertHistoryRecords({
        entries: group.rows,
        actionType: 'unsold_auto_accepted',
        statusBefore: UNSOLD_SENT_STATUS,
        statusAfter: UNSOLD_ACCEPTED_STATUS,
        actorUserId: group.actorId,
        actorUsername: group.actorUsername,
        toUserId: req.user.id,
        toUsername: req.user.username
      })));
    }

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
           OR (le.entry_source = $3 AND le.status IN ($4, '${UNSOLD_ACCEPTED_STATUS}'))
         )
         ${amountFilter}
       ORDER BY le.sent_at DESC NULLS LAST`,
      params
    );

    res.json(entriesResult.rows.map((row) => mapLotteryEntry({
      ...row,
      status: row.entry_source === PURCHASE_ENTRY_SOURCE && row.status === UNSOLD_ACCEPTED_STATUS
        ? 'accepted'
        : row.status
    })));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateReceivedEntryStatus = async (req, res) => {
  const client = await getClient();

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
      await client.query('BEGIN');

      const memoScopeResult = await client.query(
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
      const acceptedMemoResult = await client.query(
        `SELECT DISTINCT ON (entry_id) entry_id, memo_number
         FROM lottery_entry_history
         WHERE entry_id = ANY($1::int[])
           AND action_type = 'unsold_sent'
           AND actor_user_id = $2
           AND to_user_id = $3
           AND memo_number IS NOT NULL
         ORDER BY entry_id, created_at DESC`,
        [scopedIds, entry.forwarded_by, req.user.id]
      );
      const acceptedMemoMap = new Map(acceptedMemoResult.rows.map((row) => [
        Number(row.entry_id),
        Number(row.memo_number)
      ]));

      if (action === 'accept') {
        await client.query(
          `DELETE FROM lottery_entry_history h
           USING lottery_entries le
           WHERE h.entry_id = le.id
             AND le.user_id = $1
             AND le.entry_source = $2
             AND h.booking_date = $3::date
             AND h.session_mode = $4
             AND h.purchase_category = $5
             AND h.amount = $6::numeric
             AND h.to_user_id = $7
             AND h.action_type = 'unsold_accepted'`,
          [
            entry.user_id,
            PURCHASE_ENTRY_SOURCE,
            entry.booking_date,
            entry.session_mode,
            entry.purchase_category,
            entry.amount,
            req.user.id
          ]
        );
      }

      const updatedResult = await client.query(
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
        entries: updatedResult.rows.map((row) => ({
          ...row,
          history_memo_number: acceptedMemoMap.get(Number(row.id)) || row.memo_number
        })),
        actionType: action === 'accept' ? 'unsold_accepted' : 'unsold_rejected',
        statusBefore: UNSOLD_SENT_STATUS,
        statusAfter: action === 'accept' ? UNSOLD_ACCEPTED_STATUS : 'accepted',
        actorUserId: req.user.id,
        actorUsername: req.user.username,
        toUserId: req.user.id,
        toUsername: req.user.username,
        client
      });

      await client.query('COMMIT');

      return res.json({
        message: action === 'accept' ? 'Unsold accepted successfully' : 'Unsold rejected successfully',
        entry: mapLotteryEntry(updatedResult.rows[0]),
        entries: updatedResult.rows.map(mapLotteryEntry)
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
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback failures so the original error can be returned.
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
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
  getAdminPurchaseSentHistory,
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
