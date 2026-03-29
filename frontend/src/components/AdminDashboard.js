import React, { useState, useEffect } from 'react';
import { lotteryService, priceService, userService } from '../services/api';
import UserTreeView from './UserTreeView';
import EntriesTableView from './EntriesTableView';
import PasswordSettingsMenu from './PasswordSettingsMenu';
import { buildBillAmountSummariesWithPrize, buildBillData, buildBillSummaryWithPrize, formatDisplayDate, formatDisplayDateTime, formatSignedRupees, getAllowedAmountsLabel, getNormalizedPrizeBaseAmount, getNormalizedPrizeCalculatedAmount, groupTransferHistoryByActor, openTransferBill, summarizeTransferHistory } from '../utils/transferBill';
import { groupConsecutiveNumberRows, sortRowsForConsecutiveNumbers } from '../utils/numberRanges';
import '../styles/AdminDashboard.css';

const getTodayDateValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const AMOUNT_OPTIONS = ['6', '12'];
const PRIZE_OPTIONS = [
  { key: 'first', title: '1st Prize', amountLabel: '25000', amountValue: 25000, digitLength: 5 },
  { key: 'second', title: '2nd Prize', amountLabel: '20000', amountValue: 20000, digitLength: 5 },
  { key: 'third', title: '3rd Prize', amountLabel: '2000', amountValue: 2000, digitLength: 4 },
  { key: 'fourth', title: '4th Prize', amountLabel: '700', amountValue: 700, digitLength: 4 },
  { key: 'fifth', title: '5th Prize', amountLabel: '300', amountValue: 300, digitLength: 4 }
];
const RESULT_SESSION_OPTIONS = ['MORNING', 'NIGHT'];

const getAvailableSemOptions = (selectedAmount) => {
  if (selectedAmount === '6') {
    return ['5', '10', '25'];
  }
  if (selectedAmount === '12') {
    return ['5', '10', '15', '20'];
  }
  return [];
};

const mapTraceRecord = (record) => ({
  id: record.id,
  uniqueCode: record.uniqueCode,
  number: record.number,
  boxValue: record.boxValue,
  amount: String(record.amount),
  bookedBy: record.bookedBy,
  sentTo: record.sentTo,
  currentHolder: record.currentHolder,
  forwardedBy: record.forwardedBy,
  status: record.status,
  sessionMode: record.sessionMode,
  createdAt: record.createdAt,
  sentAt: record.sentAt
});

const mapApiEntry = (entry) => ({
  id: entry.id,
  username: entry.username,
  displaySeller: entry.forwardedByUsername || entry.username,
  uniqueCode: entry.uniqueCode,
  sem: entry.boxValue,
  amount: String(entry.amount),
  number: entry.number,
  price: Number(entry.boxValue || 0) * Number(entry.amount || 0),
  bookingDate: entry.bookingDate || entry.booking_date || null,
  sessionMode: entry.sessionMode,
  createdAt: entry.createdAt,
  sentAt: entry.sentAt,
  status: entry.status
});

const mapHistoryRecord = (record) => ({
  id: record.id,
  entryId: record.entryId || record.entry_id,
  uniqueCode: record.uniqueCode || record.unique_code,
  number: record.number,
  boxValue: record.boxValue || record.box_value,
  amount: String(record.amount),
  bookingDate: record.bookingDate || record.booking_date || null,
  fromUsername: record.fromUsername || record.from_username,
  toUsername: record.toUsername || record.to_username,
  actorUsername: record.actorUsername || record.actor_username,
  actionType: record.actionType || record.action_type,
  statusAfter: record.statusAfter || record.status_after,
  sessionMode: record.sessionMode || record.session_mode,
  createdAt: record.createdAt || record.created_at
});

const splitEntriesByAmount = (entries = []) => ({
  amount6: entries.filter((entry) => String(entry.amount) === '6'),
  amount12: entries.filter((entry) => String(entry.amount) === '12')
});

const buildDirectSellerLookup = (treeRoot) => {
  const directChildren = (treeRoot?.children || []).filter((node) => node.role === 'seller');
  const lookup = new Map();

  const visit = (node, rootUsername) => {
    if (!node) {
      return;
    }

    lookup.set(String(node.username || '').trim(), rootUsername);
    (node.children || []).forEach((child) => visit(child, rootUsername));
  };

  directChildren.forEach((child) => visit(child, child.username));
  return lookup;
};

const normalizePrizeTrackerRowsForAdmin = (rows = [], treeRoot) => {
  const directSellerLookup = buildDirectSellerLookup(treeRoot);
  const grouped = new Map();

  rows.forEach((row) => {
    const sellerKey = String(row.sellerUsername || '').trim();
    const mappedSeller = row.sellerUsername ? directSellerLookup.get(sellerKey) : null;
    const displaySeller = mappedSeller || row.sellerUsername || 'No winner';
    const groupKey = [
      row.resultForDate,
      row.sessionMode,
      row.prizeId || row.prizeKey || row.prizeLabel,
      displaySeller
    ].join('|');

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        ...row,
        fullPrizeAmount: getNormalizedPrizeBaseAmount(row),
        sellerUsername: displaySeller,
        bookedNumberList: row.bookedNumber ? [row.bookedNumber] : [],
        calculatedPrize: getNormalizedPrizeCalculatedAmount(row)
      });
      return;
    }

    const existing = grouped.get(groupKey);
    if (row.bookedNumber) {
      existing.bookedNumberList.push(row.bookedNumber);
    }
    existing.calculatedPrize += getNormalizedPrizeCalculatedAmount(row);
  });

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    bookedNumber: row.bookedNumberList.length > 0
      ? [...new Set(row.bookedNumberList)].join(', ')
      : '-'
  }));
};

