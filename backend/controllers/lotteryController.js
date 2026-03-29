const { query } = require('../config/database');
const { generateUniqueCode, isWithinTimeLimit, calculateUserLevel, getIndiaNowParts } = require('../utils/helpers');

const VALID_SESSION_MODES = ['MORNING', 'NIGHT'];
const isAdminRole = (role) => String(role || '').trim().toLowerCase() === 'admin';
const DATE_VALUE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeSessionMode = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  return VALID_SESSION_MODES.includes(normalized) ? normalized : null;
};

const getRequiredSessionMode = (req, res) => {
  const sessionMode = normalizeSessionMode(req.headers['x-session-mode'] || req.body.sessionMode || req.query.sessionMode);

  if (!sessionMode) {
    res.status(400).json({ message: 'Valid session mode is required' });
    return null;
  }

  return sessionMode;
};

const getOptionalSessionMode = (req) => normalizeSessionMode(req.headers['x-session-mode'] || req.body.sessionMode || req.query.sessionMode);

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
  sessionMode: row.session_mode,
  createdAt: row.created_at
});

const ensureHistoryStorage = async () => {
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
    UPDATE lottery_entry_history h
    SET booking_date = le.booking_date
    FROM lottery_entries le
    WHERE h.entry_id = le.id
      AND h.booking_date <> le.booking_date
  `);
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
  toUsername
}) => {
  if (!entries || entries.length === 0) {
    return;
  }

  await ensureHistoryStorage();

  for (const entry of entries) {
    await query(
      `INSERT INTO lottery_entry_history (
        entry_id, unique_code, number, box_value, amount,
        from_user_id, from_username, to_user_id, to_username,
        actor_user_id, actor_username, action_type, status_before, status_after, session_mode, booking_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::date)`,
      [
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
        entry.booking_date || getTodayDateValue()
      ]
    );
  }
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
      '6': Number(req.user.rateAmount6 || 0),
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

    if (bookingDate < getTodayDateValue()) {
      return res.status(400).json({ message: 'Past booking date is not allowed' });
    }

    if (bookingDate === getTodayDateValue() && !isWithinTimeLimit(sessionMode)) {
      return res.status(400).json({ message: 'Time limit exceeded for posting entries' });
    }

    // Global Uniqueness Check
    const duplicateCheck = await query(
      `SELECT number FROM lottery_entries
       WHERE number = ANY($1::varchar[]) AND amount = $2 AND box_value = $3
       AND session_mode = $4
       AND booking_date = $5::date
       ORDER BY number ASC`,
      [numbersToBook, amount, boxValue, sessionMode, bookingDate]
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
        `INSERT INTO lottery_entries (user_id, series, number, box_value, unique_code, amount, status, session_mode, booking_date)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8::date)
         RETURNING *`,
        [userId, series || null, currentNumber, boxValue, uniqueCode, amount, sessionMode, bookingDate]
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

const getPendingEntries = async (req, res) => {
  try {
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    const entriesResult = await query(
      "SELECT * FROM lottery_entries WHERE user_id = $1 AND status = 'pending' AND session_mode = $2 AND booking_date = $3::date ORDER BY created_at DESC",
      [req.user.id, sessionMode, bookingDate]
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

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    if (bookingDate < getTodayDateValue()) {
      return res.status(400).json({ message: 'Past booking date is not allowed' });
    }

    if (bookingDate === getTodayDateValue() && !isWithinTimeLimit(sessionMode)) {
      await query("DELETE FROM lottery_entries WHERE user_id = $1 AND status = 'pending' AND session_mode = $2 AND booking_date = $3::date", [userId, sessionMode, bookingDate]);
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

    const ownEntriesResult = await query(
      `UPDATE lottery_entries
       SET status = $1, sent_to_parent = $2, forwarded_by = $3, sent_at = CURRENT_TIMESTAMP
       WHERE user_id = $3 AND status = 'pending' AND session_mode = $4 AND booking_date = $5::date
       RETURNING id, user_id, unique_code, number, box_value, amount, session_mode, booking_date`,
      [nextStatus, user.parent_id, userId, sessionMode, bookingDate]
    );

    const acceptedChildEntriesResult = await query(
      `UPDATE lottery_entries
       SET status = $1, sent_to_parent = $2, forwarded_by = $3, sent_at = CURRENT_TIMESTAMP
       WHERE sent_to_parent = $4 AND status = 'accepted' AND session_mode = $5 AND booking_date = $6::date
       RETURNING id, user_id, unique_code, number, box_value, amount, session_mode, booking_date`,
      [nextStatus, user.parent_id, userId, userId, sessionMode, bookingDate]
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

    if (!sessionMode) {
      return;
    }

    await normalizeQueuedEntries([req.user.id]);

    const entriesResult = await query(
      `SELECT le.*, u.username, parent_user.username AS parent_username
       , forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE le.sent_to_parent = $1 AND le.status = 'sent' AND le.session_mode = $2 AND le.booking_date = CURRENT_DATE
       ORDER BY le.sent_at DESC NULLS LAST`,
      [req.user.id, sessionMode]
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

    if (!sessionMode) {
      return;
    }

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const entryResult = await query(
      `SELECT le.*, parent_user.parent_id AS current_user_parent_id
       FROM lottery_entries le
       LEFT JOIN users parent_user ON parent_user.id = $2
       WHERE le.id = $1 AND le.sent_to_parent = $2 AND le.status = 'sent' AND le.session_mode = $3
       LIMIT 1`,
      [entryId, req.user.id, sessionMode]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ message: 'Entry not found' });
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

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    await normalizeQueuedEntries([req.user.id]);

    const entriesResult = await query(
      `SELECT le.*, u.username, parent_user.username AS parent_username
       , forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE le.sent_to_parent = $1 AND le.status = 'accepted' AND le.session_mode = $2 AND le.booking_date = $3::date
       ORDER BY u.username ASC, le.sent_at DESC NULLS LAST`,
      [req.user.id, sessionMode, bookingDate]
    );

    res.json(entriesResult.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getSentEntries = async (req, res) => {
  try {
    const visibleUserIds = await getVisibleBranchIds(req.user.id, false);
    const sessionMode = getOptionalSessionMode(req);
    const { date, fromDate, toDate } = req.query;

    await normalizeAdminAcceptedEntries(visibleUserIds);

    if (visibleUserIds.length === 0) {
      return res.json([]);
    }

    const params = [visibleUserIds];
    let sessionFilter = '';
    const dateFilterResult = buildDateFilter({ date, fromDate, toDate }, params, 'le.booking_date', true);

    if (dateFilterResult.error) {
      return res.status(400).json({ message: dateFilterResult.error });
    }

    if (sessionMode) {
      params.push(sessionMode);
      sessionFilter = `AND le.session_mode = $${params.length}`;
    }

    const entriesResult = await query(
      `SELECT le.*, u.username
       , parent_user.username AS parent_username
       , forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE le.user_id = ANY($1::int[]) AND le.status IN ('sent', 'accepted')
       ${dateFilterResult.dateFilter}
       ${sessionFilter}
       ORDER BY le.sent_at DESC NULLS LAST`,
      params
    );
    res.json(entriesResult.rows.map(mapLotteryEntry));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getMySentEntries = async (req, res) => {
  try {
    const sessionMode = getRequiredSessionMode(req, res);
    const bookingDate = normalizeBookingDate(req.query.bookingDate);

    if (!sessionMode || !bookingDate) {
      if (!bookingDate) {
        return res.status(400).json({ message: 'Valid booking date is required' });
      }
      return;
    }

    await normalizeQueuedEntries([req.user.id]);

    const entriesResult = await query(
      `SELECT le.*, u.username, parent_user.username AS parent_username
       , forwarded_user.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
       LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
       WHERE (le.user_id = $1 OR le.forwarded_by = $1) AND le.status IN ('queued', 'sent', 'accepted', 'rejected') AND le.session_mode = $2 AND le.booking_date = $3::date
       ORDER BY le.sent_at DESC NULLS LAST`,
      [req.user.id, sessionMode, bookingDate]
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
    const { date, fromDate, toDate, shift, includeBookings } = req.query;
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

    const includeBookedActions = String(includeBookings || '').trim().toLowerCase() === 'true';
    const actionFilter = includeBookedActions ? '' : "AND h.action_type <> 'booked'";

    const historyResult = await query(
      `SELECT h.*
       FROM lottery_entry_history h
       WHERE h.actor_user_id = ANY($1::int[])
       ${dateFilterResult.dateFilter}
       ${shiftFilter}
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

module.exports = { addLotteryEntry, getPendingEntries, deletePendingEntry, sendEntries, getSentEntries, getMySentEntries, getReceivedEntries, updateReceivedEntryStatus, getAcceptedEntriesForBookLottery, getTransferHistory, searchNumberTrace };
