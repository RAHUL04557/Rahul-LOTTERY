import React, { useEffect, useState } from 'react';
import { lotteryService, priceService, userService } from '../services/api';
import UserTreeView from './UserTreeView';
import EntriesTableView from './EntriesTableView';
import PasswordSettingsMenu from './PasswordSettingsMenu';
import { buildBillData, formatDisplayDate, formatDisplayDateTime, formatSignedRupees, getAllowedAmountsLabel, groupTransferHistoryByActor, openTransferBill } from '../utils/transferBill';
import { groupConsecutiveNumberRows, sortRowsForConsecutiveNumbers } from '../utils/numberRanges';
import '../styles/SellerDashboard.css';

const getTodayDateValue = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(new Date());
};

const isSameDateValue = (dateValue, isoDateValue) => {
  if (!dateValue) {
    return false;
  }

  return new Date(dateValue).toISOString().slice(0, 10) === isoDateValue;
};

const mapApiEntry = (entry) => ({
  id: entry.id,
  userId: entry.userId,
  username: entry.username,
  displaySeller: entry.forwardedByUsername || entry.username,
  forwardedBy: entry.forwardedBy,
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

const groupPrizeResultsBySeller = (entries = []) => entries.reduce((groups, entry) => {
  const sellerName = entry.seller || '-';
  if (!groups[sellerName]) {
    groups[sellerName] = [];
  }
  groups[sellerName].push(entry);
  return groups;
}, {});

const compareEntryNumbers = (leftValue, rightValue) => {
  const left = Number.parseInt(String(leftValue ?? ''), 10);
  const right = Number.parseInt(String(rightValue ?? ''), 10);

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
  }

  return left - right;
};

const sanitizeFiveDigitInput = (value) => String(value ?? '').replace(/[^0-9]/g, '').slice(0, 5);

const normalizeRangeEndNumber = (startValue, endValue) => {
  const startNumber = sanitizeFiveDigitInput(startValue);
  const endDigits = String(endValue ?? '').replace(/[^0-9]/g, '').slice(0, 5);

  if (startNumber.length !== 5) {
    return { error: 'From Number must be 5 digits' };
  }

  if (endDigits.length === 0 || endDigits.length > 5) {
    return { error: 'To Number can be 1 to 5 digits' };
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

  if (candidateValue > 99999) {
    return { error: 'To Number suffix se valid range nahi ban pa raha' };
  }

  return { value: String(candidateValue).padStart(5, '0') };
};

const buildConsecutiveNumbers = (startValue, endValue) => {
  const startNumber = sanitizeFiveDigitInput(startValue);
  const normalizedEnd = normalizeRangeEndNumber(startValue, endValue);

  if (normalizedEnd.error) {
    return { error: normalizedEnd.error };
  }

  const endNumber = normalizedEnd.value;

  if (startNumber.length !== 5 || endNumber.length !== 5) {
    return { error: 'From Number must be 5 digits' };
  }

  const start = Number(startNumber);
  const end = Number(endNumber);

  if (start > end) {
    return { error: 'To Number must be greater than or equal to From Number' };
  }

  if ((end - start) + 1 > 500) {
    return { error: 'Maximum 500 consecutive numbers allowed at once' };
  }

  return {
    numbers: Array.from({ length: (end - start) + 1 }, (_, index) => String(start + index).padStart(5, '0'))
  };
};

const SellerDashboard = ({ user, onLogout, sessionMode, onExitSession, initialActiveTab = '', billOnlyMode = false }) => {
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const [bookingMode, setBookingMode] = useState('single');
  const [number, setNumber] = useState('');
  const [rangeEndNumber, setRangeEndNumber] = useState('');
  const [selectedBox, setSelectedBox] = useState('');
  const [amount, setAmount] = useState('');
  const [bookingDate, setBookingDate] = useState(getTodayDateValue());
  const [yourLotDate, setYourLotDate] = useState(getTodayDateValue());
  const [entries, setEntries] = useState([]);
  const [sentEntries, setSentEntries] = useState([]);
  const [receivedEntries, setReceivedEntries] = useState([]);
  const [acceptedBookEntries, setAcceptedBookEntries] = useState([]);
  const [transferHistory, setTransferHistory] = useState([]);
  const [billPrizeResults, setBillPrizeResults] = useState([]);
  const [historyFilterMode, setHistoryFilterMode] = useState('single');
  const [historyDate, setHistoryDate] = useState(getTodayDateValue());
  const [historyFromDate, setHistoryFromDate] = useState(getTodayDateValue());
  const [historyToDate, setHistoryToDate] = useState(getTodayDateValue());
  const [historyShift, setHistoryShift] = useState('');
  const [historySellerFilter, setHistorySellerFilter] = useState('');
  const [treeData, setTreeData] = useState(null);
  const [totalAmount, setTotalAmount] = useState(0);
  const [sendingEntries, setSendingEntries] = useState(false);
  const [entryActionLoadingId, setEntryActionLoadingId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [error, setError] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [success, setSuccess] = useState('');
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [traceDate, setTraceDate] = useState(getTodayDateValue());
  const [traceNumber, setTraceNumber] = useState('');
  const [traceMode, setTraceMode] = useState('single');
  const [traceRangeEndNumber, setTraceRangeEndNumber] = useState('');
  const [traceAmount, setTraceAmount] = useState('');
  const [traceSem, setTraceSem] = useState('');
  const [traceResults, setTraceResults] = useState([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [sellerPrizeDate, setSellerPrizeDate] = useState(getTodayDateValue());
  const [sellerPrizeSessionMode, setSellerPrizeSessionMode] = useState(sessionMode);
  const [sellerPrizeNumber, setSellerPrizeNumber] = useState('');
  const [sellerPrizeAmount, setSellerPrizeAmount] = useState('');
  const [sellerPrizeSem, setSellerPrizeSem] = useState('');
  const [sellerPrizeSearchPerformed, setSellerPrizeSearchPerformed] = useState(false);
  const [sellerPrizeResults, setSellerPrizeResults] = useState([]);
  const [sellerPrizeLoading, setSellerPrizeLoading] = useState(false);
  const [sellerPrizeResultType, setSellerPrizeResultType] = useState('');
  const [sellerPrizeMessage, setSellerPrizeMessage] = useState('');
  const [myPrizeAmount, setMyPrizeAmount] = useState('');
  const [myPrizeSem, setMyPrizeSem] = useState('');
  const [myPrizeAllResults, setMyPrizeAllResults] = useState([]);
  const [myPrizeResults, setMyPrizeResults] = useState([]);
  const [myPrizeLoading, setMyPrizeLoading] = useState(false);
  const [myPrizeMessage, setMyPrizeMessage] = useState('');
  const [myPrizeSearchPerformed, setMyPrizeSearchPerformed] = useState(false);
  const [myPrizeTotal, setMyPrizeTotal] = useState(0);

  const AMOUNT_OPTIONS = ['6', '12'];
  const sellerRateAmount6 = Number(user?.rateAmount6 || 0);
  const sellerRateAmount12 = Number(user?.rateAmount12 || 0);
  const amountBookingAvailability = {
    '6': sellerRateAmount6 > 0,
    '12': sellerRateAmount12 > 0
  };
  const availableAmountOptions = AMOUNT_OPTIONS.filter((amountOption) => amountBookingAvailability[amountOption]);
  const hasMultipleAvailableAmounts = availableAmountOptions.length > 1;
  const sessionDeadline = new Date(currentDateTime);
  sessionDeadline.setHours(sessionMode === 'MORNING' ? 13 : 20, 0, 0, 0);
  const isSendDeadlinePassed = currentDateTime > sessionDeadline;
  const sessionDeadlineLabel = sessionDeadline.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit'
  });
  const remainingMilliseconds = Math.max(sessionDeadline.getTime() - currentDateTime.getTime(), 0);
  const remainingHours = Math.floor(remainingMilliseconds / (1000 * 60 * 60));
  const remainingMinutes = Math.floor((remainingMilliseconds % (1000 * 60 * 60)) / (1000 * 60));
  const remainingSeconds = Math.floor((remainingMilliseconds % (1000 * 60)) / 1000);
  const sendCountdownLabel = `${String(remainingHours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;

  const getAvailableSemOptions = () => {
    if (amount === '6') {
      return ['5', '10', '25'];
    }
    if (amount === '12') {
      return ['5', '10', '15', '20'];
    }
    return [];
  };

  const getAvailableTraceSemOptions = () => {
    if (traceAmount === '') {
      const semOptions = new Set();
      if (amountBookingAvailability['6']) {
        ['5', '10', '25'].forEach((option) => semOptions.add(option));
      }
      if (amountBookingAvailability['12']) {
        ['5', '10', '15', '20'].forEach((option) => semOptions.add(option));
      }
      return Array.from(semOptions);
    }
    if (traceAmount === '6') {
      return ['5', '10', '25'];
    }
    if (traceAmount === '12') {
      return ['5', '10', '15', '20'];
    }
    return [];
  };

  const getAvailableSellerPrizeSemOptions = () => {
    if (sellerPrizeAmount === '') {
      const semOptions = new Set();
      if (amountBookingAvailability['6']) {
        ['5', '10', '25'].forEach((option) => semOptions.add(option));
      }
      if (amountBookingAvailability['12']) {
        ['5', '10', '15', '20'].forEach((option) => semOptions.add(option));
      }
      return Array.from(semOptions);
    }
    if (sellerPrizeAmount === '6') {
      return ['5', '10', '25'];
    }
    if (sellerPrizeAmount === '12') {
      return ['5', '10', '15', '20'];
    }
    return [];
  };

  const getAvailableMyPrizeSemOptions = () => {
    if (myPrizeAmount === '') {
      const semOptions = new Set();
      if (amountBookingAvailability['6']) {
        ['5', '10', '25'].forEach((option) => semOptions.add(option));
      }
      if (amountBookingAvailability['12']) {
        ['5', '10', '15', '20'].forEach((option) => semOptions.add(option));
      }
      return Array.from(semOptions);
    }
    if (myPrizeAmount === '6') {
      return ['5', '10', '25'];
    }
    if (myPrizeAmount === '12') {
      return ['5', '10', '15', '20'];
    }
    return [];
  };

  const amount6Entries = entries.filter((entry) => entry.amount === '6');
  const amount12Entries = entries.filter((entry) => entry.amount === '12');
  const totalAcceptedBookEntries = acceptedBookEntries.length;
  const isFutureBookingDate = bookingDate > getTodayDateValue();
  const isEntryDeadlinePassed = !isFutureBookingDate && isSendDeadlinePassed;
  const selectedAmountBookingDisabled = amount ? !amountBookingAvailability[amount] : false;

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
    loadTree();

    if (billOnlyMode) {
      loadBillPreviewData();
      return;
    }

    loadPendingEntries();
    loadMySentEntries();
    loadReceivedEntries();
    loadAcceptedBookEntries();
    loadTransferHistory();
  }, [billOnlyMode]);

  useEffect(() => {
    setTotalAmount(entries.reduce((sum, entry) => sum + entry.price, 0));
  }, [entries]);

  useEffect(() => {
    if (!billOnlyMode && activeTab === 'your-lot') {
      loadMySentEntries();
    }
  }, [billOnlyMode, activeTab, yourLotDate, sessionMode]);

  useEffect(() => {
    if (amount && !amountBookingAvailability[amount]) {
      setAmount('');
      setSelectedBox('');
    }
  }, [amount, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    if (availableAmountOptions.length === 1 && amount !== availableAmountOptions[0]) {
      setAmount(availableAmountOptions[0]);
      setSelectedBox('');
    }
  }, [availableAmountOptions, amount]);

  useEffect(() => {
    if (availableAmountOptions.length === 1 && !traceAmount) {
      setTraceAmount(availableAmountOptions[0]);
    }

    if (availableAmountOptions.length === 1 && !sellerPrizeAmount) {
      setSellerPrizeAmount(availableAmountOptions[0]);
    }

    if (availableAmountOptions.length === 1 && !myPrizeAmount) {
      setMyPrizeAmount(availableAmountOptions[0]);
    }
  }, [availableAmountOptions, traceAmount, sellerPrizeAmount, myPrizeAmount]);

  useEffect(() => {
    if (traceAmount && !amountBookingAvailability[traceAmount]) {
      setTraceAmount('');
      setTraceSem('');
    }
  }, [traceAmount, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    if (sellerPrizeAmount && !amountBookingAvailability[sellerPrizeAmount]) {
      setSellerPrizeAmount('');
      setSellerPrizeSem('');
    }
  }, [sellerPrizeAmount, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    if (myPrizeAmount && !amountBookingAvailability[myPrizeAmount]) {
      setMyPrizeAmount('');
      setMyPrizeSem('');
    }
  }, [myPrizeAmount, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state?.sellerDashboardRoot) {
        setActiveTab(event.state.sellerTab || '');
        return;
      }

      if (onExitSession) {
        onExitSession();
      }
    };

    const currentUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(
      { sellerDashboardRoot: true, sellerTab: '' },
      '',
      currentUrl
    );

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onExitSession]);

  useEffect(() => {
    setActiveTab(initialActiveTab);
  }, [initialActiveTab]);

  const loadTree = async () => {
    try {
      const response = await userService.getUserTree();
      setTreeData(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading tree');
    }
  };

  const loadMySentEntries = async () => {
    try {
      const response = await lotteryService.getMySentEntries({ sessionMode, bookingDate: yourLotDate });
      setSentEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading your lot');
    }
  };

  const loadReceivedEntries = async () => {
    try {
      const response = await lotteryService.getReceivedEntries();
      setReceivedEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading seller lot');
    }
  };

  const loadAcceptedBookEntries = async () => {
    try {
      const response = await lotteryService.getAcceptedBookEntries({ bookingDate });
      setAcceptedBookEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading accepted entries');
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
      setError(err.response?.data?.message || 'Error loading send history');
    }
  };

  const loadPendingEntries = async () => {
    try {
      const response = await lotteryService.getPendingEntries({ bookingDate });
      setEntries(response.data.map(entry => ({
        _id: entry.id,
        number: entry.number,
        sem: entry.boxValue,
        amount: String(entry.amount),
        uniqueCode: entry.uniqueCode,
        price: Number(entry.boxValue) * Number(entry.amount)
      })));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading pending entries');
    }
  };

  useEffect(() => {
    if (billOnlyMode) {
      return;
    }

    loadPendingEntries();
    loadAcceptedBookEntries();
  }, [billOnlyMode, bookingDate, sessionMode]);

  const handleTabToggle = (tabName) => {
    if (activeTab === tabName) {
      window.history.back();
      return;
    }

    if (tabName === 'your-lot') {
      loadMySentEntries();
    }

    if (tabName === 'accept-seller-lot') {
      loadReceivedEntries();
    }

    if (tabName === 'add-seller') {
      loadTree();
    }

    if (tabName === 'tree') {
      loadTree();
    }

    if (tabName === 'book-lottery') {
      loadAcceptedBookEntries();
    }

    if (tabName === 'send-record') {
      loadTransferHistory(getHistoryFilters());
    }

    window.history.pushState({ sellerDashboardRoot: true, sellerTab: tabName }, '', '#' + tabName);
    setActiveTab(tabName);
  };

  const handleTabBack = () => {
    if (billOnlyMode) {
      if (onExitSession) onExitSession();
      return;
    }

    if (activeTab) {
      window.history.back();
      return;
    }

    if (onExitSession) {
      onExitSession();
    }
  };

  const handleDashboardHome = () => {
    setError('');
    setSuccess('');

    if (billOnlyMode) {
      if (onExitSession) onExitSession();
      return;
    }

    if (activeTab) {
      setActiveTab('');
      window.history.pushState({ sellerDashboardRoot: true }, '', window.location.pathname);
    }
  };

  const handleAddEntry = async (e) => {
    e.preventDefault();
    setError('');
    setBookingError('');
    setSuccess('');

    if (isEntryDeadlinePassed) {
      setBookingError(`Entry posting time ended for ${sessionMode}. Last time was ${sessionDeadlineLabel}`);
      return;
    }

    if (!selectedBox || !amount) {
      setBookingError('All fields are required');
      return;
    }

    if (selectedAmountBookingDisabled) {
      setBookingError(`Amount ${amount} booking is not enabled for your seller ID`);
      return;
    }

    const normalizedSingleNumber = sanitizeFiveDigitInput(number);
    const rangeResult = bookingMode === 'range' ? buildConsecutiveNumbers(number, rangeEndNumber) : null;
    const numbersToAdd = bookingMode === 'range'
      ? (rangeResult?.numbers || [])
      : [normalizedSingleNumber];

    if (bookingMode === 'range' && rangeResult?.error) {
      setBookingError(rangeResult.error);
      return;
    }

    if (bookingMode === 'single' && normalizedSingleNumber.length !== 5) {
      setBookingError('Number must be 5 digits');
      return;
    }

    const locallySoldNumbers = entries
      .filter((entry) => (
        numbersToAdd.includes(entry.number) &&
        entry.amount === amount &&
        entry.sem === selectedBox
      ))
      .map((entry) => entry.number);

    if (locallySoldNumbers.length > 0) {
      const duplicateLabel = locallySoldNumbers.length > 5
        ? `${locallySoldNumbers.slice(0, 5).join(', ')} +${locallySoldNumbers.length - 5} more`
        : locallySoldNumbers.join(', ');
      setBookingError(`Already Sold (in your cart): ${duplicateLabel}`);
      return;
    }

    try {
      const payload = {
        series: '',
        boxValue: selectedBox,
        amount,
        bookingDate
      };

      if (bookingMode === 'range') {
        payload.rangeStart = sanitizeFiveDigitInput(number);
        payload.rangeEnd = sanitizeFiveDigitInput(rangeEndNumber);
      } else {
        payload.number = normalizedSingleNumber;
      }

      let createdEntries = [];

      try {
        const response = await lotteryService.addEntry(payload);
        createdEntries = (response.data.entries || [response.data.entry]).map((dbEntry) => ({
          _id: dbEntry.id,
          number: dbEntry.number,
          sem: dbEntry.boxValue,
          amount: String(dbEntry.amount),
          uniqueCode: dbEntry.uniqueCode,
          price: Number(dbEntry.boxValue) * Number(dbEntry.amount)
        }));
        setSuccess(response.data.message || 'Entry added successfully');
      } catch (rangeError) {
        const errorMessage = rangeError.response?.data?.message || '';
        const canFallbackToSingleAdds = bookingMode === 'range' && errorMessage === 'Number, box value and amount required';

        if (!canFallbackToSingleAdds) {
          throw rangeError;
        }

        const fallbackEntries = [];

        for (const currentNumber of numbersToAdd) {
          const singleResponse = await lotteryService.addEntry({
            series: '',
            number: currentNumber,
            boxValue: selectedBox,
            amount,
            bookingDate
          });

          const dbEntry = singleResponse.data.entry;
          fallbackEntries.push({
            _id: dbEntry.id,
            number: dbEntry.number,
            sem: dbEntry.boxValue,
            amount: String(dbEntry.amount),
            uniqueCode: dbEntry.uniqueCode,
            price: Number(dbEntry.boxValue) * Number(dbEntry.amount)
          });
        }

        createdEntries = fallbackEntries;
        setSuccess(`${fallbackEntries.length} entries added successfully`);
      }

      setEntries((prevEntries) => [...createdEntries, ...prevEntries]);
      setNumber('');
      setRangeEndNumber('');
      setSelectedBox('');
      setAmount('');
      setBookingError('');
    } catch (err) {
      setBookingError(err.response?.data?.message || 'Error adding entry');
    }
  };

  const handleDeleteEntry = async (entryId) => {
    try {
      await lotteryService.deletePendingEntry(entryId, { bookingDate });
      setEntries((prevEntries) => prevEntries.filter((entry) => entry._id !== entryId));
      setSuccess('Entry deleted successfully');
    } catch (err) {
      setError(err.response?.data?.message || 'Error deleting entry');
    }
  };

  const handleDeleteEntryGroup = async (entryIds) => {
    try {
      await Promise.all(entryIds.map((entryId) => lotteryService.deletePendingEntry(entryId, { bookingDate })));
      setEntries((prevEntries) => prevEntries.filter((entry) => !entryIds.includes(entry._id)));
      setSuccess(entryIds.length > 1 ? 'Range deleted successfully' : 'Entry deleted successfully');
    } catch (err) {
      setError(err.response?.data?.message || 'Error deleting entry');
    }
  };

  const handleSendEntries = async () => {
    if (entries.length === 0 && totalAcceptedBookEntries === 0) {
      setError('No entries to send');
      return;
    }

    if (!isFutureBookingDate && isSendDeadlinePassed) {
      setError(`Send Entries time ended for ${sessionMode}. Last time was ${sessionDeadlineLabel}`);
      return;
    }

    setSendingEntries(true);
    setError('');
    setSuccess('');

    try {
      await lotteryService.sendEntries({ bookingDate });
      await Promise.all([loadMySentEntries(), loadReceivedEntries(), loadAcceptedBookEntries(), loadTransferHistory(getHistoryFilters())]);
      setEntries([]);
      setSuccess(`Entries sent successfully`);
    } catch (err) {
      setError(err.response?.data?.message || 'Error sending entries');
    } finally {
      setSendingEntries(false);
    }
  };

  const handleCopyUniqueCode = async (uniqueCode) => {
    try {
      await navigator.clipboard.writeText(String(uniqueCode));
      setSuccess('Unique code copied');
      setError('');
    } catch (err) {
      setError('Unable to copy unique code');
    }
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
      await Promise.all([loadTree(), loadReceivedEntries(), loadAcceptedBookEntries(), loadTransferHistory(getHistoryFilters())]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error deleting seller');
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleReceivedEntryAction = async (entry, action) => {
    const groupedEntries = Array.isArray(entry) ? entry : [entry];
    const loadingEntryId = groupedEntries[0]?.id;

    setEntryActionLoadingId(loadingEntryId);
    setError('');
    setSuccess('');

    try {
      await Promise.all(
        groupedEntries.map((currentEntry) => lotteryService.updateReceivedEntryStatus(currentEntry.id, action))
      );

      const successLabel = action === 'accept' ? 'accepted' : 'rejected';
      setSuccess(
        groupedEntries.length > 1
          ? `${groupedEntries.length} consecutive entries ${successLabel} successfully`
          : `Entry ${successLabel} successfully`
      );
      await Promise.all([loadReceivedEntries(), loadMySentEntries(), loadAcceptedBookEntries(), loadTransferHistory(getHistoryFilters())]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error updating entry');
    } finally {
      setEntryActionLoadingId(null);
    }
  };

  const acceptedEntriesBySeller = acceptedBookEntries.reduce((groups, entry) => {
    const sellerName = entry.displaySeller || 'Unknown Seller';
    if (!groups[sellerName]) {
      groups[sellerName] = [];
    }
    groups[sellerName].push(entry);
    return groups;
  }, {});
  const renderAcceptedSellerSummary = (sellerEntries) => {
    const bookingDates = [...new Set(sellerEntries.map((entry) => entry.bookingDate).filter(Boolean))];
    const bookingDateLabel = bookingDates.length === 1
      ? formatDisplayDate(bookingDates[0])
      : bookingDates.length > 1
        ? bookingDates.map((date) => formatDisplayDate(date)).join(', ')
        : '-';
    const totalPiece = sellerEntries.reduce((sum, entry) => sum + Number(entry.sem || 0), 0);
    const totalAmountValue = sellerEntries.reduce((sum, entry) => sum + Number(entry.price || 0), 0);

    return (
      <div
        style={{
          marginTop: '16px',
          marginBottom: '30px',
          padding: '18px 22px',
          borderRadius: '16px',
          background: '#eef3ff',
          fontSize: '30px',
          fontWeight: '700',
          lineHeight: 1.45,
          color: '#1f2d3d',
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)'
        }}
      >
        <strong>Booking Date:</strong> {bookingDateLabel} | <strong>Total Piece:</strong> {totalPiece.toFixed(2)} | <strong>Total Amount:</strong> Rs. {totalAmountValue.toFixed(2)}
      </div>
    );
  };

  const directChildSellers = (treeData?.children || []).filter((node) => node.role === 'seller');
  const billData = buildBillData({
    records: transferHistory,
    prizeRecords: billPrizeResults,
    treeData,
    selectedSellerUsername: historySellerFilter
  });
  const billTransferHistory = billData.records;
  const transferHistoryByActor = groupTransferHistoryByActor(transferHistory);
  const billTransferHistoryByActor = billData.groupedRecords;
  const billTransferHistoryTotals = billData.totals;
  const myPrizeResultsBySeller = groupPrizeResultsBySeller(myPrizeResults);
  const todayDateValue = getTodayDateValue();
  const sortedReceivedEntries = [...receivedEntries].sort((leftEntry, rightEntry) => {
    const sellerComparison = String(leftEntry.displaySeller || leftEntry.username || '').localeCompare(String(rightEntry.displaySeller || rightEntry.username || ''));
    if (sellerComparison !== 0) {
      return sellerComparison;
    }

    const amountComparison = String(leftEntry.amount).localeCompare(String(rightEntry.amount));
    if (amountComparison !== 0) {
      return amountComparison;
    }

    const semComparison = String(leftEntry.sem).localeCompare(String(rightEntry.sem));
    if (semComparison !== 0) {
      return semComparison;
    }

    const numberComparison = compareEntryNumbers(leftEntry.number, rightEntry.number);
    if (numberComparison !== 0) {
      return numberComparison;
    }

    return new Date(leftEntry.sentAt || leftEntry.createdAt || 0).getTime() - new Date(rightEntry.sentAt || rightEntry.createdAt || 0).getTime();
  });
  const sortedSentEntries = [...sentEntries].sort((leftEntry, rightEntry) => {
    const amountComparison = String(leftEntry.amount).localeCompare(String(rightEntry.amount));
    if (amountComparison !== 0) {
      return amountComparison;
    }

    const semComparison = String(leftEntry.sem).localeCompare(String(rightEntry.sem));
    if (semComparison !== 0) {
      return semComparison;
    }

    const numberComparison = compareEntryNumbers(leftEntry.number, rightEntry.number);
    if (numberComparison !== 0) {
      return numberComparison;
    }

    return new Date(leftEntry.sentAt || leftEntry.createdAt || 0).getTime() - new Date(rightEntry.sentAt || rightEntry.createdAt || 0).getTime();
  });

  const historyPeriodLabel = historyFilterMode === 'range'
    ? `${formatDisplayDate(historyFromDate)} to ${formatDisplayDate(historyToDate)}`
    : formatDisplayDate(historyDate);

  const generateBill = () => {
    setError('');

    if (historyFilterMode === 'range' && historyFromDate > historyToDate) {
      setError('From date cannot be after to date');
      return;
    }

    if (transferHistory.length === 0) {
      setError('No send record found for bill generation');
      return;
    }

    if (billTransferHistory.length === 0) {
      setError('No bill data found for selected seller');
      return;
    }

    const didOpen = openTransferBill({
      groupedRecords: billTransferHistoryByActor,
      groupedSummaries: billData.groupedSummaries,
      groupedAmountSummaries: billData.groupedAmountSummaries,
      rootSellerMeta: billData.rootSellerMeta,
      totals: billTransferHistoryTotals,
      username: user.username,
      sessionMode,
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
    const rangeResult = traceMode === 'range' ? buildConsecutiveNumbers(traceNumber, traceRangeEndNumber) : null;
    const numbersToTrace = traceMode === 'range'
      ? (rangeResult?.numbers || [])
      : [trimmedNumber];

    if (!trimmedNumber) {
      setError('Enter number or unique code to search');
      return;
    }

    if (traceMode === 'range' && rangeResult?.error) {
      setError(rangeResult.error);
      return;
    }

    setError('');
    setTraceLoading(true);

    try {
      const response = await lotteryService.traceNumber({
        number: numbersToTrace.join(','),
        uniqueCode: traceMode === 'single' ? trimmedNumber : '',
        date: traceDate,
        sessionMode,
        amount: traceAmount,
        sem: traceSem
      });
      setTraceResults(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error tracing number');
      setTraceResults([]);
    } finally {
      setTraceLoading(false);
    }
  };

  const handleSendRecordFilterKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  };

  const handleSellerPrizeSearch = async () => {
    const trimmedNumber = sellerPrizeNumber.trim();

    if (!trimmedNumber) {
      setError('Enter booked number to search in Check Prize');
      setSellerPrizeSearchPerformed(false);
      setSellerPrizeResults([]);
      setSellerPrizeResultType('');
      setSellerPrizeMessage('');
      return;
    }

    if (!/^\d{4,5}$/.test(trimmedNumber)) {
      setError('Booked number must be 4 or 5 digits');
      setSellerPrizeSearchPerformed(false);
      setSellerPrizeResults([]);
      setSellerPrizeResultType('');
      setSellerPrizeMessage('');
      return;
    }

    if (!sellerPrizeSessionMode) {
      setError('Select session to search prize');
      setSellerPrizeSearchPerformed(false);
      setSellerPrizeResults([]);
      setSellerPrizeResultType('');
      setSellerPrizeMessage('');
      return;
    }

    setError('');
    setSellerPrizeResultType('');
    setSellerPrizeMessage('');
    setSellerPrizeLoading(true);

    try {
      if (!/^\d+$/.test(trimmedNumber)) {
        throw new Error('Only 4 or 5 digit booked number allowed in Check Prize');
      }

      const response = await priceService.checkPrize({
        number: trimmedNumber,
        date: sellerPrizeDate,
        sessionMode: sellerPrizeSessionMode,
        amount: sellerPrizeAmount,
        sem: sellerPrizeSem
      });
      setSellerPrizeResults(response.data.matches || []);
      setSellerPrizeResultType(response.data.resultType || '');
      setSellerPrizeMessage(response.data.message || '');
      setSellerPrizeSearchPerformed(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Error checking prize');
      setSellerPrizeResults([]);
      setSellerPrizeResultType('');
      setSellerPrizeMessage('');
      setSellerPrizeSearchPerformed(false);
    } finally {
      setSellerPrizeLoading(false);
    }
  };

  const handleMyPrizeSearch = async () => {
    setError('');
    setMyPrizeLoading(true);
    setMyPrizeSearchPerformed(false);
    setMyPrizeMessage('');

    try {
      const response = await priceService.getMyPrizes({
        sessionMode,
        amount: '',
        sem: ''
      });
      const allResults = response.data.results || [];
      const filteredResults = allResults.filter((entry) => {
        const amountMatches = !myPrizeAmount || String(entry.amount) === String(myPrizeAmount);
        const semMatches = !myPrizeSem || String(entry.same) === String(myPrizeSem);
        return amountMatches && semMatches;
      });

      setMyPrizeAllResults(allResults);
      setMyPrizeResults(filteredResults);
      setMyPrizeTotal(filteredResults.reduce((sum, entry) => sum + Number(entry.calculatedPrize || 0), 0));
      setMyPrizeMessage(
        filteredResults.length > 0
          ? 'Prize found'
          : `No prize today for Amount ${myPrizeAmount || 'ALL'} and SEM ${myPrizeSem || 'ALL'}`
      );
      setMyPrizeSearchPerformed(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading my prizes');
      setMyPrizeAllResults([]);
      setMyPrizeResults([]);
      setMyPrizeTotal(0);
      setMyPrizeMessage('');
      setMyPrizeSearchPerformed(false);
    } finally {
      setMyPrizeLoading(false);
    }
  };

  const renderEntriesTable = (filteredEntries, amountLabel) => {
    if (filteredEntries.length === 0) {
      return (
        <div className="entries-section">
          <h3 className="entries-group-title">AMOUNT {amountLabel} ENTRIES</h3>
          <p>No pending entries</p>
        </div>
      );
    }

    const sortedFilteredEntries = sortRowsForConsecutiveNumbers(
      filteredEntries,
      (entry) => [entry.sem, entry.amount]
    );

    const groupedEntries = groupConsecutiveNumberRows(
      sortedFilteredEntries,
      (entry) => [entry.sem, entry.amount].join('|')
    );

    return (
      <div className="entries-section">
        <h3 className="entries-group-title">AMOUNT {amountLabel} ENTRIES</h3>
        <table className="entries-table">
          <thead>
            <tr>
              <th>Unique Code</th>
              <th>SEM</th>
              <th>Amount</th>
              <th>5-Digit Number</th>
              <th>Piece</th>
              <th>Total</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {groupedEntries.map((group) => {
              const representativeEntry = group.firstRow;
              const totalPiece = group.rows.reduce((sum, entry) => sum + parseFloat(entry.sem), 0);
              const totalAmountValue = group.rows.reduce((sum, entry) => sum + Number(entry.price || 0), 0);
              const uniqueCodes = group.rows.map((entry) => entry.uniqueCode);
              const uniqueCodeLabel = group.rows.length > 1
                ? `${group.rows.length} codes`
                : uniqueCodes[0];

              return (
                <tr key={group.rows.map((entry) => entry._id).join('-')}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{uniqueCodeLabel}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyUniqueCode(uniqueCodes.join(', '))}
                        style={{ padding: '6px 10px', fontSize: '12px', backgroundColor: '#667eea' }}
                      >
                        Copy
                      </button>
                    </div>
                  </td>
                  <td style={{ backgroundColor: '#FFE082', fontWeight: 'bold' }}>{representativeEntry.sem}</td>
                  <td>{representativeEntry.amount}</td>
                  <td style={{ backgroundColor: '#81C784', fontWeight: 'bold', color: 'white' }}>{group.label}</td>
                  <td><strong>{totalPiece}</strong></td>
                  <td><strong>Rs. {totalAmountValue.toFixed(2)}</strong></td>
                  <td>
                    <button className="delete-btn" onClick={() => handleDeleteEntryGroup(group.rows.map((entry) => entry._id))}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="total-section">
          <h3>
            Total Amount: Rs. {filteredEntries.reduce((sum, entry) => sum + entry.price, 0).toFixed(2)} | Total Piece:{' '}
            {filteredEntries.reduce((sum, entry) => sum + parseFloat(entry.sem), 0)}
          </h3>
        </div>
      </div>
    );
  };

  const renderTransferHistoryTables = (records, actorName) => {
    const { amount6, amount12 } = splitEntriesByAmount(records);
    const renderTable = (tableRecords, amountLabel) => (
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
              <th>Date Time</th>
              <th>Total</th>
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
                  record.statusAfter
                ]
              );
              const groupedRecords = groupConsecutiveNumberRows(sortedTableRecords, (record) => [
                record.actionType,
                record.fromUsername,
                record.toUsername,
                record.boxValue,
                record.amount,
                record.statusAfter
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
                    <td>{new Date(record.createdAt).toLocaleString('en-IN')}</td>
                    <td>Rs. {totalValue.toFixed(2)}</td>
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
        {amount6.length > 0 && renderTable(amount6, '6')}
        {amount12.length > 0 && renderTable(amount12, '12')}
      </>
    );
  };

  const renderTraceTablesByAmount = (records) => {
    const { amount6, amount12 } = splitEntriesByAmount(records);
    const renderTable = (tableRecords, amountLabel) => (
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
                  record.sentTo || '-',
                  record.currentHolder,
                  record.forwardedBy || '-',
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
        {amount6.length > 0 && renderTable(amount6, '6')}
        {amount12.length > 0 && renderTable(amount12, '12')}
      </>
    );
  };

  return (
    <div className="seller-dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-center">
            <button type="button" className="dashboard-home-link" onClick={handleDashboardHome}>
              <h1>Seller Dashboard</h1>
            </button>
            <div className="session-banner">{billOnlyMode ? 'GENERATE BILL' : sessionMode}</div>
            <div className="session-meta">
              <span>{currentDateTime.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
              <span>{currentDateTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          </div>
          <div className="user-info">
            <span>Welcome, {user.username}</span>
            <PasswordSettingsMenu
              currentUser={user}
              onSuccess={setSuccess}
              onError={setError}
            />
            <button className="logout-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      {!billOnlyMode && (
        <div className="dashboard-accordion">
        {!activeTab && (
          <div className="accordion-item" style={{ order: 2 }}>
            <button
              className={`accordion-header ${activeTab === 'check-price' ? 'active' : ''}`}
              onClick={() => handleTabToggle('check-price')}
            >
              Check Price
            </button>
          </div>
        )}

        {activeTab === 'check-price' && (
          <div className="accordion-item" style={{ order: 2 }}>
            <button className="accordion-header active" onClick={handleTabBack}>
              Check Price
            </button>
            <div className="accordion-content">
              <h2>Check Prize</h2>
              <div className="form-group">
                <label>Search Date:</label>
                <input
                  type="date"
                  value={sellerPrizeDate}
                  onChange={(e) => setSellerPrizeDate(e.target.value)}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Search Session:</label>
                <select value={sellerPrizeSessionMode} onChange={(e) => setSellerPrizeSessionMode(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="NIGHT">NIGHT</option>
                </select>

                <label style={{ marginTop: '12px', display: 'block' }}>Booked Number:</label>
                <input
                  type="text"
                  value={sellerPrizeNumber}
                  onChange={(e) => setSellerPrizeNumber(String(e.target.value || '').replace(/[^0-9]/g, '').slice(0, 5))}
                  placeholder="Enter 4 or 5 digit booked number"
                  maxLength="5"
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Amount:</label>
                <div className="box-options" style={{ marginTop: '8px' }}>
                  {hasMultipleAvailableAmounts && (
                    <label className="checkbox-label">
                      <input
                        type="radio"
                        name="seller-prize-amount"
                        value=""
                        checked={sellerPrizeAmount === ''}
                        onChange={() => {
                          setSellerPrizeAmount('');
                          setSellerPrizeSem('');
                        }}
                      />
                      ALL
                    </label>
                  )}
                  {availableAmountOptions.map((amountOption) => (
                    <label key={amountOption} className="checkbox-label">
                      <input
                        type="radio"
                        name="seller-prize-amount"
                        value={amountOption}
                        checked={sellerPrizeAmount === amountOption}
                        onChange={(e) => {
                          setSellerPrizeAmount(e.target.value);
                          setSellerPrizeSem('');
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
                      name="seller-prize-sem"
                      value=""
                      checked={sellerPrizeSem === ''}
                      onChange={() => setSellerPrizeSem('')}
                    />
                    ALL
                  </label>
                  {sellerPrizeAmount && getAvailableSellerPrizeSemOptions().map((group) => (
                    <label key={group} className="checkbox-label">
                      <input
                        type="radio"
                        name="seller-prize-sem"
                        value={group}
                        checked={sellerPrizeSem === group}
                        onChange={(e) => setSellerPrizeSem(e.target.value)}
                      />
                      {group}
                    </label>
                  ))}
                </div>
                <button type="button" onClick={handleSellerPrizeSearch} style={{ marginTop: '12px' }} disabled={sellerPrizeLoading}>
                  {sellerPrizeLoading ? 'Searching...' : 'Search'}
                </button>
              </div>

              {sellerPrizeSearchPerformed && (
                sellerPrizeResultType === 'not_owned' ? (
                  <div className="entries-list-block" style={{ marginTop: '20px' }}>
                    <h3>Check Prize Result</h3>
                    <p>{sellerPrizeMessage}</p>
                  </div>
                ) : (
                  <div className="entries-list-block" style={{ marginTop: '20px' }}>
                    <h3>Check Prize Result</h3>
                    {sellerPrizeResults.length > 0 && (
                      <div style={{ marginBottom: '14px', padding: '14px 16px', borderRadius: '14px', background: '#eef3ff', fontSize: '22px', fontWeight: '700' }}>
                        <strong>Total Prize:</strong> Rs. {sellerPrizeResults.reduce((sum, entry) => sum + Number(entry.calculatedPrize || 0), 0).toFixed(2)}
                      </div>
                    )}
                    <table className="entries-table">
                      <thead>
                        <tr>
                          <th>Search Date</th>
                          <th>Session</th>
                          <th>Seller</th>
                          <th>Booked Number</th>
                          <th>Amount</th>
                          <th>SEM</th>
                          <th>Prize</th>
                          <th>Winning Number</th>
                          <th>Prize Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sellerPrizeResults.length > 0 ? (
                          sellerPrizeResults.map((entry) => (
                            <tr key={`${entry.id}-${entry.ownedEntryId || entry.amount}-${entry.same}`}>
                              <td>{formatDisplayDate(sellerPrizeDate)}</td>
                              <td>{sellerPrizeSessionMode}</td>
                              <td>{entry.ownedBy || '-'}</td>
                              <td>{entry.matchedAgainstNumber || sellerPrizeNumber}</td>
                              <td>{entry.amount}</td>
                              <td>{entry.same}</td>
                              <td>{entry.prizeLabel}</td>
                              <td>{entry.matchedAgainstNumber || entry.winningNumber}</td>
                              <td>Rs. {Number(entry.calculatedPrize || 0).toFixed(2)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td>{formatDisplayDate(sellerPrizeDate)}</td>
                            <td>{sellerPrizeSessionMode}</td>
                            <td>-</td>
                            <td>{sellerPrizeNumber}</td>
                            <td>{sellerPrizeAmount || 'ALL'}</td>
                            <td>{sellerPrizeSem || 'ALL'}</td>
                            <td colSpan="3">{sellerPrizeMessage || 'No Price'}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item" style={{ order: 2 }}>
            <button
              className={`accordion-header ${activeTab === 'my-prizes' ? 'active' : ''}`}
              onClick={() => handleTabToggle('my-prizes')}
            >
              My Prizes
            </button>
          </div>
        )}

        {activeTab === 'my-prizes' && (
          <div className="accordion-item" style={{ order: 2 }}>
            <button className="accordion-header active" onClick={handleTabBack}>
              My Prizes
            </button>
            <div className="accordion-content">
              <h2>My Prizes</h2>
              <div className="form-group">
                <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
                  <strong>Date:</strong> {formatDisplayDate(getTodayDateValue())} | <strong>Session:</strong> {sessionMode}
                </div>

                <label>Amount:</label>
                <div className="box-options" style={{ marginTop: '8px' }}>
                  {hasMultipleAvailableAmounts && (
                    <label className="checkbox-label">
                      <input
                        type="radio"
                        name="my-prize-amount"
                        value=""
                        checked={myPrizeAmount === ''}
                        onChange={() => {
                          setMyPrizeAmount('');
                          setMyPrizeSem('');
                        }}
                      />
                      ALL
                    </label>
                  )}
                  {availableAmountOptions.map((amountOption) => (
                    <label key={amountOption} className="checkbox-label">
                      <input
                        type="radio"
                        name="my-prize-amount"
                        value={amountOption}
                        checked={myPrizeAmount === amountOption}
                        onChange={(e) => {
                          setMyPrizeAmount(e.target.value);
                          setMyPrizeSem('');
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
                      name="my-prize-sem"
                      value=""
                      checked={myPrizeSem === ''}
                      onChange={() => setMyPrizeSem('')}
                    />
                    ALL
                  </label>
                  {getAvailableMyPrizeSemOptions().map((group) => (
                    <label key={group} className="checkbox-label">
                      <input
                        type="radio"
                        name="my-prize-sem"
                        value={group}
                        checked={myPrizeSem === group}
                        onChange={(e) => setMyPrizeSem(e.target.value)}
                      />
                      {group}
                    </label>
                  ))}
                </div>

                <button type="button" onClick={handleMyPrizeSearch} style={{ marginTop: '12px' }} disabled={myPrizeLoading}>
                  {myPrizeLoading ? 'Checking...' : 'Check'}
                </button>
              </div>

              {myPrizeSearchPerformed && (
                <div className="entries-list-block" style={{ marginTop: '20px' }}>
                  <h3>My Prize Result</h3>
                  <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
                    <strong>Applied Filter:</strong> Amount {myPrizeAmount || 'ALL'} | SEM {myPrizeSem || 'ALL'}
                  </div>
                  {myPrizeResults.length > 0 ? (
                    <>
                      <div style={{ marginBottom: '14px', padding: '14px 16px', borderRadius: '14px', background: '#eef3ff', fontSize: '22px', fontWeight: '700' }}>
                        <strong>Total Prize:</strong> Rs. {myPrizeTotal.toFixed(2)}
                      </div>
                      <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
                        <strong>Total Matched Entries:</strong> {myPrizeResults.length} | <strong>Available Today:</strong> {myPrizeAllResults.length}
                      </div>
                      {Object.entries(myPrizeResultsBySeller).map(([sellerName, sellerEntries]) => (
                        <div key={sellerName} className="entries-list-block" style={{ marginTop: '18px' }}>
                          <h3>{sellerName}</h3>
                          <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
                            <strong>{sellerName} Prize Total:</strong> Rs. {sellerEntries.reduce((sum, entry) => (
                              sum + Number(entry.calculatedPrize || 0)
                            ), 0).toFixed(2)}
                          </div>
                          <table className="entries-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Session</th>
                                <th>Seller</th>
                                <th>Prize From</th>
                                <th>Booked Number</th>
                                <th>Amount</th>
                                <th>SEM</th>
                                <th>Prize</th>
                                <th>Winning Number</th>
                                <th>Prize Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sellerEntries.map((entry) => (
                                <tr key={`${entry.prizeId}-${entry.ownedEntryId}`}>
                                  <td>{formatDisplayDate(getTodayDateValue())}</td>
                                  <td>{sessionMode}</td>
                                  <td>{entry.seller || '-'}</td>
                                  <td>{entry.prizeSource}</td>
                                  <td>{entry.bookedNumber}</td>
                                  <td>{entry.amount}</td>
                                  <td>{entry.same}</td>
                                  <td>{entry.prizeLabel}</td>
                                  <td>{entry.bookedNumber || entry.winningNumber}</td>
                                  <td>Rs. {Number(entry.calculatedPrize || 0).toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                      <div style={{ marginTop: '18px', padding: '14px 16px', borderRadius: '14px', background: '#dfe8ff', fontSize: '24px', fontWeight: '700' }}>
                        <strong>Grand Total Prize:</strong> Rs. {myPrizeTotal.toFixed(2)}
                      </div>
                      <div style={{ marginTop: '14px', padding: '14px 16px', borderRadius: '14px', background: '#eef3ff' }}>
                        <strong>Prize Numbers:</strong> {[...new Set(myPrizeResults.map((entry) => entry.bookedNumber))].join(', ')}
                      </div>
                    </>
                  ) : (
                    <p style={{ fontWeight: '600' }}>{myPrizeMessage || `No prize today for Amount ${myPrizeAmount || 'ALL'} and SEM ${myPrizeSem || 'ALL'}`}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item" style={{ order: 3 }}>
            <button
              className={`accordion-header ${activeTab === 'tree' ? 'active' : ''}`}
              onClick={() => handleTabToggle('tree')}
            >
              Tree
            </button>
          </div>
        )}

        {activeTab === 'tree' && (
          <div className="accordion-item" style={{ order: 3 }}>
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
          <div className="accordion-item" style={{ order: 4 }}>
            <button
              className={`accordion-header ${activeTab === 'add-seller' ? 'active' : ''}`}
              onClick={() => handleTabToggle('add-seller')}
            >
              Add New Seller
            </button>
          </div>
        )}

        {activeTab === 'add-seller' && (
          <div className="accordion-item" style={{ order: 4 }}>
            <button className="accordion-header active" onClick={handleTabBack}>
              Add New Seller
            </button>
            <div className="accordion-content">
              <AddSellerForm
                currentUser={user}
                onSuccess={async () => {
                  setSuccess('Seller created successfully');
                  await loadTree();
                }}
                onError={setError}
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button
              className={`accordion-header ${activeTab === 'book-lottery' ? 'active' : ''}`}
              onClick={() => handleTabToggle('book-lottery')}
            >
              Book Lottery
            </button>
          </div>
        )}

        {activeTab === 'book-lottery' && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button className="accordion-header active" onClick={handleTabBack}>
              Book Lottery
            </button>
            <div className="accordion-content">
              <h2>Book Lottery</h2>
              <div className="time-left-banner" style={{ backgroundColor: '#f8f9fa', padding: '12px', borderRadius: '8px', marginBottom: '20px', borderLeft: '4px solid #667eea' }}>
                <p style={{ margin: '0 0 4px 0', color: '#555', fontWeight: '600', fontSize: '14px' }}>
                  {sessionMode} last send time: {sessionDeadlineLabel}
                </p>
                <p style={{ margin: 0, color: '#d32f2f', fontWeight: '700', fontSize: '16px' }}>
                  {isFutureBookingDate ? `Future booking selected for ${formatDisplayDate(bookingDate)}` : `Time Left To Send: ${sendCountdownLabel}`}
                </p>
              </div>
              <form onSubmit={handleAddEntry} className="lottery-form">
                <div className="form-group">
                  <label>Booking Date:</label>
                  <input
                    type="date"
                    value={bookingDate}
                    min={getTodayDateValue()}
                    onChange={(e) => setBookingDate(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Amount:</label>
                  {availableAmountOptions.length === 1 ? (
                    <>
                      <div style={{ padding: '12px 14px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f8f9ff', fontWeight: '600' }}>
                        {availableAmountOptions[0]} (auto-selected)
                      </div>
                      <p style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
                        This seller is allowed to book only amount {availableAmountOptions[0]}, so it is selected automatically.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="box-options">
                        {availableAmountOptions.map((amountOption) => (
                          <label key={amountOption} className="checkbox-label">
                            <input
                              type="radio"
                              name="amount"
                              value={amountOption}
                              checked={amount === amountOption}
                              onChange={(e) => {
                                setAmount(e.target.value);
                                setSelectedBox('');
                              }}
                            />
                            {amountOption}
                          </label>
                        ))}
                      </div>
                      <p style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
                        Only allowed amount options are shown. Amounts without permission are hidden from the seller dashboard.
                      </p>
                    </>
                  )}
                </div>

                <div className="form-group">
                  <label>SEM</label>
                  <div className="box-options">
                    {amount && getAvailableSemOptions().map((box) => (
                      <label key={box} className="checkbox-label">
                        <input
                          type="radio"
                          name="box"
                          value={box}
                          checked={selectedBox === box}
                          onChange={(e) => setSelectedBox(e.target.value)}
                        />
                        {box}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Booking Type:</label>
                  <div className="box-options">
                    <label className="checkbox-label">
                      <input
                        type="radio"
                        name="booking-mode"
                        value="single"
                        checked={bookingMode === 'single'}
                        onChange={() => {
                          setBookingMode('single');
                          setNumber('');
                          setRangeEndNumber('');
                        }}
                      />
                      Single Number
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="radio"
                        name="booking-mode"
                        value="range"
                        checked={bookingMode === 'range'}
                        onChange={() => {
                          setBookingMode('range');
                          setNumber('');
                          setRangeEndNumber('');
                        }}
                      />
                      Consecutive Range
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label>{bookingMode === 'range' ? 'From Number:' : '5-Digit Number:'}</label>
                  <input
                    type="text"
                    value={number}
                    onChange={(e) => setNumber(sanitizeFiveDigitInput(e.target.value))}
                    placeholder="00000"
                    maxLength="5"
                  />
                </div>

                {bookingMode === 'range' && (
                  <div className="form-group">
                    <label>To Number:</label>
                    <input
                      type="text"
                      value={rangeEndNumber}
                      onChange={(e) => setRangeEndNumber(String(e.target.value).replace(/[^0-9]/g, '').slice(0, 5))}
                      placeholder=""
                      maxLength="5"
                    />
                  </div>
                )}

                <button type="submit" className="add-btn" disabled={isEntryDeadlinePassed}>Add Entry</button>
                {bookingError && <p style={{ color: '#d32f2f', fontWeight: '600', marginTop: '10px' }}>{bookingError}</p>}
                {isEntryDeadlinePassed && (
                  <p style={{ color: '#d32f2f', fontWeight: '600', marginTop: '10px' }}>
                    Entry posting time ended for {sessionMode}. Last time was {sessionDeadlineLabel}
                  </p>
                )}
              </form>

              <div className="entries-section">
                <h3>Pending Entries ({entries.length})</h3>
                {entries.length > 0 ? (
                  <div>
                    {renderEntriesTable(amount6Entries, '6')}
                    {renderEntriesTable(amount12Entries, '12')}
                  </div>
                ) : (
                  <p>No pending entries</p>
                )}

                {(entries.length > 0 || totalAcceptedBookEntries > 0) && (
                  <div className="total-section">
                    <h3>
                      Booking Date: {formatDisplayDate(bookingDate)} | Total Amount: Rs. {totalAmount.toFixed(2)} | Total Piece: {entries.reduce((sum, entry) => sum + parseFloat(entry.sem), 0)}
                    </h3>
                    <button className="send-btn" onClick={handleSendEntries} disabled={(!isFutureBookingDate && isSendDeadlinePassed) || sendingEntries} style={{ marginTop: '16px' }}>
                      {sendingEntries ? 'Sending...' : 'Send Entries'}
                    </button>
                    {totalAcceptedBookEntries > 0 && (
                      <p style={{ marginTop: '12px', color: '#333', fontWeight: '600' }}>
                        Accepted seller entries ready to send: {totalAcceptedBookEntries}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="entries-section">
                <h3>Accepted Seller Entries</h3>
                {Object.keys(acceptedEntriesBySeller).length > 0 ? (
                  Object.entries(acceptedEntriesBySeller).map(([sellerName, sellerEntries]) => (
                    <React.Fragment key={sellerName}>
                      <EntriesTableView
                        entries={sellerEntries}
                        title={sellerName}
                        showStatus
                        splitByAmount
                        groupConsecutiveRows
                        showSummary
                        emptyMessage="No accepted seller entries"
                      />
                      {renderAcceptedSellerSummary(sellerEntries)}
                    </React.Fragment>
                  ))
                ) : (
                  <p>No accepted seller entries</p>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      )}

      <div className="dashboard-accordion dashboard-secondary-actions">
        {!billOnlyMode && !activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'your-lot' ? 'active' : ''}`}
              onClick={() => handleTabToggle('your-lot')}
            >
              Your Lot
            </button>
          </div>
        )}

        {!billOnlyMode && activeTab === 'your-lot' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Your Lot
            </button>
            <div className="accordion-content">
              <h2>Your Lot</h2>
              <div className="form-group">
                <label>Select Date</label>
                <input
                  type="date"
                  value={yourLotDate}
                  onChange={(event) => setYourLotDate(event.target.value)}
                />
              </div>
              <EntriesTableView
                entries={sortedSentEntries}
                showStatus
                splitByAmount
                groupConsecutiveRows
                emptyMessage="No sent entries yet"
              />
            </div>
          </div>
        )}

        {!billOnlyMode && !activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'send-record' ? 'active' : ''}`}
              onClick={() => handleTabToggle('send-record')}
            >
              Send Record
            </button>
          </div>
        )}

        {!billOnlyMode && activeTab === 'send-record' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Send Record
            </button>
            <div className="accordion-content">
              <h2>Send Record</h2>
              <div className="form-group" onKeyDown={handleSendRecordFilterKeyDown}>
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

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button type="button" onClick={() => loadTransferHistory(getHistoryFilters())}>
                    View Record
                  </button>
                </div>
              </div>

              {Object.keys(transferHistoryByActor).length > 0 ? (
                Object.entries(transferHistoryByActor).map(([actorName, records]) => (
                  <React.Fragment key={actorName}>
                    {renderTransferHistoryTables(records, actorName)}
                  </React.Fragment>
                ))
              ) : (
                <p>No send record found</p>
              )}
            </div>
          </div>
        )}

        {!billOnlyMode && !activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'track-number' ? 'active' : ''}`}
              onClick={() => handleTabToggle('track-number')}
            >
              Track Number
            </button>
          </div>
        )}

        {!billOnlyMode && activeTab === 'track-number' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Track Number
            </button>
            <div className="accordion-content">
              <h2>Track Number - {sessionMode}</h2>
              <div className="form-group">
                <label>Select Date:</label>
                <input
                  type="date"
                  value={traceDate}
                  onChange={(e) => setTraceDate(e.target.value)}
                />

                <label>Search Type:</label>
                <div className="box-options" style={{ marginTop: '8px' }}>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="trace-mode"
                      value="single"
                      checked={traceMode === 'single'}
                      onChange={() => {
                        setTraceMode('single');
                        setTraceNumber('');
                        setTraceRangeEndNumber('');
                      }}
                    />
                    Single Number / Code
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="trace-mode"
                      value="range"
                      checked={traceMode === 'range'}
                      onChange={() => {
                        setTraceMode('range');
                        setTraceNumber('');
                        setTraceRangeEndNumber('');
                      }}
                    />
                    Consecutive Range
                  </label>
                </div>

                <label style={{ marginTop: '12px', display: 'block' }}>
                  {traceMode === 'range' ? 'From Number:' : 'Booked Number / Unique Code:'}
                </label>
                <input
                  type="text"
                  value={traceNumber}
                  onChange={(e) => setTraceNumber(traceMode === 'range' ? sanitizeFiveDigitInput(e.target.value) : e.target.value)}
                  placeholder={traceMode === 'range' ? 'Enter 5 digit from number' : 'Enter booked number or unique code'}
                />
                {traceMode === 'range' && (
                  <>
                    <label style={{ marginTop: '12px', display: 'block' }}>To Number:</label>
                    <input
                      type="text"
                      value={traceRangeEndNumber}
                      onChange={(e) => setTraceRangeEndNumber(String(e.target.value || '').replace(/[^0-9]/g, '').slice(0, 5))}
                      placeholder="Enter end number or suffix"
                      maxLength="5"
                    />
                  </>
                )}
                <label style={{ marginTop: '12px', display: 'block' }}>Amount:</label>
                <div className="box-options" style={{ marginTop: '8px' }}>
                  {hasMultipleAvailableAmounts && (
                    <label className="checkbox-label">
                      <input
                        type="radio"
                        name="trace-amount"
                        value=""
                        checked={traceAmount === ''}
                        onChange={() => {
                          setTraceAmount('');
                          setTraceSem('');
                        }}
                      />
                      ALL
                    </label>
                  )}
                  {availableAmountOptions.map((amountOption) => (
                    <label key={amountOption} className="checkbox-label">
                      <input
                        type="radio"
                        name="trace-amount"
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
                      name="trace-sem"
                      value=""
                      checked={traceSem === ''}
                      onChange={() => setTraceSem('')}
                    />
                    ALL
                  </label>
                  {traceAmount && getAvailableTraceSemOptions().map((group) => (
                    <label key={group} className="checkbox-label">
                      <input
                        type="radio"
                        name="trace-sem"
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
                traceNumber && !traceLoading && <p>No matching booked number / unique code found for {formatDisplayDate(traceDate)} in {sessionMode}</p>
              )}
            </div>
          </div>
        )}

        {billOnlyMode && !activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'generate-bill' ? 'active' : ''}`}
              onClick={() => handleTabToggle('generate-bill')}
            >
              Generate Bill
            </button>
          </div>
        )}

        {billOnlyMode && activeTab === 'generate-bill' && (
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
                  {directChildSellers.map((seller) => (
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
                  <strong>Records:</strong> {billTransferHistoryTotals.recordCount} | <strong>Total Piece:</strong> {billTransferHistoryTotals.totalPiece.toFixed(2)} |{' '}
                  <strong>Total Sales:</strong> Rs. {billTransferHistoryTotals.totalSales.toFixed(2)} | <strong>Total Prize:</strong> Rs. {billTransferHistoryTotals.totalPrize.toFixed(2)} |{' '}
                  <strong>Total VC:</strong> Rs. {billTransferHistoryTotals.totalVc.toFixed(2)} | <strong>Total SVC:</strong> Rs. {billTransferHistoryTotals.totalSvc.toFixed(2)} |{' '}
                  <strong>Net Bill:</strong> {formatSignedRupees(billTransferHistoryTotals.netBill)}
                </div>
              )}

              {Object.keys(billTransferHistoryByActor).length > 0 ? (
                Object.entries(billTransferHistoryByActor).map(([billSellerName, records]) => (
                  <div key={billSellerName} className="entries-list-block" style={{ marginTop: '20px' }}>
                    {(() => {
                      const amountBreakdown = billData.groupedAmountSummaries?.[billSellerName] || {};
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
                              record.pieceCount,
                              record.appliedRate,
                              record.statusAfter
                            ]
                          );
                          const groupedRecords = groupConsecutiveNumberRows(sortedRecords, (record) => [
                            record.actorUsername,
                            record.actionType,
                            record.fromUsername,
                            record.toUsername,
                            record.amount,
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
                                <td>{record.actorUsername}</td>
                                <td>{record.actionType}</td>
                                <td>{record.fromUsername}</td>
                                <td>{record.toUsername}</td>
                                <td>{uniqueCodeLabel}</td>
                                <td>{record.sessionMode}</td>
                                <td>{record.amount}</td>
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
                    <strong>{billSellerName} Total:</strong> Records {billData.groupedSummaries[billSellerName]?.recordCount || 0} | Piece{' '}
                    {billData.groupedSummaries[billSellerName]?.totalPiece?.toFixed(2) || '0.00'} | Sales Rs.{' '}
                    {billData.groupedSummaries[billSellerName]?.totalSales?.toFixed(2) || '0.00'} | Prize Rs.{' '}
                    {billData.groupedSummaries[billSellerName]?.totalPrize?.toFixed(2) || '0.00'} | Total VC Rs.{' '}
                    {billData.groupedSummaries[billSellerName]?.totalVc?.toFixed(2) || '0.00'} | Total SVC Rs.{' '}
                    {billData.groupedSummaries[billSellerName]?.totalSvc?.toFixed(2) || '0.00'} | Net{' '}
                    {formatSignedRupees(billData.groupedSummaries[billSellerName]?.netBill || 0)}
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

              {Object.keys(billTransferHistoryByActor).length > 0 && (
                <div style={{ marginTop: '20px', padding: '14px 16px', borderRadius: '14px', background: '#eef2ff' }}>
                  <strong>Grand Total:</strong> Total Records {billTransferHistoryTotals.recordCount} | Total Piece{' '}
                  {billTransferHistoryTotals.totalPiece.toFixed(2)} | Total Sales Rs. {billTransferHistoryTotals.totalSales.toFixed(2)} | Total Prize Rs.{' '}
                  {billTransferHistoryTotals.totalPrize.toFixed(2)} | Total VC Rs. {billTransferHistoryTotals.totalVc.toFixed(2)} | Total SVC Rs. {billTransferHistoryTotals.totalSvc.toFixed(2)} | Net {formatSignedRupees(billTransferHistoryTotals.netBill)}
                </div>
              )}
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'accept-seller-lot' ? 'active' : ''}`}
              onClick={() => handleTabToggle('accept-seller-lot')}
            >
              Accept Seller Lot
            </button>
          </div>
        )}

        {activeTab === 'accept-seller-lot' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={handleTabBack}>
              Accept Seller Lot
            </button>
            <div className="accordion-content">
              <h2>Accept Seller Lot</h2>
              <EntriesTableView
                entries={sortedReceivedEntries}
                showSeller
                showStatus
                splitByAmount
                actionMode="seller-review"
                actionLoadingId={entryActionLoadingId}
                onAccept={(entry) => handleReceivedEntryAction(entry, 'accept')}
                onReject={(entry) => handleReceivedEntryAction(entry, 'reject')}
                emptyMessage="No seller entries received yet"
              />
            </div>
          </div>
        )}
      </div>

      <>
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}
      </>
    </div>
  );
};