const getLatestRecordPerEntry = (records = []) => {
  const latestMap = new Map();

  records.forEach((record) => {
    const key = record.entryId || record.uniqueCode || record.id;
    const existing = latestMap.get(key);

    if (!existing) {
      latestMap.set(key, record);
      return;
    }

    const currentTime = new Date(record.createdAt || 0).getTime();
    const existingTime = new Date(existing.createdAt || 0).getTime();

    if (currentTime > existingTime || (currentTime === existingTime && Number(record.id || 0) > Number(existing.id || 0))) {
      latestMap.set(key, record);
    }
  });

  return Array.from(latestMap.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
};

const createPrizeInputs = () => PRIZE_OPTIONS.reduce((accumulator, prize) => {
  accumulator[prize.key] = '';
  return accumulator;
}, {});

const createPendingPrizeEntries = () => PRIZE_OPTIONS.reduce((accumulator, prize) => {
  accumulator[prize.key] = [];
  return accumulator;
}, {});

const getIndiaDateTimeParts = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
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

const getUploadTimingMessage = (selectedDate, selectedSessionMode, currentDate) => {
  if (selectedDate !== currentDate) {
    return '';
  }

  if (selectedSessionMode === 'MORNING') {
    return 'Current date ke liye Morning result upload 1:00 PM ke baad hi open hoga.';
  }

  if (selectedSessionMode === 'NIGHT') {
    return 'Current date ke liye Night result upload 8:00 PM ke baad hi open hoga.';
  }

  return '';
};

const AdminDashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('');
  const [prizeInputs, setPrizeInputs] = useState(createPrizeInputs);
  const [pendingPrizeEntries, setPendingPrizeEntries] = useState(createPendingPrizeEntries);
  const [uploadedPrizeResults, setUploadedPrizeResults] = useState([]);
  const [editingUploadedResultId, setEditingUploadedResultId] = useState(null);
  const [editingUploadedValue, setEditingUploadedValue] = useState('');
  const [editingUploadedLoading, setEditingUploadedLoading] = useState(false);
  const [uploadResultDate, setUploadResultDate] = useState(getTodayDateValue());
  const [uploadSessionMode, setUploadSessionMode] = useState('MORNING');
  const [currentIndiaDateTime, setCurrentIndiaDateTime] = useState(() => getIndiaDateTimeParts());
  const [treeData, setTreeData] = useState(null);
  const [acceptEntries, setAcceptEntries] = useState([]);
  const [transferHistory, setTransferHistory] = useState([]);
  const [billPrizeResults, setBillPrizeResults] = useState([]);
  const [summaryDate, setSummaryDate] = useState(getTodayDateValue());
  const [summarySessionMode, setSummarySessionMode] = useState('');
  const [summaryEntries, setSummaryEntries] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [historyFilterMode, setHistoryFilterMode] = useState('single');
  const [historyDate, setHistoryDate] = useState(getTodayDateValue());
  const [historyFromDate, setHistoryFromDate] = useState(getTodayDateValue());
  const [historyToDate, setHistoryToDate] = useState(getTodayDateValue());
  const [historyShift, setHistoryShift] = useState('');
  const [historySellerFilter, setHistorySellerFilter] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [traceNumber, setTraceNumber] = useState('');
  const [traceAmount, setTraceAmount] = useState('');
  const [traceSem, setTraceSem] = useState('');
  const [traceResults, setTraceResults] = useState([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [prizeTrackerDate, setPrizeTrackerDate] = useState(getTodayDateValue());
  const [prizeTrackerSessionMode, setPrizeTrackerSessionMode] = useState('ALL');
  const [prizeTrackerSearchPerformed, setPrizeTrackerSearchPerformed] = useState(false);
  const [prizeTrackerResults, setPrizeTrackerResults] = useState([]);

  useEffect(() => {
    loadTree();
    loadAcceptEntries();
    loadBillPreviewData();
    loadSummaryEntries();
  }, []);

  useEffect(() => {
    loadPrizeResults(uploadResultDate, uploadSessionMode);
  }, [uploadResultDate, uploadSessionMode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentIndiaDateTime(getIndiaDateTimeParts());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setPrizeInputs(createPrizeInputs());
    setPendingPrizeEntries(createPendingPrizeEntries());
    setEditingUploadedResultId(null);
    setEditingUploadedValue('');
    setError('');
    setSuccess('');
  }, [uploadResultDate, uploadSessionMode]);

  const getHistoryFilters = () => (
    historyFilterMode === 'range'
      ? { fromDate: historyFromDate, toDate: historyToDate, shift: historyShift }
      : { date: historyDate, shift: historyShift }
  );

  const loadBillPreviewData = async (filters = getHistoryFilters()) => {
    try {
      if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
        setError('From date cannot be after to date');
        return;
      }

      setError('');
      const [historyResponse, prizeResponse] = await Promise.all([
        lotteryService.getTransferHistory(filters),
        priceService.getBillPrizes(filters)
      ]);
      setTransferHistory(historyResponse.data.map(mapHistoryRecord));
      setBillPrizeResults(prizeResponse.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading bill data');
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab('');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const loadTree = async () => {
    try {
      const response = await userService.getUserTree();
      setTreeData(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading tree');
    }
  };

  const loadAcceptEntries = async () => {
    try {
      const response = await lotteryService.getSentEntries();
      setAcceptEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading accept entries');
    }
  };

  const loadSummaryEntries = async (selectedDate = summaryDate, selectedSessionMode = summarySessionMode) => {
    try {
      setSummaryLoading(true);
      const response = await lotteryService.getSentEntries(
        { date: selectedDate, sessionMode: selectedSessionMode },
        {
          withSessionMode: false,
          headers: {
            'X-Session-Mode': selectedSessionMode || ''
          }
        }
      );
      setSummaryEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadPrizeResults = async (selectedDate = uploadResultDate, selectedSessionMode = uploadSessionMode) => {
    try {
      const response = await priceService.getAllPrices({
        resultForDate: selectedDate,
        sessionMode: selectedSessionMode
      });
      setUploadedPrizeResults(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading uploaded results');
    }
  };

  const loadTransferHistory = async (filters = getHistoryFilters()) => {
    try {
      if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
        setError('From date cannot be after to date');
        return;
      }

      setError('');
      const response = await lotteryService.getTransferHistory(filters);
      setTransferHistory(response.data.map(mapHistoryRecord));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading record');
    }
  };

  const loadRecordHistory = async () => {
    const filters = getHistoryFilters();

    try {
      if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
        setError('From date cannot be after to date');
        return;
      }

      setError('');
      const response = await lotteryService.getTransferHistory({ ...filters, includeBookings: 'true' });
      setTransferHistory(getLatestRecordPerEntry(response.data.map(mapHistoryRecord)));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading record');
    }
  };

  const addPrizeEntry = (prizeKey) => {
    const prizeConfig = PRIZE_OPTIONS.find((prize) => prize.key === prizeKey);
    const rawValue = prizeInputs[prizeKey] || '';
    const trimmedValue = rawValue.trim();

    if (!prizeConfig) {
      return;
    }

    if (!trimmedValue) {
      setError(`Enter a number in ${prizeConfig.title}`);
      setSuccess('');
      return;
    }

    if (!/^\d+$/.test(trimmedValue)) {
      setError(`Only numbers are allowed in ${prizeConfig.title}`);
      setSuccess('');
      return;
    }

    if (trimmedValue.length !== prizeConfig.digitLength) {
      setError(`${prizeConfig.title} requires exactly ${prizeConfig.digitLength} digits`);
      setSuccess('');
      return;
    }

    const alreadyPendingInAnyPrize = Object.values(pendingPrizeEntries).some((entries) => (
      entries.some((entry) => entry.winningNumber === trimmedValue)
    ));
    const alreadyUploadedInAnyPrize = uploadedPrizeResults.some((entry) => entry.winningNumber === trimmedValue);

    if (alreadyPendingInAnyPrize || alreadyUploadedInAnyPrize) {
      setError(`${trimmedValue} is already used in another prize. One number can have only one prize.`);
      setSuccess('');
      return;
    }

    setPendingPrizeEntries((current) => ({
      ...current,
      [prizeKey]: [
        ...current[prizeKey],
        {
          id: `${prizeKey}-${trimmedValue}`,
          winningNumber: trimmedValue
        }
      ]
    }));
    setPrizeInputs((current) => ({
      ...current,
      [prizeKey]: ''
    }));
    setError('');
    setSuccess(`${trimmedValue} saved in ${prizeConfig.title}`);
  };

  const removePendingPrizeEntry = (prizeKey, winningNumber) => {
    setPendingPrizeEntries((current) => ({
      ...current,
      [prizeKey]: current[prizeKey].filter((entry) => entry.winningNumber !== winningNumber)
    }));
    setError('');
    setSuccess(`${winningNumber} removed from ${PRIZE_OPTIONS.find((prize) => prize.key === prizeKey)?.title || 'prize list'}`);
  };

  const startEditingUploadedResult = (entry) => {
    setEditingUploadedResultId(entry.id);
    setEditingUploadedValue(entry.winningNumber);
    setError('');
    setSuccess('');
  };

  const cancelEditingUploadedResult = () => {
    setEditingUploadedResultId(null);
    setEditingUploadedValue('');
  };

  const saveEditedUploadedResult = async (entry) => {
    const prizeConfig = PRIZE_OPTIONS.find((prize) => prize.key === entry.prizeKey);
    const sanitizedValue = String(editingUploadedValue || '').replace(/[^0-9]/g, '').slice(0, prizeConfig?.digitLength || 5);

    if (!prizeConfig) {
      return;
    }

    if (sanitizedValue.length !== prizeConfig.digitLength) {
      setError(`${prizeConfig.title} requires exactly ${prizeConfig.digitLength} digits`);
      return;
    }

    const duplicatePendingEntry = Object.entries(pendingPrizeEntries).some(([currentPrizeKey, entries]) => (
      currentPrizeKey !== entry.prizeKey && entries.some((pendingEntry) => pendingEntry.winningNumber === sanitizedValue)
    ));
    const duplicateUploadedEntry = uploadedPrizeResults.some((uploadedEntry) => (
      uploadedEntry.id !== entry.id && uploadedEntry.winningNumber === sanitizedValue
    ));

    if (duplicatePendingEntry || duplicateUploadedEntry) {
      setError(`${sanitizedValue} is already used in another prize. One number can have only one prize.`);
      return;
    }

    setEditingUploadedLoading(true);
    setError('');
    setSuccess('');

    try {
      await priceService.updatePrizeResult(entry.id, sanitizedValue);
      setSuccess(`${sanitizedValue} updated in ${prizeConfig.title}`);
      setEditingUploadedResultId(null);
      setEditingUploadedValue('');
      await loadPrizeResults(uploadResultDate, uploadSessionMode);
    } catch (err) {
      setError(err.response?.data?.message || 'Error updating uploaded result');
    } finally {
      setEditingUploadedLoading(false);
    }
  };

  const handleUploadPrice = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!isSelectedUploadSessionAllowed) {
      setError(uploadTimingMessage || 'Selected session upload is locked right now');
      return;
    }

    const entriesToUpload = PRIZE_OPTIONS.flatMap((prize) =>
      pendingPrizeEntries[prize.key].map((entry) => ({
        prizeKey: prize.key,
        winningNumber: entry.winningNumber
      }))
    );

    if (entriesToUpload.length === 0) {
      setError('Save at least one number before uploading');
      return;
    }

    setLoading(true);

    try {
      await priceService.uploadPrice({
        entries: entriesToUpload,
        sessionMode: uploadSessionMode,
        resultForDate: uploadResultDate
      });
      setSuccess('Prize results uploaded successfully');
      setPrizeInputs(createPrizeInputs());
      setPendingPrizeEntries(createPendingPrizeEntries());
      await loadPrizeResults(uploadResultDate, uploadSessionMode);
    } catch (err) {
      const apiMessage = err.response?.data?.message || '';
      setError(
        apiMessage === 'Unique code and price required'
          ? 'The backend is still using the old upload logic. Restart the server, then upload only result numbers.'
          : apiMessage || 'Error uploading prize results'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSellerCreateSuccess = async () => {
    setSuccess('Seller created successfully');
    await loadTree();
  };

  const handleDeleteUser = async (node) => {
    const confirmed = window.confirm(`Delete ${node.username} and all users under this tree?`);
    if (!confirmed) {
      return;
    }

    setDeletingUserId(node.id);
    setError('');
    setSuccess('');

    try {
      await userService.deleteUser(node.id);
      setSuccess('Seller deleted successfully');
      await Promise.all([loadTree(), loadAcceptEntries()]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error deleting seller');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleTabToggle = (tabName) => {
    setError('');
    setSuccess('');

    if (activeTab === tabName) {
      setActiveTab('');
      window.history.back();
      return;
    }

    window.history.pushState({ adminTab: tabName }, '');

    if (tabName === 'record' || tabName === 'generate-bill') {
      if (tabName === 'record') {
        loadRecordHistory();
      } else {
        loadBillPreviewData(getHistoryFilters());
      }
    }

    if (tabName === 'today-summary') {
      loadSummaryEntries(summaryDate, summarySessionMode);
    }

    setActiveTab(tabName);
  };

  const handleTabBack = () => {
    setError('');
    setSuccess('');
    setActiveTab('');
    window.history.back();
  };

  const handleDashboardHome = () => {
    setError('');
    setSuccess('');

    if (activeTab) {
      setActiveTab('');
      window.history.pushState({ adminDashboardRoot: true }, '', window.location.pathname);
    }
  };

  const directAdminSellers = (treeData?.children || []).filter((node) => node.role === 'seller');
  const billData = buildBillData({
    records: transferHistory,
    prizeRecords: billPrizeResults,
    treeData,
    selectedSellerUsername: historySellerFilter
  });
  const billTransferHistory = billData.records;
  const transferHistoryByActor = groupTransferHistoryByActor(transferHistory);
  const billTransferHistoryByActor = billData.groupedRecords;
  const adminBillVisibleGroups = Object.entries(billTransferHistoryByActor).reduce((accumulator, [billSellerName, records]) => {
    const visibleRecords = records.filter((record) => record.toUsername === user.username);
    if (visibleRecords.length > 0) {
      accumulator[billSellerName] = visibleRecords;
    }
    return accumulator;
  }, {});
  const adminVisibleGroupedSummaries = Object.entries(adminBillVisibleGroups).reduce((accumulator, [billSellerName, records]) => {
    accumulator[billSellerName] = buildBillSummaryWithPrize(records, billData.prizeTotalsByRoot?.[billSellerName] || {});
    return accumulator;
  }, {});
  const adminVisibleGroupedAmountSummaries = Object.entries(adminBillVisibleGroups).reduce((accumulator, [billSellerName, records]) => {
    accumulator[billSellerName] = buildBillAmountSummariesWithPrize(
      records,
      billData.prizeTotalsByRootAndAmount?.[billSellerName] || {}
    );
    return accumulator;
  }, {});
  const adminVisibleBillTotals = Object.entries(adminBillVisibleGroups).reduce((totals, [billSellerName, records]) => {
    const summary = adminVisibleGroupedSummaries[billSellerName];
    if (!summary) {
      return totals;
    }

    totals.recordCount += summary.recordCount;
    totals.totalPiece += summary.totalPiece;
    totals.totalSales += summary.totalSales;
    totals.totalPrize += summary.totalPrize;
    totals.totalVc += summary.totalVc;
    totals.totalSvc += summary.totalSvc;
    totals.netBill += summary.netBill;
    return totals;
  }, {
    recordCount: 0,
    totalPiece: 0,
    totalSales: 0,
    totalPrize: 0,
    totalVc: 0,
    totalSvc: 0,
    netBill: 0
  });
  const summaryTotals = summarizeTransferHistory(summaryEntries.map((entry) => ({
    boxValue: entry.sem,
    amount: entry.amount
  })));
  const summaryAmount6Entries = summaryEntries.filter((entry) => entry.amount === '6');
  const summaryAmount12Entries = summaryEntries.filter((entry) => entry.amount === '12');
  const normalizedPrizeTrackerResults = normalizePrizeTrackerRowsForAdmin(prizeTrackerResults, treeData);
  const uploadedPrizeResultsByKey = uploadedPrizeResults.reduce((accumulator, entry) => {
    if (!accumulator[entry.prizeKey]) {
      accumulator[entry.prizeKey] = [];
    }
    accumulator[entry.prizeKey].push(entry);
    return accumulator;
  }, {});
  const uploadedPrizeSummary = PRIZE_OPTIONS
    .map((prize) => ({
      ...prize,
      numbers: (uploadedPrizeResultsByKey[prize.key] || []).map((entry) => entry.winningNumber)
    }))
    .filter((prize) => prize.numbers.length > 0);
  const isCurrentUploadDate = uploadResultDate === currentIndiaDateTime.date;
  const isMorningUploadAllowed = !isCurrentUploadDate || currentIndiaDateTime.hour >= 13;
  const isNightUploadAllowed = !isCurrentUploadDate || currentIndiaDateTime.hour >= 20;
  const isSelectedUploadSessionAllowed = uploadSessionMode === 'MORNING' ? isMorningUploadAllowed : isNightUploadAllowed;
  const uploadTimingMessage = getUploadTimingMessage(uploadResultDate, uploadSessionMode, currentIndiaDateTime.date);
  const historyPeriodLabel = historyFilterMode === 'range'
    ? `${formatDisplayDate(historyFromDate)} to ${formatDisplayDate(historyToDate)}`
    : formatDisplayDate(historyDate);

  const renderAdminEntriesTable = (entries, title) => (
    <div className="entries-list-block" style={{ marginTop: '20px' }}>
      <h3>{title}</h3>
      <table className="entries-table">
        <thead>
          <tr>
            <th>Unique Code</th>
            <th>SEM</th>
            <th>Amount</th>
            <th>5-Digit Number</th>
            <th>Status</th>
            <th>Sent At</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const sortedEntries = sortRowsForConsecutiveNumbers(
              entries,
              (entry) => [entry.sem, entry.amount, entry.status]
            );
            const groupedEntries = groupConsecutiveNumberRows(sortedEntries, (entry) => [entry.sem, entry.amount, entry.status].join('|'));

            return groupedEntries.map((group) => {
              const representativeEntry = group.firstRow;
              const uniqueCodeLabel = group.rows.length > 1 ? `${group.rows.length} codes` : representativeEntry.uniqueCode;

              return (
                <tr key={group.rows.map((entry) => entry.id).join('-')}>
                  <td>{uniqueCodeLabel}</td>
                  <td>{representativeEntry.sem}</td>
                  <td>{representativeEntry.amount}</td>
                  <td>{group.label}</td>
                  <td>{representativeEntry.status}</td>
                  <td>{new Date(representativeEntry.sentAt || representativeEntry.createdAt).toLocaleString('en-IN')}</td>
                </tr>
              );
            });
          })()}
        </tbody>
      </table>
    </div>
  );

  const renderHistoryTablesByAmount = (records, actorName, { showTotal = false } = {}) => {
    const { amount6, amount12 } = splitEntriesByAmount(records);
    const renderRecordTable = (tableRecords, amountLabel) => (
      <div className="entries-list-block" style={{ marginTop: '20px' }}>
        <h3>{actorName} - Amount {amountLabel}</h3>
        <table className="entries-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>From</th>
              <th>To</th>
              <th>Unique Code</th>
              <th>SEM</th>
              <th>Amount</th>
              <th>5-Digit Number</th>
              <th>Status</th>
              <th>Booked On</th>
              <th>Lottery Date</th>
              <th>Date Time</th>
              {showTotal && <th>Total</th>}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const sortedTableRecords = sortRowsForConsecutiveNumbers(
                tableRecords,
                (record) => [
                  record.actionType,
                  record.fromUsername,
                  record.toUsername,
                  record.boxValue,
                  record.amount,
                  record.statusAfter,
                  record.bookingDate || ''
                ]
              );
              const groupedRecords = groupConsecutiveNumberRows(sortedTableRecords, (record) => [
                record.actionType,
                record.fromUsername,
                record.toUsername,
                record.boxValue,
                record.amount,
                record.statusAfter,
                record.bookingDate || ''
              ].join('|'));

              return groupedRecords.map((group) => {
                const record = group.firstRow;
                const totalValue = group.rows.reduce((sum, currentRecord) => (
                  sum + (Number(currentRecord.boxValue || 0) * Number(currentRecord.amount || 0))
                ), 0);
                const uniqueCodeLabel = group.rows.length > 1 ? `${group.rows.length} codes` : record.uniqueCode;

                return (
                  <tr key={group.rows.map((currentRecord) => currentRecord.id).join('-')}>
                    <td>{record.actionType}</td>
                    <td>{record.fromUsername}</td>
                    <td>{record.toUsername}</td>
                    <td>{uniqueCodeLabel}</td>
                    <td>{record.boxValue}</td>
                    <td>{record.amount}</td>
                    <td>{group.label}</td>
                    <td>{record.statusAfter}</td>
                    <td>{formatDisplayDate(record.createdAt)}</td>
                    <td>{formatDisplayDate(record.bookingDate)}</td>
                    <td>{formatDisplayDateTime(record.createdAt)}</td>
                    {showTotal && <td>Rs. {totalValue.toFixed(2)}</td>}
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
    );

    return (
      <>
        {amount6.length > 0 && renderRecordTable(amount6, '6')}
        {amount12.length > 0 && renderRecordTable(amount12, '12')}
      </>
    );
  };

  const renderTraceTablesByAmount = (records) => {
    const { amount6, amount12 } = splitEntriesByAmount(records);
    const renderTraceTable = (tableRecords, amountLabel) => (
      <div className="entries-list-block" style={{ marginTop: '20px' }}>
        <h3>Amount {amountLabel}</h3>
        <table className="entries-table">
          <thead>
            <tr>
              <th>Unique Code</th>
              <th>Number</th>
              <th>SEM</th>
              <th>Amount</th>
              <th>Booked By</th>
              <th>Sent To</th>
              <th>Current Holder</th>
              <th>Forwarded By</th>
              <th>Status</th>
              <th>Morning/Night</th>
              <th>Booked Time</th>
              <th>Sent Time</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const sortedTableRecords = sortRowsForConsecutiveNumbers(
                tableRecords,
                (record) => [
                  record.boxValue,
                  record.amount,
                  record.bookedBy,
                  record.sentTo || '',
                  record.currentHolder,
                  record.forwardedBy || '',
                  record.status,
                  record.sessionMode
                ]
              );
              const groupedRecords = groupConsecutiveNumberRows(sortedTableRecords, (record) => [
                record.boxValue,
                record.amount,
                record.bookedBy,
                record.sentTo || '',
                record.currentHolder,
                record.forwardedBy || '',
                record.status,
                record.sessionMode
              ].join('|'));

              return groupedRecords.map((group) => {
                const record = group.firstRow;
                const uniqueCodeLabel = group.rows.length > 1 ? `${group.rows.length} codes` : record.uniqueCode;

                return (
                  <tr key={group.rows.map((currentRecord) => currentRecord.id).join('-')}>
                    <td>{uniqueCodeLabel}</td>
                    <td>{group.label}</td>
                    <td>{record.boxValue}</td>
                    <td>{record.amount}</td>
                    <td>{record.bookedBy}</td>
                    <td>{record.sentTo || '-'}</td>
                    <td>{record.currentHolder}</td>
                    <td>{record.forwardedBy || '-'}</td>
                    <td>{record.status}</td>
                    <td><strong>{record.sessionMode}</strong></td>
                    <td>{formatDisplayDateTime(record.createdAt)}</td>
                    <td>{formatDisplayDateTime(record.sentAt)}</td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
    );

    return (
      <>
        {amount6.length > 0 && renderTraceTable(amount6, '6')}
        {amount12.length > 0 && renderTraceTable(amount12, '12')}
      </>
    );
  };

  const generateBill = () => {
    setError('');

    if (historyFilterMode === 'range' && historyFromDate > historyToDate) {
      setError('From date cannot be after to date');
      return;
    }

    if (transferHistory.length === 0) {
      setError('No bill data found');
      return;
    }

    if (billTransferHistory.length === 0) {
      setError('No bill data found for selected seller');
      return;
    }

    const didOpen = openTransferBill({
      groupedRecords: adminBillVisibleGroups,
      groupedSummaries: adminVisibleGroupedSummaries,
      groupedAmountSummaries: adminVisibleGroupedAmountSummaries,
      rootSellerMeta: billData.rootSellerMeta,
      totals: adminVisibleBillTotals,
      username: user.username,
      periodLabel: historyPeriodLabel,
      shiftLabel: `${historyShift || 'All'}${historySellerFilter ? ` | Seller: ${historySellerFilter}` : ''}`,
      title: 'Generate Bill'
    });

    if (!didOpen) {
      setError('Allow pop-up to generate bill');
    }
  };

  const handleTraceSearch = async () => {
    const trimmedNumber = traceNumber.trim();

    if (!trimmedNumber) {
      setError('Enter number or unique code to search');
      return;
    }

    setError('');
    setTraceLoading(true);

    try {
      const response = await lotteryService.traceNumber(
        {
          number: trimmedNumber,
          uniqueCode: trimmedNumber,
          date: summaryDate,
          sessionMode: summarySessionMode,
          amount: traceAmount,
          sem: traceSem
        },
        {
          withSessionMode: false,
          headers: {
            'X-Session-Mode': summarySessionMode || ''
          }
        }
      );
      setTraceResults(response.data.map(mapTraceRecord));
    } catch (err) {
      setError(err.response?.data?.message || 'Error tracing number');
      setTraceResults([]);
    } finally {
      setTraceLoading(false);
    }
  };

  const handlePrizeTrackerSearch = async () => {
    setError('');
    setPrizeTrackerSearchPerformed(false);

    try {
      const response = await priceService.getPrizeTracker({
        resultForDate: prizeTrackerDate,
        sessionMode: prizeTrackerSessionMode
      });
      setPrizeTrackerResults(response.data);
      setPrizeTrackerSearchPerformed(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading prize tracker');
      setPrizeTrackerResults([]);
    }
  };

  return (
    <div className="admin-dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <button type="button" className="dashboard-home-link" onClick={handleDashboardHome}>
            <h1>Admin Dashboard</h1>
          </button>
          <div className="user-info">
            <span>Welcome, {user.username} (Admin)</span>
            <PasswordSettingsMenu
              currentUser={user}
              onSuccess={setSuccess}
              onError={setError}
            />
            <button className="logout-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      <div className="dashboard-accordion">
        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'upload-price' ? 'active' : ''}`}
              onClick={() => handleTabToggle('upload-price')}
            >
              Upload Price/Result
            </button>
          </div>
        )}

        {activeTab === 'upload-price' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Upload Price/Result
            </button>
            <div className="accordion-content">
              <h2>Upload Price/Result</h2>
              <form onSubmit={handleUploadPrice} className="upload-form">
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label>Select Result Date:</label>
                  <input
                    type="date"
                    value={uploadResultDate}
                    max={currentIndiaDateTime.date}
                    onChange={(e) => setUploadResultDate(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label>Choose Session:</label>
                  <div className="box-options" style={{ marginTop: '10px' }}>
                    {RESULT_SESSION_OPTIONS.map((session) => {
                      return (
                        <label
                          key={session}
                          className="checkbox-label"
                          style={{ opacity: (session === 'MORNING' ? !isMorningUploadAllowed : !isNightUploadAllowed) ? 0.6 : 1 }}
                        >
                          <input
                            type="radio"
                            name="upload-session"
                            value={session}
                            checked={uploadSessionMode === session}
                            onChange={() => setUploadSessionMode(session)}
                            disabled={session === 'MORNING' ? !isMorningUploadAllowed : !isNightUploadAllowed}
                          />
                          {session}
                        </label>
                      );
                    })}
                  </div>
                  {uploadTimingMessage && !isSelectedUploadSessionAllowed && (
                    <p style={{ marginTop: '8px', color: '#c53030', fontSize: '13px' }}>{uploadTimingMessage}</p>
                  )}
                  {isCurrentUploadDate && (
                    <p style={{ marginTop: '8px', color: '#4a5568', fontSize: '13px' }}>
                      India time: {String(currentIndiaDateTime.hour).padStart(2, '0')}:
                      {String(currentIndiaDateTime.minute).padStart(2, '0')}:
                      {String(currentIndiaDateTime.second).padStart(2, '0')}
                    </p>
                  )}
                </div>

                {PRIZE_OPTIONS.map((prize) => (
                  <div
                    key={prize.key}
                    className="form-group"
                    style={{ marginBottom: '20px', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '12px', backgroundColor: '#f8fbff' }}
                  >
                    <label style={{ fontWeight: '700', display: 'block', marginBottom: '6px' }}>
                      {prize.title} {prize.amountLabel}
                    </label>
                    <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#4a5568' }}>
                      {prize.digitLength} digit number entry
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={prizeInputs[prize.key]}
                        onChange={(e) => {
                          const sanitizedValue = e.target.value.replace(/[^0-9]/g, '').slice(0, prize.digitLength);
                          setPrizeInputs((current) => ({
                            ...current,
                            [prize.key]: sanitizedValue
                          }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addPrizeEntry(prize.key);
                          }
                        }}
                        placeholder={`Enter ${prize.digitLength} digit number`}
                        maxLength={prize.digitLength}
                        style={{ flex: '1 1 260px' }}
                      />
                      <button type="button" onClick={() => addPrizeEntry(prize.key)} style={{ minWidth: '110px' }}>
                        OK
                      </button>
                    </div>

                    <div style={{ marginTop: '14px' }}>
                      <strong>Saved:</strong>
                      {pendingPrizeEntries[prize.key].length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                          {pendingPrizeEntries[prize.key].map((entry) => (
                            <span
                              key={entry.id}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px 12px',
                                borderRadius: '999px',
                                backgroundColor: '#e6f4ea',
                                color: '#1f5132',
                                fontWeight: '600'
                              }}
                            >
                              {entry.winningNumber}
                              <button
                                type="button"
                                onClick={() => removePendingPrizeEntry(prize.key, entry.winningNumber)}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#c53030',
                                  cursor: 'pointer',
                                  fontWeight: '700',
                                  padding: 0
                                }}
                              >
                                X
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p style={{ marginTop: '8px' }}>No saved number</p>
                      )}
                    </div>

                    <div style={{ marginTop: '14px' }}>
                      <strong>Uploaded Final:</strong>
                      {uploadedPrizeResultsByKey[prize.key]?.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                          {uploadedPrizeResultsByKey[prize.key].map((entry) => (
                            editingUploadedResultId === entry.id ? (
                              <div
                                key={entry.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                  padding: '8px 12px',
                                  borderRadius: '12px',
                                  backgroundColor: '#fff7e6',
                                  border: '1px solid #f6ad55'
                                }}
                              >
                                <input
                                  type="text"
                                  value={editingUploadedValue}
                                  onChange={(e) => setEditingUploadedValue(e.target.value.replace(/[^0-9]/g, '').slice(0, prize.digitLength))}
                                  maxLength={prize.digitLength}
                                  style={{ width: '140px' }}
                                />
                                <button type="button" onClick={() => saveEditedUploadedResult(entry)} disabled={editingUploadedLoading}>
                                  {editingUploadedLoading ? 'Saving...' : 'Save'}
                                </button>
                                <button type="button" onClick={cancelEditingUploadedResult} disabled={editingUploadedLoading}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <span
                                key={entry.id}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '8px 12px',
                                  borderRadius: '999px',
                                  backgroundColor: '#edf2f7',
                                  color: '#2d3748',
                                  fontWeight: '600'
                                }}
                              >
                                {entry.winningNumber}
                                <button
                                  type="button"
                                  onClick={() => startEditingUploadedResult(entry)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#2b6cb0',
                                    cursor: 'pointer',
                                    fontWeight: '700',
                                    padding: 0
                                  }}
                                >
                                  Edit
                                </button>
                              </span>
                            )
                          ))}
                        </div>
                      ) : (
                        <p style={{ marginTop: '8px' }}>No uploaded number</p>
                      )}
                    </div>
                  </div>
                ))}

                <div
                  className="form-group"
                  style={{ marginTop: '8px', padding: '18px', border: '1px solid #dbe4ff', borderRadius: '14px', backgroundColor: '#f8faff' }}
                >
                  <h3 style={{ margin: '0 0 12px 0' }}>Uploaded Result Summary</h3>
                  <p style={{ margin: '0 0 14px 0', color: '#4a5568' }}>
                    Date: {formatDisplayDate(uploadResultDate)} | Session: {uploadSessionMode}
                  </p>
                  {uploadedPrizeSummary.length > 0 ? (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {uploadedPrizeSummary.map((prize) => (
                        <div
                          key={prize.key}
                          style={{
                            padding: '14px 16px',
                            borderRadius: '12px',
                            backgroundColor: '#ffffff',
                            border: '1px solid #e2e8f0'
                          }}
                        >
                          <div style={{ fontWeight: '700', marginBottom: '6px' }}>
                            {prize.title} {prize.amountValue}
                          </div>
                          <div style={{ color: '#2d3748', wordBreak: 'break-word' }}>
                            {prize.numbers.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: 0 }}>No uploaded result summary yet</p>
                  )}
                </div>
                <button type="submit" disabled={loading || !isSelectedUploadSessionAllowed}>
                  {loading ? 'Uploading...' : 'Upload'}
                </button>
              </form>
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'tree' ? 'active' : ''}`}
              onClick={() => handleTabToggle('tree')}
            >
              Tree
            </button>
          </div>
        )}

        {activeTab === 'tree' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Tree
            </button>
            <div className="accordion-content">
              <h2>Tree</h2>
              <UserTreeView
                treeData={treeData}
                emptyMessage="No tree found"
                onDelete={handleDeleteUser}
                deletingUserId={deletingUserId}
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'add-seller' ? 'active' : ''}`}
              onClick={() => handleTabToggle('add-seller')}
            >
              Add New Seller
            </button>
          </div>
        )}

        {activeTab === 'add-seller' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Add New Seller
            </button>
            <div className="accordion-content">
              <AddSellerForm onSuccess={handleSellerCreateSuccess} onError={setError} />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'accept-entries' ? 'active' : ''}`}
              onClick={() => handleTabToggle('accept-entries')}
            >
              Accept Entries
            </button>
          </div>
        )}

        {activeTab === 'accept-entries' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Accept Entries
            </button>
            <div className="accordion-content">
              <h2>Accept Entries</h2>
              <EntriesTableView
                entries={acceptEntries}
                showSeller
                showStatus
                splitByAmount
                groupConsecutiveRows
                emptyMessage="No seller entries received yet"
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'today-summary' ? 'active' : ''}`}
              onClick={() => handleTabToggle('today-summary')}
            >
              Today Summary
            </button>
          </div>
        )}

        {activeTab === 'today-summary' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Today Summary
            </button>
            <div className="accordion-content">
              <h2>Today Summary</h2>
              <div className="form-group">
                <label>Select Date:</label>
                <input
                  type="date"
                  value={summaryDate}
                  onChange={(e) => setSummaryDate(e.target.value)}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Select Session:</label>
                <select value={summarySessionMode} onChange={(e) => setSummarySessionMode(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="NIGHT">NIGHT</option>
                </select>

                <button type="button" onClick={() => loadSummaryEntries(summaryDate, summarySessionMode)} style={{ marginTop: '12px' }}>
                  {summaryLoading ? 'Loading...' : 'Load Summary'}
                </button>
              </div>

              <div style={{ marginTop: '16px', padding: '14px', borderRadius: '12px', background: '#f6f8ff' }}>
                <strong>Total Booked Numbers:</strong> {summaryTotals.recordCount} | <strong>Total SEM:</strong> {summaryTotals.totalSem.toFixed(2)} |{' '}
                <strong>Total Piece:</strong> {summaryTotals.totalPiece.toFixed(2)} | <strong>Total Value:</strong> Rs. {summaryTotals.totalValue.toFixed(2)}
              </div>

              {summaryEntries.length > 0 ? (
                <>
                  {summaryAmount6Entries.length > 0 ? renderAdminEntriesTable(summaryAmount6Entries, 'Amount 6') : <p style={{ marginTop: '12px' }}>No booked data found for amount 6.</p>}
                  {summaryAmount12Entries.length > 0 ? renderAdminEntriesTable(summaryAmount12Entries, 'Amount 12') : <p style={{ marginTop: '12px' }}>No booked data found for amount 12.</p>}
                </>
              ) : (
                <p style={{ marginTop: '16px' }}>No booked data found for selected date/session</p>
              )}
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'record' ? 'active' : ''}`}
              onClick={() => handleTabToggle('record')}
            >
              Record
            </button>
          </div>
        )}

        {activeTab === 'record' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Record
            </button>
            <div className="accordion-content">
              <h2>Record</h2>
              <div className="form-group">
                <label>Select Date:</label>
                <input
                  type="date"
                  value={historyDate}
                  onChange={(e) => setHistoryDate(e.target.value)}
                />
                
                <label style={{ marginTop: '12px' }}>Select Shift:</label>
                <select value={historyShift} onChange={(e) => setHistoryShift(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="">All</option>
                  <option value="MORNING">MORNING</option>
                  <option value="NIGHT">NIGHT</option>
                </select>

                <button type="button" onClick={loadRecordHistory} style={{ marginTop: '12px' }}>
                  View Record
                </button>
              </div>

              {Object.keys(transferHistoryByActor).length > 0 ? (
                Object.entries(transferHistoryByActor).map(([actorName, records]) => (
                  <React.Fragment key={actorName}>
                    {renderHistoryTablesByAmount(records, actorName)}
                  </React.Fragment>
                ))
              ) : (
                <p>No record found for this date</p>
              )}
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'generate-bill' ? 'active' : ''}`}
              onClick={() => handleTabToggle('generate-bill')}
            >
              Generate Bill
            </button>
          </div>
        )}

        {activeTab === 'generate-bill' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Generate Bill
            </button>
            <div className="accordion-content">
              <h2>Generate Bill</h2>
              <div className="form-group">
                <label>Filter Type:</label>
                <select
                  value={historyFilterMode}
                  onChange={(e) => setHistoryFilterMode(e.target.value)}
                  style={{ marginTop: '8px' }}
                >
                  <option value="single">Single Date</option>
                  <option value="range">Date Range</option>
                </select>

                {historyFilterMode === 'range' ? (
                  <>
                    <label style={{ marginTop: '12px', display: 'block' }}>From Date:</label>
                    <input
                      type="date"
                      value={historyFromDate}
                      onChange={(e) => setHistoryFromDate(e.target.value)}
                    />

                    <label style={{ marginTop: '12px', display: 'block' }}>To Date:</label>
                    <input
                      type="date"
                      value={historyToDate}
                      onChange={(e) => setHistoryToDate(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <label style={{ marginTop: '12px', display: 'block' }}>Select Date:</label>
                    <input
                      type="date"
                      value={historyDate}
                      onChange={(e) => setHistoryDate(e.target.value)}
                    />
                  </>
                )}

                <label style={{ marginTop: '12px', display: 'block' }}>Select Shift:</label>
                <select value={historyShift} onChange={(e) => setHistoryShift(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="">All</option>
                  <option value="MORNING">MORNING</option>
                  <option value="NIGHT">NIGHT</option>
                </select>

                <label style={{ marginTop: '12px', display: 'block' }}>Select Seller:</label>
                <select value={historySellerFilter} onChange={(e) => setHistorySellerFilter(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="">All Direct Sellers</option>
                  {directAdminSellers.map((seller) => (
                    <option key={seller.id} value={seller.username}>
                      {seller.username} ({getAllowedAmountsLabel(seller)})
                    </option>
                  ))}
                </select>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button type="button" onClick={() => loadBillPreviewData(getHistoryFilters())}>
                    Preview Bill Data
                  </button>
                  <button type="button" onClick={generateBill} style={{ backgroundColor: '#2f855a' }}>
                    Generate Bill
                  </button>
                </div>
              </div>

              {transferHistory.length > 0 && (
                <div style={{ marginTop: '16px', padding: '14px', borderRadius: '12px', background: '#f6f8ff' }}>
                  <strong>Selected Period:</strong> {historyPeriodLabel} | <strong>Shift:</strong> {historyShift || 'All'} |{' '}
                  <strong>Seller:</strong> {historySellerFilter || 'All Direct Sellers'} |{' '}
                  <strong>Records:</strong> {adminVisibleBillTotals.recordCount} | <strong>Total Piece:</strong> {adminVisibleBillTotals.totalPiece.toFixed(2)} |{' '}
                  <strong>Total Sales:</strong> Rs. {adminVisibleBillTotals.totalSales.toFixed(2)} | <strong>Total Prize:</strong> Rs. {adminVisibleBillTotals.totalPrize.toFixed(2)} |{' '}
                  <strong>Total VC:</strong> Rs. {adminVisibleBillTotals.totalVc.toFixed(2)} | <strong>Total SVC:</strong> Rs. {adminVisibleBillTotals.totalSvc.toFixed(2)} |{' '}
                  <strong>Net Bill:</strong> {formatSignedRupees(adminVisibleBillTotals.netBill)}
                </div>
              )}

              {Object.keys(adminBillVisibleGroups).length > 0 ? (
                Object.entries(adminBillVisibleGroups).map(([billSellerName, records]) => (
                  <div key={billSellerName} className="entries-list-block" style={{ marginTop: '20px' }}>
                    {(() => {
                      const amountBreakdown = adminVisibleGroupedAmountSummaries[billSellerName] || {};
                      const allowedAmountsLabel = billData.rootSellerMeta?.[billSellerName]?.allowedAmountsLabel;

                      return (
                        <>
                    <h3>{billSellerName}{allowedAmountsLabel ? ` (${allowedAmountsLabel})` : ''}</h3>
                    <table className="entries-table">
                      <thead>
                        <tr>
                          <th>Seller</th>
                          <th>Action</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Unique Code</th>
                          <th>Session</th>
                          <th>Amount</th>
                          <th>SEM</th>
                          <th>Piece</th>
                          <th>Rate</th>
                          <th>5-Digit Number</th>
                          <th>Status</th>
                          <th>Date Time</th>
                          <th>Bill</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const sortedRecords = sortRowsForConsecutiveNumbers(
                            records,
                            (record) => [
                              record.actorUsername,
                              record.actionType,
                              record.fromUsername,
                              record.toUsername,
                              record.amount,
                              record.boxValue,
                              record.pieceCount,
                              record.appliedRate,
                              record.statusAfter
                            ]
                          );
                          const groupedRecords = groupConsecutiveNumberRows(sortedRecords, (record) => [
                            record.billSellerDisplayName,
                            record.actionType,
                            record.fromUsername,
                            record.toUsername,
                            record.amount,
                            record.boxValue,
                            record.pieceCount,
                            record.appliedRate,
                            record.statusAfter
                          ].join('|'));

                          return groupedRecords.map((group) => {
                            const record = group.firstRow;
                            const groupedPieceCount = group.rows.reduce((sum, currentRecord) => (
                              sum + Number(currentRecord.pieceCount || 0)
                            ), 0);
                            const uniqueCodeLabel = group.rows.length > 1 ? `${group.rows.length} codes` : record.uniqueCode;

                            return (
                              <tr key={group.rows.map((currentRecord) => currentRecord.id).join('-')}>
                                <td>{record.billSellerDisplayName}</td>
                                <td>{record.actionType}</td>
                                <td>{record.fromUsername}</td>
                                <td>{record.toUsername}</td>
                                <td>{uniqueCodeLabel}</td>
                                <td>{record.sessionMode}</td>
                                <td>{record.amount}</td>
                                <td>{record.boxValue}</td>
                                <td>{groupedPieceCount}</td>
                                <td>{record.appliedRate}</td>
                                <td>{group.label}</td>
                                <td>{record.statusAfter}</td>
                                <td>{new Date(record.createdAt).toLocaleString('en-IN')}</td>
                                <td>Rs. {group.rows.reduce((sum, currentRecord) => (
                                  sum + Number(currentRecord.billValue || 0)
                                ), 0).toFixed(2)}</td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                  </table>
                    <div style={{ marginTop: '12px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
                      <strong>{billSellerName} Total:</strong> Records {adminVisibleGroupedSummaries[billSellerName]?.recordCount || 0} | Piece{' '}
                      {adminVisibleGroupedSummaries[billSellerName]?.totalPiece?.toFixed(2) || '0.00'} | Sales Rs.{' '}
                      {adminVisibleGroupedSummaries[billSellerName]?.totalSales?.toFixed(2) || '0.00'} | Prize Rs.{' '}
                      {adminVisibleGroupedSummaries[billSellerName]?.totalPrize?.toFixed(2) || '0.00'} | Total VC Rs.{' '}
                      {adminVisibleGroupedSummaries[billSellerName]?.totalVc?.toFixed(2) || '0.00'} | Total SVC Rs.{' '}
                      {adminVisibleGroupedSummaries[billSellerName]?.totalSvc?.toFixed(2) || '0.00'} | Net{' '}
                      {formatSignedRupees(adminVisibleGroupedSummaries[billSellerName]?.netBill || 0)}
                    </div>
                    {Object.keys(amountBreakdown).sort((left, right) => Number(left) - Number(right)).map((amountKey) => (
                      <div key={`${billSellerName}-${amountKey}`} style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '12px', background: '#ffffff', border: '1px solid #dbe4ff' }}>
                        <strong>Amount {amountKey} Bill:</strong> Records {amountBreakdown[amountKey].recordCount} | Piece{' '}
                        {amountBreakdown[amountKey].totalPiece.toFixed(2)} | Sales Rs. {amountBreakdown[amountKey].totalSales.toFixed(2)} | Prize Rs. {amountBreakdown[amountKey].totalPrize.toFixed(2)} | Total VC Rs. {amountBreakdown[amountKey].totalVc.toFixed(2)} | Total SVC Rs. {amountBreakdown[amountKey].totalSvc.toFixed(2)} | Net {formatSignedRupees(amountBreakdown[amountKey].netBill)}
                      </div>
                    ))}
                        </>
                      );
                    })()}
                  </div>
                ))
              ) : (
                <p>No bill data found</p>
              )}

              {Object.keys(adminBillVisibleGroups).length > 0 && (
                <div style={{ marginTop: '20px', padding: '14px 16px', borderRadius: '14px', background: '#eef2ff' }}>
                  <strong>Grand Total:</strong> Total Records {adminVisibleBillTotals.recordCount} | Total Piece{' '}
                  {adminVisibleBillTotals.totalPiece.toFixed(2)} | Total Sales Rs. {adminVisibleBillTotals.totalSales.toFixed(2)} | Total Prize Rs.{' '}
                  {adminVisibleBillTotals.totalPrize.toFixed(2)} | Total VC Rs. {adminVisibleBillTotals.totalVc.toFixed(2)} | Total SVC Rs. {adminVisibleBillTotals.totalSvc.toFixed(2)} | Net {formatSignedRupees(adminVisibleBillTotals.netBill)}
                </div>
              )}
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'track-number' ? 'active' : ''}`}
              onClick={() => handleTabToggle('track-number')}
            >
              Track Number
            </button>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'prize-tracker' ? 'active' : ''}`}
              onClick={() => handleTabToggle('prize-tracker')}
            >
              Prize Tracker
            </button>
          </div>
        )}

        {activeTab === 'track-number' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Track Number
            </button>
            <div className="accordion-content">
              <h2>Track Number</h2>
              <div className="form-group">
                <label>Search Date:</label>
                <input
                  type="date"
                  value={summaryDate}
                  onChange={(e) => setSummaryDate(e.target.value)}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Search Session:</label>
                <select value={summarySessionMode} onChange={(e) => setSummarySessionMode(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="NIGHT">NIGHT</option>
                </select>

                <label style={{ marginTop: '12px', display: 'block' }}>Booked Number / Unique Code:</label>
                <input
                  type="text"
                  value={traceNumber}
                  onChange={(e) => setTraceNumber(e.target.value)}
                  placeholder="Enter booked number or unique code"
                />
                <label style={{ marginTop: '12px', display: 'block' }}>Amount:</label>
                <div className="box-options" style={{ marginTop: '8px' }}>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="admin-trace-amount"
                      value=""
                      checked={traceAmount === ''}
                      onChange={() => {
                        setTraceAmount('');
                        setTraceSem('');
                      }}
                    />
                    ALL
                  </label>
                  {AMOUNT_OPTIONS.map((amountOption) => (
                    <label key={amountOption} className="checkbox-label">
                      <input
                        type="radio"
                        name="admin-trace-amount"
                        value={amountOption}
                        checked={traceAmount === amountOption}
                        onChange={(e) => {
                          setTraceAmount(e.target.value);
                          setTraceSem('');
                        }}
                      />
                      {amountOption}
                    </label>
                  ))}
                </div>

                <label style={{ marginTop: '12px', display: 'block' }}>SEM:</label>
                <div className="box-options" style={{ marginTop: '8px' }}>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="admin-trace-sem"
                      value=""
                      checked={traceSem === ''}
                      onChange={() => setTraceSem('')}
                    />
                    ALL
                  </label>
                  {traceAmount && getAvailableSemOptions(traceAmount).map((group) => (
                    <label key={group} className="checkbox-label">
                      <input
                        type="radio"
                        name="admin-trace-sem"
                        value={group}
                        checked={traceSem === group}
                        onChange={(e) => setTraceSem(e.target.value)}
                      />
                      {group}
                    </label>
                  ))}
                </div>
                <button type="button" onClick={handleTraceSearch} disabled={traceLoading} style={{ marginTop: '12px' }}>
                  {traceLoading ? 'Searching...' : 'Search'}
                </button>
              </div>

              {traceResults.length > 0 ? (
                renderTraceTablesByAmount(traceResults)
              ) : (
                traceNumber && !traceLoading && <p>No matching booked number / unique code found for selected date/session</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'prize-tracker' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Prize Tracker
            </button>
            <div className="accordion-content">
              <h2>Prize Tracker</h2>
              <div className="form-group">
                <label>Search Date:</label>
                <input
                  type="date"
                  value={prizeTrackerDate}
                  max={currentIndiaDateTime.date}
                  onChange={(e) => setPrizeTrackerDate(e.target.value)}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Search Session:</label>
                <select value={prizeTrackerSessionMode} onChange={(e) => setPrizeTrackerSessionMode(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="NIGHT">NIGHT</option>
                </select>

                <button type="button" onClick={handlePrizeTrackerSearch} style={{ marginTop: '12px' }}>
                  Search
                </button>
              </div>


              {prizeTrackerSearchPerformed && (
                <div className="entries-list-block" style={{ marginTop: '20px' }}>
                  <h3>Daily Prize Summary</h3>
                  <table className="entries-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Session</th>
                        <th>Prize</th>
                        <th>Winning Number</th>
                        <th>Seller</th>
                        <th>Booked Number</th>
                        <th>Amount</th>
                        <th>SEM</th>
                        <th>Base Prize</th>
                        <th>Total Prize</th>
                      </tr>
                    </thead>
                    <tbody>
                      {normalizedPrizeTrackerResults.length > 0 ? (
                        normalizedPrizeTrackerResults.map((entry) => (
                          <tr key={entry.id}>
                            <td>{formatDisplayDate(entry.resultForDate)}</td>
                            <td>{entry.sessionMode}</td>
                            <td>{entry.prizeLabel}</td>
                            <td>{entry.winningNumber}</td>
                            <td>{entry.sellerUsername || 'No winner'}</td>
                            <td>{entry.bookedNumber || '-'}</td>
                            <td>{entry.amount ?? '-'}</td>
                            <td>{entry.sem ?? '-'}</td>
                            <td>Rs. {Number(entry.fullPrizeAmount).toFixed(2)}</td>
                            <td>{entry.calculatedPrize !== null && entry.calculatedPrize !== undefined ? `Rs. ${Number(entry.calculatedPrize).toFixed(2)}` : '-'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="10">No uploaded result found for selected date/session</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {normalizedPrizeTrackerResults.length > 0 && (
                    <div style={{ marginTop: '14px', padding: '14px 16px', borderRadius: '14px', background: '#eef2ff' }}>
                      <strong>Total Prize Payout:</strong> Rs. {normalizedPrizeTrackerResults.reduce((sum, entry) => (
                        sum + Number(entry.calculatedPrize || 0)
                      ), 0).toFixed(2)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
    </div>
  );
};

const AddSellerForm = ({ onSuccess, onError }) => {
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [rateAmount6, setRateAmount6] = useState('');
  const [rateAmount12, setRateAmount12] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreateSeller = async (e) => {
    e.preventDefault();
    setLoading(true);
    onError('');

    const trimmedUsername = newUsername.trim();

    if (!trimmedUsername) {
      onError('Username is required');
      setLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      onError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    if (!rateAmount6 && !rateAmount12) {
      onError('At least one rate is required');
      setLoading(false);
      return;
    }

    try {
      await userService.createSeller(
        trimmedUsername,
        newPassword,
        rateAmount6 ? parseFloat(rateAmount6) : 0,
        rateAmount12 ? parseFloat(rateAmount12) : 0
      );
      setNewUsername('');
      setNewPassword('');
      setRateAmount6('');
      setRateAmount12('');
      await onSuccess();
    } catch (err) {
      onError(err.response?.data?.message || 'Error creating seller');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2>Add New Seller</h2>
      <form onSubmit={handleCreateSeller} className="upload-form">
        <div className="form-group">
          <label>Username:</label>
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label>Password:</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength="8"
            required
          />
        </div>
        <div className="form-group">
          <label>Rate for Amount 6:</label>
          <input
            type="text"
            value={rateAmount6}
            onChange={(e) => {
              const nextValue = e.target.value.replace(/[^0-9.]/g, '');
              const parts = nextValue.split('.');
              const normalizedValue = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : nextValue;
              setRateAmount6(normalizedValue);
            }}
            placeholder="Enter rate for amount 6"
            inputMode="decimal"
          />
        </div>
        <div className="form-group">
          <label>Rate for Amount 12:</label>
          <input
            type="text"
            value={rateAmount12}
            onChange={(e) => {
              const nextValue = e.target.value.replace(/[^0-9.]/g, '');
              const parts = nextValue.split('.');
              const normalizedValue = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : nextValue;
              setRateAmount12(normalizedValue);
            }}
            placeholder="Enter rate for amount 12"
            inputMode="decimal"
          />
        </div>
        <p style={{ marginTop: '-4px', color: '#666', fontSize: '14px' }}>
          If a rate is left blank, the seller will not be able to book lottery for that amount.
        </p>
        <p style={{ marginTop: '0', color: '#666', fontSize: '14px' }}>
          At least one rate is required when creating a new seller.
        </p>
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Seller'}
        </button>
      </form>
    </>
  );
};

export default AdminDashboard;
