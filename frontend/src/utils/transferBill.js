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
    const multiplier = amount <= 6 ? 0.5 : 1;
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

  const amountMultiplier = amount <= 6 ? 1 : 2;

  return {
    prize: getNormalizedPrizeCalculatedAmount(record),
    vc: baseAdjustments.vc * amountMultiplier,
    svc: baseAdjustments.svc * amountMultiplier
  };
};

export const getAllowedAmountsLabel = (sellerNode) => {
  const allowedAmounts = [];

  if (Number(sellerNode?.rateAmount6 || 0) > 0) {
    allowedAmounts.push('6');
  }

  if (Number(sellerNode?.rateAmount12 || 0) > 0) {
    allowedAmounts.push('12');
  }

  return allowedAmounts.length > 0 ? allowedAmounts.join(', ') : 'No Amount';
};

const createEmptyBillTotals = () => ({
  recordCount: 0,
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

  if (String(amount) === '6') {
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

const BILLABLE_ACTION_TYPES = new Set(['sent', 'forwarded', 'queued', 'queue_forwarded']);

export const summarizeBillRecords = (records = []) => records.reduce((totals, record) => {
  totals.recordCount += 1;
  totals.totalPiece += Number(record.pieceCount || 0);
  totals.totalSales += Number(record.billValue || 0);
  return totals;
}, createEmptyBillTotals());

export const summarizeBillRecordsByAmount = (records = []) => records.reduce((groups, record) => {
  const amountKey = String(record.amount || '').trim() || 'Unknown';

  if (!groups[amountKey]) {
    groups[amountKey] = createEmptyBillTotals();
  }

  groups[amountKey].recordCount += 1;
  groups[amountKey].totalPiece += Number(record.pieceCount || 0);
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

  const billRecords = records
    .filter((record) => BILLABLE_ACTION_TYPES.has(String(record.actionType || '').trim().toLowerCase()))
    .map((record) => {
      const actorNode = usernameMap.get(record.actorUsername);

      if (!actorNode || !selectedRootSet.has(actorNode.directRootUsername)) {
        return null;
      }

      const pieceCount = Number(record.boxValue || 0);
      const appliedRate = getSellerRateForAmount(actorNode, record.amount);
      const billValue = pieceCount * appliedRate;

      return {
        ...record,
        pieceCount,
        appliedRate,
        billValue,
        billRootUsername: actorNode.directRootUsername,
        billSellerDisplayName: actorNode.directRootUsername,
        rateOwnerUsername: actorNode.username
      };
    })
    .filter(Boolean);

  const latestBillRecordByEntryId = billRecords.reduce((accumulator, record) => {
    const entryKey = String(record.entryId || '').trim();

    if (!entryKey) {
      return accumulator;
    }

    const existing = accumulator.get(entryKey);

    if (!existing) {
      accumulator.set(entryKey, record);
      return accumulator;
    }

    const existingTime = new Date(existing.createdAt || 0).getTime();
    const currentTime = new Date(record.createdAt || 0).getTime();

    if (currentTime > existingTime || (currentTime === existingTime && Number(record.id || 0) > Number(existing.id || 0))) {
      accumulator.set(entryKey, record);
    }

    return accumulator;
  }, new Map());

  const groupedRecords = groupBillRecordsByRoot(billRecords);
  const baseTotals = summarizeBillRecords(billRecords);
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
  const prizeDisplayByBillRecordId = prizeRecords.reduce((accumulator, record) => {
    const actorNode = usernameMap.get(record.sellerUsername);
    const entryKey = String(record.entryId || '').trim();

    if (!actorNode || !selectedRootSet.has(actorNode.directRootUsername) || !entryKey) {
      return accumulator;
    }

    const latestBillRecord = latestBillRecordByEntryId.get(entryKey);

    if (!latestBillRecord) {
      return accumulator;
    }

    const billRecordId = String(latestBillRecord.id);
    const prizeAdjustments = getPrizeAdjustmentAmounts(record);

    if (!accumulator[billRecordId]) {
      accumulator[billRecordId] = { prize: 0, vc: 0, svc: 0 };
    }

    accumulator[billRecordId].prize += prizeAdjustments.prize;
    accumulator[billRecordId].vc += prizeAdjustments.vc;
    accumulator[billRecordId].svc += prizeAdjustments.svc;
    return accumulator;
  }, {});
  const billRecordsWithAdjustments = billRecords.map((record) => {
    const displayAdjustments = prizeDisplayByBillRecordId[String(record.id)] || { prize: 0, vc: 0, svc: 0 };

    return {
      ...record,
      displayPrize: displayAdjustments.prize,
      displayVc: displayAdjustments.vc,
      displaySvc: displayAdjustments.svc
    };
  });
  const groupedRecordsWithAdjustments = groupBillRecordsByRoot(billRecordsWithAdjustments);
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
    records: billRecordsWithAdjustments,
    groupedRecords: groupedRecordsWithAdjustments,
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

  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0;">
      <div style="border:1px solid #d7defa;border-radius:12px;padding:12px;background:#f8faff;min-width:0;"><strong>Total Records</strong><br/><span style="display:block;word-break:break-word;">${totals.recordCount}</span></div>
      <div style="border:1px solid #d7defa;border-radius:12px;padding:12px;background:#f8faff;min-width:0;"><strong>Total Piece</strong><br/><span style="display:block;word-break:break-word;">${totals.totalPiece.toFixed(2)}</span></div>
      <div style="border:1px solid #d7defa;border-radius:12px;padding:12px;background:#f8faff;min-width:0;"><strong>Total Sales</strong><br/><span style="display:block;word-break:break-word;">Rs. ${totals.totalSales.toFixed(2)}</span></div>
      <div style="border:1px solid #d7defa;border-radius:12px;padding:12px;background:#f8faff;min-width:0;"><strong>Total Prize</strong><br/><span style="display:block;word-break:break-word;">Rs. ${totals.totalPrize.toFixed(2)}</span></div>
      <div style="border:1px solid #d7defa;border-radius:12px;padding:12px;background:#f8faff;min-width:0;"><strong>Total VC</strong><br/><span style="display:block;word-break:break-word;">Rs. ${Number(totals.totalVc || 0).toFixed(2)}</span></div>
      <div style="border:1px solid #d7defa;border-radius:12px;padding:12px;background:#f8faff;min-width:0;"><strong>Total SVC</strong><br/><span style="display:block;word-break:break-word;">Rs. ${Number(totals.totalSvc || 0).toFixed(2)}</span></div>
      <div style="border:1px solid #d7defa;border-radius:12px;padding:12px;background:#f8faff;min-width:0;"><strong>Net Bill</strong><br/><span style="display:block;word-break:break-word;">${formatSignedRupees(totals.netBill)}</span></div>
    </div>
  `;

  const actorSectionsHtml = Object.entries(groupedRecords).map(([billName, billRecords]) => {
    const billTotals = groupedSummaries[billName] || summarizeBillRecords(billRecords);
    const amountBreakdown = groupedAmountSummaries[billName] || {};
    const amountBreakdownHtml = Object.keys(amountBreakdown)
      .sort((left, right) => Number(left) - Number(right))
      .map((amountKey) => {
        const amountTotals = amountBreakdown[amountKey];

        return `
          <div style="margin-top:8px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;font-size:13px;">
            <strong>Amount ${escapeHtml(amountKey)} Bill:</strong>
            Records ${amountTotals.recordCount} |
            Piece ${amountTotals.totalPiece.toFixed(2)} |
            Sales Rs. ${amountTotals.totalSales.toFixed(2)} |
            Prize Rs. ${amountTotals.totalPrize.toFixed(2)} |
            VC Rs. ${Number(amountTotals.totalVc || 0).toFixed(2)} |
            SVC Rs. ${Number(amountTotals.totalSvc || 0).toFixed(2)} |
            Net ${formatSignedRupees(amountTotals.netBill)}
          </div>
        `;
      }).join('');
    const sellerMetaLabel = rootSellerMeta[billName]?.allowedAmountsLabel
      ? ` (${rootSellerMeta[billName].allowedAmountsLabel})`
      : '';

    const aggregatedRows = Object.values(billRecords.reduce((accumulator, record) => {
      const session = String(record.sessionMode ?? '').trim();
      const amount = String(record.amount ?? '').trim();
      const sem = String(record.boxValue ?? '').trim();
      const rate = Number(record.appliedRate || 0);
      const key = [session, amount, sem, rate].join('|');

      if (!accumulator[key]) {
        accumulator[key] = {
          session,
          amount,
          sem,
          rate,
          totalPiece: 0,
          totalBill: 0
        };
      }

      accumulator[key].totalPiece += Number(record.pieceCount || 0);
      accumulator[key].totalBill += Number(record.billValue || 0);
      return accumulator;
    }, {})).sort((left, right) => {
      const sessionComparison = String(left.session || '').localeCompare(String(right.session || ''));
      if (sessionComparison !== 0) {
        return sessionComparison;
      }

      const amountDiff = Number(left.amount || 0) - Number(right.amount || 0);
      if (amountDiff !== 0) {
        return amountDiff;
      }

      const semDiff = Number(left.sem || 0) - Number(right.sem || 0);
      if (semDiff !== 0) {
        return semDiff;
      }

      return Number(left.rate || 0) - Number(right.rate || 0);
    });
    const rowsHtml = aggregatedRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.session || '-')}</td>
        <td>${escapeHtml(row.amount)}</td>
        <td>${escapeHtml(row.sem)}</td>
        <td>${escapeHtml(row.totalPiece)}</td>
        <td>${escapeHtml(row.rate)}</td>
        <td>Rs. ${Number(row.totalBill || 0).toFixed(2)}</td>
      </tr>
    `).join('');

    return `
      <section style="margin-top:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
          <h3 style="margin:0;">${escapeHtml(billName)}${escapeHtml(sellerMetaLabel)}</h3>
          <div style="font-size:14px;color:#4a5568;">
            Records: ${billRecords.length} | Piece: ${billTotals.totalPiece.toFixed(2)} | Sales: Rs. ${billTotals.totalSales.toFixed(2)} | Prize: Rs. ${billTotals.totalPrize.toFixed(2)} | Total VC: Rs. ${Number(billTotals.totalVc || 0).toFixed(2)} | Total SVC: Rs. ${Number(billTotals.totalSvc || 0).toFixed(2)} | Net: ${formatSignedRupees(billTotals.netBill)}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr>
              <th>Session</th>
              <th>Amount</th>
              <th>SEM</th>
              <th>Piece</th>
              <th>Rate</th>
              <th>Bill</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div style="margin-top:10px;padding:12px 14px;border:1px solid #d7defa;border-radius:12px;background:#f8faff;font-size:14px;">
          <strong>${escapeHtml(billName)} Total:</strong>
          Records ${billTotals.recordCount} |
          Piece ${billTotals.totalPiece.toFixed(2)} |
          Sales Rs. ${billTotals.totalSales.toFixed(2)} |
          Prize Rs. ${billTotals.totalPrize.toFixed(2)} |
          Total VC Rs. ${Number(billTotals.totalVc || 0).toFixed(2)} |
          Total SVC Rs. ${Number(billTotals.totalSvc || 0).toFixed(2)} |
          Net ${formatSignedRupees(billTotals.netBill)}
        </div>
        ${amountBreakdownHtml}
      </section>
    `;
  }).join('');

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
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p style="margin:8px 0 0;">User: ${escapeHtml(username)}</p>
            ${sessionMode ? `<p style="margin:4px 0 0;">Session: ${escapeHtml(sessionMode)}</p>` : ''}
            <p style="margin:4px 0 0;">Period: ${escapeHtml(periodLabel)}</p>
            <p style="margin:4px 0 0;">Shift: ${escapeHtml(shiftLabel)}</p>
          </div>
          <div style="text-align:right;">
            <p style="margin:0;">Generated: ${escapeHtml(new Date().toLocaleString('en-IN'))}</p>
          </div>
        </div>
        ${summaryHtml}
        ${actorSectionsHtml}
        <div style="margin-top:24px;padding:14px 16px;border:1px solid #cbd5e1;border-radius:14px;background:#eef2ff;font-size:15px;">
          <strong>Grand Total:</strong>
          Total Records ${totals.recordCount} |
          Total Piece ${totals.totalPiece.toFixed(2)} |
          Total Sales Rs. ${totals.totalSales.toFixed(2)} |
          Total Prize Rs. ${totals.totalPrize.toFixed(2)} |
          Total VC Rs. ${Number(totals.totalVc || 0).toFixed(2)} |
          Total SVC Rs. ${Number(totals.totalSvc || 0).toFixed(2)} |
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
