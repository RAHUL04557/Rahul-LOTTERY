const { query } = require('../config/database');

const PURCHASE_ENTRY_SOURCE = 'purchase';
const ADMIN_PURCHASE_ENTRY_SOURCE = 'admin_purchase';
const DEFAULT_BOOTSTRAP_DAYS = 365;
const MAX_BOOTSTRAP_DAYS = 730;

const PRIZE_CONFIG = {
  first: { label: 'First Prize', fullPrizeAmount: 25000, digitLength: 5 },
  second: { label: 'Second Prize', fullPrizeAmount: 20000, digitLength: 5 },
  third: { label: 'Third Prize', fullPrizeAmount: 2000, digitLength: 4 },
  fourth: { label: 'Fourth Prize', fullPrizeAmount: 700, digitLength: 4 },
  fifth: { label: 'Fifth Prize', fullPrizeAmount: 300, digitLength: 4 }
};

const normalizeBootstrapDays = (value) => {
  const days = Number(value || DEFAULT_BOOTSTRAP_DAYS);
  if (!Number.isFinite(days) || days <= 0) {
    return DEFAULT_BOOTSTRAP_DAYS;
  }

  return Math.min(Math.floor(days), MAX_BOOTSTRAP_DAYS);
};

const normalizeSince = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
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
  entrySource: row.entry_source || PURCHASE_ENTRY_SOURCE,
  memoNumber: row.memo_number,
  purchaseMemoNumber: row.purchase_memo_number || row.memo_number,
  purchaseCategory: row.purchase_category,
  sentToParent: row.sent_to_parent,
  bookingDate: row.booking_date,
  createdAt: row.created_at,
  sentAt: row.sent_at
});

const mapUser = (row) => ({
  id: row.id,
  username: row.username,
  keyword: row.keyword || '',
  role: row.role,
  sellerType: row.seller_type || row.role,
  parentId: row.parent_id,
  ownerAdminId: row.owner_admin_id,
  rateAmount6: Number(row.rate_amount_6 || 0),
  rateAmount12: Number(row.rate_amount_12 || 0)
});

const mapPrizeResult = (row) => {
  const config = PRIZE_CONFIG[String(row.prize_key || '').trim().toLowerCase()] || {
    label: row.prize_label,
    fullPrizeAmount: Number(row.prize_amount || 0),
    digitLength: Number(row.digit_length || 0)
  };
  const purchaseCategory = row.purchase_category || (row.session_mode === 'NIGHT' ? 'E' : 'M');

  return {
    id: row.id,
    prizeKey: row.prize_key,
    prizeLabel: config.label,
    fullPrizeAmount: config.fullPrizeAmount,
    digitLength: config.digitLength,
    winningNumber: row.winning_number,
    sessionMode: row.session_mode,
    purchaseCategory,
    resultShift: purchaseCategory === 'D' ? 'DAY' : purchaseCategory === 'E' ? 'EVENING' : 'MORNING',
    resultForDate: row.result_for_date,
    uploadedBy: row.uploaded_by,
    resultDate: row.result_date,
    createdAt: row.created_at
  };
};

const getPrizeOwnerId = (user) => (
  user?.role === 'admin'
    ? user.id
    : user?.ownerAdminId || user?.parentId || user?.id
);

const bootstrapLocalData = async (req, res) => {
  const days = normalizeBootstrapDays(req.query.days);
  const since = normalizeSince(req.query.since);

  const usersResult = await query(
    `
      WITH RECURSIVE visible_users AS (
        SELECT id, username, keyword, role, seller_type, parent_id, owner_admin_id, rate_amount_6, rate_amount_12
        FROM users
        WHERE id = $1
        UNION ALL
        SELECT u.id, u.username, u.keyword, u.role, u.seller_type, u.parent_id, u.owner_admin_id, u.rate_amount_6, u.rate_amount_12
        FROM users u
        INNER JOIN visible_users vu ON u.parent_id = vu.id
      )
      SELECT *
      FROM visible_users
      ORDER BY username ASC
    `,
    [req.user.id]
  );

  const visibleUserIds = usersResult.rows.map((row) => row.id);

  if (visibleUserIds.length === 0) {
    return res.json({
      serverTime: new Date().toISOString(),
      days,
      purchases: [],
      users: []
    });
  }

  const purchaseParams = [[PURCHASE_ENTRY_SOURCE, ADMIN_PURCHASE_ENTRY_SOURCE], days, visibleUserIds];
  const incrementalFilter = since
    ? `AND COALESCE(le.sent_at, le.created_at) > $${purchaseParams.push(since)}::timestamp`
    : '';

  const purchasesResult = await query(
    `
      SELECT
        le.*,
        u.username,
        parent_user.username AS parent_username,
        forwarded_user.username AS forwarded_by_username
      FROM lottery_entries le
      LEFT JOIN users u ON u.id = le.user_id
      LEFT JOIN users parent_user ON parent_user.id = le.sent_to_parent
      LEFT JOIN users forwarded_user ON forwarded_user.id = le.forwarded_by
      WHERE le.entry_source = ANY($1::varchar[])
        AND le.booking_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 day'))
        ${incrementalFilter}
        AND (
          le.user_id = ANY($3::int[])
          OR le.forwarded_by = ANY($3::int[])
          OR le.sent_to_parent = ANY($3::int[])
        )
      ORDER BY le.booking_date DESC, le.created_at DESC, le.id DESC
    `,
    purchaseParams
  );

  const prizeOwnerId = getPrizeOwnerId(req.user);
  const prizeParams = [prizeOwnerId, days];
  const prizeIncrementalFilter = since
    ? `AND COALESCE(pr.result_date, pr.created_at) > $${prizeParams.push(since)}::timestamp`
    : '';
  const prizeResults = await query(
    `
      SELECT *
      FROM prize_results pr
      WHERE pr.uploaded_by = $1
        AND pr.result_for_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 day'))
        ${prizeIncrementalFilter}
      ORDER BY pr.result_for_date DESC, pr.session_mode ASC, pr.prize_amount DESC, pr.created_at DESC
    `,
    prizeParams
  );

  res.json({
    serverTime: new Date().toISOString(),
    days,
    since,
    purchases: purchasesResult.rows.map(mapLotteryEntry),
    prizeResults: prizeResults.rows.map(mapPrizeResult),
    users: usersResult.rows.map(mapUser)
  });
};

module.exports = {
  bootstrapLocalData
};
