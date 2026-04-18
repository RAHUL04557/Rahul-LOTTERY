const { getClient, query } = require('../config/database');

const PRIZE_CONFIG = {
  first: { label: 'First Prize', fullPrizeAmount: 25000, digitLength: 5 },
  second: { label: 'Second Prize', fullPrizeAmount: 20000, digitLength: 5 },
  third: { label: 'Third Prize', fullPrizeAmount: 2000, digitLength: 4 },
  fourth: { label: 'Fourth Prize', fullPrizeAmount: 700, digitLength: 4 },
  fifth: { label: 'Fifth Prize', fullPrizeAmount: 300, digitLength: 4 }
};

const INDIA_TIMEZONE = 'Asia/Kolkata';
const DATE_VALUE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PURCHASE_CATEGORIES = ['M', 'D', 'E'];

const normalizePurchaseCategory = (value) => {
  if (!value) {
    return '';
  }

  const normalized = String(value).trim().toUpperCase();
  return VALID_PURCHASE_CATEGORIES.includes(normalized) ? normalized : '';
};

const getNormalizedPrizeConfig = (prizeKey, fallbackLabel = '', fallbackDigitLength = 0) => {
  const normalizedKey = String(prizeKey || '').trim().toLowerCase();
  const config = PRIZE_CONFIG[normalizedKey];

  if (config) {
    return config;
  }

  return {
    label: fallbackLabel,
    fullPrizeAmount: 0,
    digitLength: Number(fallbackDigitLength || 0)
  };
};

const mapPrizeResult = (row) => {
  const config = getNormalizedPrizeConfig(row.prize_key, row.prize_label, row.digit_length);

  return {
    id: row.id,
    prizeKey: row.prize_key,
    prizeLabel: config.label,
    fullPrizeAmount: config.fullPrizeAmount,
    digitLength: config.digitLength,
    winningNumber: row.winning_number,
    sessionMode: row.session_mode,
    resultForDate: row.result_for_date,
    uploadedBy: row.uploaded_by,
    resultDate: row.result_date,
    createdAt: row.created_at
  };
};

const mapPrizeTrackerRow = (row) => {
  const config = getNormalizedPrizeConfig(row.prize_key, row.prize_label, row.digit_length);
  const amount = row.amount !== null && row.amount !== undefined ? Number(row.amount) : null;
  const sem = row.sem !== null && row.sem !== undefined ? Number(row.sem) : null;
  const calculatedPrize = amount !== null && sem !== null
    ? config.fullPrizeAmount * getPrizeMultiplier(amount, sem)
    : row.calculated_prize !== null && row.calculated_prize !== undefined
      ? Number(row.calculated_prize)
      : null;

  return {
    id: row.id,
    prizeId: row.prize_id,
    prizeKey: row.prize_key,
    prizeLabel: config.label,
    fullPrizeAmount: config.fullPrizeAmount,
    digitLength: config.digitLength,
    winningNumber: row.winning_number,
    sessionMode: row.session_mode,
    resultForDate: row.result_for_date,
    sellerUsername: row.seller_username || null,
    bookedNumber: row.booked_number || null,
    amount,
    sem,
    calculatedPrize,
    status: row.entry_status || null
  };
};

const normalizeWinningNumber = (value) => String(value || '').trim();
const normalizeDateValue = (value) => {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const normalized = String(value).trim();
  const parsedDate = new Date(normalized);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().slice(0, 10);
  }

  return normalized;
};

const getIndiaDateParts = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
};