const AddSellerForm = ({ currentUser, onSuccess, onError }) => {
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [rateAmount6, setRateAmount6] = useState('');
  const [rateAmount12, setRateAmount12] = useState('');
  const [loading, setLoading] = useState(false);
  const canAssignAmount6 = currentUser?.role === 'admin' || Number(currentUser?.rateAmount6 || 0) > 0;
  const canAssignAmount12 = currentUser?.role === 'admin' || Number(currentUser?.rateAmount12 || 0) > 0;

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

    try {
      await userService.createSeller(
        trimmedUsername,
        newPassword,
        canAssignAmount6 ? (rateAmount6 ? parseFloat(rateAmount6) : '') : 0,
        canAssignAmount12 ? (rateAmount12 ? parseFloat(rateAmount12) : '') : 0
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
    <div className="tab-content">
      <h2>Add New Seller</h2>
      <form onSubmit={handleCreateSeller} className="seller-form">
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
        {canAssignAmount6 && (
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
        )}
        {canAssignAmount12 && (
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
        )}
        <p style={{ marginTop: '-4px', color: '#666', fontSize: '14px' }}>
          If a rate is left blank, the seller will not be able to book lottery for that amount.
        </p>
        {currentUser?.role !== 'admin' && (
          <p style={{ marginTop: '0', color: '#666', fontSize: '14px' }}>
            If a seller leaves a rate blank, the child seller will get the default rate automatically: 6 for amount 6 and 12 for amount 12.
          </p>
        )}
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Seller'}
        </button>
      </form>
    </div>
  );
};

export default SellerDashboard;
