export const formatDisplayDate = (dateValue) => {
  if (!dateValue) {
    return '-';
  }

  const parsedDate = new Date(dateValue);
  const normalizedDate = Number.isNaN(parsedDate.getTime())
    ? new Date(`${dateValue}T00:00:00`)
    : parsedDate;

  if (Number.isNaN(normalizedDate.getTime())) {
    return '-';
  }

  return normalizedDate.toLocaleDateString('en-IN');
};

export const formatDisplayDateTime = (dateValue) => {
  if (!dateValue) {
    return '-';
  }

  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return '-';
  }

  return parsedDate.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

export const groupTransferHistoryByActor = (records) => records.reduce((groups, record) => {
  const actorName = record.actorUsername || 'Unknown Seller';
  if (!groups[actorName]) {
    groups[actorName] = [];
  }
  groups[actorName].push(record);
  return groups;
}, {});

export const summarizeTransferHistory = (records) => records.reduce((totals, record) => {
  const sem = Number(record.boxValue || 0);
  const piece = Number(record.amount || 0);

  totals.recordCount += 1;
  totals.totalSem += sem;
  totals.totalPiece += piece;
  totals.totalValue += sem * piece;
  return totals;
}, {
  recordCount: 0,
  totalSem: 0,
  totalPiece: 0,
  totalValue: 0
});

export const formatSignedRupees = (value) => {
  const numericValue = Number(value || 0);
  const prefix = numericValue < 0 ? '-' : '+';
  return `Rs. ${prefix}${Math.abs(numericValue).toFixed(2)}`;
};

const formatSignedNumber = (value) => {
  const numericValue = Number(value || 0);
  const prefix = numericValue < 0 ? '-' : '+';
  return `${prefix}${Math.abs(numericValue).toFixed(2)}`;
};

const isFifthPrizeRecord = (record) => {
  const prizeKey = String(record?.prizeKey || '').trim().toLowerCase();
  const prizeLabel = String(record?.prizeLabel || '').trim().toLowerCase();
  return prizeKey === 'fifth' || prizeLabel === '5th prize' || prizeLabel === 'fifth prize';
};

const normalizePrizeKey = (record) => {
  const prizeKey = String(record?.prizeKey || '').trim().toLowerCase();
  if (prizeKey) {
    return prizeKey;
  }

  const prizeLabel = String(record?.prizeLabel || '').trim().toLowerCase();
  if (prizeLabel === '1st prize' || prizeLabel === 'first prize') {
    return 'first';
  }
  if (prizeLabel === '2nd prize' || prizeLabel === 'second prize') {
    return 'second';
  }
  if (prizeLabel === '3rd prize' || prizeLabel === 'third prize') {
    return 'third';
  }
  if (prizeLabel === '4th prize' || prizeLabel === 'fourth prize') {
    return 'fourth';
  }
  if (prizeLabel === '5th prize' || prizeLabel === 'fifth prize') {
    return 'fifth';
  }

  return '';
};

const PRIZE_ADJUSTMENT_RULES = {
  first: { vc: 1000, svc: 200 },
  second: { vc: 1000, svc: 200 },
  third: { vc: 100, svc: 20 },
  fourth: { vc: 75, svc: 10 },
  fifth: { vc: 35, svc: 5 }
};

export const getNormalizedPrizeBaseAmount = (record) => {
  if (isFifthPrizeRecord(record)) {
    return 300;
  }

  return Number(record?.fullPrizeAmount || 0);
};

export const getNormalizedPrizeCalculatedAmount = (record) => {
  const normalizedBaseAmount = getNormalizedPrizeBaseAmount(record);
  const amount = Number(record?.amount || 0);
  const sem = Number(record?.sem ?? record?.boxValue ?? 0);

  if (normalizedBaseAmount > 0 && amount > 0 && sem > 0) {
    const multiplier = amount <= 7 ? 0.5 : 1;
    return normalizedBaseAmount * sem * multiplier;
  }

  if (isFifthPrizeRecord(record) && normalizedBaseAmount > 0) {
    return normalizedBaseAmount;
  }

  return Number(record?.calculatedPrize || 0);
};

