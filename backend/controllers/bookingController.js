const { getClient, query } = require('../config/database');
const { getIndiaNowParts } = require('../utils/helpers');

const DATE_VALUE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SESSION_MODES = ['MORNING', 'NIGHT'];
const VALID_PURCHASE_CATEGORIES = ['M', 'D', 'E'];
const SELLER_TYPES = {
  STOCKIST: 'seller',
  SUB_STOCKIST: 'sub_seller',
  NORMAL: 'normal_seller'
};

const normalizeSellerType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.values(SELLER_TYPES).includes(normalized) ? normalized : SELLER_TYPES.STOCKIST;
};

const normalizeSessionMode = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return VALID_SESSION_MODES.includes(normalized) ? normalized : '';
};

const normalizePurchaseCategory = (value, sessionMode = 'MORNING') => {
  const normalized = String(value || '').trim().toUpperCase();
  if (VALID_PURCHASE_CATEGORIES.includes(normalized)) {
    return normalized;
  }
  return sessionMode === 'NIGHT' ? 'E' : 'M';
};

const normalizeDate = (value) => {
  const normalized = String(value || getIndiaNowParts().date).trim();
  return DATE_VALUE_REGEX.test(normalized) ? normalized : '';
};

const normalizeNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 5);
  return digits.length === 5 ? digits : '';
};

const buildNumbers = (startValue, endValue) => {
  const startNumber = normalizeNumber(startValue);
  const endNumber = normalizeNumber(endValue || startValue);

  if (!startNumber || !endNumber) {
    return { error: 'Number 5 digit hona chahiye' };
  }

  const start = Number(startNumber);
  const end = Number(endNumber);
  if (end < start) {
    return { error: 'To number from number se chhota nahi ho sakta' };
  }
  if ((end - start) + 1 > 2000) {
    return { error: 'Ek baar me maximum 2000 booking numbers add honge' };
  }

  return {
    numbers: Array.from({ length: (end - start) + 1 }, (_, index) => String(start + index).padStart(5, '0'))
  };
};

const getVisibleBranchIds = async (rootUserId, includeSelf = true) => {
  const result = await query(
    `WITH RECURSIVE branch_users AS (
       SELECT id FROM users WHERE id = $1
       UNION ALL
       SELECT u.id FROM users u INNER JOIN branch_users bu ON u.parent_id = bu.id
     )
     SELECT id FROM branch_users`,
    [rootUserId]
  );

  return result.rows.map((row) => row.id).filter((id) => includeSelf || Number(id) !== Number(rootUserId));
};

const getAdminForUser = async (user) => {
  if (String(user.role).toLowerCase() === 'admin') {
    return user;
  }

  const result = await query(
    "SELECT id, username, role FROM users WHERE id = $1 AND role = 'admin' LIMIT 1",
    [user.ownerAdminId || user.owner_admin_id]
  );
  return result.rows[0] || null;
};

const validateSellerTarget = async (currentUser, sellerId, { allowSelf = false } = {}) => {
  const targetResult = await query(
    'SELECT id, username, role, seller_type, parent_id, owner_admin_id FROM users WHERE id = $1 LIMIT 1',
    [sellerId]
  );
  const target = targetResult.rows[0];
  if (!target || target.role !== 'seller') {
    return { error: 'Seller not found' };
  }

  if (Number(target.id) === Number(currentUser.id)) {
    return allowSelf ? { target } : { error: 'Self booking allowed nahi hai' };
  }

  if (currentUser.role !== 'admin' && Number(target.parent_id) !== Number(currentUser.id)) {
    return { error: 'Aap sirf apne direct seller ke liye booking kar sakte hain' };
  }

  return { target };
};

