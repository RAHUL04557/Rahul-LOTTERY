import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bookingService, priceService, userService } from '../services/api';
import SearchableSellerSelect from './SearchableSellerSelect';
import RetroPurchasePanel from './RetroPurchasePanel';
import { formatDisplayDate, formatSignedRupees, getPrizeAdjustmentAmounts, openTransferBill } from '../utils/transferBill';
import { useFunctionShortcuts } from '../utils/functionShortcuts';

const SHIFT_OPTIONS = ['MORNING', 'DAY', 'EVENING'];
const BILL_SHIFT_OPTIONS = ['ALL', ...SHIFT_OPTIONS];

const BOOKING_STORAGE_MODE_KEYS = {
  book: 'book-numbers',
  record: 'summary-booking',
  'price-track': 'prize-booking',
  bill: 'bill-booking'
};

const BOOKING_STORAGE_PURGE_VERSION = '2026-05-10-booking-entries-reset-v2';

const getTodayDateValue = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date());

const getPurchaseCategory = (shift) => {
  if (shift === 'DAY') return 'D';
  if (shift === 'EVENING') return 'E';
  return 'M';
};

const getSessionMode = (shift) => (shift === 'EVENING' ? 'NIGHT' : 'MORNING');

const getShiftLabel = (sessionMode, purchaseCategory) => {
  if (purchaseCategory === 'D') return 'DAY';
  if (purchaseCategory === 'E' || sessionMode === 'NIGHT') return 'EVENING';
  return 'MORNING';
};

const normalizeDateValue = (dateValue) => {
  const rawValue = String(dateValue || '').trim();
  if (!rawValue) return '';
  const isoMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const displayMatch = rawValue.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (displayMatch) return `${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}`;
  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) return rawValue;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsedDate);
};

const isSameDateValue = (leftDate, rightDate) => normalizeDateValue(leftDate) === normalizeDateValue(rightDate);

const getDisplayDay = (dateValue) => {
  if (!dateValue) return '';
  const date = new Date(`${normalizeDateValue(dateValue)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
};

const RIVER_ITEM_NAMES_BY_DAY = ['BRAHMAPUTRA', 'GANGA', 'YAMUNA', 'GODAVARI', 'NARMADA', 'KRISHNA', 'KAVERI'];

const getRetroItemName = (dateValue) => {
  const date = new Date(`${normalizeDateValue(dateValue)}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return RIVER_ITEM_NAMES_BY_DAY[1];
  }

  return RIVER_ITEM_NAMES_BY_DAY[date.getDay()] || RIVER_ITEM_NAMES_BY_DAY[1];
};

const flattenSellerTree = (node) => {
  const rows = [];
  const visit = (item) => {
    if (!item) return;
    if (item.role === 'seller') rows.push(item);
    (item.children || []).forEach(visit);
  };
  visit(node);
  return rows;
};

const numberInput = (value) => String(value || '').replace(/[^0-9]/g, '').slice(0, 5);

const buildBookingCode = (shift, semValue) => `${getPurchaseCategory(shift)}${String(semValue || '').replace(/[^0-9]/g, '')}`;

const getAvailableSemOptions = (selectedAmount) => {
  if (String(selectedAmount) === '7') {
    return ['5', '10', '25', '50', '100', '200'];
  }
  if (String(selectedAmount) === '12') {
    return ['5', '10', '15', '20', '30', '50', '100', '200'];
  }
  return [];
};

const parseBookingCode = (value, fallbackShift) => {
  const rawValue = String(value || '').trim().toUpperCase();
  const prefix = rawValue.match(/[MDE]/)?.[0];
  const semValue = rawValue.replace(/[^0-9]/g, '').slice(0, 3);
  const fallbackCategory = getPurchaseCategory(fallbackShift);
  if (prefix && prefix !== fallbackCategory) {
    return { error: `${prefix}${semValue} is not allowed. Is company me sirf ${fallbackCategory}${semValue} chalega` };
  }
  let shift = fallbackShift;
  if (prefix === 'M') shift = 'MORNING';
  if (prefix === 'D') shift = 'DAY';
  if (prefix === 'E') shift = 'EVENING';
  return { shift, semValue };
};

const getShiftFromSession = (sessionMode, purchaseCategory = '') => {
  if (purchaseCategory === 'D') return 'DAY';
  if (purchaseCategory === 'E' || sessionMode === 'NIGHT') return 'EVENING';
  return 'MORNING';
};

const getEntryShift = (entry) => getShiftLabel(entry?.sessionMode, entry?.purchaseCategory);

const isSameBookingScope = (entry, sessionMode, purchaseCategory) => (
  String(entry?.sessionMode || 'MORNING') === String(sessionMode || 'MORNING')
  && String(entry?.purchaseCategory || (entry?.sessionMode === 'NIGHT' ? 'E' : 'M')) === String(purchaseCategory || '')
);

const sellerSupportsAmount = (seller, amountValue) => {
  if (!seller || !amountValue) {
    return true;
  }

  if (String(amountValue) === '7') {
    return Number(seller.rateAmount6 || 0) > 0;
  }

  if (String(amountValue) === '12') {
    return Number(seller.rateAmount12 || 0) > 0;
  }

  return true;
};

const shouldMoveFocusLeft = (event) => {
  const cursorAtStart = typeof event.target?.selectionStart === 'number'
    ? event.target.selectionStart === 0 && event.target.selectionEnd === 0
    : true;
  return event.key === 'ArrowLeft' && cursorAtStart;
};

const shouldMoveFocusRight = (event) => {
  const cursorAtEnd = typeof event.target?.selectionStart === 'number'
    ? event.target.selectionStart === String(event.target?.value || '').length
      && event.target.selectionEnd === String(event.target?.value || '').length
    : true;
  return event.key === 'ArrowRight' && cursorAtEnd;
};

const shouldMoveFocusVertical = (event, direction) => event.key === direction;

const getRangeNumbers = (fromValue, toValue) => {
  if (!numberInput(fromValue)) {
    return [];
  }
  const from = Number(numberInput(fromValue));
  const to = Number(numberInput(toValue || fromValue));
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    return [];
  }
  return Array.from({ length: (to - from) + 1 }, (_, index) => String(from + index).padStart(5, '0'));
};

const getRangeCount = (fromValue, toValue) => getRangeNumbers(fromValue, toValue).length;

const getEntryNumbers = (entry) => {
  if (entry?.rangeStart) {
    return getRangeNumbers(entry.rangeStart, entry.rangeEnd || entry.rangeStart);
  }
  return entry?.number ? [String(entry.number).padStart(5, '0')] : [];
};

const getNumberRangeGroups = (numbers = []) => {
  const numberCounts = (Array.isArray(numbers) ? numbers : [])
    .map((number) => String(number || '').replace(/[^0-9]/g, '').padStart(5, '0'))
    .filter((number) => number.length === 5)
    .reduce((counts, number) => {
      counts[number] = (counts[number] || 0) + 1;
      return counts;
    }, {});
  const uniqueNumbers = Object.keys(numberCounts).sort((left, right) => Number(left) - Number(right));
  const maxCount = uniqueNumbers.reduce((max, number) => Math.max(max, numberCounts[number] || 0), 0);

  const ranges = [];

  for (let occurrence = 1; occurrence <= maxCount; occurrence += 1) {
    let rangeStart = '';
    let previousNumber = '';
    let rangeCount = 0;

    const flushRange = () => {
      if (!rangeStart) return;
      ranges.push({
        label: rangeStart === previousNumber ? rangeStart : `${rangeStart}-${previousNumber}`,
        count: rangeCount,
        occurrence
      });
    };

    uniqueNumbers.forEach((number) => {
      if ((numberCounts[number] || 0) < occurrence) {
        flushRange();
        rangeStart = '';
        previousNumber = '';
        rangeCount = 0;
        return;
      }

      if (!rangeStart) {
        rangeStart = number;
        previousNumber = number;
        rangeCount = 1;
        return;
      }

      if (Number(number) === Number(previousNumber) + 1) {
        previousNumber = number;
        rangeCount += 1;
        return;
      }

      flushRange();
      rangeStart = number;
      previousNumber = number;
      rangeCount = 1;
    });

    flushRange();
  }

  return ranges;
};

const getEntrySignature = (entry) => [
  entry.memoNumber,
  entry.sellerId,
  entry.sellerName,
  normalizeDateValue(entry.bookingDate),
  entry.shift,
  entry.sessionMode,
  entry.purchaseCategory,
  entry.amount,
  entry.boxValue,
  entry.rowOrder
].join('|');

const getBookingEntryScopeKey = (entry) => [
  entry.sellerId,
  entry.memoNumber,
  normalizeDateValue(entry.bookingDate),
  entry.sessionMode,
  entry.purchaseCategory
].join('|');