export const getPrizeAdjustmentAmounts = (record) => {
  const prizeKey = normalizePrizeKey(record);
  const baseAdjustments = PRIZE_ADJUSTMENT_RULES[prizeKey];
  const amount = Number(record?.amount || 0);

  if (!baseAdjustments || amount <= 0) {
    return { prize: getNormalizedPrizeCalculatedAmount(record), vc: 0, svc: 0 };
  }

  const amountMultiplier = amount <= 7 ? 1 : 2;
  const semMultiplier = Number(record?.sem ?? record?.boxValue ?? 0) || 1;

  return {
    prize: getNormalizedPrizeCalculatedAmount(record),
    vc: baseAdjustments.vc * amountMultiplier * semMultiplier,
    svc: baseAdjustments.svc * amountMultiplier * semMultiplier
  };
};

export const getAllowedAmountsLabel = (sellerNode) => {
  const allowedAmounts = [];

  if (Number(sellerNode?.rateAmount6 || 0) > 0) {
    allowedAmounts.push('7');
  }

  if (Number(sellerNode?.rateAmount12 || 0) > 0) {
    allowedAmounts.push('12');
  }

  return allowedAmounts.length > 0 ? allowedAmounts.join(', ') : 'No Amount';
};

const createEmptyBillTotals = () => ({
  recordCount: 0,
  totalSentPiece: 0,
  totalUnsoldPiece: 0,
  totalSoldPiece: 0,
  totalPiece: 0,
  totalSales: 0,
  totalPrize: 0,
  totalVc: 0,
  totalSvc: 0,
  netBill: 0
});

const getSellerRateForAmount = (sellerNode, amount) => {
  if (!sellerNode) {
    return 0;
  }

  if (String(amount) === '7') {
    return Number(sellerNode.rateAmount6 || 0);
  }

  if (String(amount) === '12') {
    return Number(sellerNode.rateAmount12 || 0);
  }

  return 0;
};

const flattenSellerTree = (node, directRootUsername = null, usernameMap = new Map()) => {
  if (!node) {
    return usernameMap;
  }

  const nextDirectRootUsername = directRootUsername || node.username;
  usernameMap.set(node.username, {
    ...node,
    directRootUsername: nextDirectRootUsername
  });

  (node.children || []).forEach((child) => {
    flattenSellerTree(child, nextDirectRootUsername, usernameMap);
  });

  return usernameMap;
};

const PURCHASE_BILLABLE_ACTION_TYPES = new Set([
  'purchase_sent',
  'purchase_forwarded',
  'purchase_assigned',
  'purchase_memo_updated',
  'purchase_forward_memo_updated',
  'purchase_self_memo_created',
  'marked_unsold',
  'unsold_accepted',
  'unsold_auto_accepted'
]);

const PURCHASE_UNSOLD_BILL_ACTION_TYPES = new Set(['marked_unsold', 'unsold_accepted', 'unsold_auto_accepted']);

export const summarizeBillRecords = (records = []) => records.reduce((totals, record) => {
  totals.recordCount += 1;
  totals.totalSentPiece += Number(record.sentPiece || 0);
  totals.totalUnsoldPiece += Number(record.unsoldPiece || 0);
  totals.totalSoldPiece += Number(record.soldPiece || 0);
  totals.totalPiece += Number(record.soldPiece || 0);
  totals.totalSales += Number(record.billValue || 0);
  return totals;
}, createEmptyBillTotals());

export const summarizeBillRecordsByAmount = (records = []) => records.reduce((groups, record) => {
  const amountKey = String(record.amount || '').trim() || 'Unknown';

  if (!groups[amountKey]) {
    groups[amountKey] = createEmptyBillTotals();
  }

  groups[amountKey].recordCount += 1;
  groups[amountKey].totalSentPiece += Number(record.sentPiece || 0);
  groups[amountKey].totalUnsoldPiece += Number(record.unsoldPiece || 0);
  groups[amountKey].totalSoldPiece += Number(record.soldPiece || 0);
  groups[amountKey].totalPiece += Number(record.soldPiece || 0);
  groups[amountKey].totalSales += Number(record.billValue || 0);
  return groups;
}, {});

export const groupBillRecordsByRoot = (records = []) => records.reduce((groups, record) => {
  const rootName = record.billRootUsername || record.actorUsername || 'Unknown Seller';
  if (!groups[rootName]) {
    groups[rootName] = [];
  }
  groups[rootName].push(record);
  return groups;
}, {});

