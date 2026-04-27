import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bookingService, userService } from '../services/api';
import SearchableSellerSelect from './SearchableSellerSelect';
import RetroPurchasePanel from './RetroPurchasePanel';
import { formatDisplayDate } from '../utils/transferBill';
import { useFunctionShortcuts } from '../utils/functionShortcuts';

const getTodayDateValue = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
};

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

const getDisplayDay = (dateValue) => {
  if (!dateValue) {
    return '';
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
};

const getRangeCount = (fromValue, toValue) => {
  const fromNumber = Number(numberInput(fromValue));
  const toNumber = Number(numberInput(toValue || fromValue));

  if (Number.isNaN(fromNumber) || Number.isNaN(toNumber) || toNumber < fromNumber) {
    return 0;
  }

  return (toNumber - fromNumber) + 1;
};

const buildBookingCode = (shift, semValue) => `${getPurchaseCategory(shift)}${String(semValue || '').replace(/[^0-9]/g, '')}`;

const createDraftGridRows = (rows = []) => rows.map((row, index) => {
  const count = getRangeCount(row.rangeStart, row.rangeEnd);
  const quantity = count * Number(row.boxValue || 0);
  return {
    id: row.id || `booking-draft-${index}`,
    serial: index + 1,
    code: buildBookingCode(row.shift, row.boxValue),
    itemName: row.sellerName || '',
    drawDate: row.bookingDate,
    day: getDisplayDay(row.bookingDate),
    from: row.rangeStart,
    to: row.rangeEnd || row.rangeStart,
    quantity,
    rate: Number(row.amount || 0).toFixed(2),
    amount: (quantity * Number(row.amount || 0)).toFixed(2)
  };
});

const BookingPanel = ({ mode, currentUser, onError, onSuccess }) => {
  const [sellers, setSellers] = useState([]);
  const [sellerId, setSellerId] = useState('');
  const [bookingDate, setBookingDate] = useState(getTodayDateValue());
  const [shift, setShift] = useState('MORNING');
  const [amount, setAmount] = useState('6');
  const [sem, setSem] = useState('5');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [draftRows, setDraftRows] = useState([]);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [memoNumber, setMemoNumber] = useState(null);
  const [memoPopupOpen, setMemoPopupOpen] = useState(false);
  const [memoSelectionIndex, setMemoSelectionIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState([]);
  const [billRows, setBillRows] = useState([]);
  const [priceRows, setPriceRows] = useState([]);
  const [recordRows, setRecordRows] = useState([]);
  const [fromDate, setFromDate] = useState(getTodayDateValue());
  const [toDate, setToDate] = useState(getTodayDateValue());
  const [filterSellerId, setFilterSellerId] = useState('');
  const codeInputRef = useRef(null);
  const fromInputRef = useRef(null);
  const toInputRef = useRef(null);
  const dateInputRef = useRef(null);
  const sellerInputRef = useRef(null);
  const headerDateInputRef = useRef(null);
  const shiftSelectRef = useRef(null);
  const baseSelectRef = useRef(null);

  const isAdminMode = currentUser?.role === 'admin';
  const selectedSeller = sellers.find((seller) => String(seller.id) === String(sellerId)) || null;
  const bookingRangeCount = getRangeCount(rangeStart, rangeEnd);
  const bookingQuantity = bookingRangeCount * Number(sem || 0);
  const bookingAmount = bookingQuantity * Number(amount || 0);
  const draftGridRows = createDraftGridRows(draftRows);
  const selectedMemoNumber = Number(memoNumber || 0);
  const memoSummaries = useMemo(() => {
    const memoMap = new Map();
    entries.forEach((entry) => {
      const entryMemoNumber = Number(entry.memoNumber || 0);
      if (!entryMemoNumber) return;
      const current = memoMap.get(entryMemoNumber) || {
        memoNumber: entryMemoNumber,
        drawDate: String(entry.bookingDate || '').slice(0, 10),
        quantity: 0
      };
      current.quantity += Number(entry.boxValue || 0);
      memoMap.set(entryMemoNumber, current);
    });
    return Array.from(memoMap.values()).sort((left, right) => left.memoNumber - right.memoNumber);
  }, [entries]);
  const nextMemoNumber = memoSummaries.length > 0
    ? Math.max(...memoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const effectiveMemoNumber = selectedMemoNumber || nextMemoNumber;
  const memoOptions = [
    { key: `booking-new-${nextMemoNumber}`, label: `New ${nextMemoNumber}`, memoNumber: nextMemoNumber, drawDate: bookingDate, quantity: 0, isNew: true },
    ...memoSummaries.map((memo) => ({
      key: `booking-memo-${memo.memoNumber}`,
      label: memo.memoNumber,
      memoNumber: memo.memoNumber,
      drawDate: memo.drawDate,
      quantity: memo.quantity
    }))
  ];

  const sellerOptions = useMemo(() => [
    ...(mode === 'price-track' || mode === 'bill' || mode === 'accept' ? [{ id: '', username: 'All Sellers', keyword: 'ALL' }] : []),
    ...sellers
  ], [mode, sellers]);

  useEffect(() => {
    let mounted = true;
    userService.getUserTree()
      .then((response) => {
        if (!mounted) return;
        const rows = flattenSellerTree(response.data);
        setSellers(rows);
        if (isAdminMode && rows.length > 0) {
          setSellerId((current) => current || String(rows[0].id));
        }
      })
      .catch((err) => onError?.(err.response?.data?.message || 'Seller list load nahi hua'));
    return () => {
      mounted = false;
    };
  }, [isAdminMode, onError]);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const response = await bookingService.getBookings({
        bookingDate,
        sellerId: isAdminMode ? sellerId : '',
        sessionMode: getSessionMode(shift),
        purchaseCategory: getPurchaseCategory(shift),
        amount
      });
      setEntries(response.data || []);
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking record load nahi hua');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'book') {
      loadEntries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bookingDate, sellerId, shift, amount]);

  const resetEntryInputs = () => {
    setRangeStart('');
    setRangeEnd('');
    setSem('5');
    setActiveRowIndex((current) => Math.min(current + 1, draftRows.length + 1));
  };

  const addOrUpdateDraftRow = () => {
    onError?.('');
    if (isAdminMode && !sellerId) {
      onError?.('Seller select karo');
      return false;
    }
    if (!rangeStart) {
      onError?.('From number required');
      return false;
    }
    if (!sem) {
      onError?.('Code/SEM required');
      return false;
    }
    if (bookingRangeCount <= 0) {
      onError?.('To number from number se chhota nahi ho sakta');
      return false;
    }

    const row = {
      id: `booking-draft-${Date.now()}`,
      sellerId,
      sellerName: isAdminMode ? (selectedSeller?.username || '') : (currentUser?.username || ''),
      bookingDate,
      shift,
      sessionMode: getSessionMode(shift),
      purchaseCategory: getPurchaseCategory(shift),
      amount,
      boxValue: sem,
      rangeStart,
      rangeEnd: rangeEnd || rangeStart
    };

    setDraftRows((currentRows) => {
      if (activeRowIndex < currentRows.length) {
        const nextRows = [...currentRows];
        nextRows[activeRowIndex] = { ...row, id: currentRows[activeRowIndex].id };
        return nextRows;
      }
      return [...currentRows, row];
    });
    resetEntryInputs();
    window.requestAnimationFrame(() => codeInputRef.current?.focus());
    return true;
  };

  const getRowsForSave = () => {
    const rowsToSave = [...draftRows];
    if (rangeStart && sem && bookingRangeCount > 0) {
      rowsToSave.push({
        sellerId,
        sellerName: isAdminMode ? (selectedSeller?.username || '') : (currentUser?.username || ''),
        bookingDate,
        shift,
        sessionMode: getSessionMode(shift),
        purchaseCategory: getPurchaseCategory(shift),
        amount,
        boxValue: sem,
        rangeStart,
        rangeEnd: rangeEnd || rangeStart
      });
    }
    return rowsToSave;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    onError?.('');
    onSuccess?.('');
    if (isAdminMode && !sellerId) {
      onError?.('Seller select karo');
      return;
    }
    const rowsToSave = getRowsForSave();
    if (rowsToSave.length === 0) {
      onError?.('Booking row add karo');
      return;
    }
    setLoading(true);
    try {
      const payloadRows = rowsToSave.map((row) => ({
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd || row.rangeStart,
        boxValue: row.boxValue,
        amount: row.amount,
        bookingDate: row.bookingDate,
        sessionMode: row.sessionMode,
        purchaseCategory: row.purchaseCategory
      }));
      const response = await bookingService.replaceMemo({
        sellerId: isAdminMode ? sellerId : undefined,
        memoNumber: effectiveMemoNumber,
        entries: payloadRows
      });
      setDraftRows([]);
      resetEntryInputs();
      setMemoNumber(effectiveMemoNumber);
      onSuccess?.(response.data?.message || 'Booking save ho gaya');
      await loadEntries();
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking save nahi hua');
    } finally {
      setLoading(false);
    }
  };

  const deleteActiveDraftRow = () => {
    if (draftRows.length === 0) {
      setRangeStart('');
      setRangeEnd('');
      setSem('5');
      return;
    }

    const deleteIndex = activeRowIndex < draftRows.length ? activeRowIndex : draftRows.length - 1;
    setDraftRows((currentRows) => currentRows.filter((_, index) => index !== deleteIndex));
    setActiveRowIndex((currentIndex) => Math.max(Math.min(currentIndex, draftRows.length - 2), 0));
  };

  const hydrateMemoDraftRows = (selectedMemo) => {
    const scopedEntries = entries.filter((entry) => Number(entry.memoNumber || 0) === Number(selectedMemo.memoNumber || 0));
    const rows = scopedEntries.map((entry) => ({
      id: `booking-existing-${entry.id}`,
      sellerId: String(entry.userId || sellerId || ''),
      sellerName: entry.username || selectedSeller?.username || currentUser?.username || '',
      bookingDate: String(entry.bookingDate || '').slice(0, 10),
      shift: getShiftLabel(entry.sessionMode, entry.purchaseCategory),
      sessionMode: entry.sessionMode,
      purchaseCategory: entry.purchaseCategory,
      amount: String(entry.amount || amount),
      boxValue: String(entry.boxValue || ''),
      rangeStart: entry.number,
      rangeEnd: entry.number
    }));
    setMemoNumber(selectedMemo.memoNumber);
    setDraftRows(rows);
    setActiveRowIndex(rows.length);
    setMemoPopupOpen(false);
    window.requestAnimationFrame(() => codeInputRef.current?.focus());
  };

  const handleSend = async () => {
    setLoading(true);
    onError?.('');
    try {
      const response = await bookingService.sendBookings({
        bookingDate,
        sessionMode: getSessionMode(shift),
        purchaseCategory: getPurchaseCategory(shift),
        amount
      });
      onSuccess?.(`${response.data?.message || 'Booking send ho gaya'} (${response.data?.entriesSent || 0})`);
      await loadEntries();
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking send nahi hua');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptBookings = async () => {
    setLoading(true);
    onError?.('');
    try {
      const response = await bookingService.acceptBookings({
        bookingDate,
        sellerId: filterSellerId,
        sessionMode: getSessionMode(shift),
        purchaseCategory: getPurchaseCategory(shift),
        amount
      });
      onSuccess?.(`${response.data?.message || 'Booking accept ho gaya'} (${response.data?.acceptedCount || 0})`);
      await loadAcceptEntries();
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking accept nahi hua');
    } finally {
      setLoading(false);
    }
  };

  const loadAcceptEntries = async () => {
    setLoading(true);
    try {
      const response = await bookingService.getBookings({
        bookingDate,
        sellerId: filterSellerId,
        status: 'sent',
        sessionMode: getSessionMode(shift),
        purchaseCategory: getPurchaseCategory(shift),
        amount
      });
      setEntries(response.data || []);
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking accept list load nahi hua');
    } finally {
      setLoading(false);
    }
  };

  useFunctionShortcuts(mode === 'book', {
    F2: () => {
      const form = document.getElementById('booking-number-form');
      if (form) {
        form.requestSubmit();
      }
    },
    F3: deleteActiveDraftRow,
    F8: () => {
      setDraftRows([]);
      setRangeStart('');
      setRangeEnd('');
      setSem('5');
      setActiveRowIndex(0);
    }
  });

  const loadBill = async () => {
    setLoading(true);
    try {
      const response = await bookingService.getBillSummary({
        fromDate,
        toDate,
        sellerId: filterSellerId
      });
      setBillRows(response.data || []);
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking bill load nahi hua');
    } finally {
      setLoading(false);
    }
  };

  const loadPriceTrack = async () => {
    setLoading(true);
    try {
      const response = await bookingService.getPriceTrack({
        date: bookingDate,
        shift,
        sellerId: filterSellerId
      });
      setPriceRows(response.data?.rows || []);
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking price track load nahi hua');
    } finally {
      setLoading(false);
    }
  };

  const loadRecord = async () => {
    setLoading(true);
    try {
      const response = await bookingService.getRecord({ fromDate, toDate });
      setRecordRows(response.data || []);
    } catch (err) {
      onError?.(err.response?.data?.message || 'Booking record load nahi hua');
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'bill') {
    const totals = billRows.reduce((sum, row) => ({
      totalPiece: sum.totalPiece + Number(row.totalPiece || 0),
      salesAmount: sum.salesAmount + Number(row.salesAmount || 0),
      prizeAmount: sum.prizeAmount + Number(row.prizeAmount || 0),
      netAmount: sum.netAmount + Number(row.netAmount || 0)
    }), { totalPiece: 0, salesAmount: 0, prizeAmount: 0, netAmount: 0 });

    return (
      <div className="accordion-content">
        <h2>Booking Bill</h2>
        <div className="form-group">
          <label>From Date:</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label>To Date:</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <label>Seller:</label>
          <SearchableSellerSelect
            options={sellerOptions}
            value={filterSellerId}
            onChange={(seller) => setFilterSellerId(String(seller?.id || ''))}
            getOptionValue={(option) => option.id}
            getOptionLabel={(option) => option.id ? option.username : 'All Sellers'}
            placeholder="Seller select karo"
          />
          <button type="button" onClick={loadBill} disabled={loading}>{loading ? 'Loading...' : 'View Booking Bill'}</button>
        </div>
        <BookingBillTable rows={billRows} />
        {billRows.length > 0 && (
          <div style={{ marginTop: '16px', padding: '14px 16px', background: '#eef2ff', borderRadius: '8px' }}>
            <strong>Total:</strong> Piece {totals.totalPiece.toFixed(2)} | Sales Rs. {totals.salesAmount.toFixed(2)} | Prize Rs. {totals.prizeAmount.toFixed(2)} | Net Rs. {totals.netAmount.toFixed(2)}
          </div>
        )}
      </div>
    );
  }

  if (mode === 'accept') {
    return (
      <div className="accordion-content">
        <h2>Accept Book Number</h2>
        <div className="form-group">
          <label>Date:</label>
          <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
          <label>Shift:</label>
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="MORNING">MORNING</option>
            <option value="DAY">DAY</option>
            <option value="EVENING">EVENING</option>
          </select>
          <label>Base:</label>
          <select value={amount} onChange={(e) => setAmount(e.target.value)}>
            <option value="6">Rs. 6</option>
            <option value="12">Rs. 12</option>
          </select>
          <label>Seller:</label>
          <SearchableSellerSelect
            options={sellerOptions}
            value={filterSellerId}
            onChange={(seller) => setFilterSellerId(String(seller?.id || ''))}
            getOptionValue={(option) => option.id}
            getOptionLabel={(option) => option.id ? option.username : 'All Sellers'}
            placeholder="Seller select karo"
          />
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
            <button type="button" onClick={loadAcceptEntries} disabled={loading}>{loading ? 'Loading...' : 'View Pending Booking'}</button>
            <button type="button" onClick={handleAcceptBookings} disabled={loading || entries.length === 0} style={{ backgroundColor: '#2f855a' }}>
              Accept Book Number
            </button>
          </div>
        </div>
        <BookingPendingTable rows={entries} />
      </div>
    );
  }

  if (mode === 'price-track') {
    return (
      <div className="accordion-content">
        <h2>Booking Price Track</h2>
        <div className="form-group">
          <label>Date:</label>
          <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
          <label>Shift:</label>
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="ALL">ALL</option>
            <option value="MORNING">MORNING</option>
            <option value="DAY">DAY</option>
            <option value="EVENING">EVENING</option>
          </select>
          <label>Seller:</label>
          <SearchableSellerSelect
            options={sellerOptions}
            value={filterSellerId}
            onChange={(seller) => setFilterSellerId(String(seller?.id || ''))}
            getOptionValue={(option) => option.id}
            getOptionLabel={(option) => option.id ? option.username : 'All Sellers'}
            placeholder="Seller select karo"
          />
          <button type="button" onClick={loadPriceTrack} disabled={loading}>{loading ? 'Loading...' : 'Search'}</button>
        </div>
        <BookingPriceTable rows={priceRows} />
      </div>
    );
  }

  if (mode === 'record' || mode === 'send-record') {
    return (
      <div className="accordion-content">
        <h2>{mode === 'send-record' ? 'Send Record' : 'Booking Record'}</h2>
        <div className="form-group">
          <label>From Date:</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label>To Date:</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <button type="button" onClick={loadRecord} disabled={loading}>{loading ? 'Loading...' : 'View Record'}</button>
        </div>
        <BookingRecordTable rows={recordRows} />
      </div>
    );
  }

  const bookingFormRows = [
    ...(isAdminMode ? [{
      label: 'Seller',
      content: (
        <SearchableSellerSelect
          options={sellers}
          value={sellerId}
          onChange={(seller) => setSellerId(String(seller?.id || ''))}
          getOptionValue={(option) => option.id}
          getOptionLabel={(option) => option.username}
          placeholder="Seller select karo"
          inputRef={sellerInputRef}
          onEnter={() => window.requestAnimationFrame(() => headerDateInputRef.current?.focus())}
        />
      )
    }] : []),
    {
      label: 'Draw Date',
      content: (
        <input
          ref={headerDateInputRef}
          type="date"
          value={bookingDate}
          onChange={(e) => setBookingDate(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              shiftSelectRef.current?.focus();
            }
          }}
        />
      )
    },
    {
      label: 'Shift',
      content: (
        <select
          ref={shiftSelectRef}
          value={shift}
          onChange={(e) => setShift(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              baseSelectRef.current?.focus();
            }
          }}
        >
          <option value="MORNING">MORNING</option>
          <option value="DAY">DAY</option>
          <option value="EVENING">EVENING</option>
        </select>
      )
    },
    {
      label: 'Base',
      content: (
        <select
          ref={baseSelectRef}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              codeInputRef.current?.focus();
              codeInputRef.current?.select?.();
            }
          }}
        >
          <option value="6">Rs. 6</option>
          <option value="12">Rs. 12</option>
        </select>
      )
    }
  ];

  const bookingEditableRow = (
    <tr key="booking-entry-row">
      <td>{activeRowIndex + 1}</td>
      <td>
        <input
          ref={codeInputRef}
          type="text"
          value={buildBookingCode(shift, sem)}
          onChange={(e) => {
            const rawValue = String(e.target.value || '').toUpperCase();
            const prefix = rawValue.match(/[MDE]/)?.[0];
            if (prefix === 'D') setShift('DAY');
            if (prefix === 'E') setShift('EVENING');
            if (prefix === 'M') setShift('MORNING');
            setSem(rawValue.replace(/[^0-9]/g, '').slice(0, 3));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              dateInputRef.current?.focus();
            }
          }}
        />
      </td>
      <td>{isAdminMode ? (selectedSeller?.username || '') : (currentUser?.username || '')}</td>
      <td>
        <input
          ref={dateInputRef}
          type="date"
          value={bookingDate}
          onChange={(e) => setBookingDate(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              fromInputRef.current?.focus();
            }
          }}
        />
      </td>
      <td>{getDisplayDay(bookingDate)}</td>
      <td>
        <input
          ref={fromInputRef}
          type="text"
          value={rangeStart}
          onChange={(e) => setRangeStart(numberInput(e.target.value))}
          maxLength="5"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              toInputRef.current?.focus();
            }
          }}
        />
      </td>
      <td>
        <input
          ref={toInputRef}
          type="text"
          value={rangeEnd}
          onChange={(e) => setRangeEnd(numberInput(e.target.value))}
          maxLength="5"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
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
      screenCode="BOOK"
      screenTitle="Book Number"
      panelTitle={isAdminMode && selectedSeller ? `Booking direct ${selectedSeller.username} ke naam par save hogi` : `${currentUser?.username || ''} booking draft`}
      headerTimestamp={new Date().toLocaleString('en-IN')}
      windowClassName="full-page booking-full-page"
      formId="booking-number-form"
      onSubmit={handleSave}
      formRows={bookingFormRows}
      gridRows={draftGridRows}
      editableRow={bookingEditableRow}
      editableRowIndex={Math.min(activeRowIndex, draftGridRows.length)}
      activeGridRowIndex={activeRowIndex < draftGridRows.length ? activeRowIndex : null}
      onGridRowClick={(row, index) => {
        const draftRow = draftRows[index];
        if (!draftRow) return;
        setActiveRowIndex(index);
        setBookingDate(draftRow.bookingDate);
        setShift(draftRow.shift);
        setAmount(draftRow.amount);
        setSem(draftRow.boxValue);
        setRangeStart(draftRow.rangeStart);
        setRangeEnd(draftRow.rangeEnd || draftRow.rangeStart);
      }}
      summaryQuantity={draftRows.reduce((sum, row) => sum + (getRangeCount(row.rangeStart, row.rangeEnd) * Number(row.boxValue || 0)), 0) + bookingQuantity}
      summaryAmount={draftRows.reduce((sum, row) => sum + (getRangeCount(row.rangeStart, row.rangeEnd) * Number(row.boxValue || 0) * Number(row.amount || 0)), 0) + bookingAmount}
      statusLabel={loading ? 'SAVING' : 'READY'}
      memoNumber={effectiveMemoNumber}
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
            setActiveRowIndex(0);
            setMemoPopupOpen(false);
            return;
          }
          hydrateMemoDraftRows(option);
        }
      }}
      memoProps={{
        tabIndex: 0,
        onClick: () => setMemoPopupOpen((open) => !open),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setMemoPopupOpen((open) => !open);
          }
        }
      }}
      footerActions={[
        {
          label: loading ? 'Saving...' : 'Save (F2)',
          type: 'submit',
          form: 'booking-number-form',
          disabled: loading
        },
        {
          label: 'Delete Row (F3)',
          onClick: deleteActiveDraftRow,
          disabled: loading
        },
        ...(!isAdminMode ? [{
          label: 'Send Booking Numbers',
          onClick: handleSend,
          disabled: loading
        }] : []),
        {
          label: 'Clear',
          onClick: () => {
            setRangeStart('');
            setRangeEnd('');
            setSem('5');
          }
        }
      ]}
      topShortcuts={isAdminMode ? ['F2-Save', 'F3-Delete', 'F8-Clear', 'Esc-Exit'] : ['F2-Save', 'F3-Delete', 'F4-Send', 'F8-Clear', 'Esc-Exit']}
    />
  );
};