const normalizeServerBookingEntries = (entries = []) => normalizeStoredBookingEntries(
  (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: `server-booking-${entry.id}`,
    serverId: entry.id,
    memoNumber: entry.memoNumber,
    rowOrder: Number(entry.rowOrder || 0),
    sellerId: String(entry.userId || entry.sellerId || ''),
    sellerName: entry.username || entry.sellerName || entry.sellerUsername || '',
    bookingDate: normalizeDateValue(entry.bookingDate),
    shift: getShiftLabel(entry.sessionMode, entry.purchaseCategory),
    sessionMode: entry.sessionMode,
    purchaseCategory: entry.purchaseCategory || (entry.sessionMode === 'NIGHT' ? 'E' : 'M'),
    amount: String(entry.amount || ''),
    boxValue: String(entry.boxValue || ''),
    number: entry.number,
    createdAt: entry.createdAt || ''
  })).filter((entry) => entry.sellerId && entry.memoNumber && entry.number)
);

const normalizeStoredBookingEntries = (entries = []) => {
  const normalizedEntries = [];
  const singlesBySignature = new Map();

  const pushSingle = (entry, number) => {
    const signature = getEntrySignature(entry);
    if (!singlesBySignature.has(signature)) {
      singlesBySignature.set(signature, []);
    }
    singlesBySignature.get(signature).push({
      ...entry,
      bookingDate: normalizeDateValue(entry.bookingDate),
      number: String(number).padStart(5, '0')
    });
  };

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (entry?.rangeStart) {
      const rangeStart = String(entry.rangeStart).padStart(5, '0');
      const rangeEnd = String(entry.rangeEnd || entry.rangeStart).padStart(5, '0');
      normalizedEntries.push({
        ...entry,
        bookingDate: normalizeDateValue(entry.bookingDate),
        rangeStart,
        rangeEnd
      });
      return;
    }

    if (!entry?.number) {
      return;
    }

    pushSingle(entry, entry.number);
  });

  singlesBySignature.forEach((rows) => {
    const sortedRows = [...rows].sort((left, right) => Number(left.number) - Number(right.number));
    let currentGroup = [];

    const flushGroup = () => {
      if (currentGroup.length === 0) return;
      const firstRow = currentGroup[0];
      const lastRow = currentGroup[currentGroup.length - 1];
      normalizedEntries.push({
        ...firstRow,
        id: firstRow.id || `admin-booking-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        rangeStart: firstRow.number,
        rangeEnd: lastRow.number
      });
      currentGroup = [];
    };

    sortedRows.forEach((row) => {
      const previousRow = currentGroup[currentGroup.length - 1];
      if (!previousRow || Number(row.number) === Number(previousRow.number) + 1) {
        currentGroup.push(row);
        return;
      }
      flushGroup();
      currentGroup.push(row);
    });
    flushGroup();
  });

  return normalizedEntries.sort((left, right) => (
    new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
    || Number(left.rowOrder ?? 0) - Number(right.rowOrder ?? 0)
  ));
};

const normalizeRangeStartInput = (fromValue, referenceFromValue = '') => {
  const fromDigits = numberInput(fromValue);
  if (fromDigits.length >= 5) return { value: fromDigits.padStart(5, '0') };
  const referenceDigits = numberInput(referenceFromValue);
  if (referenceDigits.length === 5 && fromDigits) {
    return { value: `${referenceDigits.slice(0, 5 - fromDigits.length)}${fromDigits}` };
  }
  return { value: '', error: 'From is empty ya 5 digit nahi hai' };
};

const normalizeRangeEndInput = (toValue, fromValue) => {
  const toDigits = numberInput(toValue);
  const fromDigits = numberInput(fromValue);
  if (!toDigits) return { value: fromDigits };
  if (toDigits.length >= 5) return { value: toDigits.padStart(5, '0') };
  if (fromDigits.length === 5) {
    return { value: `${fromDigits.slice(0, 5 - toDigits.length)}${toDigits}` };
  }
  return { value: '', error: 'To number valid nahi hai' };
};

const buildModeStateKey = (mode, currentUser) => [
  'lottery.adminBooking',
  String(currentUser?.id || 'guest'),
  BOOKING_STORAGE_MODE_KEYS[mode] || String(mode || 'book'),
  'ui'
].join('.');

const buildEntriesKey = (currentUser) => [
  'lottery.adminBooking',
  String(currentUser?.id || 'guest'),
  'book-numbers',
  'entries'
].join('.');

const readJson = (key, fallbackValue) => {
  if (typeof window === 'undefined' || !window.localStorage || !key) return fallbackValue;
  try {
    const savedValue = window.localStorage.getItem(key);
    return savedValue ? JSON.parse(savedValue) : fallbackValue;
  } catch (error) {
    return fallbackValue;
  }
};

const writeJson = (key, value) => {
  if (typeof window === 'undefined' || !window.localStorage || !key) return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const removeJson = (key) => {
  if (typeof window === 'undefined' || !window.localStorage || !key) return;
  window.localStorage.removeItem(key);
};

const purgeStoredBookingEntries = (entriesKey, stateKey) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const bookingEntriesPattern = /^lottery\.adminBooking\.[^.]+\.book-numbers\.entries$/;
  const storageKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(Boolean);
  storageKeys.forEach((key) => {
    if (bookingEntriesPattern.test(key)) {
      writeJson(key, []);
    }
  });
  writeJson(entriesKey, []);
  removeJson(stateKey);
};

const getSellerRate = (seller, amount) => {
  if (String(amount) === '7') return Number(seller?.rateAmount6 || 0) || Number(amount || 0);
  if (String(amount) === '12') return Number(seller?.rateAmount12 || 0) || Number(amount || 0);
  return Number(amount || 0);
};

const createGridRows = (rows = []) => rows.map((row, index) => {
  const count = getRangeCount(row.rangeStart, row.rangeEnd);
  const quantity = count * Number(row.boxValue || 0);
  return {
    id: row.id || `booking-row-${index}`,
    serial: index + 1,
    code: buildBookingCode(row.shift, row.boxValue),
    itemName: getRetroItemName(row.bookingDate),
    drawDate: row.bookingDate,
    day: getDisplayDay(row.bookingDate),
    from: row.rangeStart,
    to: row.rangeEnd || row.rangeStart,
    quantity,
    rate: Number(row.amount || 0).toFixed(2),
    amount: (quantity * Number(row.amount || 0)).toFixed(2)
  };
});

const groupRows = (rows, getKey, createInitial, applyRow) => (
  Object.values(rows.reduce((groups, row) => {
    const key = getKey(row);
    if (!groups[key]) groups[key] = createInitial(row, key);
    applyRow(groups[key], row);
    return groups;
  }, {}))
);

const createEmptyBookingBillTotals = () => ({
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

const summarizeBookingBillRows = (rows = []) => rows.reduce((totals, row) => ({
  recordCount: totals.recordCount + 1,
  totalSentPiece: totals.totalSentPiece + Number(row.totalSentPiece || 0),
  totalUnsoldPiece: totals.totalUnsoldPiece + Number(row.totalUnsoldPiece || 0),
  totalSoldPiece: totals.totalSoldPiece + Number(row.totalSoldPiece || 0),
  totalPiece: totals.totalPiece + Number(row.totalSoldPiece || 0),
  totalSales: totals.totalSales + Number(row.totalSales || 0),
  totalPrize: totals.totalPrize + Number(row.totalPrize || 0),
  totalVc: totals.totalVc + Number(row.totalVc || 0),
  totalSvc: totals.totalSvc + Number(row.totalSvc || 0),
  netBill: totals.netBill + Number(row.netBill || 0)
}), createEmptyBookingBillTotals());

const createBookingPrintableBill = ({
  rows = [],
  username = '',
  fromDate = '',
  toDate = '',
  shift = '',
  sellerName = ''
}) => {
  const groupedRecords = rows.reduce((groups, row) => {
    const sellerKey = row.sellerName || 'Unknown Seller';
    if (!groups[sellerKey]) groups[sellerKey] = [];
    groups[sellerKey].push({
      ...row,
      actorUsername: sellerKey,
      billSellerDisplayName: sellerKey,
      billRootUsername: sellerKey,
      sentPiece: Number(row.totalSentPiece || 0),
      unsoldPiece: Number(row.totalUnsoldPiece || 0),
      soldPiece: Number(row.totalSoldPiece || 0),
      totalPiece: Number(row.totalSoldPiece || 0),
      billValue: Number(row.totalSales || 0),
      appliedRate: Number(row.appliedRate || row.amount || 0),
      boxValue: row.sem || row.boxValue || '',
      actionType: 'booking_bill'
    });
    return groups;
  }, {});
  const groupedSummaries = Object.entries(groupedRecords).reduce((summaries, [sellerKey, sellerRows]) => {
    summaries[sellerKey] = summarizeBookingBillRows(sellerRows.map((row) => ({
      totalSentPiece: row.sentPiece,
      totalUnsoldPiece: row.unsoldPiece,
      totalSoldPiece: row.soldPiece,
      totalSales: row.billValue,
      totalPrize: row.totalPrize,
      totalVc: row.totalVc,
      totalSvc: row.totalSvc,
      netBill: row.netBill
    })));
    return summaries;
  }, {});
  const totals = summarizeBookingBillRows(rows);
  const periodLabel = fromDate && toDate && fromDate !== toDate
    ? `${formatDisplayDate(fromDate)} - ${formatDisplayDate(toDate)}`
    : formatDisplayDate(fromDate || toDate);
  const shiftLabel = `${shift || 'ALL'}${sellerName ? ` | Seller: ${sellerName}` : ''}`;

  return {
    groupedRecords,
    groupedSummaries,
    groupedAmountSummaries: {},
    rootSellerMeta: {},
    totals,
    username,
    periodLabel,
    shiftLabel,
    title: 'Bill Booking'
  };
};

const BookingPanel = ({
  mode,
  currentUser,
  initialSessionMode = 'MORNING',
  initialPurchaseCategory = '',
  initialAmount = '7',
  entryCompanyLabel = '',
  onExit,
  onError,
  onSuccess
}) => {
  const entriesKey = useMemo(() => buildEntriesKey(currentUser), [currentUser]);
  const stateKey = useMemo(() => buildModeStateKey(mode, currentUser), [currentUser, mode]);
  const [sellers, setSellers] = useState([]);
  const [allEntries, setAllEntries] = useState([]);
  const [sellerId, setSellerId] = useState('');
  const [bookingDate, setBookingDate] = useState(getTodayDateValue());
  const [shift, setShift] = useState(getShiftFromSession(initialSessionMode, initialPurchaseCategory));
  const [amount, setAmount] = useState(initialAmount || '7');
  const [sem, setSem] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [draftRows, setDraftRows] = useState([]);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [memoNumber, setMemoNumber] = useState(null);
  const [memoPopupOpen, setMemoPopupOpen] = useState(false);
  const [memoSelectionIndex, setMemoSelectionIndex] = useState(0);
  const [filterSellerId, setFilterSellerId] = useState('');
  const [fromDate, setFromDate] = useState(getTodayDateValue());
  const [toDate, setToDate] = useState(getTodayDateValue());
  const [resultRows, setResultRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [blockingWarning, setBlockingWarning] = useState(null);

  const sellerInputRef = useRef(null);
  const dateInputRef = useRef(null);
  const memoRef = useRef(null);
  const codeInputRef = useRef(null);
  const fromInputRef = useRef(null);
  const toInputRef = useRef(null);
  const serverSyncKeyRef = useRef('');

  const selectedSeller = sellers.find((seller) => String(seller.id) === String(sellerId)) || null;
  const activeSem = sem;

  const clearBlockingWarning = useCallback(() => {
    const onClear = blockingWarning?.onClear;
    setBlockingWarning(null);
    if (typeof onClear === 'function') {
      onClear();
    }
  }, [blockingWarning]);

  const openBlockingWarning = (message, details = [], title = 'Warning', onClear = null) => {
    onError?.('');
    onSuccess?.('');
    setBlockingWarning({
      message,
      details: Array.isArray(details) ? details : [],
      title,
      onClear
    });
  };

  const openCodeWarning = (message) => {
    openBlockingWarning(message, [], 'Warning', () => {
      window.requestAnimationFrame(() => {
        codeInputRef.current?.focus();
        codeInputRef.current?.select?.();
      });
    });
  };

  const openSellerWarning = (message) => {
    openBlockingWarning(message, [], 'Warning', () => {
      window.requestAnimationFrame(() => {
        sellerInputRef.current?.focus();
        sellerInputRef.current?.select?.();
      });
    });
  };

  const openFromWarning = (message) => {
    openBlockingWarning(message, [], 'Warning', () => {
      window.requestAnimationFrame(() => {
        fromInputRef.current?.focus();
        fromInputRef.current?.select?.();
      });
    });
  };

  const openToWarning = (message) => {
    openBlockingWarning(message, [], 'Warning', () => {
      window.requestAnimationFrame(() => {
        toInputRef.current?.focus();
        toInputRef.current?.select?.();
      });
    });
  };

  const commitCodeInput = () => {
    const parsed = parseBookingCode(codeInput, shift);
    if (parsed.error) {
      setCodeInput('');
      setSem('');
      openCodeWarning(parsed.error);
      return false;
    }
    if (!parsed.semValue) {
      openCodeWarning('Code is empty');
      return false;
    }
    const allowedSemOptions = getAvailableSemOptions(amount);
    if (allowedSemOptions.length > 0 && !allowedSemOptions.includes(String(parsed.semValue))) {
      setCodeInput('');
      setSem('');
      openCodeWarning(`Amount ${amount} me SEM ${allowedSemOptions.join(', ')} hi allowed hai`);
      return false;
    }
    setShift(parsed.shift);
    setSem(parsed.semValue);
    setCodeInput(buildBookingCode(parsed.shift, parsed.semValue));
    onError?.('');
    return true;
  };

  const resetEntryInputs = () => {
    setShift(getShiftFromSession(initialSessionMode, initialPurchaseCategory));
    setAmount(initialAmount || '7');
    setSem('');
    setCodeInput('');
    setRangeStart('');
    setRangeEnd('');
    setActiveRowIndex(0);
  };

  const loadDraftRowIntoEditor = (row, index) => {
    if (!row) {
      resetEntryInputs();
      return;
    }
    setActiveRowIndex(index);
    setBookingDate(row.bookingDate || getTodayDateValue());
    setShift(row.shift);
    setAmount(row.amount);
    setSem(row.boxValue);
    setCodeInput(buildBookingCode(row.shift, row.boxValue));
    setRangeStart(row.rangeStart || '');
    setRangeEnd(row.rangeEnd || row.rangeStart || '');
  };

  const focusCodeInput = () => {
    window.requestAnimationFrame(() => {
      codeInputRef.current?.focus();
      codeInputRef.current?.select?.();
    });
  };

  const selectedEntryAmount = initialAmount || amount || '7';
  const activeAmountSellers = useMemo(
    () => sellers.filter((seller) => sellerSupportsAmount(seller, selectedEntryAmount)),
    [selectedEntryAmount, sellers]
  );
  const sellerOptions = useMemo(() => [
    { id: '', username: 'All Sellers', keyword: 'ALL' },
    ...activeAmountSellers
  ], [activeAmountSellers]);
  const currentSessionMode = getSessionMode(shift);
  const currentPurchaseCategory = getPurchaseCategory(shift);
  const bookingQuantity = getRangeCount(rangeStart, rangeEnd) * Number(activeSem || 0);
  const bookingAmount = bookingQuantity * Number(amount || 0);

  const scopedEntries = allEntries.filter((entry) => (
    (!filterSellerId || String(entry.sellerId) === String(filterSellerId))
    && (!selectedEntryAmount || String(entry.amount) === String(selectedEntryAmount))
    && (!fromDate || normalizeDateValue(entry.bookingDate) >= normalizeDateValue(fromDate))
    && (!toDate || normalizeDateValue(entry.bookingDate) <= normalizeDateValue(toDate))
    && (shift === 'ALL' || getEntryShift(entry) === shift)
  ));

  useEffect(() => {
    if (sellerId && !activeAmountSellers.some((seller) => String(seller.id) === String(sellerId))) {
      setSellerId('');
      setMemoNumber(null);
      setDraftRows([]);
      setShift(getShiftFromSession(initialSessionMode, initialPurchaseCategory));
      setAmount(initialAmount || '7');
      setSem('');
      setCodeInput('');
      setRangeStart('');
      setRangeEnd('');
      setActiveRowIndex(0);
    }
    if (filterSellerId && !activeAmountSellers.some((seller) => String(seller.id) === String(filterSellerId))) {
      setFilterSellerId('');
    }
  }, [activeAmountSellers, filterSellerId, initialAmount, initialPurchaseCategory, initialSessionMode, sellerId]);

  const memoSummaries = useMemo(() => {
    const currentDate = normalizeDateValue(bookingDate) || getTodayDateValue();
    const scoped = allEntries.filter((entry) => (
      String(entry.sellerId) === String(sellerId || '')
      && isSameDateValue(entry.bookingDate, currentDate)
      && isSameBookingScope(entry, currentSessionMode, currentPurchaseCategory)
    ));
    return groupRows(
      scoped,
      (entry) => String(entry.memoNumber || 0),
      (entry) => ({
        memoNumber: Number(entry.memoNumber || 0),
        drawDate: normalizeDateValue(entry.bookingDate),
        sessionMode: entry.sessionMode,
        purchaseCategory: entry.purchaseCategory,
        quantity: 0
      }),
      (summary, entry) => {
        summary.quantity += getEntryNumbers(entry).length * Number(entry.boxValue || 0);
      }
    ).filter((summary) => summary.memoNumber > 0).sort((left, right) => left.memoNumber - right.memoNumber);
  }, [allEntries, bookingDate, currentPurchaseCategory, currentSessionMode, sellerId]);

  const nextMemoNumber = memoSummaries.length > 0
    ? Math.max(...memoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const effectiveMemoNumber = Number(memoNumber || 0) || nextMemoNumber;
  const memoOptions = [
    { key: `booking-new-${nextMemoNumber}`, label: `New ${nextMemoNumber}`, memoNumber: nextMemoNumber, drawDate: normalizeDateValue(bookingDate) || getTodayDateValue(), quantity: 0, isNew: true },
    ...memoSummaries.map((memo) => ({ key: `booking-memo-${memo.memoNumber}`, label: memo.memoNumber, ...memo }))
  ];

  useEffect(() => {
    let mounted = true;
    userService.getUserTree()
      .then((response) => {
        if (!mounted) return;
        const rows = flattenSellerTree(response.data);
        setSellers(rows);
      })
      .catch((error) => onError?.(error.response?.data?.message || 'Seller list load nahi hua'));
    return () => {
      mounted = false;
    };
  }, [onError]);

  useEffect(() => {
    const currentDate = getTodayDateValue();
    const purgeKey = `lottery.adminBooking.${BOOKING_STORAGE_PURGE_VERSION}`;
    const shouldPurgeBookingEntries = !readJson(purgeKey, false);
    const normalizedEntries = shouldPurgeBookingEntries
      ? []
      : normalizeStoredBookingEntries(readJson(entriesKey, []));

    setAllEntries(normalizedEntries);
    writeJson(entriesKey, normalizedEntries);
    if (shouldPurgeBookingEntries) {
      purgeStoredBookingEntries(entriesKey, stateKey);
      writeJson(purgeKey, true);
    }

    const savedState = readJson(stateKey, null);
    setBookingDate(currentDate);
    setFromDate(currentDate);
    setToDate(currentDate);
    setDraftRows([]);
    setActiveRowIndex(0);
    setMemoNumber(null);
    setRangeStart('');
    setRangeEnd('');

    if (mode !== 'book' && savedState) {
      setSellerId(savedState.sellerId || '');
      setShift(savedState.shift || getShiftFromSession(initialSessionMode, initialPurchaseCategory));
      setAmount(initialAmount || savedState.amount || '7');
      setSem(savedState.sem || '');
      setCodeInput(savedState.codeInput || '');
      setFilterSellerId(savedState.filterSellerId || '');
      setResultRows(Array.isArray(savedState.resultRows) ? savedState.resultRows : []);
    } else {
      setSem('');
      setCodeInput('');
      setResultRows([]);
    }
    setMemoPopupOpen(false);
    setHydrated(true);
  }, [entriesKey, initialAmount, initialPurchaseCategory, initialSessionMode, mode, stateKey]);

  useEffect(() => {
    if (!hydrated) return;
    const syncCurrentDate = () => {
      const currentDate = getTodayDateValue();
      setBookingDate((value) => value || currentDate);
      setFromDate((value) => (mode === 'book' ? currentDate : value || currentDate));
      setToDate((value) => (mode === 'book' ? currentDate : value || currentDate));
    };
    syncCurrentDate();
    const intervalId = window.setInterval(syncCurrentDate, 60000);
    return () => window.clearInterval(intervalId);
  }, [hydrated, mode]);

  useEffect(() => {
    if (mode !== 'book' || !hydrated) return;
    onError?.('');
    onSuccess?.('');
    window.requestAnimationFrame(() => {
      sellerInputRef.current?.focus();
      sellerInputRef.current?.select?.();
    });
  }, [hydrated, mode, onError, onSuccess]);

  useFunctionShortcuts(mode === 'book', {
    A: () => {
      addOrUpdateDraftRow();
    },
    F2: () => {
      const form = document.getElementById('booking-number-form');
      form?.requestSubmit();
    },
    F3: () => {
      deleteActiveDraftRow();
    },
    F8: () => {
      setDraftRows([]);
      resetEntryInputs();
    },
    ESCAPE: () => {
      if (blockingWarning) {
        clearBlockingWarning();
        return;
      }
      onExit?.();
    }
  });

  useEffect(() => {
    if (mode !== 'book' || !blockingWarning) return undefined;
    const handleWarningEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      clearBlockingWarning();
    };
    window.addEventListener('keydown', handleWarningEscape, true);
    return () => window.removeEventListener('keydown', handleWarningEscape, true);
  }, [blockingWarning, clearBlockingWarning, mode]);

  useEffect(() => {
    if (!hydrated) return;
    writeJson(stateKey, {
      sellerId,
      bookingDate,
      shift,
      amount,
      sem,
      codeInput,
      rangeStart,
      rangeEnd,
      activeRowIndex,
      memoNumber,
      filterSellerId,
      fromDate,
      toDate,
      resultRows
    });
  }, [activeRowIndex, amount, bookingDate, codeInput, filterSellerId, fromDate, hydrated, memoNumber, rangeEnd, rangeStart, resultRows, sellerId, sem, shift, stateKey, toDate]);

  const persistEntries = (nextEntries) => {
    const normalizedEntries = normalizeStoredBookingEntries(nextEntries);
    setAllEntries(normalizedEntries);
    writeJson(entriesKey, normalizedEntries);
  };

  const uploadMemoRowsToServer = useCallback(({
    memoNumber: targetMemoNumber,
    sellerId: targetSellerId,
    bookingDate: targetDate,
    sessionMode: targetSessionMode,
    purchaseCategory: targetPurchaseCategory,
    rows
  }) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    const payload = {
      memoNumber: targetMemoNumber,
      sellerId: targetSellerId,
      bookingDate: targetDate,
      sessionMode: targetSessionMode || currentSessionMode,
      purchaseCategory: targetPurchaseCategory || currentPurchaseCategory,
      entries: safeRows.map((row, index) => ({
        rowOrder: Number.isInteger(Number(row.rowOrder)) ? Number(row.rowOrder) : index,
        bookingDate: row.bookingDate || targetDate,
        sessionMode: row.sessionMode || targetSessionMode || currentSessionMode,
        purchaseCategory: row.purchaseCategory || targetPurchaseCategory || currentPurchaseCategory,
        amount: row.amount,
        boxValue: row.boxValue,
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd || row.rangeStart
      }))
    };

    return bookingService.replaceMemo(payload)
      .then((response) => {
        const serverEntries = normalizeServerBookingEntries(response.data?.entries);
        if (serverEntries.length === 0) return response;
        const serverScopeKeys = new Set(serverEntries.map(getBookingEntryScopeKey));
        setAllEntries((currentEntries) => {
          const mergedEntries = normalizeStoredBookingEntries([
            ...currentEntries.filter((entry) => !serverScopeKeys.has(getBookingEntryScopeKey(entry))),
            ...serverEntries
          ]);
          writeJson(entriesKey, mergedEntries);
          return mergedEntries;
        });
        return response;
      });
  }, [currentPurchaseCategory, currentSessionMode, entriesKey]);

  useEffect(() => {
    if (mode !== 'book' || !hydrated || serverSyncKeyRef.current === entriesKey) return;
    serverSyncKeyRef.current = entriesKey;
    const localEntriesBeforeSync = allEntries;
    bookingService.getEntries()
      .then((response) => {
        const serverEntries = normalizeServerBookingEntries(response.data);
        const serverScopeKeys = new Set(serverEntries.map(getBookingEntryScopeKey));
        if (serverEntries.length > 0) {
          setAllEntries((currentEntries) => {
            const mergedEntries = normalizeStoredBookingEntries([
              ...currentEntries.filter((entry) => !serverScopeKeys.has(getBookingEntryScopeKey(entry))),
              ...serverEntries
            ]);
            writeJson(entriesKey, mergedEntries);
            return mergedEntries;
          });
        }

        const localMemoGroups = groupRows(
          localEntriesBeforeSync.filter((entry) => (
            !entry.serverId
            && entry.memoNumber
            && entry.sellerId
            && entry.bookingDate
            && entry.rangeStart
          )),
          getBookingEntryScopeKey,
          (entry) => ({
            memoNumber: Number(entry.memoNumber || 0),
            sellerId: entry.sellerId,
            bookingDate: normalizeDateValue(entry.bookingDate),
            sessionMode: entry.sessionMode,
            purchaseCategory: entry.purchaseCategory,
            rows: []
          }),
          (group, entry) => {
            group.rows.push(entry);
          }
        );

        localMemoGroups.forEach((group) => {
          uploadMemoRowsToServer({
            memoNumber: group.memoNumber,
            sellerId: group.sellerId,
            bookingDate: group.bookingDate,
            sessionMode: group.sessionMode,
            purchaseCategory: group.purchaseCategory,
            rows: group.rows.sort((left, right) => Number(left.rowOrder ?? 0) - Number(right.rowOrder ?? 0))
          }).catch((error) => {
            console.warn('Booking local backup failed:', error.response?.data?.message || error.message);
          });
        });
      })
      .catch((error) => {
        console.warn('Booking server sync failed:', error.response?.data?.message || error.message);
      });
  }, [allEntries, entriesKey, hydrated, mode, uploadMemoRowsToServer]);

  const backupMemoToServer = ({ memoNumber: targetMemoNumber, sellerId: targetSellerId, bookingDate: targetDate, rows }) => {
    uploadMemoRowsToServer({
      memoNumber: targetMemoNumber,
      sellerId: targetSellerId,
      bookingDate: targetDate,
      sessionMode: currentSessionMode,
      purchaseCategory: currentPurchaseCategory,
      rows
    })
      .catch((error) => {
        console.warn('Booking memo server backup failed:', error.response?.data?.message || error.message);
      });
  };

  const addOrUpdateDraftRow = () => {
    onError?.('');
    onSuccess?.('');
    if (!sellerId) {
      openSellerWarning('Seller select karo');
      return false;
    }
    if (!activeSem) {
      openCodeWarning('Code is empty');
      return false;
    }
    const allowedSemOptions = getAvailableSemOptions(amount);
    if (allowedSemOptions.length > 0 && !allowedSemOptions.includes(String(activeSem))) {
      openCodeWarning(`Amount ${amount} me SEM ${allowedSemOptions.join(', ')} hi allowed hai`);
      return false;
    }
    if (!rangeStart) {
      openFromWarning('From number required');
      return false;
    }
    const previousRow = draftRows[Math.min(activeRowIndex, draftRows.length) - 1] || null;
    const normalizedFrom = normalizeRangeStartInput(rangeStart, previousRow?.rangeStart);
    const normalizedEnd = normalizeRangeEndInput(rangeEnd, normalizedFrom.value);
    const normalizedTo = normalizedEnd.value;
    if (normalizedFrom.error || !normalizedFrom.value) {
      openFromWarning(normalizedFrom.error);
      return false;
    }
    if (normalizedEnd.error || !normalizedEnd.value) {
      openToWarning(normalizedEnd.error);
      return false;
    }
    if (getRangeCount(normalizedFrom.value, normalizedTo) <= 0) {
      openToWarning('To number from number se chhota nahi ho sakta');
      return false;
    }

    const row = {
      id: `booking-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sellerId,
      sellerName: selectedSeller?.username || '',
      bookingDate: normalizeDateValue(bookingDate) || getTodayDateValue(),
      shift,
      sessionMode: currentSessionMode,
      purchaseCategory: currentPurchaseCategory,
      amount,
      boxValue: activeSem,
      rangeStart: normalizedFrom.value,
      rangeEnd: normalizedTo
    };

    const isUpdatingExistingRow = activeRowIndex < draftRows.length;
    setDraftRows((currentRows) => {
      if (activeRowIndex < currentRows.length) {
        const nextRows = [...currentRows];
        nextRows[activeRowIndex] = { ...row, id: currentRows[activeRowIndex].id };
        return nextRows;
      }
      return [...currentRows, row];
    });
    if (isUpdatingExistingRow) {
      setRangeStart('');
      setRangeEnd('');
      setActiveRowIndex(draftRows.length);
      focusCodeInput();
      return true;
    }
    setRangeStart('');
    setRangeEnd('');
    setActiveRowIndex(draftRows.length + 1);
    focusCodeInput();
    return true;
  };

  const moveDraftSelection = (delta) => {
    const maxIndex = draftRows.length;
    const nextIndex = Math.max(0, Math.min(activeRowIndex + delta, maxIndex));
    const nextRow = draftRows[nextIndex];
    if (nextRow) {
      loadDraftRowIntoEditor(nextRow, nextIndex);
      return;
    }
    setActiveRowIndex(nextIndex);
    setRangeStart('');
    setRangeEnd('');
  };

  const getRowsForSave = () => {
    const rows = [...draftRows];
    if (rangeStart && activeSem) {
      const previousRow = rows[Math.min(activeRowIndex, rows.length) - 1] || null;
      const normalizedFrom = normalizeRangeStartInput(rangeStart, previousRow?.rangeStart);
      if (normalizedFrom.error || !normalizedFrom.value) {
        return rows;
      }
      const normalizedEnd = normalizeRangeEndInput(rangeEnd, normalizedFrom.value);
      if (normalizedEnd.error || !normalizedEnd.value) {
        return rows;
      }
      const normalizedTo = normalizedEnd.value;
      if (getRangeCount(normalizedFrom.value, normalizedTo) <= 0) {
        return rows;
      }
      const rowToSave = {
        sellerId,
        sellerName: selectedSeller?.username || '',
        bookingDate: normalizeDateValue(bookingDate) || getTodayDateValue(),
        shift,
        sessionMode: currentSessionMode,
        purchaseCategory: currentPurchaseCategory,
        amount,
        boxValue: activeSem,
        rangeStart: normalizedFrom.value,
        rangeEnd: normalizedTo
      };
      if (activeRowIndex < rows.length) {
        rows[activeRowIndex] = {
          ...rowToSave,
          id: rows[activeRowIndex].id
        };
      } else {
        rows.push(rowToSave);
      }
    }
    return rows;
  };

  const saveBookNumbers = (event) => {
    event.preventDefault();
    onError?.('');
    onSuccess?.('');
    const currentDate = normalizeDateValue(bookingDate) || getTodayDateValue();
    setBookingDate(currentDate);
    if (!sellerId) {
      openSellerWarning('Seller select karo');
      return;
    }
    const rowsToSave = getRowsForSave();
    const memoHasSavedRows = allEntries.some((entry) => (
      String(entry.sellerId) === String(sellerId)
      && Number(entry.memoNumber) === Number(effectiveMemoNumber)
      && isSameDateValue(entry.bookingDate, currentDate)
      && isSameBookingScope(entry, currentSessionMode, currentPurchaseCategory)
    ));
    if (rowsToSave.length === 0) {
      if (memoHasSavedRows) {
        const nextEntries = allEntries.filter((entry) => !(
          String(entry.sellerId) === String(sellerId)
          && Number(entry.memoNumber) === Number(effectiveMemoNumber)
          && isSameDateValue(entry.bookingDate, currentDate)
          && isSameBookingScope(entry, currentSessionMode, currentPurchaseCategory)
        ));
        persistEntries(nextEntries);
        backupMemoToServer({
          memoNumber: effectiveMemoNumber,
          sellerId,
          bookingDate: currentDate,
          rows: []
        });
        setDraftRows([]);
        resetEntryInputs();
        setMemoNumber(null);
        return;
      }
      openCodeWarning('Booking row add karo');
      return;
    }

    const saveTimestamp = new Date().toISOString();
    const entriesToSave = rowsToSave.map((row, index) => ({
      id: `admin-booking-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      memoNumber: effectiveMemoNumber,
      rowOrder: index,
      sellerId: String(row.sellerId),
      sellerName: row.sellerName,
      bookingDate: currentDate,
      shift: row.shift,
      sessionMode: row.sessionMode,
      purchaseCategory: row.purchaseCategory,
      amount: String(row.amount),
      boxValue: String(row.boxValue),
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd || row.rangeStart,
      createdAt: saveTimestamp
    }));

    const nextEntries = [
      ...allEntries.filter((entry) => !(
        String(entry.sellerId) === String(sellerId)
        && Number(entry.memoNumber) === Number(effectiveMemoNumber)
        && isSameDateValue(entry.bookingDate, currentDate)
        && isSameBookingScope(entry, currentSessionMode, currentPurchaseCategory)
      )),
      ...entriesToSave
    ];
    persistEntries(nextEntries);
    backupMemoToServer({
      memoNumber: effectiveMemoNumber,
      sellerId,
      bookingDate: currentDate,
      rows: entriesToSave
    });
    setDraftRows([]);
    resetEntryInputs();
    setMemoNumber(effectiveMemoNumber);
  };

  const hydrateMemo = (selectedMemo) => {
    const currentDate = normalizeDateValue(selectedMemo.drawDate || bookingDate) || getTodayDateValue();
    let rows = allEntries
      .filter((entry) => (
        String(entry.sellerId) === String(sellerId)
        && Number(entry.memoNumber) === Number(selectedMemo.memoNumber)
        && isSameDateValue(entry.bookingDate, currentDate)
        && isSameBookingScope(
          entry,
          selectedMemo.sessionMode || currentSessionMode,
          selectedMemo.purchaseCategory || currentPurchaseCategory
        )
      ))
      .map((entry) => ({
        id: `booking-existing-${entry.id}`,
        sellerId: String(entry.sellerId),
        sellerName: entry.sellerName,
        bookingDate: currentDate,
        shift: getShiftLabel(entry.sessionMode, entry.purchaseCategory),
        sessionMode: entry.sessionMode,
        purchaseCategory: entry.purchaseCategory,
        amount: String(entry.amount),
        boxValue: String(entry.boxValue),
        rangeStart: entry.rangeStart || entry.number,
        rangeEnd: entry.rangeEnd || entry.rangeStart || entry.number
      }));
    setMemoNumber(selectedMemo.memoNumber);
    setBookingDate(currentDate);
    setDraftRows(rows);
    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1];
      setActiveRowIndex(rows.length);
      setBookingDate(currentDate);
      setShift(lastRow.shift);
      setAmount(lastRow.amount);
      setSem(lastRow.boxValue);
      setCodeInput(buildBookingCode(lastRow.shift, lastRow.boxValue));
      setRangeStart('');
      setRangeEnd('');
    } else {
      resetEntryInputs();
      setBookingDate(currentDate);
    }
    setMemoPopupOpen(false);
    focusCodeInput();
  };

  const deleteActiveDraftRow = () => {
    if (draftRows.length === 0) {
      setRangeStart('');
      setRangeEnd('');
      focusCodeInput();
      return;
    }
    const deleteIndex = activeRowIndex < draftRows.length ? activeRowIndex : draftRows.length - 1;
    const nextRows = draftRows.filter((_, index) => index !== deleteIndex);
    setDraftRows(nextRows);
    if (nextRows.length === 0) {
      resetEntryInputs();
      focusCodeInput();
      return;
    }
    const nextIndex = Math.min(deleteIndex, nextRows.length - 1);
    loadDraftRowIntoEditor(nextRows[nextIndex], nextIndex);
    focusCodeInput();
  };

  const loadSummary = () => {
    setResultRows(groupRows(
      scopedEntries,
      (entry) => [entry.sellerId, entry.amount, entry.boxValue].join('|'),
      (entry) => ({
        sellerId: entry.sellerId,
        sellerName: entry.sellerName,
        amount: entry.amount,
        sem: entry.boxValue,
        numberCount: 0,
        numberRanges: [],
        totalPiece: 0,
        totalAmount: 0
      }),
      (summary, entry) => {
        const entryNumbers = getEntryNumbers(entry);
        const numberCount = entryNumbers.length;
        summary.numberCount += numberCount;
        summary.numberRanges.push(...entryNumbers);
        summary.totalPiece += numberCount * Number(entry.boxValue || 0);
        summary.totalAmount += numberCount * Number(entry.boxValue || 0) * Number(entry.amount || 0);
      }
    ).flatMap((row) => getNumberRangeGroups(row.numberRanges).map((range, index) => ({
      ...row,
      numberRangeLabel: range.label,
      numberCount: range.count,
      totalPiece: range.count * Number(row.sem || 0),
      totalAmount: range.count * Number(row.sem || 0) * Number(row.amount || 0),
      rangeSortIndex: index
    }))).sort((left, right) => (
      String(left.sellerName).localeCompare(String(right.sellerName))
      || Number(left.amount) - Number(right.amount)
      || Number(left.sem) - Number(right.sem)
      || Number(left.rangeSortIndex || 0) - Number(right.rangeSortIndex || 0)
    )));
  };

  const getBookingPrizeRows = async () => {
    const prizeLookupKeys = [...new Set(scopedEntries.map((entry) => [
      entry.bookingDate,
      entry.sessionMode,
      entry.purchaseCategory
    ].join('|')).filter(Boolean))];
    const prizeResponses = await Promise.all(prizeLookupKeys.map(async (lookupKey) => {
      const [dateValue, sessionMode, purchaseCategory] = lookupKey.split('|');
      const response = await priceService.getAllPrices({
        resultForDate: dateValue,
        sessionMode,
        purchaseCategory
      });
      return {
        lookupKey,
        prizes: Array.isArray(response.data) ? response.data : []
      };
    }));
    const prizesByEntryKey = prizeResponses.reduce((groups, item) => {
      groups[item.lookupKey] = item.prizes;
      return groups;
    }, {});

    return scopedEntries.flatMap((entry) => getEntryNumbers(entry).flatMap((number) => (
      (prizesByEntryKey[[entry.bookingDate, entry.sessionMode, entry.purchaseCategory].join('|')] || [])
        .filter((prize) => {
          const winningNumber = String(prize.winningNumber || prize.winning_number || '');
          const digitLength = Number(prize.digitLength || prize.digit_length || winningNumber.length);
          return String(number || '').slice(-digitLength) === winningNumber;
        })
        .map((prize) => {
          const row = {
            ...entry,
            number,
            prizeKey: prize.prizeKey || prize.prize_key,
            prizeLabel: prize.prizeLabel || prize.prize_label,
            fullPrizeAmount: prize.fullPrizeAmount || prize.full_prize_amount || prize.prizeAmount || prize.prize_amount,
            winningNumber: prize.winningNumber || prize.winning_number
          };
          return {
            ...row,
            calculatedPrize: getPrizeAdjustmentAmounts(row).prize
          };
        })
    )));
  };

  const loadPrizeBooking = async () => {
    setLoading(true);
    onError?.('');
    try {
      setResultRows(await getBookingPrizeRows());
    } catch (error) {
      setResultRows([]);
      onError?.(error.response?.data?.message || 'Prize booking load nahi hua');
    } finally {
      setLoading(false);
    }
  };

  const getBookingBillRows = async () => {
    const prizeRows = await getBookingPrizeRows();
    const prizeTotalsBySeller = prizeRows.reduce((groups, row) => {
      const key = String(row.sellerId);
      if (!groups[key]) groups[key] = { totalPrize: 0, totalVc: 0, totalSvc: 0 };
      const adjustments = getPrizeAdjustmentAmounts(row);
      groups[key].totalPrize += adjustments.prize;
      groups[key].totalVc += adjustments.vc;
      groups[key].totalSvc += adjustments.svc;
      return groups;
    }, {});
    return groupRows(
      scopedEntries,
      (entry) => [entry.sellerId, entry.amount].join('|'),
      (entry) => ({
        sellerId: entry.sellerId,
        sellerName: entry.sellerName,
        amount: entry.amount,
        sem: entry.boxValue,
        totalSentPiece: 0,
        totalUnsoldPiece: 0,
        totalSoldPiece: 0,
        totalSales: 0,
        totalPrize: 0,
        totalVc: 0,
        totalSvc: 0,
        netBill: 0
      }),
      (summary, entry) => {
        const seller = sellers.find((item) => String(item.id) === String(entry.sellerId));
        const piece = getEntryNumbers(entry).length * Number(entry.boxValue || 0);
        const rate = getSellerRate(seller, entry.amount);
        summary.totalSentPiece += piece;
        summary.totalSoldPiece += piece;
        summary.totalSales += piece * rate;
      }
    ).map((row) => {
      const adjustments = prizeTotalsBySeller[String(row.sellerId)] || {};
      const totalPrize = Number(adjustments.totalPrize || 0);
      const totalVc = Number(adjustments.totalVc || 0);
      const totalSvc = Number(adjustments.totalSvc || 0);
      return {
        ...row,
        totalUnsoldPiece: 0,
        totalPrize,
        totalVc,
        totalSvc,
        netBill: Number(row.totalSales || 0) - totalPrize - totalVc - totalSvc
      };
    });
  };

  const loadBillBooking = async () => {
    setLoading(true);
    onError?.('');
    try {
      setResultRows(await getBookingBillRows());
    } catch (error) {
      setResultRows([]);
      onError?.(error.response?.data?.message || 'Bill booking load nahi hua');
    } finally {
      setLoading(false);
    }
  };

  const generateBookingBill = async () => {
    setLoading(true);
    onError?.('');
    try {
      const billRows = await getBookingBillRows();
      setResultRows(billRows);
      if (billRows.length === 0) {
        onError?.('No bill data found');
        return;
      }
      const sellerName = activeAmountSellers.find((seller) => String(seller.id) === String(filterSellerId))?.username || '';
      const didOpen = openTransferBill(createBookingPrintableBill({
        rows: billRows,
        username: currentUser?.username || 'Admin',
        fromDate,
        toDate,
        shift,
        sellerName
      }));
      if (!didOpen) {
        onError?.('Allow pop-up to generate bill');
      }
    } catch (error) {
      onError?.(error.response?.data?.message || 'Bill generate nahi hua');
    } finally {
      setLoading(false);
    }
  };

  if (mode !== 'book') {
    const titleMap = {
      record: 'Summary Booking',
      'price-track': 'Prize Booking',
      bill: 'Bill Booking'
    };
    const loadAction = mode === 'record' ? loadSummary : (mode === 'price-track' ? loadPrizeBooking : loadBillBooking);
    const primaryLoadLabel = mode === 'bill' ? 'Preview Bill Data' : 'View';
    const shiftOptions = mode === 'book' ? SHIFT_OPTIONS : BILL_SHIFT_OPTIONS;

    return (
      <div className="accordion-content">
        <h2>{titleMap[mode] || 'Booking'}</h2>
        <div className="form-group">
          <label>From Date:</label>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <label>To Date:</label>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          <label>{mode === 'bill' ? 'Select Shift:' : 'Shift:'}</label>
          <select value={shift} onChange={(event) => setShift(event.target.value)}>
            {shiftOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <label>{mode === 'bill' ? 'Select Seller:' : 'Seller:'}</label>
          {mode === 'bill' ? (
            <select value={filterSellerId} onChange={(event) => setFilterSellerId(event.target.value)}>
              <option value="">ALL All Direct Sellers</option>
              {activeAmountSellers.map((seller) => (
                <option key={seller.id || seller.username} value={seller.id}>
                  {`${seller.keyword || ''} ${seller.username} [${seller.keyword || ''}]`.trim()}
                </option>
              ))}
            </select>
          ) : (
            <SearchableSellerSelect
              options={sellerOptions}
              value={filterSellerId}
              onChange={(seller) => setFilterSellerId(String(seller?.id || ''))}
              getOptionValue={(option) => option.id}
              getOptionLabel={(option) => option.id ? option.username : 'All Sellers'}
              placeholder="Seller select karo"
            />
          )}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
            <button type="button" onClick={loadAction} disabled={loading}>{loading ? 'Loading...' : primaryLoadLabel}</button>
          {mode === 'bill' ? (
            <button type="button" onClick={generateBookingBill} disabled={loading} style={{ backgroundColor: '#2f855a' }}>
              Generate Bill
            </button>
          ) : null}
          </div>
        </div>
        {mode === 'record' && <BookingSummaryTable rows={resultRows} />}
        {mode === 'price-track' && <BookingPrizeTable rows={resultRows} />}
        {mode === 'bill' && <BookingBillTable rows={resultRows} />}
      </div>
    );
  }

  const gridRows = createGridRows(draftRows);
  const draftSummary = draftRows.reduce((summary, row, index) => {
    const rowQuantity = getRangeCount(row.rangeStart, row.rangeEnd) * Number(row.boxValue || 0);
    if (index === activeRowIndex) {
      return summary;
    }
    return {
      quantity: summary.quantity + rowQuantity,
      amount: summary.amount + (rowQuantity * Number(row.amount || 0))
    };
  }, { quantity: 0, amount: 0 });
  const visibleSummaryQuantity = draftSummary.quantity + bookingQuantity;
  const visibleSummaryAmount = draftSummary.amount + bookingAmount;
  const editableRow = (
    <tr key="booking-entry-row">
      <td>{activeRowIndex + 1}</td>
      <td>
        <input
          ref={codeInputRef}
          type="text"
          value={codeInput}
          onChange={(event) => {
            setCodeInput(event.target.value.toUpperCase());
          }}
          onKeyDown={(event) => {
            if (shouldMoveFocusVertical(event, 'ArrowUp')) {
              event.preventDefault();
              moveDraftSelection(-1);
              window.requestAnimationFrame(() => {
                codeInputRef.current?.focus();
                codeInputRef.current?.select?.();
              });
              return;
            }
            if (shouldMoveFocusVertical(event, 'ArrowDown')) {
              event.preventDefault();
              moveDraftSelection(1);
              window.requestAnimationFrame(() => {
                codeInputRef.current?.focus();
                codeInputRef.current?.select?.();
              });
              return;
            }
            if (shouldMoveFocusRight(event)) {
              event.preventDefault();
              if (!commitCodeInput()) {
                return;
              }
              fromInputRef.current?.focus();
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!commitCodeInput()) {
                return;
              }
              fromInputRef.current?.focus();
            }
          }}
        />
      </td>
      <td>{selectedSeller?.username || ''}</td>
      <td>{bookingDate}</td>
      <td>{getDisplayDay(bookingDate)}</td>
      <td>
        <input
          ref={fromInputRef}
          type="text"
          value={rangeStart}
          onChange={(event) => setRangeStart(numberInput(event.target.value))}
          maxLength="5"
          onInput={(event) => {
            const normalized = numberInput(event.currentTarget.value);
            if (normalized.length === 5) {
              setRangeStart(normalized);
              setRangeEnd(normalized);
              window.requestAnimationFrame(() => {
                toInputRef.current?.focus();
                toInputRef.current?.select?.();
              });
            }
          }}
          onKeyDown={(event) => {
            if (shouldMoveFocusVertical(event, 'ArrowUp')) {
              event.preventDefault();
              moveDraftSelection(-1);
              window.requestAnimationFrame(() => {
                fromInputRef.current?.focus();
                fromInputRef.current?.select?.();
              });
              return;
            }
            if (shouldMoveFocusVertical(event, 'ArrowDown')) {
              event.preventDefault();
              moveDraftSelection(1);
              window.requestAnimationFrame(() => {
                fromInputRef.current?.focus();
                fromInputRef.current?.select?.();
              });
              return;
            }
            if (shouldMoveFocusLeft(event)) {
              event.preventDefault();
              window.requestAnimationFrame(() => {
                codeInputRef.current?.focus();
                codeInputRef.current?.select?.();
              });
              return;
            }
            if (shouldMoveFocusRight(event)) {
              event.preventDefault();
              const previousRow = draftRows[Math.min(activeRowIndex, draftRows.length) - 1] || null;
              const normalized = normalizeRangeStartInput(rangeStart, previousRow?.rangeStart);
              if (normalized.error || !normalized.value) {
                openFromWarning(normalized.error);
                return;
              }
              setRangeStart(normalized.value);
              setRangeEnd((current) => numberInput(current || normalized.value).padStart(5, '0'));
              window.requestAnimationFrame(() => {
                toInputRef.current?.focus();
                toInputRef.current?.select?.();
              });
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const previousRow = draftRows[Math.min(activeRowIndex, draftRows.length) - 1] || null;
              const normalized = normalizeRangeStartInput(rangeStart, previousRow?.rangeStart);
              if (normalized.error || !normalized.value) {
                openFromWarning(normalized.error);
                return;
              }
              setRangeStart(normalized.value);
              setRangeEnd((current) => numberInput(current || normalized.value).padStart(5, '0'));
              window.requestAnimationFrame(() => {
                toInputRef.current?.focus();
                toInputRef.current?.select?.();
              });
            }
          }}
        />
      </td>
      <td>
        <input
          ref={toInputRef}
          type="text"
          className={rangeEnd && rangeEnd === rangeStart ? 'retro-grid-autofill' : ''}
          value={rangeEnd}
          onChange={(event) => setRangeEnd(numberInput(event.target.value))}
          maxLength="5"
          onKeyDown={(event) => {
            if (shouldMoveFocusVertical(event, 'ArrowUp')) {
              event.preventDefault();
              moveDraftSelection(-1);
              window.requestAnimationFrame(() => {
                toInputRef.current?.focus();
                toInputRef.current?.select?.();
              });
              return;
            }
            if (shouldMoveFocusVertical(event, 'ArrowDown')) {
              event.preventDefault();
              moveDraftSelection(1);
              window.requestAnimationFrame(() => {
                toInputRef.current?.focus();
                toInputRef.current?.select?.();
              });
              return;
            }
            if (shouldMoveFocusLeft(event)) {
              event.preventDefault();
              fromInputRef.current?.focus();
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const normalizedTo = normalizeRangeEndInput(rangeEnd, rangeStart);
              if (normalizedTo.error || !normalizedTo.value) {
                openToWarning(normalizedTo.error);
                return;
              }
              setRangeEnd(normalizedTo.value);
              addOrUpdateDraftRow();
            }
          }}
        />
      </td>
      <td>{bookingQuantity || ''}</td>
      <td>{Number(amount || 0).toFixed(2)}</td>
      <td>{bookingAmount ? bookingAmount.toFixed(2) : ''}</td>
    </tr>
  );

  return (
    <RetroPurchasePanel
      screenCode="RAHUL"
      screenTitle={entryCompanyLabel || 'ADMIN BOOK NUMBERS'}
      panelTitle="Book Numbers"
      headerTimestamp={new Date().toLocaleString('en-IN')}
      windowClassName="full-page booking-full-page"
      formId="booking-number-form"
      onSubmit={saveBookNumbers}
      formRows={[
        {
          label: 'Seller Name',
          className: 'wide',
          content: (
            <SearchableSellerSelect
              inputRef={sellerInputRef}
              options={activeAmountSellers}
              value={sellerId}
          onChange={(seller) => {
            setSellerId(String(seller?.id || ''));
            setMemoNumber(null);
            setMemoSelectionIndex(0);
            setMemoPopupOpen(false);
            setDraftRows([]);
            resetEntryInputs();
          }}
              getOptionValue={(option) => option.id}
              getOptionLabel={(option) => `${option.username} [${option.keyword || ''}]`}
              placeholder="Seller select karo"
              onEnter={() => dateInputRef.current?.focus()}
              enterMovesWhenSelected
            />
          )
        },
        {
          label: 'Date',
          className: 'medium',
          content: (
            <input
              ref={dateInputRef}
              type="date"
              value={bookingDate}
              onChange={(event) => {
                setBookingDate(event.target.value);
                setMemoNumber(null);
                setMemoSelectionIndex(0);
                setMemoPopupOpen(false);
                setDraftRows([]);
                resetEntryInputs();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  memoRef.current?.focus();
                }
              }}
            />
          )
        }
      ]}
      gridRows={gridRows}
      editableRow={editableRow}
      editableRowIndex={Math.min(activeRowIndex, gridRows.length)}
      activeGridRowIndex={activeRowIndex < gridRows.length ? activeRowIndex : null}
      onGridRowClick={(row, index) => {
        const draftRow = draftRows[index];
        if (!draftRow) return;
        setActiveRowIndex(index);
        setShift(draftRow.shift);
        setAmount(draftRow.amount);
        setSem(draftRow.boxValue);
        setCodeInput(buildBookingCode(draftRow.shift, draftRow.boxValue));
        setRangeStart(draftRow.rangeStart);
        setRangeEnd(draftRow.rangeEnd);
      }}
      summaryQuantity={visibleSummaryQuantity}
      summaryAmount={visibleSummaryAmount}
      statusLabel="LOCAL"
      memoNumber={effectiveMemoNumber}
      memoProps={{
        ref: memoRef,
        tabIndex: 0,
        onFocus: () => setMemoPopupOpen(true),
        onClick: () => {
          if (!memoPopupOpen) {
            setMemoPopupOpen(true);
          }
        },
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!memoPopupOpen) {
              setMemoPopupOpen(true);
            }
            setMemoSelectionIndex((currentIndex) => {
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              const nextIndex = currentIndex + delta;
              if (nextIndex < 0) return 0;
              if (nextIndex >= memoOptions.length) return Math.max(memoOptions.length - 1, 0);
              return nextIndex;
            });
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setMemoPopupOpen(false);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!memoPopupOpen) {
              setMemoPopupOpen(true);
              return;
            }
            const selectedOption = memoOptions[memoSelectionIndex] || memoOptions[0];
            if (!selectedOption) return;
            if (selectedOption.isNew) {
              setMemoNumber(selectedOption.memoNumber);
              setDraftRows([]);
              resetEntryInputs();
              setMemoPopupOpen(false);
              window.requestAnimationFrame(() => {
                codeInputRef.current?.focus();
                codeInputRef.current?.select?.();
              });
              return;
            }
            hydrateMemo(selectedOption);
          }
        }
      }}
      memoSelector={{
        isOpen: memoPopupOpen,
        variant: 'table',
        options: memoOptions,
        activeIndex: memoSelectionIndex,
        onHighlight: setMemoSelectionIndex,
        onSelect: (option, index) => {
          setMemoSelectionIndex(index);
          if (option.isNew) {
            setMemoNumber(option.memoNumber);
            setDraftRows([]);
            resetEntryInputs();
            setMemoPopupOpen(false);
            return;
          }
          hydrateMemo(option);
        }
      }}
      footerActions={[
        { label: 'Add (A)', shortcut: 'A', onClick: addOrUpdateDraftRow },
        { label: 'Save (F2)', shortcut: 'F2', type: 'submit', form: 'booking-number-form', variant: 'primary' },
        { label: 'Delete (F3)', shortcut: 'F3', onClick: deleteActiveDraftRow },
        {
          label: 'Clear (F8)',
          shortcut: 'F8',
          onClick: () => {
            setDraftRows([]);
            resetEntryInputs();
          }
        }
      ]}
      showStatusField={false}
      blockingWarning={blockingWarning}
      onBlockingWarningClose={clearBlockingWarning}
      topShortcuts={['F2-Save', 'F3-Delete', 'F8-Clear', 'Esc-Exit']}
    />
  );
};

const BookingSummaryTable = ({ rows }) => (
  <div className="entries-list-block" style={{ marginTop: '20px' }}>
    <table className="entries-table">
      <thead>
        <tr>
          <th>Seller</th>
          <th>Base</th>
          <th>SEM</th>
          <th>From - To Numbers</th>
          <th>Total Nos</th>
          <th>Piece</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row) => (
          <tr key={`${row.sellerId}-${row.amount}-${row.sem}-${row.numberRangeLabel}-${row.rangeSortIndex}`}>
            <td>{row.sellerName}</td>
            <td>{row.amount}</td>
            <td>{row.sem}</td>
            <td>{row.numberRangeLabel || '-'}</td>
            <td>{row.numberCount}</td>
            <td>{Number(row.totalPiece || 0).toFixed(2)}</td>
            <td>{Number(row.totalAmount || 0).toFixed(2)}</td>
          </tr>
        )) : <tr><td colSpan="7">No booking summary found</td></tr>}
      </tbody>
    </table>
  </div>
);

const BookingPrizeTable = ({ rows }) => (
  <div className="entries-list-block" style={{ marginTop: '20px' }}>
    <table className="entries-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Seller</th>
          <th>Base</th>
          <th>SEM</th>
          <th>Number</th>
          <th>Prize</th>
          <th>Winning</th>
          <th>Prize Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row) => (
          <tr key={`${row.id}-${row.prizeKey}-${row.winningNumber}`}>
            <td>{formatDisplayDate(row.bookingDate)}</td>
            <td>{row.sellerName}</td>
            <td>{row.amount}</td>
            <td>{row.boxValue}</td>
            <td>{row.number}</td>
            <td>{row.prizeLabel}</td>
            <td>{row.winningNumber}</td>
            <td>{Number(row.calculatedPrize || 0).toFixed(2)}</td>
          </tr>
        )) : <tr><td colSpan="8">Selected filter me booking prize nahi mila</td></tr>}
      </tbody>
    </table>
  </div>
);

const BookingBillTable = ({ rows }) => {
  const totals = rows.reduce((sum, row) => ({
    totalSentPiece: sum.totalSentPiece + Number(row.totalSentPiece || 0),
    totalSoldPiece: sum.totalSoldPiece + Number(row.totalSoldPiece || 0),
    totalSales: sum.totalSales + Number(row.totalSales || 0),
    totalPrize: sum.totalPrize + Number(row.totalPrize || 0),
    totalVc: sum.totalVc + Number(row.totalVc || 0),
    totalSvc: sum.totalSvc + Number(row.totalSvc || 0),
    netBill: sum.netBill + Number(row.netBill || 0)
  }), { totalSentPiece: 0, totalSoldPiece: 0, totalSales: 0, totalPrize: 0, totalVc: 0, totalSvc: 0, netBill: 0 });

  return (
    <div className="entries-list-block" style={{ marginTop: '20px' }}>
      <table className="entries-table">
        <thead>
          <tr>
            <th>Seller</th>
            <th>Base</th>
            <th>Booking Piece</th>
            <th>Sold Piece</th>
            <th>Net Value</th>
            <th>Prize</th>
            <th>VC</th>
            <th>SVC</th>
            <th>Net Bill</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row) => (
            <tr key={`${row.sellerId}-${row.amount}`}>
              <td>{row.sellerName}</td>
              <td>{row.amount}</td>
              <td>{Number(row.totalSentPiece || 0).toFixed(2)}</td>
              <td>{Number(row.totalSoldPiece || 0).toFixed(2)}</td>
              <td>{Number(row.totalSales || 0).toFixed(2)}</td>
              <td>{Number(row.totalPrize || 0).toFixed(2)}</td>
              <td>{Number(row.totalVc || 0).toFixed(2)}</td>
              <td>{Number(row.totalSvc || 0).toFixed(2)}</td>
              <td>{formatSignedRupees(row.netBill)}</td>
            </tr>
          )) : <tr><td colSpan="9">No booking bill data found</td></tr>}
        </tbody>
      </table>
      {rows.length > 0 ? (
        <div style={{ marginTop: '16px', padding: '14px 16px', background: '#eef2ff', borderRadius: '8px' }}>
          <strong>Grand Total:</strong> Booking {totals.totalSentPiece.toFixed(2)} | Sold {totals.totalSoldPiece.toFixed(2)} | Net Value Rs. {totals.totalSales.toFixed(2)} | Prize Rs. {totals.totalPrize.toFixed(2)} | VC Rs. {totals.totalVc.toFixed(2)} | SVC Rs. {totals.totalSvc.toFixed(2)} | Net {formatSignedRupees(totals.netBill)}
        </div>
      ) : null}
    </div>
  );
};

export default BookingPanel;