const getSessionUploadBlockReason = (resultForDate, sessionMode) => {
  const indiaNow = getIndiaDateParts();

  if (resultForDate !== indiaNow.date) {
    return '';
  }

  if (sessionMode === 'MORNING' && indiaNow.hour < 13) {
    return 'Morning result upload current date ke liye 1:00 PM ke baad hi hoga';
  }

  if (sessionMode === 'NIGHT' && indiaNow.hour < 20) {
    return 'Night result upload current date ke liye 8:00 PM ke baad hi hoga';
  }

  return '';
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

const buildDateRangeFilter = ({ date, fromDate, toDate }, params, columnName) => {
  if (fromDate || toDate) {
    if (!fromDate || !toDate) {
      return { error: 'Both from and to dates are required for range filter' };
    }

    if (!DATE_VALUE_REGEX.test(fromDate) || !DATE_VALUE_REGEX.test(toDate)) {
      return { error: 'Valid date range required' };
    }

    if (fromDate > toDate) {
      return { error: 'From date cannot be after to date' };
    }

    params.push(fromDate, toDate);
    return {
      clause: `AND ${columnName} BETWEEN $${params.length - 1}::date AND $${params.length}::date`
    };
  }

  if (date) {
    if (!DATE_VALUE_REGEX.test(date)) {
      return { error: 'Valid date required' };
    }

    params.push(date);
    return {
      clause: `AND ${columnName} = $${params.length}::date`
    };
  }

  return {
    clause: `AND ${columnName} = CURRENT_DATE`
  };
};

const validatePrizeEntry = (entry) => {
  const prizeKey = String(entry?.prizeKey || '').trim().toLowerCase();
  const winningNumber = normalizeWinningNumber(entry?.winningNumber);
  const config = PRIZE_CONFIG[prizeKey];

  if (!config) {
    return 'Invalid prize option selected';
  }

  if (!/^\d+$/.test(winningNumber)) {
    return `${config.label} me sirf numeric entry allowed hai`;
  }

  if (winningNumber.length !== config.digitLength) {
    return `${config.label} requires exactly ${config.digitLength} digits`;
  }

  return null;
};

const getPrizeMultiplier = (amountValue, sameValue) => {
  const parsedAmount = Number(amountValue);
  const parsedSame = Number(sameValue);

  if (!parsedAmount || !parsedSame) {
    return 0;
  }

  const isHalfPrizeAmount = parsedAmount <= 7;
  return parsedSame * (isHalfPrizeAmount ? 0.5 : 1);
};

const uploadPrice = async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const sessionMode = String(req.body?.sessionMode || '').trim().toUpperCase();
  const resultForDate = String(req.body?.resultForDate || '').trim();

  if (!['MORNING', 'NIGHT'].includes(sessionMode)) {
    return res.status(400).json({ message: 'Session mode required' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultForDate)) {
    return res.status(400).json({ message: 'Valid result date required' });
  }

  if (entries.length === 0) {
    return res.status(400).json({ message: 'At least one prize result is required' });
  }

  const timingBlockReason = getSessionUploadBlockReason(resultForDate, sessionMode);
  if (timingBlockReason) {
    return res.status(400).json({ message: timingBlockReason });
  }

  const duplicateCheck = new Set();

  for (const entry of entries) {
    const validationMessage = validatePrizeEntry(entry);

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const duplicateKey = `${sessionMode}::${resultForDate}::${normalizeWinningNumber(entry.winningNumber)}`;

    if (duplicateCheck.has(duplicateKey)) {
      return res.status(400).json({ message: 'One number can have only one prize in the same date and session' });
    }

    duplicateCheck.add(duplicateKey);
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');
    const existingWinningNumbers = await client.query(
      `SELECT winning_number
       FROM prize_results
       WHERE session_mode = $1 AND result_for_date = $2`,
      [sessionMode, resultForDate]
    );
    const existingNumberSet = new Set(existingWinningNumbers.rows.map((row) => normalizeWinningNumber(row.winning_number)));

    const insertedRows = [];

    for (const entry of entries) {
      const prizeKey = String(entry.prizeKey).trim().toLowerCase();
      const winningNumber = normalizeWinningNumber(entry.winningNumber);
      const config = PRIZE_CONFIG[prizeKey];

       if (existingNumberSet.has(winningNumber)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'One number can have only one prize in the same date and session' });
      }

      const result = await client.query(
        `INSERT INTO prize_results (
          prize_key,
          prize_label,
          prize_amount,
          digit_length,
          winning_number,
          session_mode,
          result_for_date,
          uploaded_by,
          result_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        RETURNING *`,
        [
          prizeKey,
          config.label,
          config.fullPrizeAmount,
          config.digitLength,
          winningNumber,
          sessionMode,
          resultForDate,
          req.user?.id || null
        ]
      );

      insertedRows.push(result.rows[0]);
      existingNumberSet.add(winningNumber);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Prize results uploaded successfully',
      results: insertedRows.map(mapPrizeResult)
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      return res.status(400).json({ message: 'Ye prize number is date aur session me pehle se uploaded hai aur upload ke baad change nahi hoga' });
    }

    return res.status(500).json({ message: 'Server error', error: error.message });
  } finally {
    client.release();
  }
};