const BookingBillTable = ({ rows }) => (
  <div className="entries-list-block" style={{ marginTop: '20px' }}>
    <table className="entries-table">
      <thead>
        <tr>
          <th>Seller</th>
          <th>Base</th>
          <th>SEM</th>
          <th>Numbers</th>
          <th>Sold Piece</th>
          <th>Sales</th>
          <th>Prize</th>
          <th>Net Bill</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row) => (
          <tr key={`${row.sellerId}-${row.amount}-${row.sem}`}>
            <td>{row.sellerUsername}</td>
            <td>{row.amount}</td>
            <td>{row.sem}</td>
            <td>{row.numberCount}</td>
            <td>{Number(row.soldPiece || 0).toFixed(2)}</td>
            <td>{Number(row.salesAmount || 0).toFixed(2)}</td>
            <td>{Number(row.prizeAmount || 0).toFixed(2)}</td>
            <td>{Number(row.netAmount || 0).toFixed(2)}</td>
          </tr>
        )) : (
          <tr><td colSpan="8">No booking bill data found</td></tr>
        )}
      </tbody>
    </table>
  </div>
);

const BookingPendingTable = ({ rows }) => (
  <div className="entries-list-block" style={{ marginTop: '20px' }}>
    <table className="entries-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Shift</th>
          <th>Seller</th>
          <th>Base</th>
          <th>SEM</th>
          <th>Number</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row) => (
          <tr key={row.id}>
            <td>{formatDisplayDate(row.bookingDate)}</td>
            <td>{getShiftLabel(row.sessionMode, row.purchaseCategory)}</td>
            <td>{row.username || '-'}</td>
            <td>{row.amount}</td>
            <td>{row.boxValue}</td>
            <td>{row.number}</td>
            <td>{row.status}</td>
          </tr>
        )) : (
          <tr><td colSpan="7">No pending booking found</td></tr>
        )}
      </tbody>
    </table>
  </div>
);