const applyAdjustmentsToBillSummary = (totals, adjustments = {}) => ({
  ...totals,
  totalPrize: Number(adjustments.totalPrize || 0),
  totalVc: Number(adjustments.totalVc || 0),
  totalSvc: Number(adjustments.totalSvc || 0),
  netBill: Number(totals.totalSales || 0)
    - Number(adjustments.totalPrize || 0)
    - Number(adjustments.totalVc || 0)
    - Number(adjustments.totalSvc || 0)
});

export const buildBillSummaryWithPrize = (records = [], adjustments = {}) => (
  applyAdjustmentsToBillSummary(summarizeBillRecords(records), adjustments)
);

export const buildBillAmountSummariesWithPrize = (records = [], adjustmentTotalsByAmount = {}) => {
  const amountSummaries = summarizeBillRecordsByAmount(records);

  return Object.entries(amountSummaries).reduce((accumulator, [amountKey, amountTotals]) => {
    accumulator[amountKey] = applyAdjustmentsToBillSummary(amountTotals, adjustmentTotalsByAmount[amountKey] || {});
    return accumulator;
  }, {});
};

export const buildBillData = ({ records = [], prizeRecords = [], treeData, selectedSellerUsername = '' }) => {
  const directChildSellers = (treeData?.children || []).filter((node) => node.role === 'seller');

  if (directChildSellers.length === 0) {
    return {
      records: [],
      groupedRecords: {},
      groupedAmountSummaries: {},
      rootSellerMeta: {},
      totals: createEmptyBillTotals()
    };
  }

  const selectedRootSet = new Set(
    (selectedSellerUsername
      ? directChildSellers.filter((node) => node.username === selectedSellerUsername)
      : directChildSellers
    ).map((node) => node.username)
  );

  const usernameMap = directChildSellers.reduce((accumulator, directChild) => (
    flattenSellerTree(directChild, directChild.username, accumulator)
  ), new Map());

  const movementRows = records
    .filter((record) => PURCHASE_BILLABLE_ACTION_TYPES.has(String(record.actionType || '').trim().toLowerCase()))
    .map((record) => {
      const normalizedActionType = String(record.actionType || '').trim().toLowerCase();
      const billedUsername = PURCHASE_UNSOLD_BILL_ACTION_TYPES.has(normalizedActionType)
        ? record.actorUsername
        : (record.toUsername || record.actorUsername);
      const billedNode = usernameMap.get(billedUsername);

      if (!billedNode || !selectedRootSet.has(billedNode.directRootUsername)) {
        return null;
      }

      return {
        ...record,
        billedUsername,
        billedNode,
        billRootUsername: billedNode.directRootUsername,
        billSellerDisplayName: billedNode.directRootUsername,
        rateOwnerUsername: billedNode.username,
        pieceCount: Number(record.boxValue || 0)
      };
    })
    .filter(Boolean);

  const aggregatedBillRecords = Object.values(movementRows.reduce((accumulator, record) => {
    const appliedRate = getSellerRateForAmount(record.billedNode, record.amount);
    const aggregationKey = [
      record.billRootUsername,
      record.billedUsername,
      record.sessionMode,
      record.amount,
      record.boxValue,
      appliedRate,
      record.purchaseCategory || ''
    ].join('|');

    if (!accumulator[aggregationKey]) {
      accumulator[aggregationKey] = {
        id: aggregationKey,
        actorUsername: record.billedUsername,
        billSellerDisplayName: record.billSellerDisplayName,
        billRootUsername: record.billRootUsername,
        rateOwnerUsername: record.rateOwnerUsername,
        fromUsername: record.fromUsername,
        toUsername: record.toUsername,
        uniqueCode: '',
        sessionMode: record.sessionMode,
        purchaseCategory: record.purchaseCategory || '',
        amount: record.amount,
        boxValue: record.boxValue,
        statusAfter: record.statusAfter,
        createdAt: record.createdAt,
        actionType: 'purchase_bill',
        sentPiece: 0,
        unsoldPiece: 0,
        soldPiece: 0,
        appliedRate,
        billValue: 0,
        numbers: []
      };
    }

    if (PURCHASE_UNSOLD_BILL_ACTION_TYPES.has(String(record.actionType || '').trim().toLowerCase())) {
      accumulator[aggregationKey].unsoldPiece += Number(record.pieceCount || 0);
    } else {
      accumulator[aggregationKey].sentPiece += Number(record.pieceCount || 0);
    }

    if (record.number) {
      accumulator[aggregationKey].numbers.push(record.number);
    }

    if (new Date(record.createdAt || 0).getTime() > new Date(accumulator[aggregationKey].createdAt || 0).getTime()) {
      accumulator[aggregationKey].createdAt = record.createdAt;
    }

    return accumulator;
  }, {})).map((record) => {
    const sentPiece = Number(record.sentPiece || 0);
    const unsoldPiece = Number(record.unsoldPiece || 0);
    const soldPiece = Math.max(sentPiece - unsoldPiece, 0);

    return {
      ...record,
      sentPiece,
      unsoldPiece,
      soldPiece,
      totalPiece: soldPiece,
      billValue: soldPiece * Number(record.appliedRate || 0),
      numberRangeLabel: record.numbers.length > 0
        ? record.numbers.sort((left, right) => Number(left) - Number(right))[0] === record.numbers.sort((left, right) => Number(left) - Number(right))[record.numbers.length - 1]
          ? record.numbers[0]
          : `${record.numbers.sort((left, right) => Number(left) - Number(right))[0]} to ${record.numbers.sort((left, right) => Number(left) - Number(right))[record.numbers.length - 1]}`
        : '-'
    };
  }).filter((record) => Number(record.sentPiece || 0) > 0 || Number(record.unsoldPiece || 0) > 0);

  const groupedRecords = groupBillRecordsByRoot(aggregatedBillRecords);
  const baseTotals = summarizeBillRecords(aggregatedBillRecords);
  const adjustmentTotalsByRoot = prizeRecords.reduce((accumulator, record) => {
    const actorNode = usernameMap.get(record.sellerUsername);

    if (!actorNode || !selectedRootSet.has(actorNode.directRootUsername)) {
      return accumulator;
    }

    const rootName = actorNode.directRootUsername;
    const prizeAdjustments = getPrizeAdjustmentAmounts(record);

    if (!accumulator[rootName]) {
      accumulator[rootName] = { totalPrize: 0, totalVc: 0, totalSvc: 0 };
    }

    accumulator[rootName].totalPrize += prizeAdjustments.prize;
    accumulator[rootName].totalVc += prizeAdjustments.vc;
    accumulator[rootName].totalSvc += prizeAdjustments.svc;
    return accumulator;
  }, {});
  const adjustmentTotalsByRootAndAmount = prizeRecords.reduce((accumulator, record) => {
    const actorNode = usernameMap.get(record.sellerUsername);

    if (!actorNode || !selectedRootSet.has(actorNode.directRootUsername)) {
      return accumulator;
    }

    const rootName = actorNode.directRootUsername;
    const amountKey = String(record.amount || '').trim() || 'Unknown';

    if (!accumulator[rootName]) {
      accumulator[rootName] = {};
    }

    if (!accumulator[rootName][amountKey]) {
      accumulator[rootName][amountKey] = { totalPrize: 0, totalVc: 0, totalSvc: 0 };
    }

    const prizeAdjustments = getPrizeAdjustmentAmounts(record);
    accumulator[rootName][amountKey].totalPrize += prizeAdjustments.prize;
    accumulator[rootName][amountKey].totalVc += prizeAdjustments.vc;
    accumulator[rootName][amountKey].totalSvc += prizeAdjustments.svc;
    return accumulator;
  }, {});
  const groupedSummaries = Object.entries(groupedRecords).reduce((accumulator, [rootName, rootRecords]) => {
    accumulator[rootName] = buildBillSummaryWithPrize(rootRecords, adjustmentTotalsByRoot[rootName] || {});
    return accumulator;
  }, {});
  const groupedAmountSummaries = Object.entries(groupedRecords).reduce((accumulator, [rootName, rootRecords]) => {
    accumulator[rootName] = buildBillAmountSummariesWithPrize(rootRecords, adjustmentTotalsByRootAndAmount[rootName] || {});
    return accumulator;
  }, {});
  const rootSellerMeta = directChildSellers.reduce((accumulator, node) => {
    accumulator[node.username] = {
      username: node.username,
      allowedAmountsLabel: getAllowedAmountsLabel(node)
    };
    return accumulator;
  }, {});
  const totalAdjustments = Object.values(adjustmentTotalsByRoot).reduce((totals, value) => ({
    totalPrize: totals.totalPrize + Number(value?.totalPrize || 0),
    totalVc: totals.totalVc + Number(value?.totalVc || 0),
    totalSvc: totals.totalSvc + Number(value?.totalSvc || 0)
  }), { totalPrize: 0, totalVc: 0, totalSvc: 0 });

  return {
    records: aggregatedBillRecords,
    groupedRecords,
    groupedSummaries,
    groupedAmountSummaries,
    prizeTotalsByRoot: adjustmentTotalsByRoot,
    prizeTotalsByRootAndAmount: adjustmentTotalsByRootAndAmount,
    rootSellerMeta,
    totals: applyAdjustmentsToBillSummary(baseTotals, totalAdjustments)
  };
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const openTransferBill = ({
  groupedRecords,
  groupedSummaries = {},
  groupedAmountSummaries = {},
  rootSellerMeta = {},
  totals,
  username,
  sessionMode,
  periodLabel,
  shiftLabel,
  title = 'Transfer Bill'
}) => {
  const billWindow = window.open('', '_blank', 'width=1200,height=800');
  if (!billWindow) {
    return false;
  }

  const sellerSummaryRows = Object.entries(groupedSummaries)
    .sort((left, right) => String(left[0] || '').localeCompare(String(right[0] || '')))
    .map(([billName, billTotals]) => {
      const sellerMetaLabel = rootSellerMeta[billName]?.allowedAmountsLabel
        ? ` (${rootSellerMeta[billName].allowedAmountsLabel})`
        : '';

      return `
        <tr>
          <td>${escapeHtml(`${billName}${sellerMetaLabel}`)}</td>
          <td>${Number(billTotals.totalSentPiece || 0).toFixed(2)}</td>
          <td>${Number(billTotals.totalUnsoldPiece || 0).toFixed(2)}</td>
          <td>${(Number(billTotals.totalSentPiece || 0) > 0 ? ((Number(billTotals.totalUnsoldPiece || 0) / Number(billTotals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}%</td>
          <td>${Number(billTotals.totalSoldPiece || 0).toFixed(2)}</td>
          <td>${(Number(billTotals.totalSentPiece || 0) > 0 ? ((Number(billTotals.totalSoldPiece || 0) / Number(billTotals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}%</td>
          <td>${Number(billTotals.totalSales || 0).toFixed(2)}</td>
          <td>${Number(billTotals.totalPrize || 0).toFixed(2)}</td>
          <td>${Number(billTotals.totalVc || 0).toFixed(2)}</td>
          <td>${Number(billTotals.totalSvc || 0).toFixed(2)}</td>
          <td>${formatSignedNumber(billTotals.netBill)}</td>
        </tr>
      `;
    }).join('');
  const sellerTotalsTableHtml = `
    <section style="margin-top:24px;">
      <h3 style="margin:0 0 10px;">Seller Totals</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr>
            <th>Seller</th>
            <th>Purchase</th>
            <th>Unsold</th>
            <th>Unsold %</th>
            <th>Sold</th>
            <th>Sold %</th>
            <th>Sales</th>
            <th>Prize</th>
            <th>VC</th>
            <th>SVC</th>
            <th>Net Bill</th>
          </tr>
        </thead>
        <tbody>${sellerSummaryRows}</tbody>
      </table>
    </section>
  `;

  billWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(title)} - ${escapeHtml(username)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
          h1, h2, h3 { margin: 0; }
          table, th, td { border: 1px solid #cbd5e1; }
          th, td { padding: 8px; text-align: left; }
          th { background: #eef2ff; }
          @media print {
            body { margin: 12px; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        ${sellerTotalsTableHtml}
        <div style="margin-top:24px;padding:18px 22px;border:1px solid #cbd5e1;border-radius:16px;background:#eef2ff;font-size:20px;line-height:1.45;">
          <strong>Grand Total:</strong>
          Unsold % ${(Number(totals.totalSentPiece || 0) > 0 ? ((Number(totals.totalUnsoldPiece || 0) / Number(totals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}% |
          Sold % ${(Number(totals.totalSentPiece || 0) > 0 ? ((Number(totals.totalSoldPiece || 0) / Number(totals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}% |
          Net ${formatSignedRupees(totals.netBill)}
        </div>
        <script>
          window.onload = function () {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  billWindow.document.close();
  return true;
};