const updatePrizeResult = async (req, res) => {
  try {
    const resultId = Number(req.params.id);
    const winningNumber = normalizeWinningNumber(req.body?.winningNumber);

    if (!Number.isInteger(resultId) || resultId <= 0) {
      return res.status(400).json({ message: 'Valid result id required' });
    }

    const existingResult = await query('SELECT * FROM prize_results WHERE id = $1 LIMIT 1', [resultId]);

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ message: 'Uploaded result not found' });
    }

    const currentRow = existingResult.rows[0];
    const validationMessage = validatePrizeEntry({
      prizeKey: currentRow.prize_key,
      winningNumber
    });

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const timingBlockReason = getSessionUploadBlockReason(currentRow.result_for_date, currentRow.session_mode);
    if (timingBlockReason) {
      return res.status(400).json({ message: timingBlockReason });
    }

    const duplicateResult = await query(
      `SELECT id FROM prize_results
       WHERE session_mode = $1 AND result_for_date = $2 AND winning_number = $3 AND id <> $4
       LIMIT 1`,
      [currentRow.session_mode, currentRow.result_for_date, winningNumber, resultId]
    );

    if (duplicateResult.rows.length > 0) {
      return res.status(400).json({ message: 'One number can have only one prize in the same date and session' });
    }

    const updatedResult = await query(
      `UPDATE prize_results
      SET winning_number = $1, uploaded_by = $2, result_date = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *`,
      [winningNumber, req.user?.id || null, resultId]
    );

    return res.json({
      message: 'Prize result updated successfully',
      result: mapPrizeResult(updatedResult.rows[0])
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ message: 'One number can have only one prize in the same date and session' });
    }

    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPriceByCode = async (req, res) => {
  try {
    const winningNumber = normalizeWinningNumber(req.params.uniqueCode);
    const result = await query(
      'SELECT * FROM prize_results WHERE winning_number = $1 ORDER BY result_for_date DESC, session_mode ASC, prize_amount DESC, created_at DESC',
      [winningNumber]
    );

    if (result.rows.length === 0) {
      return res.json({ message: 'No result', price: null, results: [] });
    }

    return res.json({
      price: null,
      results: result.rows.map(mapPrizeResult)
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getAllPrices = async (req, res) => {
  try {
    const sessionMode = String(req.query?.sessionMode || '').trim().toUpperCase();
    const resultForDate = String(req.query?.resultForDate || '').trim();
    const conditions = [];
    const params = [];

    if (sessionMode) {
      params.push(sessionMode);
      conditions.push(`session_mode = $${params.length}`);
    }

    if (resultForDate) {
      params.push(resultForDate);
      conditions.push(`result_for_date = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT * FROM prize_results ${whereClause} ORDER BY result_for_date DESC, session_mode ASC, prize_amount DESC, created_at DESC`,
      params
    );
    return res.json(result.rows.map(mapPrizeResult));
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getPrizeTracker = async (req, res) => {
  try {
    const rawSessionMode = String(req.query?.sessionMode || '').trim().toUpperCase();
    const sessionMode = rawSessionMode === 'ALL' ? '' : rawSessionMode;
    const resultForDate = String(req.query?.resultForDate || '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(resultForDate)) {
      return res.status(400).json({ message: 'Valid result date required' });
    }

    if (sessionMode && !['MORNING', 'NIGHT'].includes(sessionMode)) {
      return res.status(400).json({ message: 'Valid session mode required' });
    }

    const result = await query(
      `WITH RECURSIVE branch_users AS (
         SELECT
           u.id,
           u.username,
           u.parent_id,
           u.id AS direct_root_id,
           u.username AS direct_root_username
         FROM users u
         WHERE u.parent_id = $1
         UNION ALL
         SELECT
           child.id,
           child.username,
           child.parent_id,
           branch_users.direct_root_id,
           branch_users.direct_root_username
         FROM users child
         INNER JOIN branch_users ON child.parent_id = branch_users.id
       ),
       tracker_rows AS (
         SELECT
           pr.id AS prize_id,
           pr.prize_key,
           pr.prize_label,
           pr.prize_amount,
           pr.digit_length,
           pr.winning_number,
           pr.session_mode,
           pr.result_for_date,
           bu.direct_root_username AS seller_username,
           le.number AS booked_number,
           le.amount,
           le.box_value AS sem,
           CASE
             WHEN le.id IS NULL THEN NULL
             WHEN CAST(le.amount AS NUMERIC) <= 7
               THEN CAST(pr.prize_amount AS NUMERIC) * CAST(le.box_value AS NUMERIC) * 0.5
             ELSE CAST(pr.prize_amount AS NUMERIC) * CAST(le.box_value AS NUMERIC)
           END AS calculated_prize,
           le.status AS entry_status
         FROM prize_results pr
         LEFT JOIN lottery_entries le
           ON le.booking_date = pr.result_for_date
          AND le.session_mode = pr.session_mode
          AND RIGHT(le.number, pr.digit_length) = pr.winning_number
          AND le.status IN ('queued', 'sent', 'accepted', 'rejected')
         LEFT JOIN branch_users bu ON bu.id = le.user_id
         WHERE pr.result_for_date = $2::date
           AND ($3::text = '' OR pr.session_mode = $3)
           AND (le.id IS NULL OR bu.id IS NOT NULL)
       )
       SELECT
         CONCAT(prize_id, '-', COALESCE(seller_username, 'no-winner')) AS id,
         prize_id,
         prize_key,
         prize_label,
         prize_amount,
         digit_length,
         winning_number,
         session_mode,
         result_for_date,
         seller_username,
         CASE
           WHEN COUNT(booked_number) = 0 THEN NULL
           WHEN COUNT(booked_number) = 1 THEN MIN(booked_number)
           ELSE STRING_AGG(booked_number, ', ' ORDER BY booked_number)
         END AS booked_number,
         CASE
           WHEN COUNT(amount) = 0 THEN NULL
           WHEN COUNT(DISTINCT amount) = 1 THEN MIN(amount)
           ELSE NULL
         END AS amount,
         CASE
           WHEN COUNT(sem) = 0 THEN NULL
           WHEN COUNT(DISTINCT sem) = 1 THEN MIN(sem)
           ELSE NULL
         END AS sem,
         SUM(COALESCE(calculated_prize, 0)) AS calculated_prize,
         MAX(entry_status) AS entry_status
       FROM tracker_rows
       GROUP BY
         prize_id,
         prize_key,
         prize_label,
         prize_amount,
         digit_length,
         winning_number,
         session_mode,
         result_for_date,
         seller_username
       ORDER BY prize_amount DESC, prize_id ASC, seller_username ASC NULLS LAST`,
      [req.user.id, resultForDate, sessionMode]
    );

    return res.json(result.rows.map(mapPrizeTrackerRow));
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getBillPrizes = async (req, res) => {
  try {
    const { date, fromDate, toDate, shift, amount: rawAmount, purchaseCategory } = req.query;
    const sessionMode = String(shift || '').trim().toUpperCase();
    const amount = String(rawAmount || '').trim();
    const normalizedPurchaseCategory = normalizePurchaseCategory(purchaseCategory);
    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);

    const prizeParams = [];
    const prizeDateFilter = buildDateRangeFilter({ date, fromDate, toDate }, prizeParams, 'pr.result_for_date');
    if (prizeDateFilter.error) {
      return res.status(400).json({ message: prizeDateFilter.error });
    }

    let prizeShiftFilter = '';
    if (sessionMode) {
      if (!['MORNING', 'NIGHT'].includes(sessionMode)) {
        return res.status(400).json({ message: 'Valid shift required' });
      }

      prizeParams.push(sessionMode);
      prizeShiftFilter = `AND pr.session_mode = $${prizeParams.length}`;
    }

    const prizeResultsResponse = await query(
      `SELECT * FROM prize_results pr
       WHERE 1 = 1
       ${prizeDateFilter.clause}
       ${prizeShiftFilter}
       ORDER BY pr.result_for_date DESC, pr.session_mode ASC, pr.prize_amount DESC, pr.created_at DESC`,
      prizeParams
    );

    const prizeResults = prizeResultsResponse.rows.map(mapPrizeResult);
    if (prizeResults.length === 0) {
      return res.json([]);
    }

    const entryParams = [visibleUserIds];
    const entryDateFilter = buildDateRangeFilter({ date, fromDate, toDate }, entryParams, 'le.booking_date');
    if (entryDateFilter.error) {
      return res.status(400).json({ message: entryDateFilter.error });
    }

    let entryShiftFilter = '';
    if (sessionMode) {
      entryParams.push(sessionMode);
      entryShiftFilter = `AND le.session_mode = $${entryParams.length}`;
    }

    let entryAmountFilter = '';
    if (amount) {
      entryParams.push(amount);
      entryAmountFilter = `AND le.amount = $${entryParams.length}::numeric`;
    }

    let entryPurchaseCategoryFilter = '';
    if (normalizedPurchaseCategory) {
      entryParams.push(normalizedPurchaseCategory);
      entryPurchaseCategoryFilter = `AND le.purchase_category = $${entryParams.length}`;
    }

    const entriesResponse = await query(
      `SELECT
         le.id,
         le.number,
         le.booking_date,
         le.session_mode,
         le.purchase_category,
         le.amount,
         le.box_value,
         le.status,
         u.username AS seller_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       WHERE le.user_id = ANY($1::int[])
         AND le.status IN ('queued', 'sent', 'accepted', 'rejected')
         ${entryDateFilter.clause}
         ${entryShiftFilter}
         ${entryAmountFilter}
         ${entryPurchaseCategoryFilter}
       ORDER BY le.booking_date DESC, le.session_mode ASC, u.username ASC, le.number ASC`,
      entryParams
    );

    const results = entriesResponse.rows.flatMap((entry) => {
      const bookedNumber = String(entry.number || '');
      const entryAmount = String(entry.amount);
      const entrySame = String(entry.box_value);

      return prizeResults
        .filter((prize) => (
          normalizeDateValue(prize.resultForDate) === normalizeDateValue(entry.booking_date)
          && prize.sessionMode === entry.session_mode
          && bookedNumber.endsWith(prize.winningNumber)
        ))
        .map((prize) => ({
          id: `${prize.id}-${entry.id}`,
          prizeId: prize.id,
          prizeKey: prize.prizeKey,
          sellerUsername: entry.seller_username || null,
          entryId: entry.id,
          bookedNumber,
          amount: Number(entryAmount),
          sem: Number(entrySame),
          status: entry.status,
          prizeLabel: prize.prizeLabel,
          winningNumber: prize.winningNumber,
          fullPrizeAmount: prize.fullPrizeAmount,
          calculatedPrize: prize.fullPrizeAmount * getPrizeMultiplier(entryAmount, entrySame),
          sessionMode: prize.sessionMode,
          purchaseCategory: entry.purchase_category || (entry.session_mode === 'NIGHT' ? 'E' : 'M'),
          resultForDate: prize.resultForDate
        }));
    });

    return res.json(results);
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getMyPrizes = async (req, res) => {
  try {
    const sessionMode = String(req.query?.sessionMode || req.headers['x-session-mode'] || '').trim().toUpperCase();
    const rawAmount = String(req.query?.amount || '').trim();
    const rawSame = String(req.query?.sem || '').trim();
    const amount = rawAmount.toUpperCase() === 'ALL' ? '' : rawAmount;
    const same = rawSame.toUpperCase() === 'ALL' ? '' : rawSame;
    const resultForDate = getIndiaDateParts().date;

    if (!['MORNING', 'NIGHT'].includes(sessionMode)) {
      return res.status(400).json({ message: 'Session mode required' });
    }

    const prizeResultsResponse = await query(
      `SELECT * FROM prize_results
       WHERE result_for_date = $1 AND session_mode = $2
       ORDER BY prize_amount DESC, created_at DESC`,
      [resultForDate, sessionMode]
    );

    const prizeResults = prizeResultsResponse.rows.map(mapPrizeResult);
    if (prizeResults.length === 0) {
      return res.json({
        results: [],
        totalPrize: 0,
        resultForDate,
        sessionMode,
        message: 'No prize today'
      });
    }

    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const params = [visibleUserIds, resultForDate, sessionMode];
    const conditions = [
      'le.user_id = ANY($1::int[])',
      'le.booking_date = $2::date',
      'le.session_mode = $3',
      "le.status IN ('queued', 'sent', 'accepted', 'rejected')"
    ];

    const entriesResponse = await query(
      `SELECT
         le.id,
         le.user_id,
         le.forwarded_by,
         le.number,
         le.amount,
         le.box_value,
         le.status,
         u.username,
         fb.username AS forwarded_by_username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       LEFT JOIN users fb ON fb.id = le.forwarded_by
       WHERE ${conditions.join('\n         AND ')}
       ORDER BY u.username ASC, le.number ASC, le.amount ASC, le.box_value ASC, le.created_at DESC`,
      params
    );

    const results = entriesResponse.rows.flatMap((entry) => {
      const entryAmount = String(entry.amount);
      const entrySame = String(entry.box_value);
      const bookedNumber = String(entry.number || '');

      return prizeResults
        .filter((prize) => bookedNumber.endsWith(prize.winningNumber))
        .map((prize) => ({
          prizeId: prize.id,
          ownedEntryId: entry.id,
          seller: entry.username || '-',
          bookedNumber,
          amount: Number(entryAmount),
          same: Number(entrySame),
          prizeLabel: prize.prizeLabel,
          winningNumber: prize.winningNumber,
          calculatedPrize: prize.fullPrizeAmount * getPrizeMultiplier(entryAmount, entrySame),
          prizeSource: entry.user_id === req.user.id ? 'Own' : entry.forwarded_by === req.user.id ? 'Forwarded' : 'Branch',
          forwardedBy: entry.forwarded_by_username || null,
          status: entry.status
        }));
    });
    const filteredResults = results.filter((entry) => {
      const amountMatches = !amount || String(entry.amount) === String(amount);
      const sameMatches = !same || String(entry.same) === String(same);
      return amountMatches && sameMatches;
    });

    return res.json({
      results: filteredResults,
      totalPrize: filteredResults.reduce((sum, entry) => sum + Number(entry.calculatedPrize || 0), 0),
      resultForDate,
      sessionMode,
      message: filteredResults.length > 0
        ? 'Prize found'
        : `No prize today${amount ? ` for amount ${amount}` : ''}${same ? ` and SEM ${same}` : ''}`
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const checkPrize = async (req, res) => {
  try {
    const number = normalizeWinningNumber(req.query?.number);
    const resultForDate = String(req.query?.date || '').trim();
    const sessionMode = String(req.query?.sessionMode || '').trim().toUpperCase();
    const rawAmount = String(req.query?.amount || '').trim();
    const rawSame = String(req.query?.sem || '').trim();
    const amount = rawAmount.toUpperCase() === 'ALL' ? '' : rawAmount;
    const same = rawSame.toUpperCase() === 'ALL' ? '' : rawSame;

    if (!/^\d{4,5}$/.test(number)) {
      return res.status(400).json({ message: 'Booked number must be 4 or 5 digits' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(resultForDate)) {
      return res.status(400).json({ message: 'Valid date required' });
    }

    if (!['MORNING', 'NIGHT'].includes(sessionMode)) {
      return res.status(400).json({ message: 'Session mode required' });
    }

    const visibleUserIds = await getVisibleBranchIds(req.user.id, true);
    const ownedEntryParams = [visibleUserIds, resultForDate, sessionMode];
    const ownedEntryConditions = [
      'le.user_id = ANY($1::int[])',
      'le.booking_date = $2::date',
      'le.session_mode = $3',
      "le.status IN ('queued', 'sent', 'accepted', 'rejected')"
    ];

    ownedEntryParams.push(number);
    ownedEntryConditions.push(
      number.length === 5
        ? `le.number = $${ownedEntryParams.length}`
        : `RIGHT(le.number, 4) = $${ownedEntryParams.length}`
    );

    if (amount) {
      ownedEntryParams.push(amount);
      ownedEntryConditions.push(`CAST(le.amount AS INTEGER) = $${ownedEntryParams.length}::int`);
    }

    if (same) {
      ownedEntryParams.push(same);
      ownedEntryConditions.push(`CAST(TRIM(le.box_value) AS INTEGER) = $${ownedEntryParams.length}::int`);
    }

    const ownedEntriesResult = await query(
      `SELECT le.id, le.number, le.user_id, le.amount, le.box_value, le.status, u.username
       FROM lottery_entries le
       LEFT JOIN users u ON u.id = le.user_id
       WHERE ${ownedEntryConditions.join('\n         AND ')}
       ORDER BY le.number ASC, le.amount ASC, le.box_value ASC, le.created_at DESC`,
      ownedEntryParams
    );

    if (ownedEntriesResult.rows.length === 0) {
      return res.json({
        matches: [],
        searchedNumber: number,
        resultForDate,
        sessionMode,
        message: 'Not your number',
        resultType: 'not_owned'
      });
    }

    const result = await query(
      `SELECT * FROM prize_results
      WHERE result_for_date = $1 AND session_mode = $2
      ORDER BY prize_amount DESC, created_at DESC`,
      [resultForDate, sessionMode]
    );

    const prizeResults = result.rows.map(mapPrizeResult);
    const matches = ownedEntriesResult.rows.flatMap((ownedEntry) => {
      const entryAmount = String(ownedEntry.amount);
      const entrySame = String(ownedEntry.box_value);
      const matchedNumber = String(ownedEntry.number || '');

      return prizeResults
        .filter((entry) => matchedNumber.endsWith(entry.winningNumber))
        .map((entry) => ({
          ...entry,
          amount: Number(entryAmount),
          same: Number(entrySame),
          calculatedPrize: entry.fullPrizeAmount * getPrizeMultiplier(entryAmount, entrySame),
          matchedAgainstNumber: matchedNumber,
          matchedEntryOwners: [ownedEntry.username].filter(Boolean),
          ownedEntryId: ownedEntry.id,
          ownedBy: ownedEntry.username || null
        }));
    });

    return res.json({
      matches,
      searchedNumber: number,
      resultForDate,
      sessionMode,
      message: matches.length > 0 ? 'Prize found' : 'No Price',
      resultType: matches.length > 0 ? 'matched' : 'no_price'
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { uploadPrice, updatePrizeResult, getPriceByCode, getAllPrices, getPrizeTracker, getBillPrizes, checkPrize, getMyPrizes };