const BookingPriceTable = ({ rows }) => (
  <div className="entries-list-block" style={{ marginTop: '20px' }}>
    <table className="entries-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Shift</th>
          <th>Seller</th>
          <th>Base</th>
          <th>SEM</th>
          <th>Number</th>
          <th>Prize</th>
          <th>Winning</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row) => (
          <tr key={row.id}>
            <td>{formatDisplayDate(row.bookingDate)}</td>
            <td>{getShiftLabel(row.sessionMode, row.purchaseCategory)}</td>
            <td>{row.sellerUsername}</td>
            <td>{row.amount}</td>
            <td>{row.sem}</td>
            <td>{row.number}</td>
            <td>{row.prizeLabel}</td>
            <td>{row.winningNumber}</td>
            <td>{Number(row.calculatedPrize || 0).toFixed(2)}</td>
          </tr>
        )) : (
          <tr><td colSpan="9">Selected filter me booking winning number nahi mila</td></tr>
        )}
      </tbody>
    </table>
  </div>
);

const BookingRecordTable = ({ rows }) => (
  <div className="entries-list-block" style={{ marginTop: '20px' }}>
    <table className="entries-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Time</th>
          <th>Actor</th>
          <th>Seller</th>
          <th>Action</th>
          <th>Base</th>
          <th>SEM</th>
          <th>Number</th>
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row) => (
          <tr key={row.id}>
            <td>{formatDisplayDate(row.bookingDate)}</td>
            <td>{row.createdAt ? new Date(row.createdAt).toLocaleTimeString('en-IN') : '-'}</td>
            <td>{row.actorUsername}</td>
            <td>{row.username}</td>
            <td>{row.actionType}</td>
            <td>{row.amount}</td>
            <td>{row.boxValue}</td>
            <td>{row.number}</td>
          </tr>
        )) : (
          <tr><td colSpan="8">No booking record found</td></tr>
        )}
      </tbody>
    </table>
  </div>
);

export default BookingPanel;