const getBookingSendDeadline = (sellerType, sessionMode, purchaseCategory) => {
  const type = normalizeSellerType(sellerType);
  const category = normalizePurchaseCategory(purchaseCategory, sessionMode);
  const shift = category === 'D' ? 'DAY' : category === 'E' ? 'EVENING' : 'MORNING';

  if (type === SELLER_TYPES.SUB_STOCKIST) {
    if (shift === 'DAY') return { hour: 17, minute: 50, second: 0 };
    if (shift === 'EVENING') return { hour: 19, minute: 50, second: 0 };
    return { hour: 12, minute: 50, second: 0 };
  }

  if (type === SELLER_TYPES.STOCKIST) {
    if (shift === 'DAY') return { hour: 17, minute: 55, second: 0 };
    if (shift === 'EVENING') return { hour: 19, minute: 50, second: 0 };
    return { hour: 12, minute: 55, second: 0 };
  }

  return null;
};

const isWithinBookingSendTime = ({ sellerType, bookingDate, sessionMode, purchaseCategory }) => {
  const today = getIndiaNowParts();
  if (bookingDate > today.date) {
    return true;
  }
  if (bookingDate < today.date) {
    return false;
  }

  const deadline = getBookingSendDeadline(sellerType, sessionMode, purchaseCategory);
  if (!deadline) {
    return false;
  }

  const nowSeconds = (today.hour * 3600) + (today.minute * 60) + today.second;
  const deadlineSeconds = (deadline.hour * 3600) + (deadline.minute * 60) + deadline.second;
  return nowSeconds <= deadlineSeconds;
};

const mapBookingEntry = (row) => ({
  id: row.id,
  userId: row.user_id,
  username: row.username,
  createdBy: row.created_by,
  createdByUsername: row.created_by_username,
  sentToAdmin: row.sent_to_admin,
  sentToAdminUsername: row.sent_to_admin_username,
  series: row.series || '',
  number: row.number,
  boxValue: row.box_value,
  amount: Number(row.amount),
  status: row.status,
  sessionMode: row.session_mode,
  purchaseCategory: row.purchase_category || (row.session_mode === 'NIGHT' ? 'E' : 'M'),
  bookingDate: row.booking_date,
  memoNumber: row.memo_number,
  createdAt: row.created_at,
  sentAt: row.sent_at
});

const mapBookingHistory = (row) => ({
  id: row.id,
  entryId: row.entry_id,
  userId: row.user_id,
  username: row.username,
  actorUserId: row.actor_user_id,
  actorUsername: row.actor_username,
  toUserId: row.to_user_id,
  toUsername: row.to_username,
  actionType: row.action_type,
  number: row.number,
  boxValue: row.box_value,
  amount: Number(row.amount),
  sessionMode: row.session_mode,
  purchaseCategory: row.purchase_category || (row.session_mode === 'NIGHT' ? 'E' : 'M'),
  bookingDate: row.booking_date,
  memoNumber: row.memo_number,
  createdAt: row.created_at
});

const insertHistory = async (client, rows, actionType, actor, toUser = null) => {
  for (const row of rows) {
    await client.query(
      `INSERT INTO booking_entry_history (
        entry_id, user_id, username, actor_user_id, actor_username, to_user_id, to_username,
        action_type, number, box_value, amount, session_mode, purchase_category, booking_date, memo_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        row.id,
        row.user_id,
        row.username || actor.username,
        actor.id,
        actor.username,
        toUser?.id || null,
        toUser?.username || null,
        actionType,
        row.number,
        row.box_value,
        row.amount,
        row.session_mode,
        row.purchase_category,
        row.booking_date,
        row.memo_number || null
      ]
    );
  }
};

const createBookingEntries = async (req, res) => {
  const bookingDate = normalizeDate(req.body.bookingDate);
  const sessionMode = normalizeSessionMode(req.body.sessionMode || req.headers['x-session-mode']);
  const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory, sessionMode);
  const amount = String(req.body.amount || '').trim();
  const boxValue = String(req.body.boxValue || req.body.sem || '').replace(/[^0-9]/g, '');
  const memoNumber = req.body.memoNumber ? Number(req.body.memoNumber) : null;
  const numbersResult = buildNumbers(req.body.rangeStart || req.body.number, req.body.rangeEnd || req.body.number);

  if (!bookingDate) return res.status(400).json({ message: 'Valid booking date required' });
  if (!sessionMode) return res.status(400).json({ message: 'Valid session required' });
  if (!amount || Number.isNaN(Number(amount))) return res.status(400).json({ message: 'Valid booking amount required' });
  if (!boxValue) return res.status(400).json({ message: 'SEM required' });
  if (numbersResult.error) return res.status(400).json({ message: numbersResult.error });

  const isAdmin = req.user.role === 'admin';
  let targetUser = req.user;
  if (isAdmin) {
    const validation = await validateSellerTarget(req.user, req.body.sellerId);
    if (validation.error) return res.status(400).json({ message: validation.error });
    targetUser = validation.target;
  }

  const adminUser = await getAdminForUser(req.user);
  if (!adminUser) return res.status(400).json({ message: 'Admin not found for booking' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const insertedRows = [];
    const status = isAdmin ? 'booked' : 'draft';

    for (const number of numbersResult.numbers) {
      const result = await client.query(
        `INSERT INTO booking_entries (
          user_id, created_by, sent_to_admin, series, number, box_value, amount, status,
          session_mode, purchase_category, booking_date, memo_number, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13)
        RETURNING *`,
        [
          targetUser.id,
          req.user.id,
          isAdmin ? adminUser.id : null,
          String(req.body.series || '').trim(),
          number,
          boxValue,
          amount,
          status,
          sessionMode,
          purchaseCategory,
          bookingDate,
          memoNumber,
          isAdmin ? new Date() : null
        ]
      );
      insertedRows.push({ ...result.rows[0], username: targetUser.username });
    }

    await insertHistory(client, insertedRows, isAdmin ? 'booked_by_admin' : 'booking_saved', req.user, isAdmin ? adminUser : null);
    await client.query('COMMIT');

    return res.status(201).json({
      message: isAdmin ? 'Booking number seller ke naam par save ho gaya' : 'Booking draft save ho gaya',
      entries: insertedRows.map(mapBookingEntry)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const replaceBookingMemoEntries = async (req, res) => {
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  const memoNumber = Number(req.body.memoNumber || 0);
  const targetSellerId = req.user.role === 'admin' ? Number(req.body.sellerId || 0) : Number(req.user.id);

  if (!Number.isInteger(memoNumber) || memoNumber <= 0) {
    return res.status(400).json({ message: 'Valid memo number required' });
  }
  if (!targetSellerId) {
    return res.status(400).json({ message: 'Seller select karo' });
  }
  if (entries.length === 0) {
    return res.status(400).json({ message: 'At least one booking row required' });
  }

  let targetUser = req.user;
  if (req.user.role === 'admin') {
    const validation = await validateSellerTarget(req.user, targetSellerId);
    if (validation.error) return res.status(400).json({ message: validation.error });
    targetUser = validation.target;
  }

  const adminUser = await getAdminForUser(req.user);
  if (!adminUser) return res.status(400).json({ message: 'Admin not found for booking' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const existingRows = await client.query(
      `DELETE FROM booking_entries
       WHERE user_id = $1 AND memo_number = $2
       RETURNING *`,
      [targetUser.id, memoNumber]
    );

    await insertHistory(
      client,
      existingRows.rows.map((row) => ({ ...row, username: targetUser.username })),
      'booking_memo_removed',
      req.user,
      adminUser
    );

    const insertedRows = [];
    for (const entry of entries) {
      const bookingDate = normalizeDate(entry.bookingDate);
      const sessionMode = normalizeSessionMode(entry.sessionMode);
      const purchaseCategory = normalizePurchaseCategory(entry.purchaseCategory, sessionMode);
      const amount = String(entry.amount || '').trim();
      const boxValue = String(entry.boxValue || '').replace(/[^0-9]/g, '');
      const numbersResult = buildNumbers(entry.rangeStart || entry.number, entry.rangeEnd || entry.number);

      if (!bookingDate || !sessionMode || !amount || !boxValue || numbersResult.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: numbersResult.error || 'Booking row valid nahi hai' });
      }

      for (const number of numbersResult.numbers) {
        const result = await client.query(
          `INSERT INTO booking_entries (
            user_id, created_by, sent_to_admin, series, number, box_value, amount, status,
            session_mode, purchase_category, booking_date, memo_number, sent_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13)
          RETURNING *`,
          [
            targetUser.id,
            req.user.id,
            req.user.role === 'admin' ? adminUser.id : null,
            String(entry.series || '').trim(),
            number,
            boxValue,
            amount,
            req.user.role === 'admin' ? 'booked' : 'draft',
            sessionMode,
            purchaseCategory,
            bookingDate,
            memoNumber,
            req.user.role === 'admin' ? new Date() : null
          ]
        );
        insertedRows.push({ ...result.rows[0], username: targetUser.username });
      }
    }

    await insertHistory(client, insertedRows, 'booking_memo_updated', req.user, adminUser);
    await client.query('COMMIT');

    return res.json({
      message: 'Booking memo update ho gaya',
      entries: insertedRows.map(mapBookingEntry)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const getBookingEntries = async (req, res) => {
  try {
    const visibleUserIds = req.user.role === 'admin'
      ? await getVisibleBranchIds(req.user.id, true)
      : [req.user.id];
    const params = [visibleUserIds];
    const conditions = ['be.user_id = ANY($1::int[])'];

    if (req.query.sellerId) {
      params.push(Number(req.query.sellerId));
      conditions.push(`be.user_id = $${params.length}`);
    }
    if (req.query.status) {
      params.push(String(req.query.status).trim());
      conditions.push(`be.status = $${params.length}`);
    }
    if (req.query.bookingDate) {
      params.push(normalizeDate(req.query.bookingDate));
      conditions.push(`be.booking_date = $${params.length}::date`);
    }
    if (req.query.fromDate && req.query.toDate) {
      params.push(normalizeDate(req.query.fromDate), normalizeDate(req.query.toDate));
      conditions.push(`be.booking_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }
    if (req.query.sessionMode) {
      params.push(normalizeSessionMode(req.query.sessionMode));
      conditions.push(`be.session_mode = $${params.length}`);
    }
    if (req.query.purchaseCategory) {
      params.push(normalizePurchaseCategory(req.query.purchaseCategory, req.query.sessionMode));
      conditions.push(`be.purchase_category = $${params.length}`);
    }
    if (req.query.amount) {
      params.push(String(req.query.amount).trim());
      conditions.push(`be.amount = $${params.length}::numeric`);
    }

    const result = await query(
      `SELECT be.*, u.username, cb.username AS created_by_username, au.username AS sent_to_admin_username
       FROM booking_entries be
       LEFT JOIN users u ON u.id = be.user_id
       LEFT JOIN users cb ON cb.id = be.created_by
       LEFT JOIN users au ON au.id = be.sent_to_admin
       WHERE ${conditions.join(' AND ')}
       ORDER BY be.booking_date DESC, be.created_at DESC, be.id DESC`,
      params
    );
    return res.json(result.rows.map(mapBookingEntry));
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const sendBookingEntries = async (req, res) => {
  const bookingDate = normalizeDate(req.body.bookingDate || req.query.bookingDate);
  const sessionMode = normalizeSessionMode(req.body.sessionMode || req.headers['x-session-mode']);
  const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory, sessionMode);
  const amount = String(req.body.amount || req.query.amount || '').trim();

  if (req.user.role !== 'seller') {
    return res.status(403).json({ message: 'Only stokist/sub-stokist booking send kar sakte hain' });
  }
  if (!bookingDate || !sessionMode) {
    return res.status(400).json({ message: 'Valid booking date and session required' });
  }
  if (normalizeSellerType(req.user.sellerType || req.user.seller_type) === SELLER_TYPES.NORMAL) {
    return res.status(403).json({ message: 'Normal seller booking send nahi kar sakta' });
  }
  if (!isWithinBookingSendTime({
    sellerType: req.user.sellerType || req.user.seller_type,
    bookingDate,
    sessionMode,
    purchaseCategory
  })) {
    return res.status(400).json({ message: 'Booking send ka time khatam ho gaya' });
  }

  const adminUser = await getAdminForUser(req.user);
  if (!adminUser) return res.status(400).json({ message: 'Admin not found for booking' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const params = [req.user.id, bookingDate, sessionMode, purchaseCategory, adminUser.id];
    const amountFilter = amount ? `AND amount = $${params.push(amount)}::numeric` : '';
    const result = await client.query(
      `UPDATE booking_entries
       SET status = 'sent', sent_to_admin = $5, sent_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
         AND booking_date = $2::date
         AND session_mode = $3
         AND purchase_category = $4
         AND status = 'draft'
         ${amountFilter}
       RETURNING *`,
      params
    );

    await insertHistory(
      client,
      result.rows.map((row) => ({ ...row, username: req.user.username })),
      'booking_sent',
      req.user,
      adminUser
    );
    await client.query('COMMIT');

    return res.json({ message: 'Booking numbers admin ko send ho gaye', entriesSent: result.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const acceptBookingEntries = async (req, res) => {
  const bookingDate = normalizeDate(req.body.bookingDate || req.query.bookingDate);
  const sessionMode = normalizeSessionMode(req.body.sessionMode || req.query.sessionMode || req.headers['x-session-mode']);
  const purchaseCategory = normalizePurchaseCategory(req.body.purchaseCategory || req.query.purchaseCategory, sessionMode);
  const sellerId = Number(req.body.sellerId || req.query.sellerId || 0);
  const amount = String(req.body.amount || req.query.amount || '').trim();

  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only admin booking accept kar sakta hai' });
  }
  if (!bookingDate || !sessionMode) {
    return res.status(400).json({ message: 'Valid booking date and session required' });
  }

  const params = [req.user.id, bookingDate, sessionMode, purchaseCategory];
  const sellerFilter = sellerId ? `AND user_id = $${params.push(sellerId)}` : '';
  const amountFilter = amount ? `AND amount = $${params.push(amount)}::numeric` : '';
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE booking_entries
       SET status = 'booked', sent_to_admin = $1, sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP)
       WHERE sent_to_admin = $1
         AND booking_date = $2::date
         AND session_mode = $3
         AND purchase_category = $4
         AND status = 'sent'
         ${sellerFilter}
         ${amountFilter}
       RETURNING *`,
      params
    );

    const userIds = [...new Set(result.rows.map((row) => row.user_id))];
    const userResult = userIds.length > 0
      ? await client.query('SELECT id, username FROM users WHERE id = ANY($1::int[])', [userIds])
      : { rows: [] };
    const usernamesById = new Map(userResult.rows.map((row) => [Number(row.id), row.username]));

    await insertHistory(
      client,
      result.rows.map((row) => ({ ...row, username: usernamesById.get(Number(row.user_id)) || 'Unknown' })),
      'booking_accepted',
      req.user,
      req.user
    );

    await client.query('COMMIT');
    return res.json({
      message: 'Booking numbers accept ho gaye',
      acceptedCount: result.rowCount
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const getBookingRecord = async (req, res) => {
  try {
    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const params = [visibleUserIds];
    const conditions = ['bh.actor_user_id = ANY($1::int[])'];

    if (req.query.fromDate && req.query.toDate) {
      params.push(normalizeDate(req.query.fromDate), normalizeDate(req.query.toDate));
      conditions.push(`bh.booking_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    } else if (req.query.date) {
      params.push(normalizeDate(req.query.date));
      conditions.push(`bh.booking_date = $${params.length}::date`);
    }
    if (req.query.sessionMode) {
      params.push(normalizeSessionMode(req.query.sessionMode));
      conditions.push(`bh.session_mode = $${params.length}`);
    }
    if (req.query.purchaseCategory) {
      params.push(normalizePurchaseCategory(req.query.purchaseCategory, req.query.sessionMode));
      conditions.push(`bh.purchase_category = $${params.length}`);
    }

    const result = await query(
      `SELECT *
       FROM booking_entry_history bh
       WHERE ${conditions.join(' AND ')}
       ORDER BY bh.created_at DESC, bh.id DESC`,
      params
    );
    return res.json(result.rows.map(mapBookingHistory));
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getBookingBillSummary = async (req, res) => {
  try {
    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const params = [visibleUserIds];
    const conditions = ["be.user_id = ANY($1::int[])", "be.status IN ('booked', 'sent')"];

    if (req.query.fromDate && req.query.toDate) {
      params.push(normalizeDate(req.query.fromDate), normalizeDate(req.query.toDate));
      conditions.push(`be.booking_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    } else if (req.query.date) {
      params.push(normalizeDate(req.query.date));
      conditions.push(`be.booking_date = $${params.length}::date`);
    }
    if (req.query.sellerId) {
      params.push(Number(req.query.sellerId));
      conditions.push(`be.user_id = $${params.length}`);
    }
    if (req.query.sessionMode) {
      params.push(normalizeSessionMode(req.query.sessionMode));
      conditions.push(`be.session_mode = $${params.length}`);
    }
    if (req.query.purchaseCategory) {
      params.push(normalizePurchaseCategory(req.query.purchaseCategory, req.query.sessionMode));
      conditions.push(`be.purchase_category = $${params.length}`);
    }
    if (req.query.amount) {
      params.push(String(req.query.amount).trim());
      conditions.push(`be.amount = $${params.length}::numeric`);
    }

    const result = await query(
      `WITH entry_rows AS (
         SELECT
           be.*,
           u.username AS seller_username,
           COALESCE(SUM(
             CASE
               WHEN pr.id IS NULL THEN 0
               WHEN CAST(be.amount AS NUMERIC) <= 7 THEN CAST(pr.prize_amount AS NUMERIC) * CAST(be.box_value AS NUMERIC) * 0.5
               ELSE CAST(pr.prize_amount AS NUMERIC) * CAST(be.box_value AS NUMERIC)
             END
           ), 0) AS prize_amount
         FROM booking_entries be
         INNER JOIN users u ON u.id = be.user_id
         LEFT JOIN prize_results pr
           ON pr.result_for_date = be.booking_date
          AND pr.session_mode = be.session_mode
          AND COALESCE(pr.purchase_category, CASE WHEN pr.session_mode = 'NIGHT' THEN 'E' ELSE 'M' END) = be.purchase_category
          AND pr.uploaded_by = COALESCE(u.owner_admin_id, be.sent_to_admin)
          AND RIGHT(be.number, pr.digit_length) = pr.winning_number
         WHERE ${conditions.join(' AND ')}
         GROUP BY be.id, u.username
       )
       SELECT
         user_id,
         seller_username,
         amount,
         box_value,
         COUNT(*) AS number_count,
         SUM(CAST(box_value AS NUMERIC)) AS total_piece,
         SUM(CAST(box_value AS NUMERIC) * CAST(amount AS NUMERIC)) AS sales_amount,
         SUM(prize_amount) AS prize_amount,
         SUM((CAST(box_value AS NUMERIC) * CAST(amount AS NUMERIC)) - prize_amount) AS net_amount
       FROM entry_rows
       GROUP BY user_id, seller_username, amount, box_value
       ORDER BY seller_username ASC, amount ASC, box_value ASC`,
      params
    );

    return res.json(result.rows.map((row) => ({
      sellerId: row.user_id,
      sellerUsername: row.seller_username,
      amount: Number(row.amount),
      sem: Number(row.box_value),
      numberCount: Number(row.number_count),
      totalPiece: Number(row.total_piece),
      soldPiece: Number(row.total_piece),
      salesAmount: Number(row.sales_amount),
      prizeAmount: Number(row.prize_amount),
      netAmount: Number(row.net_amount)
    })));
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getBookingPriceTrack = async (req, res) => {
  try {
    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const sellerId = Number(req.query.sellerId || 0);
    const date = normalizeDate(req.query.date || getIndiaNowParts().date);
    const params = [visibleUserIds, date];
    const conditions = ["be.user_id = ANY($1::int[])", "be.status IN ('booked', 'sent')", "be.booking_date = $2::date"];

    if (sellerId) {
      if (!visibleUserIds.includes(sellerId)) {
        return res.status(403).json({ message: 'Selected seller is not available in your view' });
      }
      params.push(sellerId);
      conditions.push(`be.user_id = $${params.length}`);
    }

    if (req.query.shift && req.query.shift !== 'ALL') {
      const shift = String(req.query.shift).trim().toUpperCase();
      if (shift === 'DAY') {
        params.push('MORNING', 'D');
      } else if (shift === 'EVENING') {
        params.push('NIGHT', 'E');
      } else {
        params.push('MORNING', 'M');
      }
      conditions.push(`be.session_mode = $${params.length - 1}`);
      conditions.push(`be.purchase_category = $${params.length}`);
    }

    const result = await query(
      `SELECT
         CONCAT(pr.id, '-', be.id) AS id,
         be.user_id AS seller_id,
         u.username AS seller_username,
         be.booking_date,
         be.session_mode,
         be.purchase_category,
         be.number,
         be.amount,
         be.box_value AS sem,
         pr.id AS prize_id,
         pr.prize_key,
         pr.prize_label,
         pr.winning_number,
         pr.prize_amount,
         CASE
           WHEN CAST(be.amount AS NUMERIC) <= 7 THEN CAST(pr.prize_amount AS NUMERIC) * CAST(be.box_value AS NUMERIC) * 0.5
           ELSE CAST(pr.prize_amount AS NUMERIC) * CAST(be.box_value AS NUMERIC)
         END AS calculated_prize
       FROM booking_entries be
       INNER JOIN users u ON u.id = be.user_id
       INNER JOIN prize_results pr
         ON pr.result_for_date = be.booking_date
        AND pr.session_mode = be.session_mode
        AND COALESCE(pr.purchase_category, CASE WHEN pr.session_mode = 'NIGHT' THEN 'E' ELSE 'M' END) = be.purchase_category
        AND pr.uploaded_by = COALESCE(u.owner_admin_id, be.sent_to_admin)
        AND RIGHT(be.number, pr.digit_length) = pr.winning_number
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.username ASC, be.amount ASC, be.box_value ASC, be.number ASC, pr.prize_amount DESC`,
      params
    );

    const rows = result.rows.map((row) => ({
      id: row.id,
      sellerId: row.seller_id,
      sellerUsername: row.seller_username,
      bookingDate: row.booking_date,
      sessionMode: row.session_mode,
      purchaseCategory: row.purchase_category,
      number: row.number,
      amount: Number(row.amount),
      sem: Number(row.sem),
      prizeId: row.prize_id,
      prizeKey: row.prize_key,
      prizeLabel: row.prize_label,
      winningNumber: row.winning_number,
      calculatedPrize: Number(row.calculated_prize)
    }));

    return res.json({
      rows,
      totalPrize: rows.reduce((sum, row) => sum + Number(row.calculatedPrize || 0), 0)
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  createBookingEntries,
  replaceBookingMemoEntries,
  getBookingEntries,
  sendBookingEntries,
  acceptBookingEntries,
  getBookingRecord,
  getBookingBillSummary,
  getBookingPriceTrack
};
