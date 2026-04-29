import React, { useEffect, useRef, useState } from 'react';
import { createWorker } from 'tesseract.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.entry';
import { lotteryService, priceService, userService } from '../services/api';
import UserTreeView from './UserTreeView';
import EntriesTableView from './EntriesTableView';
import PasswordSettingsMenu from './PasswordSettingsMenu';
import RetroPurchasePanel from './RetroPurchasePanel';
import DashboardLauncher from './DashboardLauncher';
import ExitConfirmPrompt from './ExitConfirmPrompt';
import SearchableSellerSelect from './SearchableSellerSelect';
import { buildBillAmountSummariesWithPrize, buildBillData, buildBillSummaryWithPrize, formatDisplayDate, formatDisplayDateTime, formatSignedRupees, getAllowedAmountsLabel, getNormalizedPrizeBaseAmount, getNormalizedPrizeCalculatedAmount, groupTransferHistoryByActor, openTransferBill, summarizeTransferHistory } from '../utils/transferBill';
import { groupConsecutiveNumberRows, sortRowsForConsecutiveNumbers } from '../utils/numberRanges';
import { useFunctionShortcuts } from '../utils/functionShortcuts';
import '../styles/AdminDashboard.css';

GlobalWorkerOptions.workerSrc = pdfWorker;

const getTodayDateValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseLocalDateValue = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    return new Date(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]));
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateOnly = (value) => {
  if (!value) {
    return '';
  }

  const normalized = String(value);
  const isoDateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) {
    return isoDateMatch[1];
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  return date.toISOString().slice(0, 10);
};

const getDisplayDay = (value) => {
  const date = parseLocalDateValue(value);
  if (!date) {
    return '';
  }

  return date.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
};

const formatDuplicateSellerWarning = (entries = []) => {
  const sellerNames = [...new Set(
    entries
      .map((entry) => String(entry.displaySeller || entry.username || '').trim())
      .filter(Boolean)
  )];

  if (sellerNames.length === 0) {
    return 'You already send this stock to another seller';
  }

  if (sellerNames.length > 5) {
    return `You already send this stock to ${sellerNames.slice(0, 5).join(', ')} +${sellerNames.length - 5} more`;
  }

  return `You already send this stock to ${sellerNames.join(', ')}`;
};

const getSellerKeyword = (sellerOrUsername = '', fallbackKeyword = '') => {
  if (sellerOrUsername && typeof sellerOrUsername === 'object') {
    const explicitKeyword = String(sellerOrUsername.keyword || '').trim().toUpperCase();
    if (explicitKeyword) {
      return explicitKeyword;
    }

    return String(sellerOrUsername.username || '').trim().slice(0, 2).toUpperCase();
  }

  const explicitKeyword = String(fallbackKeyword || '').trim().toUpperCase();
  if (explicitKeyword) {
    return explicitKeyword;
  }

  return String(sellerOrUsername || '').trim().slice(0, 2).toUpperCase();
};

const PRIZE_OPTIONS = [
  { key: 'first', title: '1st Prize', amountLabel: '25000', amountValue: 25000, digitLength: 5 },
  { key: 'second', title: '2nd Prize', amountLabel: '20000', amountValue: 20000, digitLength: 5 },
  { key: 'third', title: '3rd Prize', amountLabel: '2000', amountValue: 2000, digitLength: 4 },
  { key: 'fourth', title: '4th Prize', amountLabel: '700', amountValue: 700, digitLength: 4 },
  { key: 'fifth', title: '5th Prize', amountLabel: '300', amountValue: 300, digitLength: 4 }
];
const ADMIN_PURCHASE_SHORTCUTS = ['F2-Save', 'F3-Delete', 'A-Add', 'F8-Clear', 'Esc-Exit'];
const ADMIN_UNSOLD_SHORTCUTS = ['F2-Save', 'F3-Delete', 'A-Add', 'F4-View', 'F8-Clear', 'Esc-Exit'];
const REMOVABLE_UNSOLD_STATUSES = new Set(['unsold_saved', 'unsold_sent', 'unsold']);
const SELLER_TYPE_LABELS = {
  seller: 'Stokist',
  sub_seller: 'Sub Stokist',
  normal_seller: 'Seller'
};

const getAvailableSemOptions = (selectedAmount) => {
  if (selectedAmount === '7') {
    return ['5', '10', '25', '50', '100', '200'];
  }
  if (selectedAmount === '12') {
    return ['5', '10', '15', '20', '30', '50', '100', '200'];
  }
  return [];
};

const parseRetroCodeValue = (value, fallbackSessionMode, fallbackPurchaseCategory = '') => {
  const normalized = String(value || '').trim().toUpperCase();
  const explicitFallbackCategory = String(fallbackPurchaseCategory || '').trim().toUpperCase();
  const fallbackCategory = fallbackSessionMode === 'NIGHT' ? 'E' : (explicitFallbackCategory || 'M');

  if (!normalized) {
    return {
      semValue: '',
      resolvedSessionMode: fallbackSessionMode,
      resolvedPurchaseCategory: fallbackCategory
    };
  }

  const compactValue = normalized.replace(/[^A-Z0-9/]/g, '');
  const primaryToken = compactValue.split('/').find(Boolean) || compactValue;
  const plainSemMatch = primaryToken.match(/^(\d{1,3})$/);
  if (plainSemMatch) {
    return {
      semValue: plainSemMatch[1],
      resolvedSessionMode: fallbackCategory === 'E' ? 'NIGHT' : 'MORNING',
      resolvedPurchaseCategory: fallbackCategory
    };
  }

  const matched = primaryToken.match(/^([MDE])(\d{1,3})$/) || compactValue.match(/^([MDE])(\d{1,3})(?:\/\d{1,3})?$/);
  if (!matched) {
    return { error: 'Code mein sirf 5 / 10 / 100 / M5 / D10 / E100 jaise value do' };
  }

  const resolvedPurchaseCategory = matched[1] || fallbackCategory;
  if (fallbackCategory && resolvedPurchaseCategory !== fallbackCategory) {
    return { error: `${matched[1]}${matched[2]} is not allowed. Is company me sirf ${fallbackCategory}${matched[2]} chalega` };
  }
  const resolvedSessionMode = resolvedPurchaseCategory === 'E' ? 'NIGHT' : 'MORNING';

  return {
    semValue: matched[2],
    resolvedSessionMode,
    resolvedPurchaseCategory
  };
};

const buildRetroTicketCode = (sessionMode, semValue, purchaseCategory = '') => {
  const normalizedSem = String(semValue || '').replace(/[^0-9]/g, '');
  if (!normalizedSem) {
    return '';
  }

  return `${String(purchaseCategory || '').trim().toUpperCase() || (sessionMode === 'NIGHT' ? 'E' : 'M')}${normalizedSem}`;
};

const RIVER_ITEM_NAMES_BY_DAY = ['BRAHMAPUTRA', 'GANGA', 'YAMUNA', 'GODAVARI', 'NARMADA', 'KRISHNA', 'KAVERI'];

const getRetroItemName = (dateValue) => {
  const parsedDate = parseLocalDateValue(formatDateOnly(dateValue));
  if (!parsedDate) {
    return RIVER_ITEM_NAMES_BY_DAY[1];
  }

  return RIVER_ITEM_NAMES_BY_DAY[parsedDate.getDay()] || RIVER_ITEM_NAMES_BY_DAY[1];
};
const getPurchaseCategoryLabel = (purchaseCategory) => {
  if (purchaseCategory === 'D') {
    return 'DAY';
  }

  if (purchaseCategory === 'E') {
    return 'EVENING';
  }

  return 'MORNING';
};

const getInitialBillShift = (sessionMode, purchaseCategory = '') => {
  const normalizedCategory = String(purchaseCategory || '').trim().toUpperCase();
  if (normalizedCategory === 'D') {
    return 'DAY';
  }

  return sessionMode === 'NIGHT' ? 'EVENING' : 'MORNING';
};

const getBillPurchaseCategory = (shift) => {
  if (!shift || shift === 'ALL') {
    return '';
  }

  if (shift === 'DAY') {
    return 'D';
  }

  if (shift === 'EVENING' || shift === 'NIGHT') {
    return 'E';
  }

  return 'M';
};

const getBillApiShift = (shift) => {
  if (!shift || shift === 'ALL') {
    return '';
  }

  return shift === 'EVENING' || shift === 'NIGHT' ? 'NIGHT' : 'MORNING';
};

const isRemovableUnsoldEntry = (entry) => REMOVABLE_UNSOLD_STATUSES.has(String(entry.status || '').trim().toLowerCase());

const openSelectPicker = (selectElement) => {
  if (!selectElement) {
    return;
  }

  selectElement.focus();
  if (typeof selectElement.showPicker === 'function') {
    try {
      selectElement.showPicker();
      return;
    } catch (error) {
      // Some browsers block showPicker after synthetic events; click is the fallback.
    }
  }

  selectElement.click();
};

const focusElementReliably = (getElement) => {
  const focusElement = () => {
    const element = getElement();
    if (!element) {
      return;
    }

    element.focus();
    element.select?.();
  };

  const animationFrameId = window.requestAnimationFrame(focusElement);
  const firstTimeoutId = window.setTimeout(focusElement, 0);
  const secondTimeoutId = window.setTimeout(focusElement, 80);

  return () => {
    window.cancelAnimationFrame(animationFrameId);
    window.clearTimeout(firstTimeoutId);
    window.clearTimeout(secondTimeoutId);
  };
};

const focusNextOnEnter = (event) => {
  if (
    event.defaultPrevented
    || event.key !== 'Enter'
    || event.ctrlKey
    || event.altKey
    || event.metaKey
    || event.isComposing
  ) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const tagName = target.tagName.toLowerCase();
  const inputType = String(target.getAttribute('type') || '').toLowerCase();
  const root = target.closest('[data-enter-navigation-root]') || document;
  const focusableElements = Array.from(root.querySelectorAll('input, select, textarea, button'))
    .filter((element) => (
      element instanceof HTMLElement
      && !element.disabled
      && element.tabIndex !== -1
      && element.offsetParent !== null
      && element.getAttribute('type') !== 'hidden'
    ));
  const currentIndex = focusableElements.indexOf(target);
  const focusNextElement = () => {
    if (currentIndex === -1) {
      return;
    }

    const nextElement = focusableElements[currentIndex + 1] || focusableElements[0];
    if (nextElement && nextElement !== target) {
      nextElement.focus();
      if (typeof nextElement.select === 'function' && nextElement.tagName.toLowerCase() === 'input') {
        nextElement.select();
      }
    }
  };

  if (tagName === 'button') {
    event.preventDefault();
    target.click();
    return;
  }

  if (tagName === 'select' && !target.value) {
    event.preventDefault();
    openSelectPicker(target);
    return;
  }

  if (tagName === 'input' && ['checkbox', 'radio'].includes(inputType)) {
    event.preventDefault();
    target.click();
    window.requestAnimationFrame(focusNextElement);
    return;
  }

  const canMoveFromTarget = tagName === 'select'
    || tagName === 'textarea'
    || (tagName === 'input' && !['button', 'submit', 'reset', 'hidden', 'file'].includes(inputType));

  if (!canMoveFromTarget) {
    return;
  }

  event.preventDefault();
  focusNextElement();
};

const buildCompanyDisplayLabel = (sessionMode, purchaseCategory, amountValue, fallbackLabel = '') => {
  if (fallbackLabel) {
    return fallbackLabel;
  }

  return `${getPurchaseCategoryLabel(String(purchaseCategory || '').trim().toUpperCase() || (sessionMode === 'NIGHT' ? 'E' : 'M'))} BEST ${amountValue || ''}`.trim();
};

const getExplicitCodePrefix = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  const matched = normalized.match(/^([MDE])/);
  return matched ? matched[1] : '';
};

const normalizeNumericInput = (value) => String(value || '').replace(/[^0-9]/g, '').slice(0, 5);

const normalizeRangeStartInput = (fromValue, referenceFromValue = '') => {
  const fromDigits = normalizeNumericInput(fromValue);

  if (fromDigits.length === 5 || fromDigits.length === 0) {
    return fromDigits;
  }

  const referenceDigits = normalizeNumericInput(referenceFromValue);
  if (referenceDigits.length !== 5) {
    return fromDigits;
  }

  return `${referenceDigits.slice(0, 5 - fromDigits.length)}${fromDigits}`;
};

const resolveRangeEndValue = (fromValue, toValue) => {
  const normalizedFrom = normalizeNumericInput(fromValue);
  const normalizedTo = normalizeNumericInput(toValue);

  if (!normalizedFrom || !normalizedTo) {
    return '';
  }

  if (normalizedTo.length >= normalizedFrom.length) {
    return normalizedTo;
  }

  const suffixBase = 10 ** normalizedTo.length;
  const fromNumber = Number(normalizedFrom);
  let resolvedToNumber = Number(`${normalizedFrom.slice(0, normalizedFrom.length - normalizedTo.length)}${normalizedTo}`);

  while (resolvedToNumber < fromNumber) {
    resolvedToNumber += suffixBase;
  }

  return String(resolvedToNumber);
};

const getRetroRangeMetrics = (codeValue, fallbackSessionMode, fromValue, toValue, fallbackPurchaseCategory = '') => {
  const parsed = parseRetroCodeValue(codeValue, fallbackSessionMode, fallbackPurchaseCategory);
  const fromNumber = normalizeNumericInput(fromValue);
  const resolvedToNumber = resolveRangeEndValue(fromNumber, toValue || fromValue);

  if (parsed.error) {
    return { parsed, fromNumber, toNumber: resolvedToNumber, count: 0, quantity: 0 };
  }

  if (fromNumber && fromNumber.length < 5) {
    return { parsed, fromNumber, toNumber: resolvedToNumber, count: 0, quantity: 0, error: 'From number minimum 5 digit hona chahiye' };
  }

  if (!parsed.semValue || !fromNumber || !resolvedToNumber) {
    return { parsed, fromNumber, toNumber: resolvedToNumber, count: 0, quantity: 0 };
  }

  const count = Math.max((Number(resolvedToNumber) - Number(fromNumber)) + 1, 1);
  const quantity = Number(parsed.semValue) * count;

  return {
    parsed,
    fromNumber,
    toNumber: resolvedToNumber,
    count,
    quantity
  };
};

const shouldMoveFocusLeft = (event) => {
  const cursorAtStart = typeof event.target?.selectionStart === 'number'
    ? event.target.selectionStart === 0 && event.target.selectionEnd === 0
    : true;

  return event.key === 'ArrowLeft' && cursorAtStart;
};

const shouldMoveFocusVertical = (event, direction) => event.key === direction;
const shouldMoveFocusRight = (event) => {
  const cursorAtEnd = typeof event.target?.selectionStart === 'number'
    ? event.target.selectionStart === String(event.target?.value || '').length
      && event.target.selectionEnd === String(event.target?.value || '').length
    : true;

  return event.key === 'ArrowRight' && cursorAtEnd;
};

const rangesOverlap = (startA, endA, startB, endB) => {
  const normalizedStartA = Number(normalizeNumericInput(startA));
  const normalizedEndA = Number(normalizeNumericInput(endA || startA));
  const normalizedStartB = Number(normalizeNumericInput(startB));
  const normalizedEndB = Number(normalizeNumericInput(endB || startB));

  if ([normalizedStartA, normalizedEndA, normalizedStartB, normalizedEndB].some(Number.isNaN)) {
    return false;
  }

  return normalizedStartA <= normalizedEndB && normalizedStartB <= normalizedEndA;
};

const buildConsecutiveNumbers = (startValue, endValue) => {
  const startNumber = normalizeNumericInput(startValue);
  const endNumber = resolveRangeEndValue(startNumber, endValue || startValue);

  if (!startNumber || startNumber.length !== 5) {
    return { error: 'From number 5 digit hona chahiye' };
  }

  if (!endNumber || endNumber.length !== 5) {
    return { error: 'To number 5 digit hona chahiye' };
  }

  const start = Number(startNumber);
  const end = Number(endNumber);

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return { error: 'To number from number se chhota nahi ho sakta' };
  }

  return {
    numbers: Array.from({ length: (end - start) + 1 }, (_, index) => String(start + index).padStart(5, '0'))
  };
};

const formatMissingNumberLabel = (numbers = []) => (
  numbers.length > 5
    ? `${numbers.slice(0, 5).join(', ')} +${numbers.length - 5} more`
    : numbers.join(', ')
);

const expandPurchaseRowsForSave = (rows = [], maxRangeSize = 2000) => rows.flatMap((row) => {
  const startNumber = normalizeNumericInput(row.from);
  const endNumber = resolveRangeEndValue(startNumber, row.to || row.from);
  const start = Number(startNumber);
  const end = Number(endNumber);

  if (!startNumber || !endNumber || Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return [row];
  }

  const expandedRows = [];
  for (let currentStart = start; currentStart <= end; currentStart += maxRangeSize) {
    const currentEnd = Math.min(currentStart + maxRangeSize - 1, end);
    expandedRows.push({
      ...row,
      from: String(currentStart).padStart(5, '0'),
      to: String(currentEnd).padStart(5, '0')
    });
  }

  return expandedRows;
});

const formatRetroDisplayDate = (value) => {
  const normalized = formatDateOnly(value || '');
  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    return `${isoDateMatch[3]}-${isoDateMatch[2]}-${isoDateMatch[1]}`;
  }

  return normalized;
};

const createRetroGridRows = (rows = [], options = {}) => rows.map((row, index) => ({
  id: row.id || `retro-row-${index}`,
  serial: index + 1,
  code: row.code || '',
  itemName: row.itemName || '',
  drawDate: formatRetroDisplayDate(options.drawDate || row.drawDate || ''),
  day: row.day || '',
  prefix: row.prefix || '',
  series: row.series || '',
  from: row.from || '',
  to: row.to || '',
  quantity: row.quantity || '',
  rate: row.rate || '',
  amount: row.amount || ''
}));

const formatMemoTimestamp = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

const getDateOnlyValue = (dateValue) => {
  if (!dateValue) {
    return '';
  }

  const normalized = String(dateValue).trim();
  const isoMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const parsedDate = new Date(normalized);
  if (Number.isNaN(parsedDate.getTime())) {
    return normalized;
  }

  return parsedDate.toISOString().slice(0, 10);
};

const buildPurchaseMemoSummaries = (entries = []) => {
  const memoMap = new Map();

  entries.forEach((entry) => {
    const memoNumber = Number(entry.memoNumber || 0);
    if (!Number.isInteger(memoNumber) || memoNumber <= 0) {
      return;
    }

    const sentAtKey = entry.sentAt || entry.createdAt || `${entry.bookingDate || ''}-${memoNumber}`;
    const memoEntry = memoMap.get(memoNumber) || {
      memoNumber,
      totalPieceCount: 0,
      batches: new Map()
    };

    const existingBatch = memoEntry.batches.get(sentAtKey) || {
      id: sentAtKey,
      drawDate: getDateOnlyValue(entry.bookingDate || entry.booking_date || ''),
      sentAt: entry.sentAt || entry.createdAt || '',
      quantity: 0,
      rowCount: 0
    };

    const pieceCount = Number(entry.sem || entry.boxValue || 0);
    existingBatch.quantity += pieceCount;
    existingBatch.rowCount += 1;
    memoEntry.totalPieceCount += pieceCount;
    memoEntry.batches.set(sentAtKey, existingBatch);
    memoMap.set(memoNumber, memoEntry);
  });

  return Array.from(memoMap.values())
    .sort((left, right) => left.memoNumber - right.memoNumber)
    .map((memoEntry) => ({
      memoNumber: memoEntry.memoNumber,
      totalPieceCount: memoEntry.totalPieceCount,
      drawDate: Array.from(memoEntry.batches.values())[0]?.drawDate || '',
      batches: Array.from(memoEntry.batches.values()).sort(
        (left, right) => new Date(left.sentAt || 0).getTime() - new Date(right.sentAt || 0).getTime()
      )
    }));
};

const buildAdminStockDraftRowsFromEntries = (entries = [], amountValue) => (
  groupConsecutiveNumberRows(
    sortRowsForConsecutiveNumbers(
      [...entries],
      (entry) => [
        entry.bookingDate,
        entry.sessionMode,
        entry.purchaseCategory,
        entry.amount,
        entry.sem,
        entry.series || ''
      ]
    ),
    (entry) => [
      entry.bookingDate,
      entry.sessionMode,
      entry.purchaseCategory,
      entry.amount,
      entry.sem,
      entry.series || ''
    ].join('|')
  ).map((group, index) => {
    const entry = group.firstRow || {};
    const count = group.rows.length;
    const semValue = Number(entry.sem || 0);
    const rateValue = Number(amountValue || entry.amount || 0);

    return {
      id: `${entry.id || `memo-entry-${index}`}-${group.lastRow?.id || count}`,
      code: buildRetroTicketCode(entry.sessionMode || 'MORNING', entry.sem, entry.purchaseCategory),
      itemName: getRetroItemName(entry.bookingDate),
      drawDate: formatDateOnly(entry.bookingDate || ''),
      day: getDisplayDay(entry.bookingDate || ''),
      prefix: '',
      series: entry.series || '',
      from: entry.number || '',
      to: group.lastRow?.number || entry.number || '',
      quantity: semValue * count,
      rate: rateValue.toFixed(2),
      amount: (semValue * count * rateValue).toFixed(2),
      semValue: String(entry.sem || ''),
      bookingAmount: String(entry.amount || amountValue || ''),
      resolvedSessionMode: entry.sessionMode || 'MORNING',
      resolvedPurchaseCategory: entry.purchaseCategory || (entry.sessionMode === 'NIGHT' ? 'E' : 'M')
    };
  })
);

const buildPurchaseSendDraftRowsFromEntries = (entries = [], amountValue, options = {}) => (
  buildAdminStockDraftRowsFromEntries(entries, amountValue).map((row, index) => {
    const firstEntry = entries.find((entry) => String(entry.number || '') === String(row.from || '')) || entries[index] || {};

    return {
      ...row,
      id: `purchase-send-memo-${row.id || index}`,
      itemName: row.itemName || getRetroItemName(firstEntry.bookingDate),
      isExistingUnsoldMemoRow: Boolean(options.existingUnsoldMemo),
      isExistingUnsoldRemoveMemoRow: Boolean(options.existingUnsoldRemoveMemo),
      isEditedUnsoldRemoveRow: false,
      entryIds: entries
        .filter((entry) => (
          String(entry.boxValue || entry.sem || '') === String(row.semValue || '')
          && String(entry.amount || '') === String(row.bookingAmount || amountValue || '')
          && String(entry.sessionMode || 'MORNING') === String(row.resolvedSessionMode || 'MORNING')
          && String(entry.purchaseCategory || (entry.sessionMode === 'NIGHT' ? 'E' : 'M')) === String(row.resolvedPurchaseCategory || '')
          && String(entry.bookingDate || '') === String(row.drawDate || '')
          && String(entry.number || '') >= String(row.from || '')
          && String(entry.number || '') <= String(row.to || '')
        ))
        .map((entry) => entry.id)
    };
  })
);

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
  userId: entry.userId || entry.user_id,
  username: entry.username,
  displaySeller: entry.forwardedByUsername || entry.username,
  uniqueCode: entry.uniqueCode,
  sem: entry.boxValue,
  amount: String(entry.amount),
  number: entry.number,
  price: Number(entry.boxValue || 0) * Number(entry.amount || 0),
  memoNumber: entry.memoNumber ?? entry.memo_number ?? null,
  bookingDate: entry.bookingDate || entry.booking_date || null,
  sessionMode: entry.sessionMode,
  purchaseCategory: entry.purchaseCategory || (entry.sessionMode === 'NIGHT' ? 'E' : 'M'),
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
  fromUserId: record.fromUserId || record.from_user_id,
  fromUsername: record.fromUsername || record.from_username,
  toUserId: record.toUserId || record.to_user_id,
  toUsername: record.toUsername || record.to_username,
  actorUserId: record.actorUserId || record.actor_user_id,
  actorUsername: record.actorUsername || record.actor_username,
  actionType: record.actionType || record.action_type,
  statusAfter: record.statusAfter || record.status_after,
  memoNumber: record.memoNumber ?? record.memo_number ?? null,
  sessionMode: record.sessionMode || record.session_mode,
  purchaseCategory: record.purchaseCategory || record.purchase_category || ((record.sessionMode || record.session_mode) === 'NIGHT' ? 'E' : 'M'),
  createdAt: record.createdAt || record.created_at
});

const splitEntriesByAmount = (entries = []) => ({
  amount6: entries.filter((entry) => String(entry.amount) === '7'),
  amount12: entries.filter((entry) => String(entry.amount) === '12')
});

const normalizeSeePurchaseEntry = (entry = {}, sourceType) => ({
  id: entry.id || entry._id || `${sourceType}-${entry.number || ''}-${entry.memoNumber || ''}`,
  number: String(entry.number || '').trim(),
  boxValue: String(entry.boxValue || entry.sem || '').trim(),
  amount: String(entry.amount || '').trim(),
  bookingDate: entry.bookingDate || entry.booking_date || '',
  sessionMode: entry.sessionMode || entry.session_mode || '',
  purchaseCategory: entry.purchaseCategory || (entry.sessionMode === 'NIGHT' || entry.session_mode === 'NIGHT' ? 'E' : 'M'),
  memoNumber: entry.memoNumber ?? entry.memo_number ?? '',
  sellerName: entry.displaySeller || entry.username || '',
  status: entry.status || '',
  sourceType
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

const getAdminRootSellerName = (treeRoot, sellerName = '') => {
  const normalizedSellerName = String(sellerName || '').trim();
  if (!normalizedSellerName) {
    return '';
  }

  const directSellerLookup = buildDirectSellerLookup(treeRoot);
  return directSellerLookup.get(normalizedSellerName) || normalizedSellerName;
};

const flattenSellerNodes = (treeRoot) => {
  const sellers = [];

  const visit = (node) => {
    if (!node) {
      return;
    }

    if (node.role === 'seller') {
      sellers.push(node);
    }

    (node.children || []).forEach(visit);
  };

  visit(treeRoot);
  return sellers;
};

const getPrizeShiftLabel = (shift) => {
  if (shift === 'DAY') {
    return 'DAY';
  }

  if (shift === 'EVENING') {
    return 'EVENING';
  }

  if (shift === 'MORNING') {
    return 'MORNING';
  }

  return 'ALL';
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

const createPendingPrizeEntries = () => PRIZE_OPTIONS.reduce((accumulator, prize) => {
  accumulator[prize.key] = [];
  return accumulator;
}, {});

const createManualPrizeInputs = () => PRIZE_OPTIONS.reduce((accumulator, prize) => {
  accumulator[prize.key] = '';
  return accumulator;
}, {});

const sortPrizeNumbersAscending = (numbers = []) => (
  [...numbers].sort((left, right) => Number(left) - Number(right) || String(left).localeCompare(String(right)))
);

const OCR_DIGIT_REPLACEMENTS = {
  O: '0',
  o: '0',
  I: '1',
  l: '1',
  '|': '1',
  S: '5',
  s: '5',
  B: '8',
  Z: '2'
};

const normalizeOcrDigitToken = (value = '') => String(value)
  .replace(/[OoIl|SsBZ]/g, (character) => OCR_DIGIT_REPLACEMENTS[character] || character)
  .replace(/\D/g, '');

const getOcrSection = (text, startPatterns = [], endPatterns = []) => {
  const normalizedText = String(text || '');
  const upperText = normalizedText.toUpperCase();
  const startIndexes = startPatterns
    .map((pattern) => upperText.search(pattern))
    .filter((index) => index >= 0);
  if (startPatterns.length > 0 && startIndexes.length === 0) {
    return '';
  }
  const startIndex = startIndexes.length > 0 ? Math.min(...startIndexes) : 0;
  const remainingUpperText = upperText.slice(startIndex);
  const endIndexes = endPatterns
    .map((pattern) => remainingUpperText.search(pattern))
    .filter((index) => index > 0);
  const endIndex = endIndexes.length > 0 ? startIndex + Math.min(...endIndexes) : normalizedText.length;
  return normalizedText.slice(startIndex, endIndex);
};

const buildCurrentMemoSummaries = (entries = []) => {
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    purchaseMemoNumber: entry.memoNumber ?? entry.memo_number ?? null
  }));

  return buildPurchaseMemoSummaries(normalizedEntries);
};

const PRIZE_RESULT_COLUMNS_PER_LINE = 5;
const PRIZE_RESULT_MAX_STANDARD_FOUR_DIGIT_NUMBERS = 10;
const PRIZE_RESULT_MAX_SECOND_PRIZE_NUMBERS = 10;
const PRIZE_RESULT_MAX_FIFTH_PRIZE_NUMBERS = 100;
const IGNORED_FIVE_DIGIT_PRIZE_SCAN_NUMBERS = new Set([
  '10000',
  '20000',
  '25000',
  '50000',
  ...PRIZE_OPTIONS.map((prize) => String(prize.amountValue || '').padStart(5, '0'))
]);

const getOcrNumberTokens = (text, digitLength) => (
  String(text || '')
    .match(/[A-Z0-9|IlOoSsBZ]{3,20}/g) || []
)
  .flatMap((token) => {
    const digits = normalizeOcrDigitToken(token);
    if (!digits) {
      return [];
    }

    if (digits.length === digitLength) {
      return [digits];
    }

    if (digits.length > digitLength && digits.length % digitLength === 0) {
      return digits.match(new RegExp(`\\d{${digitLength}}`, 'g')) || [];
    }

    return [];
  });

const getOcrFirstPrizeCandidates = (text) => (
  String(text || '')
    .match(/[A-Z0-9|IlOoSsBZ]{5,10}/g) || []
)
  .map((token) => {
    const digits = normalizeOcrDigitToken(token);
    if (digits.length === 5) {
      return digits;
    }

    return /[A-Z|IlOoSsBZ]/.test(token) && digits.length > 5
      ? digits.slice(-5)
      : '';
  })
  .filter(Boolean);

const extractPrizeLineBlocks = (text, digitLength) => {
  const blocks = [];
  let currentBlock = [];

  String(text || '')
    .split(/\n/)
    .forEach((line) => {
      const digitsOnLine = getOcrNumberTokens(line, digitLength);

      if (digitsOnLine.length < 3) {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
        return;
      }

      currentBlock.push(...digitsOnLine.slice(-Math.floor(digitsOnLine.length / PRIZE_RESULT_COLUMNS_PER_LINE) * PRIZE_RESULT_COLUMNS_PER_LINE || undefined));
    });

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks;
};

const extractFourDigitPrizeLineBlocks = (text) => extractPrizeLineBlocks(text, 4);

const extractPdfTextFromFile = async (file) => {
  const pdfData = await file.arrayBuffer();
  const pdf = await getDocument({ data: pdfData }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rows = [];

    textContent.items
      .map((item) => ({
        text: String(item.str || '').trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      }))
      .filter((item) => item.text)
      .forEach((item) => {
        let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
        if (!row) {
          row = { y: item.y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      });

    rows.sort((left, right) => right.y - left.y);

    const lines = [];
    rows.forEach((row, index) => {
      if (index > 0 && Math.abs(rows[index - 1].y - row.y) > 22) {
        lines.push('');
      }

      row.items.sort((left, right) => left.x - right.x);
      lines.push(row.items.map((item) => item.text).join(' '));
    });

    pageTexts.push(lines.join('\n'));
  }

  return pageTexts.join('\n\n');
};

const extractPrizeNumbersFromSection = (sectionText, digitLength, options = {}) => {
  const {
    numbersPerLine = 0,
    minimumLineNumbers = 1,
    maxNumbers = 0
  } = options;
  const seenNumbers = new Set();

  const addNumbers = (numbers, digits) => {
    if (digits.length !== digitLength || seenNumbers.has(digits)) {
      return numbers;
    }

    seenNumbers.add(digits);
    numbers.push(digits);
    return numbers;
  };

  if (numbersPerLine > 0) {
    const lineNumbers = String(sectionText || '')
      .split(/\n+/)
      .reduce((numbers, line) => {
        const digitsOnLine = getOcrNumberTokens(line, digitLength);

        if (digitsOnLine.length < minimumLineNumbers) {
          return numbers;
        }

        const selectedDigits = digitsOnLine.length > numbersPerLine
          ? digitsOnLine.slice(-Math.floor(digitsOnLine.length / numbersPerLine) * numbersPerLine)
          : digitsOnLine;

        selectedDigits.forEach((digits) => addNumbers(numbers, digits));
        return numbers;
      }, []);

    if (lineNumbers.length > 0) {
      return maxNumbers > 0 ? lineNumbers.slice(0, maxNumbers) : lineNumbers;
    }
  }

  const allNumbers = getOcrNumberTokens(sectionText, digitLength)
    .reduce((numbers, digits) => addNumbers(numbers, digits), []);

  return maxNumbers > 0 ? allNumbers.slice(0, maxNumbers) : allNumbers;
};

const chooseFirstPrizeNumber = (ocrText, allFiveDigitNumbers = []) => {
  const ignoredFiveDigitNumbers = IGNORED_FIVE_DIGIT_PRIZE_SCAN_NUMBERS;
  const frequencyMap = allFiveDigitNumbers.reduce((map, number) => {
    if (ignoredFiveDigitNumbers.has(number)) {
      return map;
    }
    map.set(number, (map.get(number) || 0) + 1);
    return map;
  }, new Map());
  const repeatedNumber = [...frequencyMap.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1])[0]?.[0];

  if (repeatedNumber) {
    return repeatedNumber;
  }

  const firstSection = getOcrSection(
    ocrText,
    [/1\s*ST/i, /FIRST/i, /CRORE/i],
    [/2\s*ND/i, /SECOND/i]
  );
  return getOcrFirstPrizeCandidates(firstSection)
    .find((number) => !ignoredFiveDigitNumbers.has(number) && !['00000'].includes(number))
    || allFiveDigitNumbers.find((number) => !ignoredFiveDigitNumbers.has(number))
    || '';
};

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

const parsePrizeScanText = (ocrText) => {
  const normalizedText = String(ocrText || '').replace(/\r/g, '\n');
  const allFiveDigitNumbers = getOcrNumberTokens(normalizedText, 5);
  const firstPrizeNumber = chooseFirstPrizeNumber(normalizedText, allFiveDigitNumbers);
  const thirdPrizeStartPatterns = [/3\s*(?:RD|R0|RO)\b/i, /THIRD/i];
  const fourthPrizeStartPatterns = [/(?:^|\n|[^A-Z0-9])(?:4|A)\s*(?:TH|IH|H)\b/i, /FOURTH/i];
  const fifthPrizeStartPatterns = [/5\s*(?:TH|IH|H)\b/i, /FIFTH/i];
  const secondSection = getOcrSection(normalizedText, [/2\s*(?:ND|N0|NO)\b/i, /SECOND/i], thirdPrizeStartPatterns);
  const thirdSection = getOcrSection(normalizedText, thirdPrizeStartPatterns, fourthPrizeStartPatterns);
  const fourthSection = getOcrSection(normalizedText, fourthPrizeStartPatterns, fifthPrizeStartPatterns);
  const fifthSection = getOcrSection(normalizedText, fifthPrizeStartPatterns, []);
  const firstPrizeSet = new Set(firstPrizeNumber ? [firstPrizeNumber] : []);
  const ignoredFiveDigitNumbers = IGNORED_FIVE_DIGIT_PRIZE_SCAN_NUMBERS;
  const fiveDigitLineBlocks = extractPrizeLineBlocks(normalizedText, 5);
  const fourDigitLineBlocks = extractFourDigitPrizeLineBlocks(normalizedText);
  const thirdNumbers = extractPrizeNumbersFromSection(thirdSection, 4, {
    numbersPerLine: PRIZE_RESULT_COLUMNS_PER_LINE,
    minimumLineNumbers: 3,
    maxNumbers: PRIZE_RESULT_MAX_STANDARD_FOUR_DIGIT_NUMBERS
  });
  const fourthNumbers = extractPrizeNumbersFromSection(fourthSection, 4, {
    numbersPerLine: PRIZE_RESULT_COLUMNS_PER_LINE,
    minimumLineNumbers: 3,
    maxNumbers: PRIZE_RESULT_MAX_STANDARD_FOUR_DIGIT_NUMBERS
  });
  const fifthNumbers = extractPrizeNumbersFromSection(fifthSection, 4, {
    numbersPerLine: PRIZE_RESULT_COLUMNS_PER_LINE,
    minimumLineNumbers: 3,
    maxNumbers: PRIZE_RESULT_MAX_FIFTH_PRIZE_NUMBERS
  });
  const secondNumbers = extractPrizeNumbersFromSection(secondSection, 5, {
    numbersPerLine: PRIZE_RESULT_COLUMNS_PER_LINE,
    minimumLineNumbers: 3,
    maxNumbers: PRIZE_RESULT_MAX_SECOND_PRIZE_NUMBERS
  }).filter((number) => !firstPrizeSet.has(number) && !ignoredFiveDigitNumbers.has(number));
  const fallbackSecondNumbers = (fiveDigitLineBlocks[0] || [])
    .filter((number) => !firstPrizeSet.has(number) && !ignoredFiveDigitNumbers.has(number))
    .slice(0, PRIZE_RESULT_MAX_SECOND_PRIZE_NUMBERS);

  return {
    first: firstPrizeNumber ? [firstPrizeNumber] : [],
    second: secondNumbers.length > 0 ? secondNumbers : fallbackSecondNumbers,
    third: thirdNumbers.length > 0
      ? thirdNumbers
      : (fourDigitLineBlocks[0] || []).slice(0, PRIZE_RESULT_MAX_STANDARD_FOUR_DIGIT_NUMBERS),
    fourth: fourthNumbers.length > 0
      ? fourthNumbers
      : (fourDigitLineBlocks[1] || []).slice(0, PRIZE_RESULT_MAX_STANDARD_FOUR_DIGIT_NUMBERS),
    fifth: fifthNumbers.length > 0
      ? fifthNumbers
      : (
        (fourDigitLineBlocks.find((block) => block.length >= PRIZE_RESULT_MAX_FIFTH_PRIZE_NUMBERS) || fourDigitLineBlocks[2] || [])
          .slice(0, PRIZE_RESULT_MAX_FIFTH_PRIZE_NUMBERS)
      )
  };
};

const renderPdfFirstPageToImage = async (file) => {
  const pdfData = await file.arrayBuffer();
  const pdf = await getDocument({ data: pdfData }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png');
};

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

const getUploadTimingMessage = (selectedDate, selectedShift, currentDate) => {
  if (selectedDate > currentDate) {
    return 'Future date ka result upload nahi hoga.';
  }

  if (selectedDate !== currentDate) {
    return '';
  }

  if (selectedShift === 'MORNING') {
    return 'Current date ke liye Morning result upload 1:00 PM ke baad hi open hoga.';
  }

  if (selectedShift === 'DAY') {
    return 'Current date ke liye Day result upload 6:00 PM ke baad hi open hoga.';
  }

  if (selectedShift === 'EVENING') {
    return 'Current date ke liye Evening result upload 8:00 PM ke baad hi open hoga.';
  }

  return '';
};

const AdminDashboard = ({
  user,
  onLogout,
  onExitSession,
  initialActiveTab = '',
  initialSessionMode = 'MORNING',
  initialPurchaseCategory = '',
  initialAmount = '7',
  initialBillAmount = '',
  entryCompanyLabel = ''
}) => {
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const [pendingPrizeEntries, setPendingPrizeEntries] = useState(createPendingPrizeEntries);
  const [manualPrizeInputs, setManualPrizeInputs] = useState(createManualPrizeInputs);
  const [editingPendingPrizeId, setEditingPendingPrizeId] = useState(null);
  const [editingPendingPrizeValue, setEditingPendingPrizeValue] = useState('');
  const [uploadedPrizeResults, setUploadedPrizeResults] = useState([]);
  const [editingUploadedResultId, setEditingUploadedResultId] = useState(null);
  const [editingUploadedValue, setEditingUploadedValue] = useState('');
  const [editingUploadedLoading, setEditingUploadedLoading] = useState(false);
  const [prizeScanFile, setPrizeScanFile] = useState(null);
  const [prizeScanLoading, setPrizeScanLoading] = useState(false);
  const [prizeScanProgress, setPrizeScanProgress] = useState('');
  const [prizeScanRawText, setPrizeScanRawText] = useState('');
  const [uploadResultDate, setUploadResultDate] = useState(getTodayDateValue());
  const [uploadSessionMode, setUploadSessionMode] = useState(initialSessionMode);
  const [currentIndiaDateTime, setCurrentIndiaDateTime] = useState(() => getIndiaDateTimeParts());
  const [treeData, setTreeData] = useState(null);
  const [acceptEntries, setAcceptEntries] = useState([]);
  const [entryActionLoadingId, setEntryActionLoadingId] = useState(null);
  const [pieceSummaryOpen, setPieceSummaryOpen] = useState(false);
  const [pieceSummaryDate, setPieceSummaryDate] = useState(getTodayDateValue());
  const [pieceSummaryRows, setPieceSummaryRows] = useState([]);
  const [pieceSummaryLoading, setPieceSummaryLoading] = useState(false);
  const [transferHistory, setTransferHistory] = useState([]);
  const [purchaseBillRows, setPurchaseBillRows] = useState([]);
  const [billPrizeResults, setBillPrizeResults] = useState([]);
  const [summaryDate, setSummaryDate] = useState(getTodayDateValue());
  const [summarySessionMode, setSummarySessionMode] = useState('');
  const [summaryEntries, setSummaryEntries] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [historyDate, setHistoryDate] = useState(getTodayDateValue());
  const [historyFromDate, setHistoryFromDate] = useState(getTodayDateValue());
  const [historyToDate, setHistoryToDate] = useState(getTodayDateValue());
  const [historyShift, setHistoryShift] = useState(getInitialBillShift(initialSessionMode, initialPurchaseCategory));
  const [historySellerFilter, setHistorySellerFilter] = useState('');
  const [historyAmountFilter, setHistoryAmountFilter] = useState(initialBillAmount || initialAmount || '7');
  const [historyPurchaseCategoryFilter, setHistoryPurchaseCategoryFilter] = useState(
    String(initialPurchaseCategory || '').trim().toUpperCase() || (initialSessionMode === 'NIGHT' ? 'E' : 'M')
  );
  const [error, setError] = useState('');
  const [blockingWarning, setBlockingWarning] = useState(null);
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [traceNumber, setTraceNumber] = useState('');
  const [traceAmount, setTraceAmount] = useState(initialAmount || '7');
  const [traceSem, setTraceSem] = useState('');
  const [traceResults, setTraceResults] = useState([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [prizeTrackerDate, setPrizeTrackerDate] = useState(getTodayDateValue());
  const [prizeTrackerSessionMode, setPrizeTrackerSessionMode] = useState('ALL');
  const [prizeTrackerSellerId, setPrizeTrackerSellerId] = useState('');
  const [prizeTrackerSoldStatus, setPrizeTrackerSoldStatus] = useState('ALL');
  const [prizeTrackerSearchPerformed, setPrizeTrackerSearchPerformed] = useState(false);
  const [prizeTrackerResults, setPrizeTrackerResults] = useState([]);
  const [prizeTrackerTotalPrize, setPrizeTrackerTotalPrize] = useState(0);
  const [adminStockBookingDate, setAdminStockBookingDate] = useState(getTodayDateValue());
  const [adminStockSessionMode, setAdminStockSessionMode] = useState(initialSessionMode);
  const [adminStockPurchaseCategory, setAdminStockPurchaseCategory] = useState(String(initialPurchaseCategory || '').trim().toUpperCase() || (initialSessionMode === 'NIGHT' ? 'E' : 'M'));
  const [adminStockAmount, setAdminStockAmount] = useState(initialAmount || '7');
  const [adminStockSem, setAdminStockSem] = useState('5');
  const [adminStockSeries, setAdminStockSeries] = useState('');
  const [adminStockRangeStart, setAdminStockRangeStart] = useState('');
  const [adminStockRangeEnd, setAdminStockRangeEnd] = useState('');
  const [adminStockLoading, setAdminStockLoading] = useState(false);
  const [adminStockEntries, setAdminStockEntries] = useState([]);
  const [seePurchaseStockEntries, setSeePurchaseStockEntries] = useState([]);
  const [seePurchaseSentEntries, setSeePurchaseSentEntries] = useState([]);
  const [seePurchaseLoading, setSeePurchaseLoading] = useState(false);
  const [seePurchaseDate, setSeePurchaseDate] = useState(getTodayDateValue());
  const [seePurchaseShift, setSeePurchaseShift] = useState(getInitialBillShift(initialSessionMode, initialPurchaseCategory));
  const [seePurchaseSellerFilter, setSeePurchaseSellerFilter] = useState('');
  const [stockTransferDate, setStockTransferDate] = useState(getTodayDateValue());
  const [stockTransferTargetId, setStockTransferTargetId] = useState(String(user?.id || ''));
  const [stockTransferEntries, setStockTransferEntries] = useState([]);
  const [stockTransferLoading, setStockTransferLoading] = useState(false);
  const [adminStockCodeInput, setAdminStockCodeInput] = useState('');
  const [adminStockFromInput, setAdminStockFromInput] = useState('');
  const [adminStockToInput, setAdminStockToInput] = useState('');
  const [adminStockDraftRows, setAdminStockDraftRows] = useState([]);
  const [adminStockActiveRowIndex, setAdminStockActiveRowIndex] = useState(0);
  const [adminStockEditorVisible, setAdminStockEditorVisible] = useState(true);
  const [adminStockMemoNumber, setAdminStockMemoNumber] = useState(null);
  const [adminStockMemoPopupOpen, setAdminStockMemoPopupOpen] = useState(false);
  const [adminStockMemoSelectionIndex, setAdminStockMemoSelectionIndex] = useState(0);
  const [purchaseSellerId, setPurchaseSellerId] = useState('');
  const [purchaseBookingDate, setPurchaseBookingDate] = useState(getTodayDateValue());
  const [purchaseSessionMode, setPurchaseSessionMode] = useState(initialSessionMode);
  const [purchaseCategory, setPurchaseCategory] = useState(String(initialPurchaseCategory || '').trim().toUpperCase() || (initialSessionMode === 'NIGHT' ? 'E' : 'M'));
  const [purchaseAmount, setPurchaseAmount] = useState(initialAmount || '7');
  const [purchaseSem, setPurchaseSem] = useState('5');
  const [purchaseSeries, setPurchaseSeries] = useState('');
  const [purchaseRangeStart, setPurchaseRangeStart] = useState('');
  const [purchaseRangeEnd, setPurchaseRangeEnd] = useState('');
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseEntries, setPurchaseEntries] = useState([]);
  const [unsoldPurchaseEntries, setUnsoldPurchaseEntries] = useState([]);
  const [adminUnsoldRemoveMemoEntries, setAdminUnsoldRemoveMemoEntries] = useState([]);
  const [purchaseCodeInput, setPurchaseCodeInput] = useState('');
  const [purchaseFromInput, setPurchaseFromInput] = useState('');
  const [purchaseToInput, setPurchaseToInput] = useState('');
  const [purchaseDraftRows, setPurchaseDraftRows] = useState([]);
  const [purchaseActiveRowIndex, setPurchaseActiveRowIndex] = useState(0);
  const [purchaseEditorVisible, setPurchaseEditorVisible] = useState(true);
  const [purchaseMemoNumber, setPurchaseMemoNumber] = useState(null);
  const [purchaseRemoveMemoNumber, setPurchaseRemoveMemoNumber] = useState(null);
  const [purchaseMemoPopupOpen, setPurchaseMemoPopupOpen] = useState(false);
  const [purchaseMemoSelectionIndex, setPurchaseMemoSelectionIndex] = useState(0);
  const [stockLookupLoading, setStockLookupLoading] = useState(false);
  const adminStockDateInputRef = useRef(null);
  const adminStockMemoRef = useRef(null);
  const adminStockCodeInputRef = useRef(null);
  const adminStockFromInputRef = useRef(null);
  const adminStockToInputRef = useRef(null);
  const prizeTrackerResultTypeRef = useRef(null);
  const adminSendSellerSelectRef = useRef(null);
  const adminSendDateInputRef = useRef(null);
  const adminUnsoldDateInputRef = useRef(null);
  const adminSendMemoRef = useRef(null);
  const adminSendCodeInputRef = useRef(null);
  const adminSendFromInputRef = useRef(null);
  const adminSendToInputRef = useRef(null);
  const adminSendDrawDateInputRef = useRef(null);
  const dashboardRef = useRef(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitConfirmSelected, setExitConfirmSelected] = useState('no');
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [saveConfirmSelected, setSaveConfirmSelected] = useState('no');
  const [saveConfirmMessage, setSaveConfirmMessage] = useState('Save karna hai?');
  const [exitReadyFromFirstControl, setExitReadyFromFirstControl] = useState(false);
  const launcherTitle = entryCompanyLabel || 'Admin Keyboard Menu';
  const saveConfirmActionRef = useRef(null);
  const saveConfirmFocusRef = useRef(null);
  const blockingWarningActionRef = useRef(null);
  const clearBlockingWarning = () => {
    const action = blockingWarningActionRef.current;
    blockingWarningActionRef.current = null;
    setBlockingWarning(null);
    action?.();
  };
  const openBlockingWarning = (message, details = [], title = 'Warning', onClear = null) => {
    blockingWarningActionRef.current = onClear;
    setBlockingWarning({
      title,
      message,
      details
    });
  };
  const uploadPurchaseCategory = String(initialPurchaseCategory || '').trim().toUpperCase() || (uploadSessionMode === 'NIGHT' ? 'E' : 'M');
  const uploadResultShift = getInitialBillShift(uploadSessionMode, uploadPurchaseCategory);
  const formatAdminUnsoldErrorDate = (dateValue) => {
    if (!dateValue) {
      return '';
    }

    const parsedDate = new Date(dateValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return String(dateValue);
    }

    return `${parsedDate.getDate()}/${parsedDate.getMonth() + 1}/${parsedDate.getFullYear()}`;
  };
  const getSelectedAdminUnsoldSellerName = () => (
    activeAmountAdminSellers.find((seller) => String(seller.id) === String(purchaseSellerId))?.username
    || selectedAdminSendSeller?.username
    || 'selected seller'
  );
  const focusAdminUnsoldFromInput = () => {
    window.requestAnimationFrame(() => {
      adminSendFromInputRef.current?.focus();
      adminSendFromInputRef.current?.select?.();
    });
  };
  const focusAdminSendSellerSelect = () => {
    const focusSeller = () => {
      adminSendSellerSelectRef.current?.focus();
      adminSendSellerSelectRef.current?.select?.();
    };

    window.requestAnimationFrame(() => {
      focusSeller();
      window.setTimeout(focusSeller, 0);
      window.setTimeout(focusSeller, 80);
    });
  };
  const resetDateFieldsToToday = () => {
    const today = getTodayDateValue();
    setUploadResultDate(today);
    setPieceSummaryDate(today);
    setSummaryDate(today);
    setHistoryDate(today);
    setHistoryFromDate(today);
    setHistoryToDate(today);
    setPrizeTrackerDate(today);
    setAdminStockBookingDate(today);
    setStockTransferDate(today);
    setPurchaseBookingDate(today);
  };
  const closePieceSummary = () => {
    setPieceSummaryOpen(false);
    setPieceSummaryDate(getTodayDateValue());
  };
  const getCodeCategoryValidationError = (codeValue, expectedPurchaseCategory, amountValue = '') => {
    const explicitPrefix = getExplicitCodePrefix(codeValue);

    if (!explicitPrefix || !expectedPurchaseCategory || explicitPrefix === expectedPurchaseCategory) {
      return '';
    }

    return `${explicitPrefix}${String(codeValue || '').replace(/^[A-Z]/i, '')} is not allowed in ${entryCompanyLabel || `${getPurchaseCategoryLabel(expectedPurchaseCategory)} BEST ${amountValue || ''}`}. Use only ${expectedPurchaseCategory} series code.`;
  };
  const numberFallsWithinRange = (numberValue, fromValue, toValue) => {
    const normalizedNumber = Number(String(numberValue || '').replace(/[^0-9]/g, ''));
    const normalizedFrom = Number(String(fromValue || '').replace(/[^0-9]/g, ''));
    const normalizedTo = Number(String(toValue || '').replace(/[^0-9]/g, ''));

    if ([normalizedNumber, normalizedFrom, normalizedTo].some(Number.isNaN)) {
      return false;
    }

    return normalizedNumber >= normalizedFrom && normalizedNumber <= normalizedTo;
  };

  useEffect(() => {
    loadTree();
    loadAcceptEntries();
    loadBillPreviewData();
    loadSummaryEntries();
  }, []);

  useEffect(() => {
    loadPrizeResults(uploadResultDate, uploadSessionMode, uploadPurchaseCategory);
  }, [uploadResultDate, uploadSessionMode, uploadPurchaseCategory]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentIndiaDateTime(getIndiaDateTimeParts());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setPendingPrizeEntries(createPendingPrizeEntries());
    setManualPrizeInputs(createManualPrizeInputs());
    setEditingPendingPrizeId(null);
    setEditingPendingPrizeValue('');
    setEditingUploadedResultId(null);
    setEditingUploadedValue('');
    setError('');
    setSuccess('');
  }, [uploadResultDate, uploadSessionMode, uploadPurchaseCategory]);

  useEffect(() => {
    const availableSemOptions = getAvailableSemOptions(adminStockAmount);
    if (availableSemOptions.length > 0 && !availableSemOptions.includes(adminStockSem)) {
      setAdminStockSem(availableSemOptions[0]);
    }
  }, [adminStockAmount, adminStockSem]);

  useEffect(() => {
    const availableSemOptions = getAvailableSemOptions(purchaseAmount);
    if (availableSemOptions.length > 0 && !availableSemOptions.includes(purchaseSem)) {
      setPurchaseSem(availableSemOptions[0]);
    }
  }, [purchaseAmount, purchaseSem]);

  useEffect(() => {
    setAdminStockActiveRowIndex((currentIndex) => Math.min(currentIndex, adminStockDraftRows.length));
  }, [adminStockDraftRows.length]);

  useEffect(() => {
    setPurchaseActiveRowIndex((currentIndex) => Math.min(currentIndex, purchaseDraftRows.length));
  }, [purchaseDraftRows.length]);

  useEffect(() => {
    if (activeTab !== 'purchase-send') {
      return;
    }

    loadPurchaseEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId, purchaseCategory);
  }, [activeTab, purchaseBookingDate, purchaseSessionMode, purchaseSellerId, purchaseCategory, purchaseAmount]);

  useEffect(() => {
    if (activeTab !== 'purchase') {
      return;
    }

    loadAdminPurchaseEntries(adminStockBookingDate, adminStockSessionMode, adminStockAmount, adminStockPurchaseCategory);
  }, [activeTab, adminStockBookingDate, adminStockSessionMode, adminStockAmount, adminStockSem, adminStockPurchaseCategory]);

  useEffect(() => {
    if (activeTab !== 'unsold-remove') {
      return;
    }

    loadPurchaseEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId, purchaseCategory);
    loadAdminUnsoldRemoveMemoEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId);
  }, [activeTab, purchaseBookingDate, purchaseSessionMode, purchaseSellerId, purchaseAmount, purchaseCategory]);

  useEffect(() => {
    if (activeTab === 'purchase') {
      return focusElementReliably(() => adminStockDateInputRef.current);
    }

    if (activeTab === 'purchase-send' || activeTab === 'unsold' || activeTab === 'unsold-remove') {
      return focusElementReliably(() => adminSendSellerSelectRef.current);
    }

    return focusElementReliably(() => (
      dashboardRef.current?.querySelector('.accordion-content input:not([type="hidden"]):not(:disabled), .accordion-content select:not(:disabled), .accordion-content textarea:not(:disabled), .accordion-content button:not(:disabled)')
    ));
  }, [activeTab]);

  useEffect(() => {
    setActiveTab(initialActiveTab);
  }, [initialActiveTab]);

  useEffect(() => {
    setUploadSessionMode(initialSessionMode);
    setAdminStockSessionMode(initialSessionMode);
    setPurchaseSessionMode(initialSessionMode);
    const nextBillShift = getInitialBillShift(initialSessionMode, initialPurchaseCategory);
    setHistoryShift(nextBillShift);
    setHistoryPurchaseCategoryFilter(getBillPurchaseCategory(nextBillShift));
    setSeePurchaseShift(nextBillShift);
  }, [initialPurchaseCategory, initialSessionMode]);

  useEffect(() => {
    const defaultPurchaseCategory = String(initialPurchaseCategory || '').trim().toUpperCase() || (initialSessionMode === 'NIGHT' ? 'E' : 'M');
    setAdminStockPurchaseCategory(defaultPurchaseCategory);
    setPurchaseCategory(defaultPurchaseCategory);
  }, [initialPurchaseCategory, initialSessionMode]);

  useEffect(() => {
    if (initialAmount) {
      setAdminStockAmount(initialAmount);
      setPurchaseAmount(initialAmount);
      setTraceAmount(initialAmount);
    }
  }, [initialAmount]);

  useEffect(() => {
    setExitReadyFromFirstControl(false);
    setExitConfirmOpen(false);
    setExitConfirmSelected('no');
  }, [activeTab]);

  useEffect(() => {
    setHistoryAmountFilter(initialBillAmount || initialAmount || '7');
  }, [initialBillAmount, initialAmount]);

  const getHistoryFilters = () => ({
    date: historyDate,
    shift: getBillApiShift(historyShift),
    purchaseCategory: getBillPurchaseCategory(historyShift)
  });

  const getBillFilters = () => ({
    fromDate: historyFromDate,
    toDate: historyToDate,
    shift: getBillApiShift(historyShift),
    amount: historyAmountFilter || '7',
    purchaseCategory: getBillPurchaseCategory(historyShift)
  });

  const handleBillShiftChange = (nextShift) => {
    setHistoryShift(nextShift);
    setHistoryPurchaseCategoryFilter(getBillPurchaseCategory(nextShift));
  };

  const loadBillPreviewData = async (filters = getBillFilters()) => {
    try {
      if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
        setError('From date cannot be after to date');
        return;
      }

      setError('');
      const [historyResponse, purchaseBillResponse, prizeResponse] = await Promise.all([
        lotteryService.getTransferHistory(filters),
        lotteryService.getPurchaseBillSummary(filters),
        priceService.getBillPrizes(filters)
      ]);
      setTransferHistory(historyResponse.data.map(mapHistoryRecord));
      setPurchaseBillRows(purchaseBillResponse.data);
      setBillPrizeResults(prizeResponse.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading bill data');
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      resetDateFieldsToToday();
      setActiveTab('');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!['purchase', 'purchase-send', 'unsold', 'unsold-remove'].includes(activeTab)) {
      if (blockingWarning) {
        clearBlockingWarning();
      }
      return;
    }

    if (error) {
      openBlockingWarning(error);
      setError('');
    }
  }, [activeTab, error, blockingWarning]);

  useEffect(() => {
    if (!activeTab) {
      return undefined;
    }

    const handleGlobalEscape = (event) => {
      const key = String(event.key || '').toUpperCase();

      if (blockingWarning && key !== 'ESCAPE') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (key !== 'ESCAPE') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (blockingWarning) {
        clearBlockingWarning();
        return;
      }
      requestExitConfirmation();
    };

    window.addEventListener('keydown', handleGlobalEscape, true);
    return () => window.removeEventListener('keydown', handleGlobalEscape, true);
  }, [activeTab, blockingWarning]);

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
      const response = await lotteryService.getReceivedEntries({ amount: initialAmount });
      setAcceptEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading accept entries');
    }
  };

  const handleAcceptEntryAction = async (entry, action) => {
    const groupedEntries = Array.isArray(entry) ? entry : [entry];
    const loadingEntryId = groupedEntries[0]?.id;

    setEntryActionLoadingId(loadingEntryId);
    setError('');

    try {
      await Promise.all(groupedEntries.map((currentEntry) => (
        lotteryService.updateReceivedEntryStatus(currentEntry.id, action, { amount: initialAmount })
      )));
      setSuccess(`${groupedEntries.length > 1 ? `${groupedEntries.length} entries` : 'Entry'} ${action === 'accept' ? 'accepted' : 'rejected'} successfully`);
      await Promise.all([loadAcceptEntries(), loadTransferHistory(getHistoryFilters())]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error updating entry');
    } finally {
      setEntryActionLoadingId(null);
    }
  };

  const loadSummaryEntries = async (selectedDate = summaryDate, selectedShift = summarySessionMode) => {
    try {
      setSummaryLoading(true);
      const selectedSessionMode = getBillApiShift(selectedShift);
      const selectedPurchaseCategory = getBillPurchaseCategory(selectedShift);
      const response = await lotteryService.getSentEntries(
        {
          date: selectedDate,
          sessionMode: selectedSessionMode,
          purchaseCategory: selectedPurchaseCategory
        },
        {
          withSessionMode: false,
          headers: {
            'X-Session-Mode': selectedSessionMode || ''
          }
        }
      );
      setSummaryEntries((response.data || []).map((entry) => ({
        id: entry.id,
        uniqueCode: entry.uniqueCode || entry.unique_code,
        sem: entry.boxValue || entry.box_value,
        amount: String(entry.amount || ''),
        number: entry.number,
        status: entry.statusAfter || entry.status_after || '',
        createdAt: entry.createdAt || entry.created_at,
        sentAt: entry.createdAt || entry.created_at
      })));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadPrizeResults = async (
    selectedDate = uploadResultDate,
    selectedSessionMode = uploadSessionMode,
    selectedPurchaseCategory = uploadPurchaseCategory
  ) => {
    try {
      const response = await priceService.getAllPrices({
        resultForDate: selectedDate,
        sessionMode: selectedSessionMode,
        purchaseCategory: selectedPurchaseCategory
      });
      setUploadedPrizeResults(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading uploaded results');
    }
  };

  const loadAdminPurchaseEntries = async (
    selectedDate = adminStockBookingDate,
    selectedSessionMode = adminStockSessionMode,
    selectedAmount = adminStockAmount,
    selectedPurchaseCategory = adminStockPurchaseCategory
  ) => {
    try {
      const response = await lotteryService.getAdminPurchases({
        bookingDate: selectedDate,
        sessionMode: selectedSessionMode,
        amount: selectedAmount,
        purchaseCategory: selectedPurchaseCategory
      });
      const mappedEntries = response.data.map(mapApiEntry);
      setAdminStockEntries(mappedEntries);
      setSeePurchaseStockEntries(mappedEntries.map((entry) => normalizeSeePurchaseEntry(entry, 'admin_stock')));
      setStockTransferEntries(mappedEntries);
      return mappedEntries;
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading admin purchase');
      return [];
    }
  };

  const handleSaveAdminPurchase = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!adminStockRangeStart || !adminStockRangeEnd || !adminStockAmount || !adminStockSem) {
      setError('Date, session, amount, SEM and range are required');
      return;
    }

    setAdminStockLoading(true);

    try {
      const response = await lotteryService.addAdminPurchase({
        series: adminStockSeries.trim(),
        rangeStart: adminStockRangeStart,
        rangeEnd: adminStockRangeEnd,
        boxValue: adminStockSem,
        amount: adminStockAmount,
        bookingDate: adminStockBookingDate,
        sessionMode: adminStockSessionMode,
        purchaseCategory: adminStockPurchaseCategory
      });

      setSuccess(response.data.message || 'Purchase saved successfully');
      setAdminStockRangeStart('');
      setAdminStockRangeEnd('');
      setAdminStockSeries('');
      await loadAdminPurchaseEntries(adminStockBookingDate, adminStockSessionMode, adminStockAmount, adminStockPurchaseCategory);
    } catch (err) {
      setError(err.response?.data?.message || 'Error saving purchase');
    } finally {
      setAdminStockLoading(false);
    }
  };

  const buildAdminStockDraftRow = () => {
    const codeCategoryError = getCodeCategoryValidationError(adminStockCodeInput, adminStockPurchaseCategory, adminStockAmount);
    if (codeCategoryError) {
      return { error: codeCategoryError };
    }

    const { parsed, fromNumber, toNumber, quantity, error: rangeError } = getRetroRangeMetrics(
      adminStockCodeInput,
      adminStockSessionMode,
      adminStockFromInput,
      adminStockToInput,
      adminStockPurchaseCategory
    );

    if (parsed.error) {
      return { error: parsed.error };
    }

    if (rangeError) {
      return { error: rangeError };
    }

    if (!parsed.semValue || !fromNumber || !toNumber) {
      return { error: 'Code, from aur to required hai' };
    }

    const rate = Number(adminStockAmount || 0);

    return {
      row: {
      id: `admin-stock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      code: buildRetroTicketCode(parsed.resolvedSessionMode, parsed.semValue, parsed.resolvedPurchaseCategory),
      itemName: getRetroItemName(adminStockBookingDate),
      drawDate: adminStockBookingDate,
      day: getDisplayDay(adminStockBookingDate),
      prefix: '',
      series: '',
      from: fromNumber,
      to: toNumber,
      quantity,
      rate: rate.toFixed(2),
      amount: (quantity * rate).toFixed(2),
      semValue: parsed.semValue,
      bookingAmount: String(adminStockAmount || ''),
      resolvedSessionMode: parsed.resolvedSessionMode,
      resolvedPurchaseCategory: parsed.resolvedPurchaseCategory
      }
    };
  };

  const resetAdminStockEntryInputs = () => {
    setAdminStockCodeInput('');
    setAdminStockFromInput('');
    setAdminStockToInput('');
  };

  const hasPendingAdminStockEditorValues = () => (
    adminStockEditorVisible
    && (Boolean(String(adminStockFromInput || '').trim())
    || Boolean(String(adminStockToInput || '').trim())
    )
  );

  const startNewAdminStockRow = () => {
    setAdminStockEditorVisible(true);
    resetAdminStockEntryInputs();
    setAdminStockActiveRowIndex(adminStockDraftRows.length);
    window.requestAnimationFrame(() => adminStockCodeInputRef.current?.focus());
  };

  const getAdminStockRowsForSave = () => {
    const currentRows = [...adminStockDraftRows];

    if (!hasPendingAdminStockEditorValues()) {
      return { rows: currentRows };
    }

    const result = buildAdminStockDraftRow();

    if (result.error) {
      return { error: result.error };
    }

    const conflictingAdminDraft = currentRows.find((row, index) => (
      index !== adminStockActiveRowIndex
      && String(row.semValue || '') === String(result.row.semValue || '')
      && String(row.resolvedSessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(row.drawDate || '') === String(result.row.drawDate || '')
      && rangesOverlap(row.from, row.to, result.row.from, result.row.to)
    ));

    if (conflictingAdminDraft) {
      return { error: `Already added in draft: ${conflictingAdminDraft.from} to ${conflictingAdminDraft.to}` };
    }

    if (adminStockActiveRowIndex < currentRows.length) {
      const updatedRows = [...currentRows];
      updatedRows[adminStockActiveRowIndex] = {
        ...result.row,
        id: currentRows[adminStockActiveRowIndex].id
      };
      return { rows: updatedRows, consumedEditor: true };
    }

    const overlappingExistingRowIndex = currentRows.findIndex((row) => (
      String(row.drawDate || '') === String(result.row.drawDate || '')
      && String(row.semValue || '') === String(result.row.semValue || '')
      && String(row.resolvedSessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && rangesOverlap(row.from, row.to, result.row.from, result.row.to)
    ));

    if (overlappingExistingRowIndex >= 0) {
      const updatedRows = [...currentRows];
      updatedRows[overlappingExistingRowIndex] = {
        ...result.row,
        id: currentRows[overlappingExistingRowIndex].id
      };
      return { rows: updatedRows, consumedEditor: true };
    }

    return { rows: [...currentRows, result.row], consumedEditor: true };
  };

  const loadAdminStockDraftIntoEditor = (targetIndex) => {
    if (targetIndex < adminStockDraftRows.length) {
      const row = adminStockDraftRows[targetIndex];
      setAdminStockEditorVisible(true);
      setAdminStockCodeInput(row.code || '');
      setAdminStockFromInput(row.from || '');
      setAdminStockToInput(row.to || '');
      setAdminStockActiveRowIndex(targetIndex);
      return;
    }

    resetAdminStockEntryInputs();
    setAdminStockEditorVisible(true);
    setAdminStockActiveRowIndex(adminStockDraftRows.length);
  };

  const commitAdminStockDraftRow = () => {
    if (blockingWarning) {
      return;
    }

    const result = buildAdminStockDraftRow();

    if (result.error) {
      openBlockingWarning(result.error);
      return;
    }

    const isEditingExistingRow = adminStockActiveRowIndex < adminStockDraftRows.length;
    const conflictingAdminDraft = adminStockDraftRows.find((row, index) => (
      index !== adminStockActiveRowIndex
      && String(row.semValue || '') === String(result.row.semValue || '')
      && String(row.resolvedSessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(row.drawDate || '') === String(result.row.drawDate || '')
      && rangesOverlap(row.from, row.to, result.row.from, result.row.to)
    ));

    if (conflictingAdminDraft) {
      openBlockingWarning(
        'Number already added.',
        [`Memo No. ${adminStockMemoNumber || selectedAdminStockMemoOption?.memoNumber || 'N/A'}`],
        'Duplicate Number'
      );
      return;
    }

    const conflictingMemoEntries = adminStockEntries.filter((entry) => (
      String(entry.sem || '') === String(result.row.semValue || '')
      && String(entry.sessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(entry.purchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(formatDateOnly(entry.bookingDate || '')) === String(result.row.drawDate || '')
      && numberFallsWithinRange(entry.number, result.row.from, result.row.to)
    ));

    if (conflictingMemoEntries.length > 0) {
      openBlockingWarning(
        'Number already added.',
        conflictingMemoEntries.slice(0, 5).map((entry) => (
          `Memo No. ${entry.memoNumber || 'N/A'}`
        )),
        'Duplicate Number'
      );
      return;
    }

    setAdminStockDraftRows((currentRows) => {
      if (adminStockActiveRowIndex < currentRows.length) {
        const updatedRows = [...currentRows];
        updatedRows[adminStockActiveRowIndex] = {
          ...result.row,
          id: currentRows[adminStockActiveRowIndex].id
        };
        return updatedRows;
      }

      return [...currentRows, result.row];
    });

    const nextIndex = isEditingExistingRow
      ? Math.min(adminStockActiveRowIndex + 1, adminStockDraftRows.length)
      : adminStockDraftRows.length + 1;
    resetAdminStockEntryInputs();
    setAdminStockEditorVisible(true);
    setAdminStockActiveRowIndex(nextIndex);
    clearBlockingWarning();
    setError('');
    window.requestAnimationFrame(() => adminStockCodeInputRef.current?.focus());
  };

  const moveAdminStockDraftSelection = (direction) => {
    const nextIndex = Math.min(Math.max(adminStockActiveRowIndex + direction, 0), adminStockDraftRows.length);
    loadAdminStockDraftIntoEditor(nextIndex);
  };

  const deleteAdminStockDraftRow = () => {
    if (blockingWarning) {
      return;
    }

    if (adminStockDraftRows.length === 0) {
      resetAdminStockEntryInputs();
      setAdminStockEditorVisible(false);
      return;
    }

    const deleteIndex = adminStockActiveRowIndex < adminStockDraftRows.length
      ? adminStockActiveRowIndex
      : adminStockDraftRows.length - 1;

    const nextRows = adminStockDraftRows.filter((_, index) => index !== deleteIndex);
    setAdminStockDraftRows(nextRows);
    setError('');
    setSuccess('');
    window.requestAnimationFrame(() => {
      if (deleteIndex < nextRows.length) {
        const row = nextRows[deleteIndex];
        setAdminStockEditorVisible(true);
        setAdminStockCodeInput(row.code || '');
        setAdminStockFromInput(row.from || '');
        setAdminStockToInput(row.to || '');
        setAdminStockActiveRowIndex(deleteIndex);
      } else {
        resetAdminStockEntryInputs();
        setAdminStockEditorVisible(false);
        setAdminStockActiveRowIndex(nextRows.length);
      }
      adminStockCodeInputRef.current?.focus();
    });
  };

  const saveAdminStockDraftRows = async () => {
    if (blockingWarning) {
      return;
    }

    const rowsForSaveResult = getAdminStockRowsForSave();

    if (rowsForSaveResult.error) {
      openBlockingWarning(rowsForSaveResult.error);
      return;
    }

    const rowsToSave = rowsForSaveResult.rows || [];

    if (rowsToSave.length === 0 && !isEditingExistingAdminStockMemo) {
      openBlockingWarning('Save karne ke liye row add karo');
      return;
    }

    setAdminStockLoading(true);
    setError('');
    setSuccess('');

    try {
      const effectiveMemoNumber = Number(adminStockMemoNumber || nextAdminStockMemoNumber);
      const shouldAdvanceToNextMemo = !isEditingExistingAdminStockMemo;

      const response = await lotteryService.replaceAdminPurchaseMemo({
        memoNumber: effectiveMemoNumber,
        bookingDate: adminStockBookingDate,
        sessionMode: adminStockSessionMode,
        rows: expandPurchaseRowsForSave(rowsToSave).map((row) => ({
          series: '',
          rangeStart: row.from,
          rangeEnd: row.to,
          boxValue: row.semValue,
          amount: row.bookingAmount || adminStockAmount,
          sessionMode: row.resolvedSessionMode,
          purchaseCategory: row.resolvedPurchaseCategory || adminStockPurchaseCategory
        }))
      });
      const savedEntries = Array.isArray(response?.data?.entries)
        ? response.data.entries.map(mapApiEntry)
        : [];
      const confirmedMemoEntries = savedEntries.filter((entry) => Number(entry.memoNumber) === effectiveMemoNumber);

      if (savedEntries.length > 0) {
        setAdminStockEntries((currentEntries) => {
          const withoutCurrentMemo = currentEntries.filter((entry) => Number(entry.memoNumber) !== effectiveMemoNumber);
          return [...withoutCurrentMemo, ...savedEntries];
        });
        setSeePurchaseStockEntries((currentEntries) => {
          const withoutCurrentMemo = currentEntries.filter((entry) => Number(entry.memoNumber) !== effectiveMemoNumber);
          return [
            ...withoutCurrentMemo,
            ...savedEntries.map((entry) => normalizeSeePurchaseEntry(entry, 'admin_stock'))
          ];
        });
        setStockTransferEntries((currentEntries) => {
          const withoutCurrentMemo = currentEntries.filter((entry) => Number(entry.memoNumber) !== effectiveMemoNumber);
          return [...withoutCurrentMemo, ...savedEntries];
        });
      }

      setAdminStockMemoPopupOpen(false);

      if (shouldAdvanceToNextMemo) {
        setAdminStockMemoNumber(null);
        setAdminStockMemoSelectionIndex(0);
        setAdminStockDraftRows([]);
        setAdminStockActiveRowIndex(0);
        setAdminStockEditorVisible(true);
        resetAdminStockEntryInputs();
        setSuccess(`Memo ${effectiveMemoNumber} saved successfully`);
      } else {
        setAdminStockMemoNumber(effectiveMemoNumber);
        setAdminStockMemoSelectionIndex(Math.max(
          adminStockMemoOptions.findIndex((option) => Number(option.memoNumber) === effectiveMemoNumber),
          0
        ));
        const refreshedDraftRows = confirmedMemoEntries.length > 0
          ? buildAdminStockDraftRowsFromEntries(confirmedMemoEntries, adminStockAmount)
          : rowsToSave;
        setAdminStockDraftRows(refreshedDraftRows);
        setAdminStockActiveRowIndex(0);
        if (refreshedDraftRows.length > 0) {
          setAdminStockCodeInput(refreshedDraftRows[0].code || '');
          setAdminStockFromInput(refreshedDraftRows[0].from || '');
          setAdminStockToInput(refreshedDraftRows[0].to || '');
        } else {
          resetAdminStockEntryInputs();
        }
        setSuccess(`Memo ${effectiveMemoNumber} updated successfully`);
      }
      window.requestAnimationFrame(() => adminStockMemoRef.current?.focus());
    } catch (err) {
      setError(err.response?.data?.message || 'Error saving purchase');
    } finally {
      setAdminStockLoading(false);
    }
  };

  const normalizeAdminSelectedSellerEntries = (entries = [], selectedSellerId = purchaseSellerId) => {
    const selectedSellerName = directAdminSellers.find((seller) => String(seller.id) === String(selectedSellerId))?.username || '';

    return entries.map((entry) => {
      const mappedEntry = mapApiEntry(entry);
      const resolvedSellerName = selectedSellerName || mappedEntry.displaySeller || mappedEntry.username;

      return {
        ...mappedEntry,
        username: resolvedSellerName,
        displaySeller: resolvedSellerName
      };
    });
  };

  const getAdminUnsoldRemoveStockEntries = async (filter = {}) => {
    const selectedSellerId = filter.sellerId || purchaseSellerId;
    if (!selectedSellerId) {
      return [];
    }

    const response = await lotteryService.getPurchases({
      bookingDate: filter.bookingDate || purchaseBookingDate,
      sessionMode: filter.sessionMode || purchaseSessionMode,
      sellerId: selectedSellerId,
      status: 'unsold',
      purchaseCategory: filter.purchaseCategory || purchaseCategory,
      amount: filter.amount || purchaseAmount,
      boxValue: filter.boxValue || undefined
    });

    return normalizeAdminSelectedSellerEntries(response.data || [], selectedSellerId)
      .filter(isRemovableUnsoldEntry);
  };

  const loadPurchaseEntries = async (
    selectedDate = purchaseBookingDate,
    selectedSessionMode = purchaseSessionMode,
    selectedSellerId = purchaseSellerId
  ) => {
    try {
      if (!selectedSellerId) {
        setPurchaseEntries([]);
        setUnsoldPurchaseEntries([]);
        return;
      }

      const [assignedResponse, unsoldResponse] = await Promise.all([
        lotteryService.getPurchases({
          bookingDate: selectedDate,
          sessionMode: selectedSessionMode,
          sellerId: selectedSellerId,
          status: 'accepted',
          purchaseCategory,
          amount: purchaseAmount
        }),
        lotteryService.getPurchases({
          bookingDate: selectedDate,
          sessionMode: selectedSessionMode,
          sellerId: selectedSellerId,
          status: 'unsold',
          purchaseCategory,
          amount: purchaseAmount
        })
      ]);

      setPurchaseEntries(normalizeAdminSelectedSellerEntries(assignedResponse.data || [], selectedSellerId));
      setUnsoldPurchaseEntries(normalizeAdminSelectedSellerEntries(unsoldResponse.data || [], selectedSellerId)
        .filter((entry) => activeTab === 'unsold-remove' ? isRemovableUnsoldEntry(entry) : true));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading purchase record');
    }
  };

  const loadAdminUnsoldRemoveMemoEntries = async (
    selectedDate = purchaseBookingDate,
    selectedSessionMode = purchaseSessionMode,
    selectedSellerId = purchaseSellerId
  ) => {
    if (!selectedSellerId) {
      setAdminUnsoldRemoveMemoEntries([]);
      return [];
    }

    try {
      const response = await lotteryService.getPurchaseUnsoldRemoveMemo({
        bookingDate: selectedDate,
        sessionMode: selectedSessionMode,
        sellerId: selectedSellerId,
        purchaseCategory,
        amount: purchaseAmount
      });
      const mappedEntries = (response.data || []).map(mapHistoryRecord);
      setAdminUnsoldRemoveMemoEntries(mappedEntries);
      return mappedEntries;
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading unsold remove memo entries');
      setAdminUnsoldRemoveMemoEntries([]);
      return [];
    }
  };

  const buildAdminStockLookupFilter = (codeValue = '') => {
    const normalizedCode = String(codeValue || '').trim();
    if (!normalizedCode) {
      return {
        sessionMode: purchaseSessionMode,
        purchaseCategory,
        boxValue: '',
        label: 'All SEM'
      };
    }

    const parsedCode = parseRetroCodeValue(normalizedCode, purchaseSessionMode, purchaseCategory);
    if (parsedCode.error) {
      return { error: parsedCode.error };
    }

    return {
      sessionMode: parsedCode.resolvedSessionMode || purchaseSessionMode,
      purchaseCategory: parsedCode.resolvedPurchaseCategory || purchaseCategory,
      boxValue: parsedCode.semValue,
      label: buildRetroTicketCode(parsedCode.resolvedSessionMode, parsedCode.semValue, parsedCode.resolvedPurchaseCategory)
    };
  };

  const buildAdminStockLookupDetails = (entries = [], filterLabel = 'All SEM') => {
    const normalizedEntries = entries.map((entry) => normalizeSeePurchaseEntry(entry));
    const groupedEntries = groupConsecutiveNumberRows(
      sortRowsForConsecutiveNumbers(
        normalizedEntries,
        (entry) => [entry.bookingDate, entry.sessionMode, entry.purchaseCategory, entry.amount, entry.boxValue, entry.sellerName].join('|')
      ),
      (entry) => [entry.bookingDate, entry.sessionMode, entry.purchaseCategory, entry.amount, entry.boxValue, entry.sellerName].join('|')
    );
    const totalNumbers = normalizedEntries.length;
    const totalPieces = normalizedEntries.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0);
    const totalAmount = normalizedEntries.reduce((sum, entry) => sum + (Number(entry.boxValue || 0) * Number(entry.amount || 0)), 0);
    const detailRows = groupedEntries.map((group) => {
      const firstRow = group.firstRow || {};
      const pieces = group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0);
      const categoryLabel = getPurchaseCategoryLabel(firstRow.purchaseCategory);
      const rangeLabel = firstRow.number === group.lastRow?.number
        ? firstRow.number
        : `${firstRow.number} - ${group.lastRow?.number}`;

      return `${categoryLabel} | SEM ${firstRow.boxValue} | ${rangeLabel} | Nos ${group.rows.length} | Piece ${pieces} | ${firstRow.sellerName || 'Self'}`;
    });

    return [
      `Filter: ${filterLabel}`,
      `Total Numbers: ${totalNumbers} | Total Piece: ${totalPieces} | Amount: Rs. ${totalAmount.toFixed(2)}`,
      ...detailRows.slice(0, 80),
      ...(detailRows.length > 80 ? [`+${detailRows.length - 80} more ranges`] : [])
    ];
  };

  const openAdminUnsoldStockLookup = async () => {
    if (blockingWarning || stockLookupLoading) {
      return;
    }

    if (!purchaseSellerId) {
      openBlockingWarning('Seller select karo', [], 'F4 View');
      return;
    }

    const isUnsoldRemoveLookup = activeTab === 'unsold-remove';
    const filter = buildAdminStockLookupFilter(purchaseCodeInput);
    if (filter.error) {
      openBlockingWarning(filter.error, [], 'F4 View');
      return;
    }

    setStockLookupLoading(true);
    setError('');

    try {
      const lookupEntries = isUnsoldRemoveLookup
        ? await getAdminUnsoldRemoveStockEntries(filter)
        : ((await lotteryService.getPurchases({
          bookingDate: purchaseBookingDate,
          sessionMode: filter.sessionMode,
          sellerId: purchaseSellerId,
          status: 'accepted',
          purchaseCategory: filter.purchaseCategory,
          amount: purchaseAmount,
          boxValue: filter.boxValue || undefined
        })).data || []).filter((entry) => (
          entry.memoNumber !== null
          && entry.memoNumber !== undefined
          && String(entry.memoNumber).trim() !== ''
        ));
      const details = buildAdminStockLookupDetails(lookupEntries, filter.label);
      const sellerLabel = getSelectedAdminUnsoldSellerName();

      openBlockingWarning(
        lookupEntries.length
          ? isUnsoldRemoveLookup
            ? `${sellerLabel} ke unsold remove stock me ye range available hai`
            : `${sellerLabel} ke purchase stock me ye range available hai`
          : isUnsoldRemoveLookup
            ? `${sellerLabel} ke unsold remove stock me selected filter ka maal nahi hai`
            : `${sellerLabel} ke purchase stock me selected filter ka maal nahi hai`,
        details,
        isUnsoldRemoveLookup ? 'F4 Unsold Remove Stock' : 'F4 Unsold Stock'
      );
    } catch (err) {
      openBlockingWarning(
        err.response?.data?.message || (isUnsoldRemoveLookup ? 'Unsold check nahi ho paya' : 'Stock check nahi ho paya'),
        [],
        isUnsoldRemoveLookup ? 'F4 Unsold Remove Stock' : 'F4 Unsold Stock'
      );
    } finally {
      setStockLookupLoading(false);
    }
  };

  const loadSeePurchaseData = async () => {
    setSeePurchaseLoading(true);
    setError('');

    try {
      const [stockResponse, sentResponse] = await Promise.all([
        lotteryService.getAdminPurchases({
          bookingDate: seePurchaseDate,
          sessionMode: getBillApiShift(seePurchaseShift),
          purchaseCategory: getBillPurchaseCategory(seePurchaseShift),
          amount: initialAmount || adminStockAmount
        }, { withSessionMode: false }),
        lotteryService.getPurchases({
          bookingDate: seePurchaseDate,
          sessionMode: getBillApiShift(seePurchaseShift),
          purchaseCategory: getBillPurchaseCategory(seePurchaseShift),
          amount: initialAmount || purchaseAmount
        }, { withSessionMode: false })
      ]);
      const normalizeAdminSeePurchaseEntry = (entry, sourceType) => {
        const resolvedSellerName = getAdminRootSellerName(
          treeData,
          entry.displaySeller || entry.username || entry.forwardedByUsername || ''
        );

        return normalizeSeePurchaseEntry({
          ...entry,
          username: resolvedSellerName || entry.username,
          displaySeller: resolvedSellerName || entry.displaySeller || entry.username
        }, sourceType);
      };

      setSeePurchaseStockEntries((stockResponse.data || []).map((entry) => normalizeAdminSeePurchaseEntry(entry, 'admin_stock')));
      setSeePurchaseSentEntries((sentResponse.data || []).map((entry) => normalizeAdminSeePurchaseEntry(entry, 'seller_purchase')));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading see purchase data');
      setSeePurchaseStockEntries([]);
      setSeePurchaseSentEntries([]);
    } finally {
      setSeePurchaseLoading(false);
    }
  };

  const openAdminStockMemoPopup = () => {
    if (hasPendingAdminStockEditorValues()) {
      const rowsForSaveResult = getAdminStockRowsForSave();
      if (!rowsForSaveResult.error && rowsForSaveResult.consumedEditor) {
        setAdminStockDraftRows(rowsForSaveResult.rows || []);
        resetAdminStockEntryInputs();
        setAdminStockActiveRowIndex((rowsForSaveResult.rows || []).length);
      }
    }

    const nextIndex = Math.max(
      adminStockMemoOptions.findIndex((option) => Number(option.memoNumber) === Number(adminStockMemoNumber) && !option.isNew),
      0
    );
    setAdminStockMemoSelectionIndex(nextIndex);
    setAdminStockMemoPopupOpen(true);
  };

  const closeAdminStockMemoPopup = () => {
    setAdminStockMemoPopupOpen(false);
  };

  const commitAdminStockMemoSelection = (option = highlightedAdminStockMemoOption) => {
    if (!option) {
      return;
    }

    setAdminStockMemoNumber(option.memoNumber);
    setAdminStockMemoSelectionIndex(Math.max(
      adminStockMemoOptions.findIndex((currentOption) => currentOption.key === option.key),
      0
    ));
    setAdminStockMemoPopupOpen(false);
    if (option.isNew) {
      setAdminStockDraftRows([]);
      setAdminStockActiveRowIndex(0);
      setAdminStockEditorVisible(true);
      resetAdminStockEntryInputs();
    } else {
      const selectedEntries = adminStockEntries.filter((entry) => Number(entry.memoNumber) === Number(option.memoNumber));
      const draftRows = buildAdminStockDraftRowsFromEntries(selectedEntries, adminStockAmount);
      setAdminStockDraftRows(draftRows);

      if (draftRows.length > 0) {
        const firstRow = draftRows[0];
        setAdminStockCodeInput(firstRow.code || '');
        setAdminStockFromInput(firstRow.from || '');
        setAdminStockToInput(firstRow.to || '');
        setAdminStockActiveRowIndex(0);
      } else {
        setAdminStockActiveRowIndex(0);
        resetAdminStockEntryInputs();
      }
    }
    window.requestAnimationFrame(() => adminStockCodeInputRef.current?.focus());
  };

  const openPurchaseMemoPopup = () => {
    const nextIndex = Math.max(
      purchaseMemoOptions.findIndex((option) => Number(option.memoNumber) === Number(purchaseMemoNumber) && !option.isNew),
      0
    );
    setPurchaseMemoSelectionIndex(nextIndex);
    setPurchaseMemoPopupOpen(true);
  };

  const closePurchaseMemoPopup = () => {
    setPurchaseMemoPopupOpen(false);
  };

  const commitPurchaseMemoSelection = (option = highlightedPurchaseMemoOption) => {
    if (!option) {
      return;
    }

    setPurchaseMemoNumber(option.memoNumber);
    setPurchaseMemoSelectionIndex(Math.max(
      purchaseMemoOptions.findIndex((currentOption) => currentOption.key === option.key),
      0
    ));
    setPurchaseMemoPopupOpen(false);
    if (option.isNew) {
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      setPurchaseEditorVisible(true);
      resetPurchaseSendEntryInputs();
    } else {
      const selectedEntries = [...purchaseEntries, ...unsoldPurchaseEntries].filter((entry) => (
        Number(entry.memoNumber) === Number(option.memoNumber)
      ));
      const draftRows = buildPurchaseSendDraftRowsFromEntries(selectedEntries, purchaseAmount);
      setPurchaseDraftRows(draftRows);
      resetPurchaseSendEntryInputs();
      setPurchaseEditorVisible(true);
      setPurchaseActiveRowIndex(draftRows.length);
    }
    window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
  };

  const openAdminUnsoldMemoPopup = () => {
    const nextIndex = Math.max(
      currentAdminUnsoldMemoOptions.findIndex((option) => Number(option.memoNumber) === Number(currentAdminUnsoldMemoNumber) && !option.isNew),
      0
    );
    setPurchaseMemoSelectionIndex(nextIndex);
    setPurchaseMemoPopupOpen(true);
  };

  const hydrateAdminUnsoldRemoveDraftRowsForMemo = (memoNumber, sourceEntries = adminUnsoldRemoveMemoEntries) => {
    const selectedEntries = sourceEntries
      .filter((entry) => Number(entry.memoNumber) === Number(memoNumber))
      .map((entry) => ({
        id: `admin-unsold-remove-history-${entry.id}`,
        number: entry.number,
        sem: entry.boxValue,
        amount: entry.amount,
        bookingDate: entry.bookingDate,
        sessionMode: entry.sessionMode,
        purchaseCategory: entry.purchaseCategory,
        displaySeller: getSelectedAdminUnsoldSellerName()
      }));
    const draftRows = buildPurchaseSendDraftRowsFromEntries(selectedEntries, purchaseAmount, {
      existingUnsoldMemo: true,
      existingUnsoldRemoveMemo: true
    });
    setPurchaseDraftRows(draftRows);

    if (draftRows.length > 0) {
      const firstRow = draftRows[0];
      setPurchaseCodeInput(firstRow.code || '');
      setPurchaseFromInput(firstRow.from || '');
      setPurchaseToInput(firstRow.to || '');
      setPurchaseActiveRowIndex(0);
    } else {
      setPurchaseActiveRowIndex(0);
      resetPurchaseSendEntryInputs();
    }
  };

  const commitAdminUnsoldMemoSelection = (option = highlightedAdminUnsoldMemoOption) => {
    if (!option) {
      return;
    }

    if (activeTab === 'unsold-remove') {
      setPurchaseRemoveMemoNumber(option.memoNumber);
    } else {
      setPurchaseMemoNumber(option.memoNumber);
    }
    setPurchaseMemoSelectionIndex(Math.max(
      currentAdminUnsoldMemoOptions.findIndex((currentOption) => currentOption.key === option.key),
      0
    ));
    setPurchaseMemoPopupOpen(false);
    if (option.isNew) {
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      setPurchaseEditorVisible(true);
      resetPurchaseSendEntryInputs();
    } else {
      if (activeTab === 'unsold-remove') {
        hydrateAdminUnsoldRemoveDraftRowsForMemo(option.memoNumber, adminUnsoldRemoveMemoEntries);
      } else {
        const selectedEntries = unsoldPurchaseEntries.filter((entry) => (
          Number(entry.memoNumber) === Number(option.memoNumber)
        ));
        const draftRows = buildPurchaseSendDraftRowsFromEntries(selectedEntries, purchaseAmount, { existingUnsoldMemo: true });
        setPurchaseDraftRows(draftRows);

        if (draftRows.length > 0) {
          const firstRow = draftRows[0];
          setPurchaseCodeInput(firstRow.code || '');
          setPurchaseFromInput(firstRow.from || '');
          setPurchaseToInput(firstRow.to || '');
          setPurchaseActiveRowIndex(0);
        } else {
          setPurchaseActiveRowIndex(0);
          resetPurchaseSendEntryInputs();
        }
      }
    }
    window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
  };

  const handleAssignPurchase = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!purchaseSellerId || !purchaseRangeStart || !purchaseRangeEnd || !purchaseAmount || !purchaseSem) {
      setError('Seller, date, session, amount, SEM and range are required');
      return;
    }

    setPurchaseLoading(true);

    try {
      const response = await lotteryService.sendAdminPurchase({
        sellerId: purchaseSellerId,
        series: purchaseSeries.trim(),
        rangeStart: purchaseRangeStart,
        rangeEnd: purchaseRangeEnd,
        boxValue: purchaseSem,
        amount: purchaseAmount,
        bookingDate: purchaseBookingDate,
        sessionMode: purchaseSessionMode
      });

      setSuccess(response.data.message || 'Purchase sent successfully');
      setPurchaseRangeStart('');
      setPurchaseRangeEnd('');
      setPurchaseSeries('');
      await Promise.all([
        loadPurchaseEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId),
        loadAcceptEntries(),
        loadSummaryEntries(summaryDate, summarySessionMode)
      ]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error sending purchase');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const buildPurchaseSendDraftRow = () => {
    const { parsed, fromNumber, toNumber, quantity, error: rangeError } = getRetroRangeMetrics(
      purchaseCodeInput,
      purchaseSessionMode,
      purchaseFromInput,
      purchaseToInput,
      purchaseCategory
    );
    const selectedSeller = directAdminSellers.find((seller) => String(seller.id) === String(purchaseSellerId));

    if (!selectedSeller) {
      return { error: 'Seller select karo' };
    }

    if (parsed.error) {
      return { error: parsed.error };
    }

    if (rangeError) {
      return { error: rangeError };
    }

    if (!parsed.semValue || !fromNumber || !toNumber) {
      return { error: 'Code, from aur to required hai' };
    }

    const allowedSemOptions = getAvailableSemOptions(purchaseAmount);
    if (allowedSemOptions.length > 0 && !allowedSemOptions.includes(String(parsed.semValue))) {
      return { error: `Amount ${purchaseAmount} me SEM ${allowedSemOptions.join(', ')} hi allowed hai` };
    }

    const rate = Number(purchaseAmount || 0);

    return {
      row: {
      id: `admin-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      code: buildRetroTicketCode(parsed.resolvedSessionMode, parsed.semValue, parsed.resolvedPurchaseCategory),
      itemName: getRetroItemName(purchaseBookingDate),
      drawDate: purchaseBookingDate,
      day: getDisplayDay(purchaseBookingDate),
      prefix: '',
      series: '',
      from: fromNumber,
      to: toNumber,
      quantity,
      rate: rate.toFixed(2),
      amount: (quantity * rate).toFixed(2),
      semValue: parsed.semValue,
      resolvedSessionMode: parsed.resolvedSessionMode,
      resolvedPurchaseCategory: parsed.resolvedPurchaseCategory
      }
    };
  };

  const resetPurchaseSendEntryInputs = () => {
    setPurchaseCodeInput('');
    setPurchaseFromInput('');
    setPurchaseToInput('');
  };

  const hasPendingPurchaseSendEditorValues = () => (
    purchaseEditorVisible
    && (Boolean(String(purchaseFromInput || '').trim())
    || Boolean(String(purchaseToInput || '').trim())
    )
  );

  const startNewPurchaseSendRow = () => {
    setPurchaseEditorVisible(true);
    resetPurchaseSendEntryInputs();
    setPurchaseActiveRowIndex(purchaseDraftRows.length);
    window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
  };

  const loadPurchaseDraftIntoEditor = (targetIndex) => {
    if (targetIndex < purchaseDraftRows.length) {
      const row = purchaseDraftRows[targetIndex];
      setPurchaseEditorVisible(true);
      setPurchaseCodeInput(row.code || '');
      setPurchaseFromInput(row.from || '');
      setPurchaseToInput(row.to || '');
      setPurchaseActiveRowIndex(targetIndex);
      return;
    }

    resetPurchaseSendEntryInputs();
    setPurchaseEditorVisible(true);
    setPurchaseActiveRowIndex(purchaseDraftRows.length);
  };

  const getPurchaseSendRowsForSave = async () => {
    const currentRows = [...purchaseDraftRows];

    if (!hasPendingPurchaseSendEditorValues()) {
      return { rows: currentRows };
    }

    const result = buildPurchaseSendDraftRow();

    if (result.error) {
      return { error: result.error };
    }

    const conflictingPurchaseDraft = currentRows.find((row, index) => (
      index !== purchaseActiveRowIndex
      && String(row.semValue || '') === String(result.row.semValue || '')
      && String(row.resolvedSessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(row.drawDate || '') === String(result.row.drawDate || '')
      && rangesOverlap(row.from, row.to, result.row.from, result.row.to)
    ));

    if (conflictingPurchaseDraft) {
      return { error: `Already added in draft: ${conflictingPurchaseDraft.from} to ${conflictingPurchaseDraft.to}` };
    }

    const conflictingPurchaseEntries = [...purchaseEntries, ...unsoldPurchaseEntries].filter((entry) => (
      !(
        isEditingExistingPurchaseMemo
        && Number(entry.memoNumber || 0) === Number(purchaseMemoNumber || 0)
        && String(entry.userId || '') === String(purchaseSellerId || '')
      )
      && String(entry.sem || '') === String(result.row.semValue || '')
      && String(entry.sessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(entry.purchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(formatDateOnly(entry.bookingDate || '')) === String(result.row.drawDate || '')
      && numberFallsWithinRange(entry.number, result.row.from, result.row.to)
    ));

    if (conflictingPurchaseEntries.length > 0) {
      return {
        error: 'Number already added.',
        details: conflictingPurchaseEntries.slice(0, 5).map((entry) => (
          `Seller ${entry.displaySeller || entry.username || 'Unknown'} | Memo No. ${entry.memoNumber || 'N/A'}`
        )),
        title: 'Duplicate Number'
      };
    }

    if (activeTab !== 'purchase-send') {
      const stockValidation = await validateAdminDraftRowAgainstActiveTab(result.row);
      if (stockValidation.error) {
        return {
          error: stockValidation.error,
          title: activeTab === 'unsold-remove' ? 'Unsold Missing' : 'Stock Missing'
        };
      }
    }

    if (purchaseActiveRowIndex < currentRows.length) {
      const updatedRows = [...currentRows];
      updatedRows[purchaseActiveRowIndex] = {
        ...result.row,
        id: currentRows[purchaseActiveRowIndex].id
      };
      return { rows: updatedRows, consumedEditor: true };
    }

    return { rows: [...currentRows, result.row], consumedEditor: true };
  };

  const commitPurchaseSendDraftRow = async () => {
    if (blockingWarning) {
      return;
    }

    const result = buildPurchaseSendDraftRow();

    if (result.error) {
      openBlockingWarning(result.error);
      return;
    }

    const isEditingExistingRow = purchaseActiveRowIndex < purchaseDraftRows.length;
    const conflictingPurchaseDraft = purchaseDraftRows.find((row, index) => (
      index !== purchaseActiveRowIndex
      && String(row.semValue || '') === String(result.row.semValue || '')
      && String(row.resolvedSessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(row.drawDate || '') === String(result.row.drawDate || '')
      && rangesOverlap(row.from, row.to, result.row.from, result.row.to)
    ));

    if (conflictingPurchaseDraft) {
      openBlockingWarning(
        'Number already added.',
        [`Seller ${selectedPurchaseSeller?.username || 'N/A'}`],
        'Duplicate Number'
      );
      return;
    }

    const conflictingPurchaseEntries = [...purchaseEntries, ...unsoldPurchaseEntries].filter((entry) => (
      !(
        isEditingExistingPurchaseMemo
        && Number(entry.memoNumber || 0) === Number(purchaseMemoNumber || 0)
        && String(entry.userId || '') === String(purchaseSellerId || '')
      )
      && String(entry.sem || '') === String(result.row.semValue || '')
      && String(entry.sessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(entry.purchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(formatDateOnly(entry.bookingDate || '')) === String(result.row.drawDate || '')
      && numberFallsWithinRange(entry.number, result.row.from, result.row.to)
    ));

    if (conflictingPurchaseEntries.length > 0) {
      openBlockingWarning(
        formatDuplicateSellerWarning(conflictingPurchaseEntries),
        [],
        'Duplicate Number'
      );
      return;
    }

    try {
      const serverEntriesResponse = await lotteryService.getPurchases({
        bookingDate: result.row.drawDate || purchaseBookingDate,
        sessionMode: result.row.resolvedSessionMode || purchaseSessionMode,
        purchaseCategory: result.row.resolvedPurchaseCategory || purchaseCategory,
        amount: result.row.bookingAmount || purchaseAmount,
        boxValue: result.row.semValue
      });
      const serverConflicts = (serverEntriesResponse.data || []).filter((entry) => (
        !(
          isEditingExistingPurchaseMemo
          && Number(entry.memoNumber || entry.memo_number || 0) === Number(purchaseMemoNumber || 0)
          && String(entry.userId || entry.user_id || '') === String(purchaseSellerId || '')
        )
        && numberFallsWithinRange(entry.number, result.row.from, result.row.to)
      ));

      if (serverConflicts.length > 0) {
        openBlockingWarning(
          formatDuplicateSellerWarning(serverConflicts),
          [],
          'Duplicate Number'
        );
        return;
      }
    } catch (err) {
      openBlockingWarning(err.response?.data?.message || 'Purchase send check nahi ho paya', [], 'Warning');
      return;
    }

    if (activeTab !== 'purchase-send') {
      try {
        const stockValidation = await validateAdminDraftRowAgainstActiveTab(result.row);
        if (stockValidation.error) {
          openBlockingWarning(
            stockValidation.error,
            [],
            activeTab === 'unsold-remove' ? 'Unsold Missing' : 'Stock Missing'
          );
          return;
        }
      } catch (err) {
        openBlockingWarning(
          err.response?.data?.message || (activeTab === 'unsold-remove' ? 'Unsold check nahi ho paya' : 'Stock check nahi ho paya'),
          [],
          activeTab === 'unsold-remove' ? 'Unsold Missing' : 'Stock Missing'
        );
        return;
      }
    }

    setPurchaseDraftRows((currentRows) => {
      if (purchaseActiveRowIndex < currentRows.length) {
        const updatedRows = [...currentRows];
        updatedRows[purchaseActiveRowIndex] = {
          ...result.row,
          id: currentRows[purchaseActiveRowIndex].id,
          isExistingUnsoldMemoRow: currentRows[purchaseActiveRowIndex].isExistingUnsoldMemoRow,
          isEditedUnsoldRemoveRow: activeTab === 'unsold-remove'
            ? true
            : currentRows[purchaseActiveRowIndex].isEditedUnsoldRemoveRow,
          entryIds: currentRows[purchaseActiveRowIndex].entryIds || []
        };
        return updatedRows;
      }

      return [...currentRows, result.row];
    });

    const nextIndex = isEditingExistingRow
      ? Math.min(purchaseActiveRowIndex + 1, purchaseDraftRows.length)
      : purchaseDraftRows.length + 1;
    setPurchaseCodeInput(result.row.code || purchaseCodeInput);
    setPurchaseFromInput('');
    setPurchaseToInput('');
    setPurchaseEditorVisible(true);
    setPurchaseActiveRowIndex(nextIndex);
    clearBlockingWarning();
    setError('');
    window.requestAnimationFrame(() => {
      adminSendFromInputRef.current?.focus();
      adminSendFromInputRef.current?.select?.();
    });
  };

  const handleAdminPurchaseSendAddAction = async () => {
    if (blockingWarning) {
      return;
    }

    if (!hasPendingPurchaseSendEditorValues()) {
      startNewPurchaseSendRow();
      return;
    }

    await commitPurchaseSendDraftRow();
  };

  const movePurchaseDraftSelection = (direction) => {
    const nextIndex = Math.min(Math.max(purchaseActiveRowIndex + direction, 0), purchaseDraftRows.length);
    loadPurchaseDraftIntoEditor(nextIndex);
  };

  const deletePurchaseDraftRow = () => {
    if (blockingWarning) {
      return;
    }

    if (purchaseDraftRows.length === 0) {
      resetPurchaseSendEntryInputs();
      setPurchaseEditorVisible(false);
      return;
    }

    const deleteIndex = purchaseActiveRowIndex < purchaseDraftRows.length
      ? purchaseActiveRowIndex
      : purchaseDraftRows.length - 1;

    const nextRows = purchaseDraftRows.filter((_, index) => index !== deleteIndex);
    setPurchaseDraftRows(nextRows);
    setError('');
    setSuccess('');
    window.requestAnimationFrame(() => {
      if (deleteIndex < nextRows.length) {
        const row = nextRows[deleteIndex];
        setPurchaseEditorVisible(true);
        setPurchaseCodeInput(row.code || '');
        setPurchaseFromInput(row.from || '');
        setPurchaseToInput(row.to || '');
        setPurchaseActiveRowIndex(deleteIndex);
      } else {
        resetPurchaseSendEntryInputs();
        setPurchaseEditorVisible(false);
        setPurchaseActiveRowIndex(nextRows.length);
      }
      adminSendCodeInputRef.current?.focus();
    });
  };

  const savePurchaseSendDraftRows = async () => {
    if (blockingWarning) {
      return;
    }

    if (!purchaseSellerId) {
      openBlockingWarning('Seller select karo');
      return;
    }

    const rowsForSaveResult = await getPurchaseSendRowsForSave();

    if (rowsForSaveResult.error) {
      openBlockingWarning(
        rowsForSaveResult.error,
        rowsForSaveResult.details || [],
        rowsForSaveResult.title || 'Warning'
      );
      return;
    }

    const rowsToSave = rowsForSaveResult.rows || [];

    if (rowsToSave.length === 0 && !isEditingExistingPurchaseMemo) {
      openBlockingWarning('Save karne ke liye row add karo');
      return;
    }

    setPurchaseLoading(true);
    setError('');
    setSuccess('');

    try {
      if (rowsForSaveResult.consumedEditor) {
        setPurchaseDraftRows(rowsToSave);
      }

      const effectiveMemoNumber = Number(purchaseMemoNumber || nextPurchaseMemoNumber);
      const refreshBookingDate = rowsToSave[0]?.drawDate || purchaseBookingDate;
      const currentMemoEntryIds = isEditingExistingPurchaseMemo
        ? [...purchaseEntries, ...unsoldPurchaseEntries]
          .filter((entry) => (
            Number(entry.memoNumber || 0) === effectiveMemoNumber
            && String(entry.userId || '') === String(purchaseSellerId || '')
          ))
          .map((entry) => entry.id)
          .filter(Boolean)
        : [];

      if (isEditingExistingPurchaseMemo) {
        const response = await lotteryService.replacePurchaseSendMemo({
          sellerId: purchaseSellerId,
          memoNumber: effectiveMemoNumber,
          entryIds: currentMemoEntryIds,
          bookingDate: refreshBookingDate,
          sessionMode: purchaseSessionMode,
          amount: purchaseAmount,
          purchaseCategory,
          rows: rowsToSave.map((row) => ({
            rangeStart: row.from,
            rangeEnd: row.to,
            boxValue: row.semValue,
            amount: purchaseAmount,
            bookingDate: row.drawDate || purchaseBookingDate,
            sessionMode: row.resolvedSessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || purchaseCategory,
            entryIds: row.entryIds || []
          }))
        });
        setSuccess(response.data.message || `Memo ${effectiveMemoNumber} updated successfully`);
      } else {
        for (const row of rowsToSave) {
          await lotteryService.sendAdminPurchase({
            sellerId: purchaseSellerId,
            series: '',
            rangeStart: row.from,
            rangeEnd: row.to,
            boxValue: row.semValue,
            amount: purchaseAmount,
            memoNumber: effectiveMemoNumber,
            bookingDate: row.drawDate || purchaseBookingDate,
            sessionMode: row.resolvedSessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || purchaseCategory
          });
        }
        setSuccess('Purchase saved successfully');
      }

      if (!isEditingExistingPurchaseMemo) {
        setPurchaseMemoNumber(null);
        setPurchaseMemoSelectionIndex(0);
        setPurchaseDraftRows([]);
        setPurchaseActiveRowIndex(0);
        setPurchaseEditorVisible(true);
        resetPurchaseSendEntryInputs();
      } else if (rowsToSave.length > 0) {
        setPurchaseMemoNumber(null);
        setPurchaseMemoSelectionIndex(0);
        setPurchaseDraftRows([]);
        setPurchaseActiveRowIndex(0);
        setPurchaseEditorVisible(true);
        resetPurchaseSendEntryInputs();
      } else if (rowsToSave.length === 0) {
        setPurchaseMemoNumber(null);
        setPurchaseMemoSelectionIndex(0);
        setPurchaseDraftRows([]);
        setPurchaseActiveRowIndex(0);
        setPurchaseEditorVisible(true);
        resetPurchaseSendEntryInputs();
      }
      setPurchaseMemoPopupOpen(false);
      await loadPurchaseEntries(refreshBookingDate, purchaseSessionMode, purchaseSellerId);
      focusAdminSendSellerSelect();
    } catch (err) {
      const rawErrorMessage = err.response?.data?.message || err.message || '';
      const normalizedErrorMessage = String(rawErrorMessage).toLowerCase();
      if (
        normalizedErrorMessage.includes('purchase stock me nahi hai')
        || normalizedErrorMessage.includes('selected date, shift, category aur sem me pehle se use ho chuka hai')
        || normalizedErrorMessage.includes('number already added')
      ) {
        setError('');
        return;
      }

      const errorMessage = err.response?.data?.message
        || (err.response?.status === 404 ? 'Purchase memo save API nahi mila. Backend server restart karo.' : '')
        || err.message
        || 'Error saving purchase';
      setError(errorMessage);
    } finally {
      setPurchaseLoading(false);
    }
  };

  const validateAdminUnsoldRowInStock = async (row, options = {}) => {
    const currentMemoNumber = Number(options.currentMemoNumber || 0);
    const requestedNumbers = buildConsecutiveNumbers(row.from, row.to);
    if (requestedNumbers.error) {
      return { error: requestedNumbers.error };
    }

    const matchingUnsoldEntries = unsoldPurchaseEntries.filter((entry) => (
      String(entry.sem || '') === String(row.semValue || '')
      && String(entry.amount || '') === String(row.bookingAmount || purchaseAmount || '')
      && String(entry.sessionMode || '') === String(row.resolvedSessionMode || purchaseSessionMode || '')
      && String(entry.purchaseCategory || '') === String(row.resolvedPurchaseCategory || purchaseCategory || '')
      && getDateOnlyValue(entry.bookingDate) === getDateOnlyValue(row.drawDate || purchaseBookingDate)
    ));
    const duplicateUnsoldEntries = matchingUnsoldEntries.filter((entry) => (
      Number(entry.memoNumber || 0) !== currentMemoNumber
      && requestedNumbers.numbers.includes(String(entry.number || '').padStart(5, '0'))
    ));

    if (duplicateUnsoldEntries.length > 0) {
      const memoNumbers = [...new Set(
        duplicateUnsoldEntries
          .map((entry) => Number(entry.memoNumber || 0))
          .filter((memoNumber) => Number.isInteger(memoNumber) && memoNumber > 0)
      )];
      return {
        error: memoNumbers.length > 0
          ? `Ye number already unsold at memo number ${memoNumbers.join(', ')}`
          : `Ye number pehle se unsold me save hai: ${formatMissingNumberLabel(duplicateUnsoldEntries.map((entry) => String(entry.number || '').padStart(5, '0')))}`
      };
    }

    const currentMemoEntries = currentMemoNumber > 0
      ? matchingUnsoldEntries.filter((entry) => (
        Number(entry.memoNumber || 0) === currentMemoNumber
      ))
      : [];
    const currentMemoDraftNumbers = purchaseDraftRows.flatMap((draftRow) => {
      if (!draftRow?.isExistingUnsoldMemoRow) {
        return [];
      }

      const sameContext = (
        String(draftRow.semValue || '') === String(row.semValue || '')
        && String(draftRow.bookingAmount || purchaseAmount || '') === String(row.bookingAmount || purchaseAmount || '')
        && String(draftRow.resolvedSessionMode || purchaseSessionMode || '') === String(row.resolvedSessionMode || purchaseSessionMode || '')
        && String(draftRow.resolvedPurchaseCategory || purchaseCategory || '') === String(row.resolvedPurchaseCategory || purchaseCategory || '')
        && getDateOnlyValue(draftRow.drawDate || purchaseBookingDate) === getDateOnlyValue(row.drawDate || purchaseBookingDate)
      );

      if (!sameContext) {
        return [];
      }

      const draftNumbers = buildConsecutiveNumbers(draftRow.from, draftRow.to);
      return draftNumbers.error ? [] : draftNumbers.numbers;
    });

    const response = await lotteryService.getPurchases({
      bookingDate: row.drawDate || purchaseBookingDate,
      sessionMode: row.resolvedSessionMode || purchaseSessionMode,
      sellerId: purchaseSellerId,
      status: 'accepted',
      purchaseCategory: row.resolvedPurchaseCategory || purchaseCategory,
      amount: row.bookingAmount || purchaseAmount,
      boxValue: row.semValue
    });

    const availableNumbers = new Set(
      [
        ...(response.data || [])
          .filter((entry) => {
            const hasMemo = entry.memoNumber !== null && entry.memoNumber !== undefined && String(entry.memoNumber).trim() !== '';
            return hasMemo;
          })
          .map((entry) => String(entry.number || '').padStart(5, '0')),
        ...currentMemoEntries.map((entry) => String(entry.number || '').padStart(5, '0')),
        ...currentMemoDraftNumbers.map((entry) => String(entry || '').padStart(5, '0'))
      ]
    );
    const missingNumbers = requestedNumbers.numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));

    if (missingNumbers.length > 0) {
      return {
        error: `${formatAdminUnsoldErrorDate(row.drawDate || purchaseBookingDate)} date me ${getSelectedAdminUnsoldSellerName()} ke purchase stock me ye number nahi hai: ${formatMissingNumberLabel(missingNumbers)}`
      };
    }

    return { ok: true };
  };

  const getActiveAdminUnsoldMemoNumber = () => {
    if (activeTab === 'unsold-remove') {
      return Number(purchaseRemoveMemoNumber || selectedAdminUnsoldRemoveMemoOption?.memoNumber || 0);
    }

    return Number(purchaseMemoNumber || selectedAdminUnsoldMemoOption?.memoNumber || 0);
  };

  const addAdminUnsoldDraftRow = async () => {
    if (blockingWarning) {
      return;
    }

    const result = buildPurchaseSendDraftRow();
    if (result.error) {
      openBlockingWarning(result.error);
      return;
    }

    const isUnsoldRemoveMode = activeTab === 'unsold-remove';
    const editingExistingUnsoldRow = Boolean(purchaseDraftRows[purchaseActiveRowIndex]?.isExistingUnsoldMemoRow);
    const editingExistingAdminUnsoldMemo = !isUnsoldRemoveMode && Boolean(selectedAdminUnsoldMemoOption && !selectedAdminUnsoldMemoOption.isNew);

    const conflictingDraft = purchaseDraftRows.find((row, index) => (
      index !== purchaseActiveRowIndex
      && String(row.semValue || '') === String(result.row.semValue || '')
      && String(row.resolvedSessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(row.drawDate || '') === String(result.row.drawDate || '')
      && rangesOverlap(row.from, row.to, result.row.from, result.row.to)
    ));

    if (conflictingDraft) {
      openBlockingWarning('Number already added.', [], 'Duplicate Number', focusAdminUnsoldFromInput);
      return;
    }

    try {
      const stockValidation = editingExistingUnsoldRow || editingExistingAdminUnsoldMemo
        ? { ok: true }
        : isUnsoldRemoveMode
          ? await validateAdminUnsoldRemoveRowInStock(result.row)
          : await validateAdminUnsoldRowInStock(result.row, {
            currentMemoNumber: getActiveAdminUnsoldMemoNumber()
          });
      if (stockValidation.error) {
        openBlockingWarning(
          stockValidation.error,
          [],
          isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
          focusAdminUnsoldFromInput
        );
        return;
      }
    } catch (err) {
      openBlockingWarning(
        err.response?.data?.message || (isUnsoldRemoveMode ? 'Unsold check nahi ho paya' : 'Stock check nahi ho paya'),
        [],
        isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
        focusAdminUnsoldFromInput
      );
      return;
    }

    setPurchaseDraftRows((currentRows) => {
      if (purchaseActiveRowIndex < currentRows.length) {
        const updatedRows = [...currentRows];
        updatedRows[purchaseActiveRowIndex] = {
          ...result.row,
          id: currentRows[purchaseActiveRowIndex].id,
          isExistingUnsoldMemoRow: currentRows[purchaseActiveRowIndex].isExistingUnsoldMemoRow,
          isExistingUnsoldRemoveMemoRow: currentRows[purchaseActiveRowIndex].isExistingUnsoldRemoveMemoRow,
          isEditedUnsoldRemoveRow: activeTab === 'unsold-remove'
            ? !currentRows[purchaseActiveRowIndex].isExistingUnsoldRemoveMemoRow
            : currentRows[purchaseActiveRowIndex].isEditedUnsoldRemoveRow
        };
        return updatedRows;
      }
      return [...currentRows, result.row];
    });
    setPurchaseCodeInput(result.row.code || purchaseCodeInput);
    setPurchaseFromInput('');
    setPurchaseToInput('');
    setPurchaseEditorVisible(true);
    setPurchaseActiveRowIndex((currentIndex) => currentIndex < purchaseDraftRows.length ? currentIndex + 1 : purchaseDraftRows.length + 1);
    window.requestAnimationFrame(() => {
      adminSendFromInputRef.current?.focus();
      adminSendFromInputRef.current?.select?.();
    });
  };

  const validateAdminDraftRowAgainstActiveTab = async (row) => {
    if (activeTab === 'unsold') {
      return validateAdminUnsoldRowInStock(row, {
        currentMemoNumber: getActiveAdminUnsoldMemoNumber()
      });
    }

    if (activeTab === 'unsold-remove') {
      return validateAdminUnsoldRemoveRowInStock(row);
    }

    return { ok: true };
  };

  const validateAdminUnsoldRemoveRowInStock = async (row) => {
    const payload = {
      sellerId: purchaseSellerId,
      bookingDate: row.drawDate || purchaseBookingDate,
      sessionMode: row.resolvedSessionMode || purchaseSessionMode,
      purchaseCategory: row.resolvedPurchaseCategory || purchaseCategory,
      amount: row.bookingAmount || purchaseAmount,
      boxValue: row.semValue,
      rangeStart: row.from,
      rangeEnd: row.to
    };

    try {
      await lotteryService.checkPurchaseUnsoldRemove(payload);
      return { ok: true };
    } catch (err) {
      const requestedNumbers = buildConsecutiveNumbers(row.from, row.to);
      if (requestedNumbers.error) {
        return { error: err.response?.data?.message || requestedNumbers.error };
      }

      const lookupEntries = await getAdminUnsoldRemoveStockEntries({
        bookingDate: payload.bookingDate,
        sessionMode: payload.sessionMode,
        purchaseCategory: payload.purchaseCategory,
        sellerId: payload.sellerId,
        amount: payload.amount,
        boxValue: payload.boxValue
      });
      const removableNumbers = new Set(lookupEntries
        .map((entry) => String(entry.number || '').padStart(5, '0')));
      const missingNumbers = requestedNumbers.numbers.filter((currentNumber) => !removableNumbers.has(currentNumber));

      if (missingNumbers.length === 0) {
        return { ok: true };
      }

      return {
        error: err.response?.data?.message
          || `${formatAdminUnsoldErrorDate(payload.bookingDate)} date me ${getSelectedAdminUnsoldSellerName()} ke unsold remove stock me ye number nahi hai: ${formatMissingNumberLabel(missingNumbers)}`
      };
    }
  };

  const validateAdminEditorRowBeforeCommit = async () => {
    const result = buildPurchaseSendDraftRow();

    if (result.error) {
      openBlockingWarning(result.error, [], 'Warning', focusAdminUnsoldFromInput);
      return false;
    }

    const isUnsoldRemoveMode = activeTab === 'unsold-remove';
    const editingExistingUnsoldRow = Boolean(purchaseDraftRows[purchaseActiveRowIndex]?.isExistingUnsoldMemoRow);
    const editingExistingAdminUnsoldMemo = !isUnsoldRemoveMode && Boolean(selectedAdminUnsoldMemoOption && !selectedAdminUnsoldMemoOption.isNew);

    try {
      const stockValidation = editingExistingUnsoldRow || editingExistingAdminUnsoldMemo
        ? { ok: true }
        : isUnsoldRemoveMode
          ? await validateAdminUnsoldRemoveRowInStock(result.row)
          : await validateAdminUnsoldRowInStock(result.row, {
            currentMemoNumber: getActiveAdminUnsoldMemoNumber()
          });
      if (stockValidation.error) {
        openBlockingWarning(
          stockValidation.error,
          [],
          isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
          focusAdminUnsoldFromInput
        );
        return false;
      }
    } catch (err) {
      openBlockingWarning(
        err.response?.data?.message || (isUnsoldRemoveMode ? 'Unsold check nahi ho paya' : 'Stock check nahi ho paya'),
        [],
        isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
        focusAdminUnsoldFromInput
      );
      return false;
    }

    return true;
  };
  const handleAdminUnsoldAddAction = async () => {
    if (blockingWarning) {
      return;
    }

    if (!hasPendingPurchaseSendEditorValues()) {
      startNewPurchaseSendRow();
      return;
    }

    const canCommit = await validateAdminEditorRowBeforeCommit();
    if (!canCommit) {
      return;
    }

    await addAdminUnsoldDraftRow();
  };

  const saveAdminUnsoldRows = async (mode = 'mark') => {
    if (blockingWarning) {
      return;
    }

    if (!purchaseSellerId) {
      openBlockingWarning('Seller select karo');
      return;
    }

    let rowsToSave = mode === 'remove'
      ? purchaseDraftRows.filter((row) => (
        !row.isExistingUnsoldMemoRow && !row.isExistingUnsoldRemoveMemoRow
      ))
      : [...purchaseDraftRows];
    const activeRemoveMemoRow = purchaseDraftRows[purchaseActiveRowIndex];
    if (hasPendingPurchaseSendEditorValues() && !(mode === 'remove' && activeRemoveMemoRow?.isExistingUnsoldRemoveMemoRow)) {
      openBlockingWarning(
        mode === 'remove'
          ? 'Pehle A-Add ya Enter se row confirm karo, uske baad Remove karo'
          : 'Pehle A-Add karke row confirm karo, uske baad Save karo',
        [],
        'Warning',
        focusAdminUnsoldFromInput
      );
      return;
    }

    const editingExistingAdminUnsoldMemo = mode === 'mark' && Boolean(selectedAdminUnsoldMemoOption && !selectedAdminUnsoldMemoOption.isNew);
    const effectiveMemoNumber = mode === 'remove'
      ? (purchaseRemoveMemoNumber || selectedAdminUnsoldRemoveMemoOption?.memoNumber || nextAdminUnsoldRemoveMemoNumber)
      : (purchaseMemoNumber || selectedAdminUnsoldMemoOption?.memoNumber || nextAdminUnsoldMemoNumber);

    if (rowsToSave.length === 0 && !editingExistingAdminUnsoldMemo) {
      if (mode === 'remove' && purchaseDraftRows.some((row) => row.isExistingUnsoldRemoveMemoRow)) {
        setSuccess(`Unsold remove memo ${effectiveMemoNumber || ''} already saved`);
        return;
      }
      openBlockingWarning('Save karne ke liye row add karo');
      return;
    }

    if (mode !== 'remove') {
      if (!editingExistingAdminUnsoldMemo) {
        try {
          for (const row of rowsToSave) {
            const stockValidation = await validateAdminUnsoldRowInStock(row, {
              currentMemoNumber: 0
            });
            if (stockValidation.error) {
              openBlockingWarning(stockValidation.error, [], 'Stock Missing', focusAdminUnsoldFromInput);
              return;
            }
          }
        } catch (err) {
          openBlockingWarning(err.response?.data?.message || 'Stock check nahi ho paya', [], 'Stock Missing', focusAdminUnsoldFromInput);
          return;
        }
      }
    }

    setPurchaseLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'remove' && !effectiveMemoNumber) {
        openBlockingWarning('Unsold memo select karo');
        return;
      }

      if (editingExistingAdminUnsoldMemo) {
        await lotteryService.replacePurchaseUnsoldMemo({
          sellerId: purchaseSellerId,
          bookingDate: rowsToSave[0]?.drawDate || purchaseBookingDate,
          memoNumber: effectiveMemoNumber,
          sessionMode: purchaseSessionMode,
          amount: purchaseAmount,
          purchaseCategory,
          rows: rowsToSave.map((row) => ({
            rangeStart: row.from,
            rangeEnd: row.to,
            boxValue: row.semValue,
            amount: row.bookingAmount || purchaseAmount,
            bookingDate: row.drawDate || purchaseBookingDate,
            sessionMode: row.resolvedSessionMode || purchaseSessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || purchaseCategory
          }))
        });
      } else {
        for (const row of rowsToSave) {
          const payload = {
            sellerId: purchaseSellerId,
            bookingDate: row.drawDate || purchaseBookingDate,
            sessionMode: row.resolvedSessionMode || purchaseSessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || purchaseCategory,
            ...(effectiveMemoNumber && { memoNumber: effectiveMemoNumber }),
            amount: row.bookingAmount || purchaseAmount,
            boxValue: row.semValue,
            rangeStart: row.from,
            rangeEnd: row.to
          };

          if (mode === 'remove') {
          await lotteryService.removePurchaseUnsold(payload);
          } else {
          await lotteryService.markPurchaseUnsold(payload);
          }
        }
      }

      setSuccess(mode === 'remove' ? `Unsold removed successfully in memo ${effectiveMemoNumber}` : `Unsold saved successfully in memo ${effectiveMemoNumber}`);
      if (mode === 'remove') {
        setPurchaseMemoNumber(nextAdminUnsoldMemoNumber);
        setPurchaseRemoveMemoNumber(effectiveMemoNumber + 1);
      } else if (editingExistingAdminUnsoldMemo) {
        setPurchaseMemoNumber(effectiveMemoNumber);
        setPurchaseRemoveMemoNumber(nextAdminUnsoldRemoveMemoNumber);
      } else {
        setPurchaseMemoNumber(effectiveMemoNumber + 1);
        setPurchaseRemoveMemoNumber(nextAdminUnsoldRemoveMemoNumber);
      }
      setPurchaseMemoSelectionIndex(0);
      setPurchaseMemoPopupOpen(false);
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      setPurchaseEditorVisible(true);
      resetPurchaseSendEntryInputs();
      await Promise.all([
        loadPurchaseEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId),
        loadAdminUnsoldRemoveMemoEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId)
      ]);
      const derivedRefreshTasks = [];
      if (pieceSummaryOpen) {
        derivedRefreshTasks.push(loadPieceSummary());
      }
      if (activeTab === 'generate-bill') {
        derivedRefreshTasks.push(loadBillPreviewData(getBillFilters()));
      }
      if (derivedRefreshTasks.length > 0) {
        await Promise.all(derivedRefreshTasks);
      }
      if (activeTab === 'purchase-send' || activeTab === 'unsold' || activeTab === 'unsold-remove') {
        focusAdminSendSellerSelect();
      }
    } catch (err) {
      setError(err.response?.data?.message || (mode === 'remove' ? 'Error removing unsold' : 'Error saving unsold'));
    } finally {
      setPurchaseLoading(false);
    }
  };

  const loadStockTransferEntries = async () => {
    setStockTransferLoading(true);
    setError('');

    try {
      const response = await lotteryService.getAdminPurchases({
        bookingDate: stockTransferDate,
        sessionMode: initialSessionMode,
        purchaseCategory: initialPurchaseCategory || adminStockPurchaseCategory,
        amount: initialAmount || adminStockAmount
      }, { withSessionMode: false });
      setStockTransferEntries((response.data || []).map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading stock transfer data');
      setStockTransferEntries([]);
    } finally {
      setStockTransferLoading(false);
    }
  };

  const handleStockTransfer = async () => {
    if (!stockTransferTargetId) {
      setError('Seller select karo');
      return;
    }

    if (stockTransferEntries.length === 0) {
      setError('Selected date/category/amount me remaining stock nahi hai');
      return;
    }

    setStockTransferLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await lotteryService.transferRemainingStock({
        sellerId: stockTransferTargetId,
        bookingDate: stockTransferDate,
        sessionMode: initialSessionMode,
        purchaseCategory: initialPurchaseCategory || adminStockPurchaseCategory,
        amount: initialAmount || adminStockAmount
      });

      setSuccess(response.data?.message || 'Stock transferred successfully');
      setStockTransferEntries([]);
      await Promise.all([
        loadSeePurchaseData(),
        loadTransferHistory(getHistoryFilters())
      ]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error transferring stock');
    } finally {
      setStockTransferLoading(false);
    }
  };

  const clearAdminPurchaseForm = () => {
    setAdminStockSeries('');
    setAdminStockRangeStart('');
    setAdminStockRangeEnd('');
  };

  const clearPurchaseSendForm = () => {
    setPurchaseSeries('');
    setPurchaseRangeStart('');
    setPurchaseRangeEnd('');
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

  const mergeScannedPrizeEntries = (scannedPrizes) => {
    let addedCount = 0;
    const skippedNumbers = [];

    setPendingPrizeEntries((current) => {
      const nextEntries = PRIZE_OPTIONS.reduce((accumulator, prize) => {
        accumulator[prize.key] = [...(current[prize.key] || [])];
        return accumulator;
      }, {});
      const usedNumbers = new Set([
        ...Object.values(nextEntries).flat().map((entry) => entry.winningNumber),
        ...uploadedPrizeResults.map((entry) => entry.winningNumber)
      ]);

      PRIZE_OPTIONS.forEach((prize) => {
        sortPrizeNumbersAscending(scannedPrizes[prize.key] || []).forEach((number) => {
          if (number.length !== prize.digitLength || usedNumbers.has(number)) {
            skippedNumbers.push(number);
            return;
          }

          usedNumbers.add(number);
          nextEntries[prize.key].push({
            id: `scan-${prize.key}-${number}`,
            winningNumber: number
          });
          addedCount += 1;
        });
      });

      return nextEntries;
    });

    setEditingPendingPrizeId(null);
    setEditingPendingPrizeValue('');
    setError('');
    setSuccess(
      addedCount > 0
        ? `Scan se ${addedCount} prize numbers add ho gaye${skippedNumbers.length ? `, ${skippedNumbers.length} duplicate/invalid skip hua` : ''}`
        : 'Scan me koi naya prize number nahi mila'
    );
  };

  const handlePrizeFileScan = async () => {
    if (!prizeScanFile) {
      setError('Photo ya PDF select karo');
      setSuccess('');
      return;
    }

    setPrizeScanLoading(true);
    setPrizeScanProgress('File read ho raha hai...');
    setPrizeScanRawText('');
    setError('');
    setSuccess('');

    let worker = null;
    try {
      const isPdf = prizeScanFile.type === 'application/pdf' || prizeScanFile.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        setPrizeScanProgress('PDF text read ho raha hai...');
        const pdfText = await extractPdfTextFromFile(prizeScanFile);
        const pdfPrizes = parsePrizeScanText(pdfText);
        const pdfNumberCount = Object.values(pdfPrizes).reduce((count, numbers) => count + numbers.length, 0);

        if (pdfNumberCount > 0) {
          setPrizeScanRawText(pdfText);
          mergeScannedPrizeEntries(pdfPrizes);
          setPrizeScanProgress('PDF text scan complete');
          return;
        }
      }

      const imageSource = isPdf ? await renderPdfFirstPageToImage(prizeScanFile) : prizeScanFile;
      setPrizeScanProgress(isPdf ? 'PDF ka first page scan ho raha hai...' : 'Photo scan ho raha hai...');

      worker = await createWorker('eng', 1, {
        logger: (message) => {
          if (message.status === 'recognizing text') {
            setPrizeScanProgress(`OCR ${Math.round((message.progress || 0) * 100)}%`);
          }
        }
      });

      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789₹/-.,: '
      });

      const result = await worker.recognize(imageSource);
      const scannedText = result.data?.text || '';
      setPrizeScanRawText(scannedText);
      const scannedPrizes = parsePrizeScanText(scannedText);
      mergeScannedPrizeEntries(scannedPrizes);
      setPrizeScanProgress('Scan complete');
    } catch (err) {
      setError(err.message || 'Photo/PDF scan nahi ho paya');
      setSuccess('');
      setPrizeScanProgress('');
    } finally {
      if (worker) {
        await worker.terminate();
      }
      setPrizeScanLoading(false);
    }
  };

  const removePendingPrizeEntry = (prizeKey, winningNumber) => {
    const entryToRemove = pendingPrizeEntries[prizeKey]?.find((entry) => entry.winningNumber === winningNumber);
    setPendingPrizeEntries((current) => ({
      ...current,
      [prizeKey]: current[prizeKey].filter((entry) => entry.winningNumber !== winningNumber)
    }));
    if (entryToRemove && editingPendingPrizeId === `${prizeKey}:${entryToRemove.id}`) {
      setEditingPendingPrizeId(null);
    }
    setEditingPendingPrizeValue('');
    setError('');
    setSuccess(`${winningNumber} removed from ${PRIZE_OPTIONS.find((prize) => prize.key === prizeKey)?.title || 'prize list'}`);
  };

  const startEditingPendingPrizeEntry = (prizeKey, entry) => {
    setEditingPendingPrizeId(`${prizeKey}:${entry.id}`);
    setEditingPendingPrizeValue(entry.winningNumber);
    setError('');
    setSuccess('');
  };

  const cancelEditingPendingPrizeEntry = () => {
    setEditingPendingPrizeId(null);
    setEditingPendingPrizeValue('');
  };

  const addManualPrizeEntry = (prizeKey) => {
    const prizeConfig = PRIZE_OPTIONS.find((prize) => prize.key === prizeKey);
    const sanitizedValue = String(manualPrizeInputs[prizeKey] || '').replace(/[^0-9]/g, '').slice(0, prizeConfig?.digitLength || 5);

    if (!prizeConfig) {
      return;
    }

    if (sanitizedValue.length !== prizeConfig.digitLength) {
      setError(`${prizeConfig.title} requires exactly ${prizeConfig.digitLength} digits`);
      setSuccess('');
      return;
    }

    const duplicatePendingEntry = Object.values(pendingPrizeEntries).some((entries) => (
      entries.some((pendingEntry) => pendingEntry.winningNumber === sanitizedValue)
    ));
    const duplicateUploadedEntry = uploadedPrizeResults.some((uploadedEntry) => uploadedEntry.winningNumber === sanitizedValue);

    if (duplicatePendingEntry || duplicateUploadedEntry) {
      setError(`${sanitizedValue} is already used in another prize. One number can have only one prize.`);
      setSuccess('');
      return;
    }

    setPendingPrizeEntries((current) => ({
      ...current,
      [prizeKey]: [
        ...(current[prizeKey] || []),
        {
          id: `manual-${prizeKey}-${sanitizedValue}-${Date.now()}`,
          winningNumber: sanitizedValue
        }
      ]
    }));
    setManualPrizeInputs((current) => ({ ...current, [prizeKey]: '' }));
    setEditingPendingPrizeId(null);
    setEditingPendingPrizeValue('');
    setError('');
    setSuccess(`${sanitizedValue} added in ${prizeConfig.title}`);
  };

  const savePendingPrizeEntryEdit = (prizeKey, entry) => {
    const prizeConfig = PRIZE_OPTIONS.find((prize) => prize.key === prizeKey);
    const sanitizedValue = String(editingPendingPrizeValue || '').replace(/[^0-9]/g, '').slice(0, prizeConfig?.digitLength || 5);

    if (!prizeConfig) {
      return;
    }

    if (sanitizedValue.length !== prizeConfig.digitLength) {
      setError(`${prizeConfig.title} requires exactly ${prizeConfig.digitLength} digits`);
      setSuccess('');
      return;
    }

    const duplicatePendingEntry = Object.entries(pendingPrizeEntries).some(([currentPrizeKey, entries]) => (
      entries.some((pendingEntry) => (
        !(currentPrizeKey === prizeKey && pendingEntry.id === entry.id)
        && pendingEntry.winningNumber === sanitizedValue
      ))
    ));
    const duplicateUploadedEntry = uploadedPrizeResults.some((uploadedEntry) => uploadedEntry.winningNumber === sanitizedValue);

    if (duplicatePendingEntry || duplicateUploadedEntry) {
      setError(`${sanitizedValue} is already used in another prize. One number can have only one prize.`);
      setSuccess('');
      return;
    }

    setPendingPrizeEntries((current) => ({
      ...current,
      [prizeKey]: current[prizeKey].map((pendingEntry) => (
        pendingEntry.id === entry.id
          ? { ...pendingEntry, winningNumber: sanitizedValue }
          : pendingEntry
      ))
    }));
    setEditingPendingPrizeId(null);
    setEditingPendingPrizeValue('');
    setError('');
    setSuccess(`${sanitizedValue} updated in ${prizeConfig.title}`);
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
      await loadPrizeResults(uploadResultDate, uploadSessionMode, uploadPurchaseCategory);
    } catch (err) {
      setError(err.response?.data?.message || 'Error updating uploaded result');
    } finally {
      setEditingUploadedLoading(false);
    }
  };

  const deleteUploadedPrizeResult = async (entry) => {
    const confirmed = window.confirm(`${entry.winningNumber} uploaded result delete karna hai?`);
    if (!confirmed) {
      return;
    }

    setEditingUploadedLoading(true);
    setError('');
    setSuccess('');

    try {
      await priceService.deletePrizeResult(entry.id);
      setSuccess(`${entry.winningNumber} deleted from uploaded result`);
      if (editingUploadedResultId === entry.id) {
        setEditingUploadedResultId(null);
        setEditingUploadedValue('');
      }
      await loadPrizeResults(uploadResultDate, uploadSessionMode, uploadPurchaseCategory);
    } catch (err) {
      setError(err.response?.data?.message || 'Error deleting uploaded result');
    } finally {
      setEditingUploadedLoading(false);
    }
  };

  const deleteAllUploadedPrizeResults = async () => {
    if (uploadedPrizeResults.length === 0) {
      setError('Delete karne ke liye uploaded result nahi hai');
      setSuccess('');
      return;
    }

    const confirmed = window.confirm(`${formatDisplayDate(uploadResultDate)} ${uploadResultShift} ke sab uploaded results delete karne hai?`);
    if (!confirmed) {
      return;
    }

    setEditingUploadedLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await priceService.deletePrizeResults({
        resultForDate: uploadResultDate,
        sessionMode: uploadSessionMode,
        purchaseCategory: uploadPurchaseCategory
      });
      setSuccess(response.data?.message || 'All uploaded results deleted successfully');
      setEditingUploadedResultId(null);
      setEditingUploadedValue('');
      await loadPrizeResults(uploadResultDate, uploadSessionMode, uploadPurchaseCategory);
    } catch (err) {
      setError(err.response?.data?.message || 'Error deleting uploaded results');
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
      sortPrizeNumbersAscending((pendingPrizeEntries[prize.key] || []).map((entry) => entry.winningNumber)).map((winningNumber) => ({
        prizeKey: prize.key,
        winningNumber
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
        purchaseCategory: uploadPurchaseCategory,
        resultForDate: uploadResultDate
      });
      setSuccess('Prize results uploaded successfully');
      setPendingPrizeEntries(createPendingPrizeEntries());
      setManualPrizeInputs(createManualPrizeInputs());
      setEditingPendingPrizeId(null);
      setEditingPendingPrizeValue('');
      await loadPrizeResults(uploadResultDate, uploadSessionMode, uploadPurchaseCategory);
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

  function resetAdminMemoOptionState(tabName) {
    if (tabName === 'purchase') {
      setAdminStockDraftRows([]);
      setAdminStockActiveRowIndex(0);
      resetAdminStockEntryInputs();
      setAdminStockMemoNumber(nextAdminStockMemoNumber);
      setAdminStockMemoSelectionIndex(0);
      setAdminStockMemoPopupOpen(false);
      return;
    }

    if (tabName === 'purchase-send') {
      setPurchaseMemoNumber(nextPurchaseMemoNumber);
      setPurchaseMemoSelectionIndex(0);
      setPurchaseMemoPopupOpen(false);
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      resetPurchaseSendEntryInputs();
      return;
    }

    if (tabName === 'unsold') {
      setPurchaseMemoNumber(nextAdminUnsoldMemoNumber);
      setPurchaseMemoSelectionIndex(0);
      setPurchaseMemoPopupOpen(false);
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      resetPurchaseSendEntryInputs();
      return;
    }

    if (tabName === 'unsold-remove') {
      setPurchaseRemoveMemoNumber(nextAdminUnsoldRemoveMemoNumber);
      setPurchaseMemoSelectionIndex(0);
      setPurchaseMemoPopupOpen(false);
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      resetPurchaseSendEntryInputs();
    }
  }

  const handleTabToggle = (tabName) => {
    setError('');
    setSuccess('');

    if (activeTab === tabName) {
      resetAdminMemoOptionState(tabName);
      resetDateFieldsToToday();
      setActiveTab('');
      window.history.back();
      return;
    }

    if (activeTab && activeTab !== tabName) {
      resetAdminMemoOptionState(activeTab);
    }

    window.history.pushState({ adminTab: tabName }, '');

    if (tabName === 'generate-bill') {
      loadBillPreviewData(getBillFilters());
    }

    if (tabName === 'today-summary') {
      loadSummaryEntries(summaryDate, summarySessionMode);
    }

    if (tabName === 'purchase') {
      resetAdminMemoOptionState('purchase');
      loadAdminPurchaseEntries(adminStockBookingDate, adminStockSessionMode, adminStockAmount, adminStockPurchaseCategory);
    }

    if (tabName === 'purchase-send') {
      resetAdminMemoOptionState('purchase-send');
      loadPurchaseEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId);
    }

    if (tabName === 'unsold' || tabName === 'unsold-remove') {
      resetAdminMemoOptionState(tabName);
      loadPurchaseEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId);
    }

    if (tabName === 'unsold-remove') {
      loadAdminUnsoldRemoveMemoEntries(purchaseBookingDate, purchaseSessionMode, purchaseSellerId);
    }

    if (tabName === 'see-purchase') {
      loadSeePurchaseData();
    }

    if (tabName === 'stock-transfer') {
      loadStockTransferEntries();
    }

    setActiveTab(tabName);
  };

  const handleTabBack = () => {
    setError('');
    setSuccess('');
    if (activeTab) {
      resetAdminMemoOptionState(activeTab);
      resetDateFieldsToToday();
      setActiveTab('');
      window.history.back();
      return;
    }

    if (onExitSession) {
      resetDateFieldsToToday();
      onExitSession();
    }
  };

  const getFirstActiveControl = () => {
    if (activeTab === 'purchase') {
      return adminStockDateInputRef.current || adminStockCodeInputRef.current;
    }

    if (activeTab === 'purchase-send') {
      return adminSendSellerSelectRef.current || adminSendDateInputRef.current || adminSendCodeInputRef.current;
    }

    if (activeTab === 'unsold' || activeTab === 'unsold-remove') {
      return adminSendSellerSelectRef.current || adminUnsoldDateInputRef.current || adminSendCodeInputRef.current;
    }

    const activeContent = dashboardRef.current?.querySelector('.accordion-content');
    return activeContent?.querySelector('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')
      || dashboardRef.current?.querySelector('button:not(:disabled)');
  };

  const focusFirstActiveControl = () => {
    const firstControl = getFirstActiveControl();
    window.requestAnimationFrame(() => {
      firstControl?.focus();
      firstControl?.select?.();
    });
  };

  const requestExitConfirmation = () => {
    const firstControl = getFirstActiveControl();
    const isAtFirstControl = firstControl && document.activeElement === firstControl;

    if (!activeTab || exitReadyFromFirstControl || isAtFirstControl) {
      setExitReadyFromFirstControl(false);
      handleTabBack();
      return;
    }

    setExitConfirmSelected('no');
    setExitConfirmOpen(true);
  };

  const cancelExitConfirmation = () => {
    setExitConfirmOpen(false);
    setExitConfirmSelected('no');
  };

  const confirmExitRequest = () => {
    setExitConfirmOpen(false);
    setExitConfirmSelected('no');

    if (activeTab && !exitReadyFromFirstControl) {
      setExitReadyFromFirstControl(true);
      focusFirstActiveControl();
      return;
    }

    setExitReadyFromFirstControl(false);
    handleTabBack();
  };

  const refocusAfterSaveConfirmation = () => {
    const focusTarget = saveConfirmFocusRef.current;
    saveConfirmFocusRef.current = null;
    window.requestAnimationFrame(() => {
      focusTarget?.focus?.();
      focusTarget?.select?.();
    });
  };

  const requestSaveConfirmation = (action, message = 'Save karna hai?') => {
    saveConfirmActionRef.current = action;
    saveConfirmFocusRef.current = document.activeElement;
    setSaveConfirmMessage(message);
    setSaveConfirmSelected('no');
    setSaveConfirmOpen(true);
  };

  const cancelSaveConfirmation = () => {
    saveConfirmActionRef.current = null;
    setSaveConfirmOpen(false);
    setSaveConfirmSelected('no');
    refocusAfterSaveConfirmation();
  };

  const confirmSaveRequest = () => {
    const action = saveConfirmActionRef.current;
    saveConfirmActionRef.current = null;
    setSaveConfirmOpen(false);
    setSaveConfirmSelected('no');
    refocusAfterSaveConfirmation();
    action?.();
  };

  const handleDashboardFocusCapture = (event) => {
    if (!exitReadyFromFirstControl || exitConfirmOpen) {
      return;
    }

    const firstControl = getFirstActiveControl();
    if (firstControl && event.target !== firstControl) {
      setExitReadyFromFirstControl(false);
    }
  };

  useFunctionShortcuts(activeTab === 'purchase', {
    A: () => {
      if (blockingWarning) {
        return;
      }
      startNewAdminStockRow();
    },
    F2: () => {
      if (blockingWarning) {
        return;
      }
      if (!adminStockLoading) {
        requestSaveConfirmation(saveAdminStockDraftRows);
      }
    },
    F3: () => {
      if (blockingWarning) {
        return;
      }
      deleteAdminStockDraftRow();
    },
    F8: () => {
      if (blockingWarning) {
        return;
      }
      clearAdminPurchaseForm();
      resetAdminStockEntryInputs();
      setAdminStockDraftRows([]);
      setAdminStockActiveRowIndex(0);
      setAdminStockEditorVisible(true);
    },
    ESCAPE: () => {
      if (blockingWarning) {
        clearBlockingWarning();
        return;
      }
      requestExitConfirmation();
    }
  });

  useFunctionShortcuts(activeTab === 'purchase-send', {
    A: () => {
      void handleAdminPurchaseSendAddAction();
    },
    F2: () => {
      if (blockingWarning) {
        return;
      }
      if (!purchaseLoading) {
        requestSaveConfirmation(savePurchaseSendDraftRows);
      }
    },
    F3: () => {
      if (blockingWarning) {
        return;
      }
      deletePurchaseDraftRow();
    },
    F8: () => {
      if (blockingWarning) {
        return;
      }
      clearPurchaseSendForm();
      resetPurchaseSendEntryInputs();
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      setPurchaseEditorVisible(true);
    },
    ESCAPE: () => {
      if (blockingWarning) {
        clearBlockingWarning();
        return;
      }
      requestExitConfirmation();
    }
  });

  useFunctionShortcuts(activeTab === 'unsold' || activeTab === 'unsold-remove', {
    A: () => {
      void handleAdminUnsoldAddAction();
    },
    F2: () => {
      if (!purchaseLoading) {
        requestSaveConfirmation(
          () => saveAdminUnsoldRows(activeTab === 'unsold-remove' ? 'remove' : 'mark'),
          activeTab === 'unsold-remove' ? 'Remove karna hai?' : 'Save karna hai?'
        );
      }
    },
    F3: deletePurchaseDraftRow,
    F4: () => {
      void openAdminUnsoldStockLookup();
    },
    F8: () => {
      clearPurchaseSendForm();
      resetPurchaseSendEntryInputs();
      setPurchaseDraftRows([]);
      setPurchaseActiveRowIndex(0);
      setPurchaseEditorVisible(true);
    },
    ESCAPE: () => {
      if (blockingWarning) {
        clearBlockingWarning();
        return;
      }
      requestExitConfirmation();
    }
  });

  const directAdminSellers = (treeData?.children || []).filter((node) => node.role === 'seller');
  const activeAmountAdminSellers = directAdminSellers.filter((seller) => sellerSupportsAmount(seller, purchaseAmount || initialAmount));
  const adminPrizeTrackerSellerOptions = [
    { id: '', username: 'All Sellers', keyword: 'ALL' },
    ...activeAmountAdminSellers
      .filter((seller) => seller.id)
      .map((seller) => ({
        id: seller.id,
        username: seller.username,
        keyword: seller.keyword || ''
      }))
  ];
  const loadPieceSummary = async (dateOverride = '') => {
    const summaryDateValue = dateOverride || pieceSummaryDate || getTodayDateValue();
    const summarySessionValue = initialSessionMode || purchaseSessionMode || adminStockSessionMode;
    const summaryCategoryValue = initialPurchaseCategory || purchaseCategory || adminStockPurchaseCategory;
    const summaryAmountValue = initialAmount || purchaseAmount || adminStockAmount;

    setPieceSummaryLoading(true);
    setPieceSummaryOpen(true);
    setPieceSummaryDate(summaryDateValue);
    setError('');

    try {
      const response = await lotteryService.getPurchasePieceSummary({
        bookingDate: summaryDateValue,
        sessionMode: summarySessionValue,
        purchaseCategory: summaryCategoryValue,
        amount: summaryAmountValue
      });

      setPieceSummaryRows((response.data || []).map((row) => ({
        id: row.sellerId || row.seller_id,
        sellerName: row.sellerName || row.seller_name || '',
        totalPiece: Number(row.totalPiece || row.total_piece || 0),
        unsoldPiece: Number(row.unsoldPiece || row.unsold_piece || 0),
        stockNotTransferredPiece: Number(row.stockNotTransferredPiece || row.stock_not_transferred_piece || 0)
      })));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading piece summary');
      setPieceSummaryRows([]);
    } finally {
      setPieceSummaryLoading(false);
    }
  };

  useEffect(() => {
    if (!pieceSummaryOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (String(event.key || '').toUpperCase() === 'ESCAPE') {
        event.preventDefault();
        closePieceSummary();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pieceSummaryOpen]);

  useFunctionShortcuts(true, {
    F10: () => {
      loadPieceSummary();
    }
  });

  const stockTransferTargetOptions = activeAmountAdminSellers.filter((option) => option.id);
  const selectedPurchaseSeller = activeAmountAdminSellers.find((seller) => String(seller.id) === String(purchaseSellerId)) || null;
  const adminStockMemoSummaries = buildPurchaseMemoSummaries(adminStockEntries);
  const nextAdminStockMemoNumber = adminStockMemoSummaries.length > 0
    ? Math.max(...adminStockMemoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const adminStockMemoOptions = [
    {
      key: `new-stock-${nextAdminStockMemoNumber}`,
      memoNumber: nextAdminStockMemoNumber,
      isNew: true,
      label: String(nextAdminStockMemoNumber),
      drawDate: adminStockBookingDate,
      quantity: ''
    },
    ...adminStockMemoSummaries.map((memo) => ({
      key: `stock-memo-${memo.memoNumber}`,
      memoNumber: memo.memoNumber,
      isNew: false,
      label: String(memo.memoNumber),
      drawDate: memo.drawDate,
      quantity: memo.totalPieceCount,
      totalPieceCount: memo.totalPieceCount,
      batches: memo.batches
    }))
  ];
  const selectedAdminStockMemoOption = adminStockMemoOptions.find((option) => (
    Number(option.memoNumber) === Number(adminStockMemoNumber)
  )) || adminStockMemoOptions[0] || null;
  const isEditingExistingAdminStockMemo = adminStockMemoSummaries.some((memo) => Number(memo.memoNumber) === Number(adminStockMemoNumber));
  const highlightedAdminStockMemoOption = adminStockMemoOptions[adminStockMemoSelectionIndex] || selectedAdminStockMemoOption || null;
  const purchaseMemoSummaries = buildPurchaseMemoSummaries([...purchaseEntries, ...unsoldPurchaseEntries]);
  const nextPurchaseMemoNumber = purchaseMemoSummaries.length > 0
    ? Math.max(...purchaseMemoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const purchaseMemoOptions = [
    {
      key: `new-${nextPurchaseMemoNumber}`,
      memoNumber: nextPurchaseMemoNumber,
      isNew: true,
      label: String(nextPurchaseMemoNumber),
      drawDate: purchaseBookingDate,
      quantity: ''
    },
    ...purchaseMemoSummaries.map((memo) => ({
      key: `memo-${memo.memoNumber}`,
      memoNumber: memo.memoNumber,
      isNew: false,
      label: String(memo.memoNumber),
      drawDate: memo.drawDate,
      quantity: memo.totalPieceCount,
      totalPieceCount: memo.totalPieceCount,
      batches: memo.batches
    }))
  ];
  const selectedPurchaseMemoOption = purchaseMemoOptions.find((option) => (
    !option.isNew && Number(option.memoNumber) === Number(purchaseMemoNumber)
  )) || purchaseMemoOptions[0] || null;
  const isEditingExistingPurchaseMemo = purchaseMemoSummaries.some((memo) => Number(memo.memoNumber) === Number(purchaseMemoNumber));
  const highlightedPurchaseMemoOption = purchaseMemoOptions[purchaseMemoSelectionIndex] || selectedPurchaseMemoOption || null;
  const adminUnsoldMemoSummaries = buildCurrentMemoSummaries(unsoldPurchaseEntries);
  const nextAdminUnsoldMemoNumber = adminUnsoldMemoSummaries.length > 0
    ? Math.max(...adminUnsoldMemoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const adminUnsoldMemoOptions = [
    {
      key: `admin-unsold-new-${nextAdminUnsoldMemoNumber}`,
      memoNumber: nextAdminUnsoldMemoNumber,
      isNew: true,
      label: String(nextAdminUnsoldMemoNumber),
      drawDate: purchaseBookingDate,
      quantity: ''
    },
    ...adminUnsoldMemoSummaries.map((memo) => ({
      key: `admin-unsold-memo-${memo.memoNumber}`,
      memoNumber: memo.memoNumber,
      isNew: false,
      label: String(memo.memoNumber),
      drawDate: memo.drawDate,
      quantity: memo.totalPieceCount,
      totalPieceCount: memo.totalPieceCount,
      batches: memo.batches
    }))
  ];
  const selectedAdminUnsoldMemoOption = adminUnsoldMemoOptions.find((option) => (
    !option.isNew && Number(option.memoNumber) === Number(purchaseMemoNumber)
  )) || adminUnsoldMemoOptions[0] || null;
  const adminUnsoldRemoveMemoSummaries = buildCurrentMemoSummaries(adminUnsoldRemoveMemoEntries);
  const nextAdminUnsoldRemoveMemoNumber = adminUnsoldRemoveMemoSummaries.length > 0
    ? Math.max(...adminUnsoldRemoveMemoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const adminUnsoldRemoveMemoOptions = [
    {
      key: `admin-unsold-remove-new-${nextAdminUnsoldRemoveMemoNumber}`,
      memoNumber: nextAdminUnsoldRemoveMemoNumber,
      isNew: true,
      label: String(nextAdminUnsoldRemoveMemoNumber),
      drawDate: purchaseBookingDate,
      quantity: ''
    },
    ...adminUnsoldRemoveMemoSummaries.map((memo) => ({
      key: `admin-unsold-remove-memo-${memo.memoNumber}`,
      memoNumber: memo.memoNumber,
      isNew: false,
      label: String(memo.memoNumber),
      drawDate: memo.drawDate,
      quantity: memo.totalPieceCount,
      totalPieceCount: memo.totalPieceCount,
      batches: memo.batches
    }))
  ];
  const selectedAdminUnsoldRemoveMemoOption = adminUnsoldRemoveMemoOptions.find((option) => (
    !option.isNew && Number(option.memoNumber) === Number(purchaseRemoveMemoNumber)
  )) || adminUnsoldRemoveMemoOptions.find((option) => Number(option.memoNumber) === Number(purchaseRemoveMemoNumber)) || adminUnsoldRemoveMemoOptions[0] || null;
  const defaultAdminUnsoldMemoOption = selectedAdminUnsoldMemoOption
    || adminUnsoldMemoOptions.find((option) => !option.isNew)
    || adminUnsoldMemoOptions[0]
    || null;
  const defaultAdminUnsoldRemoveMemoOption = selectedAdminUnsoldRemoveMemoOption
    || adminUnsoldRemoveMemoOptions[0]
    || null;
  const currentAdminUnsoldMemoOptions = activeTab === 'unsold-remove'
    ? adminUnsoldRemoveMemoOptions
    : adminUnsoldMemoOptions;
  const currentAdminUnsoldMemoNumber = activeTab === 'unsold-remove' ? purchaseRemoveMemoNumber : purchaseMemoNumber;
  const highlightedAdminUnsoldMemoOption = currentAdminUnsoldMemoOptions[purchaseMemoSelectionIndex]
    || (activeTab === 'unsold-remove' ? selectedAdminUnsoldRemoveMemoOption : selectedAdminUnsoldMemoOption)
    || null;
  const allSellerNodes = flattenSellerNodes(treeData);
  const filteredBillPrizeResults = billPrizeResults.filter((record) => {
    const amountMatches = historyAmountFilter
      ? String(record.amount || '') === String(historyAmountFilter)
      : true;
    const categoryMatches = historyPurchaseCategoryFilter
      ? String(record.purchaseCategory || (record.sessionMode === 'NIGHT' ? 'E' : 'M')).trim().toUpperCase() === String(historyPurchaseCategoryFilter).trim().toUpperCase()
      : true;

    return amountMatches && categoryMatches;
  });
  const adminCurrentBillRows = purchaseBillRows.filter((record) => (
    !historySellerFilter || record.billRootUsername === historySellerFilter || record.sellerName === historySellerFilter
  ));
  const billData = buildBillData({
    records: [],
    prizeRecords: filteredBillPrizeResults,
    treeData,
    selectedSellerUsername: historySellerFilter
  });
  const billTransferHistory = adminCurrentBillRows;
  const transferHistoryByActor = groupTransferHistoryByActor(transferHistory);
  const adminBillVisibleGroups = adminCurrentBillRows.reduce((groups, record) => {
    const groupName = record.billRootUsername || record.sellerName || 'Unknown Seller';
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(record);
    return groups;
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
    totals.totalSentPiece += summary.totalSentPiece;
    totals.totalUnsoldPiece += summary.totalUnsoldPiece;
    totals.totalSoldPiece += summary.totalSoldPiece;
    totals.totalPiece += summary.totalPiece;
    totals.totalSales += summary.totalSales;
    totals.totalPrize += summary.totalPrize;
    totals.totalVc += summary.totalVc;
    totals.totalSvc += summary.totalSvc;
    totals.netBill += summary.netBill;
    return totals;
  }, {
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
  const adminVisibleSellerSummaryRows = Object.entries(adminVisibleGroupedSummaries)
    .map(([billSellerName, summary]) => ({
      sellerName: billSellerName,
      ...summary
    }))
    .sort((left, right) => String(left.sellerName || '').localeCompare(String(right.sellerName || '')));
  useEffect(() => {
    if (adminStockMemoOptions.length === 0) {
      setAdminStockMemoSelectionIndex(0);
      if (adminStockMemoNumber !== null) {
        setAdminStockMemoNumber(null);
      }
      return;
    }

    const existingMemoOption = adminStockMemoOptions.find((option) => (
      Number(option.memoNumber) === Number(adminStockMemoNumber)
    ));

    setAdminStockMemoSelectionIndex((currentIndex) => {
      if (adminStockMemoPopupOpen && currentIndex < adminStockMemoOptions.length) {
        return currentIndex;
      }

      const selectedIndex = adminStockMemoOptions.findIndex((option) => option.key === (existingMemoOption || adminStockMemoOptions[0]).key);
      return Math.max(selectedIndex, 0);
    });
  }, [adminStockMemoOptions, adminStockMemoNumber, adminStockMemoPopupOpen]);

  useEffect(() => {
    if (activeTab !== 'unsold' || purchaseMemoNumber !== null || purchaseMemoPopupOpen) {
      return;
    }

    const latestExistingMemoOption = [...adminUnsoldMemoOptions].reverse().find((option) => !option.isNew);
    if (latestExistingMemoOption) {
      setPurchaseMemoNumber(latestExistingMemoOption.memoNumber);
      return;
    }

    const nextNewMemoOption = adminUnsoldMemoOptions[0];
    if (nextNewMemoOption) {
      setPurchaseMemoNumber(nextNewMemoOption.memoNumber);
    }
  }, [activeTab, purchaseMemoNumber, adminUnsoldMemoOptions, purchaseMemoPopupOpen]);

  useEffect(() => {
    if (activeTab !== 'unsold-remove' || purchaseRemoveMemoNumber !== null || purchaseMemoPopupOpen) {
      return;
    }

    const nextNewMemoOption = adminUnsoldRemoveMemoOptions[0];
    if (nextNewMemoOption) {
      setPurchaseRemoveMemoNumber(nextNewMemoOption.memoNumber);
    }
  }, [activeTab, purchaseRemoveMemoNumber, adminUnsoldRemoveMemoOptions, purchaseMemoPopupOpen]);

  useEffect(() => {
    const currentMemoOptions = (activeTab === 'unsold' || activeTab === 'unsold-remove')
      ? currentAdminUnsoldMemoOptions
      : purchaseMemoOptions;

    if (currentMemoOptions.length === 0) {
      setPurchaseMemoSelectionIndex(0);
      if (purchaseMemoNumber !== null || purchaseRemoveMemoNumber !== null) {
        setPurchaseMemoNumber(null);
        setPurchaseRemoveMemoNumber(null);
      }
      return;
    }

    const existingMemoOption = currentMemoOptions.find((option) => (
      Number(option.memoNumber) === Number(
        activeTab === 'unsold-remove' ? purchaseRemoveMemoNumber : purchaseMemoNumber
      )
    ));

    setPurchaseMemoSelectionIndex((currentIndex) => {
      if (purchaseMemoPopupOpen && currentIndex < currentMemoOptions.length) {
        return currentIndex;
      }

      const selectedIndex = currentMemoOptions.findIndex((option) => option.key === (existingMemoOption || currentMemoOptions[0]).key);
      return Math.max(selectedIndex, 0);
    });
  }, [activeTab, purchaseMemoOptions, currentAdminUnsoldMemoOptions, purchaseMemoNumber, purchaseRemoveMemoNumber, purchaseMemoPopupOpen]);
  const summaryTotals = summarizeTransferHistory(summaryEntries.map((entry) => ({
    boxValue: entry.sem,
    amount: entry.amount
  })));
  const summaryAmount6Entries = summaryEntries.filter((entry) => entry.amount === '7');
  const summaryAmount12Entries = summaryEntries.filter((entry) => entry.amount === '12');
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
      numbers: sortPrizeNumbersAscending((uploadedPrizeResultsByKey[prize.key] || []).map((entry) => entry.winningNumber))
    }))
    .filter((prize) => prize.numbers.length > 0);
  const isCurrentUploadDate = uploadResultDate === currentIndiaDateTime.date;
  const isFutureUploadDate = uploadResultDate > currentIndiaDateTime.date;
  const isMorningUploadAllowed = !isCurrentUploadDate || currentIndiaDateTime.hour >= 13;
  const isDayUploadAllowed = !isCurrentUploadDate || currentIndiaDateTime.hour >= 18;
  const isEveningUploadAllowed = !isCurrentUploadDate || currentIndiaDateTime.hour >= 20;
  const isSelectedUploadSessionAllowed = !isFutureUploadDate && (
    uploadResultShift === 'MORNING'
      ? isMorningUploadAllowed
      : uploadResultShift === 'DAY'
        ? isDayUploadAllowed
        : isEveningUploadAllowed
  );
  const uploadTimingMessage = getUploadTimingMessage(uploadResultDate, uploadResultShift, currentIndiaDateTime.date);
  const historyPeriodLabel = historyFromDate === historyToDate
    ? formatDisplayDate(historyFromDate)
    : `${formatDisplayDate(historyFromDate)} to ${formatDisplayDate(historyToDate)}`;
  const adminPurchaseTimestamp = new Date(`${currentIndiaDateTime.date}T${String(currentIndiaDateTime.hour).padStart(2, '0')}:${String(currentIndiaDateTime.minute).padStart(2, '0')}:${String(currentIndiaDateTime.second).padStart(2, '0')}`)
    .toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
    .replace(',', '');
  const adminStockVisibleQuantity = adminStockDraftRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const adminStockVisibleAmount = adminStockDraftRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const adminStockGridRows = createRetroGridRows(adminStockDraftRows);
  const adminStockMetrics = getRetroRangeMetrics(
    adminStockCodeInput,
    adminStockSessionMode,
    adminStockFromInput,
    adminStockToInput,
    adminStockPurchaseCategory
  );
  const adminStockEditableRow = (
    <tr key="admin-stock-entry">
      <td>{adminStockActiveRowIndex + 1}</td>
      <td>
        <input
          ref={adminStockCodeInputRef}
          type="text"
          value={adminStockCodeInput}
          onChange={(e) => setAdminStockCodeInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              moveAdminStockDraftSelection(-1);
              window.requestAnimationFrame(() => {
                adminStockCodeInputRef.current?.focus();
                adminStockCodeInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              moveAdminStockDraftSelection(1);
              window.requestAnimationFrame(() => {
                adminStockCodeInputRef.current?.focus();
                adminStockCodeInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => adminStockFromInputRef.current?.focus());
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              const codeCategoryError = getCodeCategoryValidationError(adminStockCodeInput, adminStockPurchaseCategory, adminStockAmount);
              if (codeCategoryError) {
                setAdminStockCodeInput('');
                openBlockingWarning(
                  codeCategoryError,
                  [
                    `Selected Company: ${entryCompanyLabel || `${getPurchaseCategoryLabel(adminStockPurchaseCategory)} BEST ${adminStockAmount}`}`,
                    `Allowed Prefix: ${adminStockPurchaseCategory}`
                  ],
                  'Invalid Company Code'
                );
                return;
              }
              const parsed = parseRetroCodeValue(e.currentTarget.value, adminStockSessionMode, adminStockPurchaseCategory);
              if (parsed.error) {
                setError(parsed.error);
                return;
              }
              setAdminStockPurchaseCategory(parsed.resolvedPurchaseCategory || adminStockPurchaseCategory);
              setAdminStockCodeInput(buildRetroTicketCode(parsed.resolvedSessionMode, parsed.semValue, parsed.resolvedPurchaseCategory));
              setError('');
              window.requestAnimationFrame(() => adminStockFromInputRef.current?.focus());
            }
          }}
          placeholder="M5 / D5 / E5 / 5"
        />
      </td>
      <td>{entryCompanyLabel || 'ADMIN'}</td>
      <td>{adminStockBookingDate}</td>
      <td>{getDisplayDay(adminStockBookingDate)}</td>
      <td>
        <input
          ref={adminStockFromInputRef}
          type="text"
          value={adminStockFromInput}
          onChange={(e) => {
            const normalized = normalizeNumericInput(e.target.value);
            setAdminStockFromInput(normalized);
            if (normalized.length === 5) {
              setAdminStockToInput(normalized);
              window.requestAnimationFrame(() => {
                adminStockToInputRef.current?.focus();
                adminStockToInputRef.current?.select?.();
              });
            }
          }}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              moveAdminStockDraftSelection(-1);
              window.requestAnimationFrame(() => {
                adminStockFromInputRef.current?.focus();
                adminStockFromInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              moveAdminStockDraftSelection(1);
              window.requestAnimationFrame(() => {
                adminStockFromInputRef.current?.focus();
                adminStockFromInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => adminStockCodeInputRef.current?.focus());
              return;
            }

            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                adminStockToInputRef.current?.focus();
                adminStockToInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              const normalized = normalizeNumericInput(adminStockFromInput);
              if (!normalized || normalized.length < 5) {
                setError('From number minimum 5 digit hona chahiye');
                return;
              }
              setAdminStockFromInput(normalized);
              setAdminStockToInput(normalized);
              window.requestAnimationFrame(() => {
                adminStockToInputRef.current?.focus();
                adminStockToInputRef.current?.select?.();
              });
            }
          }}
          placeholder="521000"
        />
      </td>
      <td>
        <input
          ref={adminStockToInputRef}
          className={adminStockToInput && adminStockToInput === adminStockFromInput ? 'retro-grid-autofill' : ''}
          type="text"
          value={adminStockToInput}
          onChange={(e) => setAdminStockToInput(normalizeNumericInput(e.target.value))}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              moveAdminStockDraftSelection(-1);
              window.requestAnimationFrame(() => {
                adminStockToInputRef.current?.focus();
                adminStockToInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              moveAdminStockDraftSelection(1);
              window.requestAnimationFrame(() => {
                adminStockToInputRef.current?.focus();
                adminStockToInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                adminStockFromInputRef.current?.focus();
                adminStockFromInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              commitAdminStockDraftRow();
            }
          }}
          placeholder="521000"
        />
      </td>
      <td>{adminStockMetrics.parsed.error || adminStockMetrics.error || !adminStockMetrics.parsed.semValue || !adminStockMetrics.fromNumber ? '' : adminStockMetrics.quantity}</td>
      <td>{Number(adminStockAmount || 0).toFixed(2)}</td>
      <td>{adminStockMetrics.parsed.error || adminStockMetrics.error || !adminStockMetrics.parsed.semValue || !adminStockMetrics.fromNumber ? '' : (adminStockMetrics.quantity * Number(adminStockAmount || 0)).toFixed(2)}</td>
    </tr>
  );
  const adminStockFormRows = [
    {
      label: 'Date',
      className: 'medium',
      content: (
        <input
          ref={adminStockDateInputRef}
          type="date"
          value={adminStockBookingDate}
          onChange={(e) => {
            setAdminStockBookingDate(e.target.value);
            setAdminStockMemoPopupOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              window.requestAnimationFrame(() => adminStockMemoRef.current?.focus());
            }
          }}
          form="admin-stock-form"
        />
      )
    }
  ];
  const adminStockActions = [
    {
      label: 'Add (A)',
      shortcut: 'A',
      disabled: Boolean(blockingWarning),
      onClick: startNewAdminStockRow
    },
    {
      label: adminStockLoading ? 'Saving...' : 'Save (F2)',
      shortcut: 'F2',
      variant: 'primary',
      disabled: adminStockLoading || Boolean(blockingWarning),
      onClick: () => requestSaveConfirmation(saveAdminStockDraftRows)
    },
    {
      label: 'Delete (F3)',
      shortcut: 'F3',
      disabled: Boolean(blockingWarning),
      onClick: deleteAdminStockDraftRow
    },
    {
      label: 'Clear (F8)',
      shortcut: 'F8',
      disabled: Boolean(blockingWarning),
      onClick: () => {
        clearAdminPurchaseForm();
        resetAdminStockEntryInputs();
        setAdminStockDraftRows([]);
        setAdminStockActiveRowIndex(0);
        setAdminStockEditorVisible(true);
      }
    },
    {
      label: 'Exit (Esc)',
      shortcut: 'ESC',
      variant: 'secondary',
      disabled: Boolean(blockingWarning),
      onClick: requestExitConfirmation
    }
  ];
  const activePurchaseSendRows = purchaseDraftRows;
  const adminSendVisibleQuantity = activePurchaseSendRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const adminSendVisibleAmount = activePurchaseSendRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const adminPurchaseGridRows = createRetroGridRows(activePurchaseSendRows, { drawDate: purchaseBookingDate });
  const selectedAdminSendSeller = activeAmountAdminSellers.find((seller) => String(seller.id) === String(purchaseSellerId));
  const purchaseMetrics = getRetroRangeMetrics(
    purchaseCodeInput,
    purchaseSessionMode,
    purchaseFromInput,
    purchaseToInput,
    purchaseCategory
  );
  const adminPurchaseSendDateEditable = activeTab === 'purchase-send';
  const adminPurchaseEditableRow = (
    <tr key="admin-send-entry">
      <td>{purchaseActiveRowIndex + 1}</td>
      <td>
        <input
          ref={adminSendCodeInputRef}
          type="text"
          value={purchaseCodeInput}
          onChange={(e) => setPurchaseCodeInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              movePurchaseDraftSelection(-1);
              window.requestAnimationFrame(() => {
                adminSendCodeInputRef.current?.focus();
                adminSendCodeInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              movePurchaseDraftSelection(1);
              window.requestAnimationFrame(() => {
                adminSendCodeInputRef.current?.focus();
                adminSendCodeInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              e.stopPropagation();
              const rawCode = String(e.currentTarget.value || '').trim();
              if (!rawCode) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
                });
                return;
              }
              const parsed = parseRetroCodeValue(rawCode, purchaseSessionMode, purchaseCategory);
              if (parsed.error) {
                openBlockingWarning(parsed.error, [], 'Warning', () => {
                  setPurchaseCodeInput('');
                  window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
                });
                return;
              }
              if (activeTab === 'purchase-send') {
                setPurchaseCategory(parsed.resolvedPurchaseCategory || purchaseCategory);
              }
              setPurchaseCodeInput(buildRetroTicketCode(parsed.resolvedSessionMode, parsed.semValue, parsed.resolvedPurchaseCategory));
              setError('');
              window.requestAnimationFrame(() => (
                adminPurchaseSendDateEditable
                  ? adminSendDrawDateInputRef.current?.focus()
                  : adminSendFromInputRef.current?.focus()
              ));
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              const rawCode = String(e.currentTarget.value || '').trim();
              if (!rawCode) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
                });
                return;
              }
              const parsed = parseRetroCodeValue(rawCode, purchaseSessionMode, purchaseCategory);
              if (parsed.error) {
                openBlockingWarning(parsed.error, [], 'Warning', () => {
                  setPurchaseCodeInput('');
                  window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
                });
                return;
              }
              if (activeTab === 'purchase-send') {
                setPurchaseCategory(parsed.resolvedPurchaseCategory || purchaseCategory);
              }
              setPurchaseCodeInput(buildRetroTicketCode(parsed.resolvedSessionMode, parsed.semValue, parsed.resolvedPurchaseCategory));
              setError('');
              window.requestAnimationFrame(() => (
                adminPurchaseSendDateEditable
                  ? adminSendDrawDateInputRef.current?.focus()
                  : adminSendFromInputRef.current?.focus()
              ));
            }
          }}
          placeholder="M5 / D5 / E5 / 5"
        />
      </td>
      <td>{String(selectedAdminSendSeller?.username || '').toUpperCase()}</td>
      <td>
        {adminPurchaseSendDateEditable ? (
          <input
            ref={adminSendDrawDateInputRef}
            type="date"
            value={purchaseBookingDate}
            onChange={(e) => {
              setPurchaseBookingDate(e.target.value);
              setPurchaseMemoPopupOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                window.requestAnimationFrame(() => {
                  adminSendCodeInputRef.current?.focus();
                  adminSendCodeInputRef.current?.select?.();
                });
                return;
              }

              if (e.key === 'ArrowRight' || e.key === 'Enter') {
                e.preventDefault();
                window.requestAnimationFrame(() => {
                  adminSendFromInputRef.current?.focus();
                  adminSendFromInputRef.current?.select?.();
                });
              }
            }}
          />
        ) : purchaseBookingDate}
      </td>
      <td>{getDisplayDay(purchaseBookingDate)}</td>
      <td>
        <input
          ref={adminSendFromInputRef}
          type="text"
          maxLength={5}
          value={purchaseFromInput}
          onChange={(e) => {
            const normalized = normalizeNumericInput(e.target.value);
            setPurchaseFromInput(normalized);
            if (normalized.length === 5) {
              setPurchaseToInput(normalized);
              window.requestAnimationFrame(() => {
                adminSendToInputRef.current?.focus();
                adminSendToInputRef.current?.select?.();
              });
            }
          }}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              movePurchaseDraftSelection(-1);
              window.requestAnimationFrame(() => {
                adminSendFromInputRef.current?.focus();
                adminSendFromInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              movePurchaseDraftSelection(1);
              window.requestAnimationFrame(() => {
                adminSendFromInputRef.current?.focus();
                adminSendFromInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                if (adminPurchaseSendDateEditable) {
                  adminSendDrawDateInputRef.current?.focus();
                } else {
                  adminSendCodeInputRef.current?.focus();
                  adminSendCodeInputRef.current?.select?.();
                }
              });
              return;
            }

            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                adminSendToInputRef.current?.focus();
                adminSendToInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              if (!String(purchaseCodeInput || '').trim()) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
                });
                return;
              }
              const previousRow = purchaseDraftRows[Math.min(purchaseActiveRowIndex, purchaseDraftRows.length) - 1] || null;
              const normalized = activeTab === 'unsold' || activeTab === 'unsold-remove'
                ? normalizeRangeStartInput(purchaseFromInput, previousRow?.from)
                : normalizeNumericInput(purchaseFromInput);
              if (!normalized || normalized.length < 5) {
                openBlockingWarning('From is empty ya 5 digit nahi hai', [], 'Warning', () => {
                  window.requestAnimationFrame(() => adminSendFromInputRef.current?.focus());
                });
                return;
              }
              setPurchaseFromInput(normalized);
              setPurchaseToInput(normalized);
              window.requestAnimationFrame(() => {
                adminSendToInputRef.current?.focus();
                adminSendToInputRef.current?.select?.();
              });
            }
          }}
          placeholder="00000"
        />
      </td>
      <td>
        <input
          ref={adminSendToInputRef}
          className={purchaseToInput && purchaseToInput === purchaseFromInput ? 'retro-grid-autofill' : ''}
          type="text"
          maxLength={5}
          value={purchaseToInput}
          onChange={(e) => setPurchaseToInput(normalizeNumericInput(e.target.value))}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              movePurchaseDraftSelection(-1);
              window.requestAnimationFrame(() => {
                adminSendToInputRef.current?.focus();
                adminSendToInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              movePurchaseDraftSelection(1);
              window.requestAnimationFrame(() => {
                adminSendToInputRef.current?.focus();
                adminSendToInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                adminSendFromInputRef.current?.focus();
                adminSendFromInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              void (async () => {
                if (!String(purchaseCodeInput || '').trim()) {
                  openBlockingWarning('Code is empty', [], 'Warning', () => {
                    window.requestAnimationFrame(() => adminSendCodeInputRef.current?.focus());
                  });
                  return;
                }
                if (!String(purchaseFromInput || '').trim()) {
                  openBlockingWarning('From is empty', [], 'Warning', () => {
                    window.requestAnimationFrame(() => adminSendFromInputRef.current?.focus());
                  });
                  return;
                }
                if (!String(purchaseToInput || '').trim()) {
                  openBlockingWarning('To is empty', [], 'Warning', () => {
                    window.requestAnimationFrame(() => adminSendToInputRef.current?.focus());
                  });
                  return;
                }
                if (purchaseMetrics.error) {
                  openBlockingWarning(purchaseMetrics.error, [], 'Warning', () => {
                    window.requestAnimationFrame(() => adminSendToInputRef.current?.focus());
                  });
                  return;
                }

                if (activeTab === 'purchase-send') {
                  await commitPurchaseSendDraftRow();
                  return;
                }

                await handleAdminUnsoldAddAction();
              })();
            }
          }}
          placeholder="99999"
        />
      </td>
      <td>{purchaseMetrics.parsed.error || purchaseMetrics.error || !purchaseMetrics.parsed.semValue || !purchaseMetrics.fromNumber ? '' : purchaseMetrics.quantity}</td>
      <td>{Number(purchaseAmount || 0).toFixed(2)}</td>
      <td>{purchaseMetrics.parsed.error || purchaseMetrics.error || !purchaseMetrics.parsed.semValue || !purchaseMetrics.fromNumber ? '' : (purchaseMetrics.quantity * Number(purchaseAmount || 0)).toFixed(2)}</td>
    </tr>
  );
  const adminPurchaseFormRows = [
    {
      label: 'Seller Name',
      className: 'wide',
      content: (
        <SearchableSellerSelect
          inputRef={adminSendSellerSelectRef}
          value={purchaseSellerId}
          options={activeAmountAdminSellers}
          required
          form="admin-purchase-form"
          getOptionLabel={(seller) => `${seller.username} [${getSellerKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
          getOptionSearchLabel={(seller) => `${getSellerKeyword(seller)} ${seller.username} ${getAllowedAmountsLabel(seller)}`}
          onChange={(seller) => {
            setPurchaseSellerId(String(seller?.id || ''));
            setPurchaseMemoNumber(null);
            setPurchaseRemoveMemoNumber(null);
            setPurchaseMemoSelectionIndex(0);
            setPurchaseMemoPopupOpen(false);
          }}
          onEnter={(seller) => {
            if (seller) {
              window.requestAnimationFrame(() => adminSendDateInputRef.current?.focus());
            }
          }}
          placeholder="Keyword ya seller name type karo"
        />
      )
    },
    {
      label: 'Date',
      className: 'medium',
      content: (
        <input
          ref={adminSendDateInputRef}
          type="date"
          value={purchaseBookingDate}
          onChange={(event) => {
            const nextDate = event.target.value || getTodayDateValue();
            setPurchaseBookingDate(nextDate);
            setPurchaseMemoNumber(null);
            setPurchaseRemoveMemoNumber(null);
            setPurchaseMemoSelectionIndex(0);
            setPurchaseMemoPopupOpen(false);
            setPurchaseDraftRows([]);
            setPurchaseActiveRowIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              window.requestAnimationFrame(() => adminSendMemoRef.current?.focus());
            }
          }}
          form="admin-purchase-form"
        />
      )
    }
  ];
  const adminUnsoldFormRows = [
    {
      label: 'Seller Name',
      className: 'wide',
      content: (
        <SearchableSellerSelect
          inputRef={adminSendSellerSelectRef}
          value={purchaseSellerId}
          options={activeAmountAdminSellers}
          required
          getOptionLabel={(seller) => `${seller.username} [${getSellerKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
          getOptionSearchLabel={(seller) => `${getSellerKeyword(seller)} ${seller.username} ${getAllowedAmountsLabel(seller)}`}
          onChange={(seller) => {
            setPurchaseSellerId(String(seller?.id || ''));
            setPurchaseMemoPopupOpen(false);
          }}
          onEnter={(seller) => {
            if (seller) {
              window.requestAnimationFrame(() => adminUnsoldDateInputRef.current?.focus());
            }
          }}
          placeholder="Keyword ya seller name type karo"
        />
      )
    },
    {
      label: 'Date',
      className: 'medium',
      content: (
        <input
          ref={adminUnsoldDateInputRef}
          type="date"
          value={purchaseBookingDate}
          onChange={(e) => setPurchaseBookingDate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              window.requestAnimationFrame(() => {
                if (activeTab === 'unsold-remove') {
                  adminSendCodeInputRef.current?.focus();
                  adminSendCodeInputRef.current?.select?.();
                  return;
                }

                adminSendMemoRef.current?.focus();
              });
            }
          }}
        />
      )
    }
  ];
  const adminPurchaseActions = [
    {
      label: 'Add (A)',
      shortcut: 'A',
      disabled: Boolean(blockingWarning),
      onClick: () => {
        void handleAdminPurchaseSendAddAction();
      }
    },
    {
      label: purchaseLoading ? 'Saving...' : 'Save (F2)',
      shortcut: 'F2',
      variant: 'primary',
      disabled: purchaseLoading || Boolean(blockingWarning),
      onClick: () => requestSaveConfirmation(savePurchaseSendDraftRows)
    },
    {
      label: 'Delete (F3)',
      shortcut: 'F3',
      disabled: Boolean(blockingWarning),
      onClick: deletePurchaseDraftRow
    },
    {
      label: 'Clear (F8)',
      shortcut: 'F8',
      disabled: Boolean(blockingWarning),
      onClick: () => {
        clearPurchaseSendForm();
        resetPurchaseSendEntryInputs();
        setPurchaseDraftRows([]);
        setPurchaseActiveRowIndex(0);
        setPurchaseEditorVisible(true);
      }
    },
    {
      label: 'Exit (Esc)',
      shortcut: 'ESC',
      variant: 'secondary',
      disabled: Boolean(blockingWarning),
      onClick: requestExitConfirmation
    }
  ];
  const clearAdminUnsoldForm = () => {
    clearPurchaseSendForm();
    resetPurchaseSendEntryInputs();
    setPurchaseDraftRows([]);
    setPurchaseActiveRowIndex(0);
    setPurchaseEditorVisible(true);
  };
  const adminUnsoldActions = [
    {
      label: 'Add (A)',
      shortcut: 'A',
      disabled: Boolean(blockingWarning),
      onClick: () => {
        void handleAdminUnsoldAddAction();
      }
    },
    {
      label: purchaseLoading ? 'Saving...' : 'Save (F2)',
      shortcut: 'F2',
      variant: 'primary',
      disabled: purchaseLoading || Boolean(blockingWarning),
      onClick: () => requestSaveConfirmation(() => saveAdminUnsoldRows('mark'))
    },
    {
      label: 'Delete (F3)',
      shortcut: 'F3',
      disabled: Boolean(blockingWarning),
      onClick: deletePurchaseDraftRow
    },
    {
      label: 'View (F4)',
      shortcut: 'F4',
      disabled: Boolean(blockingWarning),
      onClick: () => {
        void openAdminUnsoldStockLookup();
      }
    },
    {
      label: 'Clear (F8)',
      shortcut: 'F8',
      disabled: Boolean(blockingWarning),
      onClick: clearAdminUnsoldForm
    },
    {
      label: 'Exit (Esc)',
      shortcut: 'ESC',
      variant: 'secondary',
      disabled: Boolean(blockingWarning),
      onClick: requestExitConfirmation
    }
  ];
  const adminUnsoldRemoveActions = adminUnsoldActions.map((action) => (
    action.shortcut === 'F2'
      ? {
          ...action,
          label: purchaseLoading ? 'Removing...' : 'Remove (F2)',
          onClick: () => requestSaveConfirmation(() => saveAdminUnsoldRows('remove'), 'Remove karna hai?')
        }
      : action
  ));

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
        {amount6.length > 0 && renderRecordTable(amount6, '7')}
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
        {amount6.length > 0 && renderTraceTable(amount6, '7')}
        {amount12.length > 0 && renderTraceTable(amount12, '12')}
      </>
    );
  };

  const generateBill = () => {
    setError('');

    if (historyFromDate > historyToDate) {
      setError('From date cannot be after to date');
      return;
    }

    if (purchaseBillRows.length === 0) {
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
      shiftLabel: `${historyShift === 'ALL' ? 'ALL' : (historyShift || 'All')} | Amount ${historyAmountFilter || '7'}${historySellerFilter ? ` | Seller: ${historySellerFilter}` : ''}`,
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
      const response = await priceService.getFilteredPrizeResults({
        date: prizeTrackerDate,
        shift: prizeTrackerSessionMode || 'ALL',
        sellerId: prizeTrackerSellerId,
        soldStatus: prizeTrackerSoldStatus || 'ALL'
      });
      setPrizeTrackerResults(response.data?.rows || []);
      setPrizeTrackerTotalPrize(Number(response.data?.totalPrize || 0));
      setPrizeTrackerSearchPerformed(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading prize tracker');
      setPrizeTrackerResults([]);
      setPrizeTrackerTotalPrize(0);
    }
  };

  const seePurchaseSessionConfigs = [
    { key: 'MORNING', label: 'MORNING / DAY SESSION' },
    { key: 'NIGHT', label: 'EVENING SESSION' }
  ];

  const buildSeePurchaseRangeGroups = (rows = [], includeSeller = false) => {
    const sortedRows = sortRowsForConsecutiveNumbers(
      rows,
      (row) => includeSeller
        ? [row.bookingDate, row.sessionMode, row.amount, row.boxValue, row.sellerName, row.memoNumber]
        : [row.bookingDate, row.sessionMode, row.amount, row.boxValue]
    );

    return groupConsecutiveNumberRows(
      sortedRows,
      (row) => includeSeller
        ? [row.bookingDate, row.sessionMode, row.amount, row.boxValue, row.sellerName, row.memoNumber].join('|')
        : [row.bookingDate, row.sessionMode, row.amount, row.boxValue].join('|')
    );
  };

  const seePurchaseSelectedSessionMode = getBillApiShift(seePurchaseShift);
  const seePurchaseSelectedAmount = initialAmount || adminStockAmount;
  const seePurchaseSelectedCategory = getBillPurchaseCategory(seePurchaseShift);
  const seePurchaseTitle = buildCompanyDisplayLabel(
    seePurchaseSelectedSessionMode,
    seePurchaseSelectedCategory,
    seePurchaseSelectedAmount,
    entryCompanyLabel
  );
  const seePurchaseSellerOptions = [
    { id: '', username: '', label: 'All Direct Sellers', keyword: 'ALL', rateAmount6: 0, rateAmount12: 0 },
    ...directAdminSellers.filter((seller) => sellerSupportsAmount(seller, seePurchaseSelectedAmount)).map((seller) => ({
      id: seller.id,
      username: seller.username,
      keyword: seller.keyword || '',
      rateAmount6: seller.rateAmount6 || 0,
      rateAmount12: seller.rateAmount12 || 0
    }))
  ];
  const seePurchaseSelectedSeller = seePurchaseSellerOptions.find((seller) => String(seller.id) === String(seePurchaseSellerFilter)) || null;
  const seePurchaseSelectedSellerLabel = seePurchaseSellerFilter
    ? (seePurchaseSelectedSeller?.username || 'Selected Seller')
    : 'All Direct Sellers';
  const seePurchaseAvailableEntries = seePurchaseStockEntries.filter((entry) => (
    (!seePurchaseSelectedSessionMode || entry.sessionMode === seePurchaseSelectedSessionMode)
    && entry.amount === seePurchaseSelectedAmount
    && (!seePurchaseSelectedCategory || entry.purchaseCategory === seePurchaseSelectedCategory)
  ));
  const seePurchaseAllSentEntries = seePurchaseSentEntries.filter((entry) => (
    (!seePurchaseSelectedSessionMode || entry.sessionMode === seePurchaseSelectedSessionMode)
    && entry.amount === seePurchaseSelectedAmount
    && (!seePurchaseSelectedCategory || entry.purchaseCategory === seePurchaseSelectedCategory)
  ));
  const seePurchaseSentOnlyEntries = seePurchaseAllSentEntries.filter((entry) => (
    !seePurchaseSellerFilter || entry.sellerName === seePurchaseSelectedSeller?.username
  ));
  const seePurchaseTotalEntries = [...seePurchaseAvailableEntries, ...seePurchaseAllSentEntries];
  const seePurchaseTotalGroups = buildSeePurchaseRangeGroups(seePurchaseTotalEntries);
  const seePurchaseAvailableGroups = buildSeePurchaseRangeGroups(seePurchaseAvailableEntries);
  const seePurchaseSentGroups = buildSeePurchaseRangeGroups(seePurchaseSentOnlyEntries, true);
  const seePurchaseSummary = {
    totalCount: seePurchaseTotalEntries.length,
    totalPieces: seePurchaseTotalEntries.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0),
    totalValue: seePurchaseTotalEntries.reduce((sum, entry) => (
      sum + (Number(entry.amount || 0) * Number(entry.boxValue || 0))
    ), 0),
    availableCount: seePurchaseAvailableEntries.length,
    availablePieces: seePurchaseAvailableEntries.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0),
    availableValue: seePurchaseAvailableEntries.reduce((sum, entry) => (
      sum + (Number(entry.amount || 0) * Number(entry.boxValue || 0))
    ), 0),
    sentCount: seePurchaseSentOnlyEntries.length,
    sentPieces: seePurchaseSentOnlyEntries.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0),
    sentValue: seePurchaseSentOnlyEntries.reduce((sum, entry) => (
      sum + (Number(entry.amount || 0) * Number(entry.boxValue || 0))
    ), 0)
  };
  const stockTransferNormalizedEntries = stockTransferEntries.map((entry) => normalizeSeePurchaseEntry(entry, 'stock_transfer'));
  const stockTransferGroups = buildSeePurchaseRangeGroups(stockTransferNormalizedEntries);
  const stockTransferTotalPieces = stockTransferNormalizedEntries.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0);
  const stockTransferTotalAmount = stockTransferNormalizedEntries.reduce((sum, entry) => (
    sum + (Number(entry.amount || 0) * Number(entry.boxValue || 0))
  ), 0);

  const isRetroScreenActive = activeTab === 'purchase' || activeTab === 'purchase-send' || activeTab === 'unsold' || activeTab === 'unsold-remove';
  const adminLauncherItems = [
    { tab: 'upload-price', label: 'Upload Result' },
    { tab: 'tree', label: 'Tree' },
    { tab: 'add-seller', label: 'Add New Seller' },
    { tab: 'purchase-send', label: 'Purchase Send' },
    { tab: 'unsold', label: 'Unsold' },
    { tab: 'unsold-remove', label: 'Unsold Remove' },
    { tab: 'accept-entries', label: 'Accept Entries' },
    { tab: 'today-summary', label: 'Today Summary' },
    { tab: 'generate-bill', label: 'Generate Bill' },
    { tab: 'track-number', label: 'Track Number' },
    { tab: 'prize-tracker', label: 'Prize Tracker' },
    { tab: 'see-purchase', label: 'See Purchase' }
  ];
  const adminLauncherActions = [
    { id: 'piece-summary', label: 'F10 - Unsold Summary' }
  ];

  return (
    <div
      ref={dashboardRef}
      className="admin-dashboard"
      data-enter-navigation-root
      onKeyDown={focusNextOnEnter}
      onFocusCapture={handleDashboardFocusCapture}
    >
      <ExitConfirmPrompt
        open={exitConfirmOpen}
        selected={exitConfirmSelected}
        onSelectedChange={setExitConfirmSelected}
        onConfirm={confirmExitRequest}
        onCancel={cancelExitConfirmation}
      />
      <ExitConfirmPrompt
        open={saveConfirmOpen}
        selected={saveConfirmSelected}
        message={saveConfirmMessage}
        onSelectedChange={setSaveConfirmSelected}
        onConfirm={confirmSaveRequest}
        onCancel={cancelSaveConfirmation}
      />
      {pieceSummaryOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#fff', width: 'min(720px, 100%)', borderRadius: '8px', padding: '20px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ margin: 0 }}>F10 Unsold Summary</h2>
              <button type="button" onClick={closePieceSummary}>Close</button>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'end', gap: '12px', flexWrap: 'wrap' }}>
              <label style={{ display: 'grid', gap: '6px', fontWeight: 700 }}>
                Date
                <input
                  type="date"
                  value={pieceSummaryDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setPieceSummaryDate(nextDate);
                    if (nextDate) {
                      loadPieceSummary(nextDate);
                    }
                  }}
                  style={{ minWidth: '180px' }}
                />
              </label>
            </div>
            {pieceSummaryLoading ? (
              <p>Loading...</p>
            ) : (
              <table className="entries-table" style={{ marginTop: '16px' }}>
                <thead>
                  <tr>
                    <th>Seller Name</th>
                    <th>Total Piece</th>
                    <th>Unsold Piece</th>
                  </tr>
                </thead>
                <tbody>
                  {pieceSummaryRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.sellerName}</td>
                      <td>{Number(row.totalPiece || 0).toFixed(2)}</td>
                      <td>{Number(row.unsoldPiece || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Total</strong></td>
                    <td><strong>{pieceSummaryRows.reduce((sum, row) => sum + Number(row.totalPiece || 0), 0).toFixed(2)}</strong></td>
                    <td><strong>{pieceSummaryRows.reduce((sum, row) => sum + Number(row.unsoldPiece || 0), 0).toFixed(2)}</strong></td>
                  </tr>
                  <tr style={{ color: '#c53030', background: '#fff5f5' }}>
                    <td><strong>STOCK NOT TRANSFERED</strong></td>
                    <td colSpan="2"><strong>{Number(pieceSummaryRows[0]?.stockNotTransferredPiece || 0).toFixed(2)} Piece</strong></td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      {activeTab ? (
        <div className="active-session-titlebar">
          <span>RAHUL</span>
          <strong>{launcherTitle}</strong>
          <span>Press A-Z</span>
        </div>
      ) : null}
      <div className={`dashboard-accordion ${!activeTab ? 'dashboard-launcher-active' : ''}`.trim()}>
        {!activeTab ? (
          <DashboardLauncher
            title={launcherTitle}
            subtitle="A-Z keyboard shortcuts se admin pages kholo"
            items={adminLauncherItems}
            actions={adminLauncherActions}
            onSelect={(item) => handleTabToggle(item.tab)}
            onAction={(item) => {
              if (item.id === 'piece-summary') {
                loadPieceSummary();
              }
            }}
            onExit={requestExitConfirmation}
          />
        ) : null}
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
                  <label>Result Session:</label>
                  <div style={{ marginTop: '10px', padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#f8fbff', fontWeight: 700 }}>
                    {uploadResultShift}
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

                <div
                  className="form-group"
                  style={{ marginBottom: '20px', padding: '16px', border: '1px solid #dbe4ff', borderRadius: '8px', backgroundColor: '#f8faff' }}
                >
                  <label style={{ fontWeight: 700, display: 'block', marginBottom: '8px' }}>
                    Scan Prize Photo/PDF
                  </label>
                  <input
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    onChange={(event) => {
                      setPrizeScanFile(event.target.files?.[0] || null);
                      setPrizeScanProgress('');
                      setPrizeScanRawText('');
                    }}
                  />
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' }}>
                    <button type="button" onClick={handlePrizeFileScan} disabled={prizeScanLoading || !prizeScanFile}>
                      {prizeScanLoading ? 'Scanning...' : 'Scan & Add Numbers'}
                    </button>
                    {prizeScanProgress ? (
                      <span style={{ color: '#2d3748', fontWeight: 600 }}>{prizeScanProgress}</span>
                    ) : null}
                  </div>
                  <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#4a5568' }}>
                    Scan ke baad saare prize numbers niche pending list me aayenge. Upload se pehle har number ko edit ya delete kar sakte ho.
                  </p>
                  {prizeScanRawText ? (
                    <details style={{ marginTop: '10px' }}>
                      <summary>Scanned text dekhna hai</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto', background: '#fff', padding: '10px', borderRadius: '8px' }}>
                        {prizeScanRawText}
                      </pre>
                    </details>
                  ) : null}
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
                      {prize.digitLength} digit result numbers
                    </p>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
                      <input
                        type="text"
                        value={manualPrizeInputs[prize.key] || ''}
                        onChange={(e) => setManualPrizeInputs((current) => ({
                          ...current,
                          [prize.key]: e.target.value.replace(/[^0-9]/g, '').slice(0, prize.digitLength)
                        }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addManualPrizeEntry(prize.key);
                          }
                        }}
                        maxLength={prize.digitLength}
                        placeholder={`${prize.digitLength} digit number`}
                        style={{ width: '170px' }}
                      />
                      <button type="button" onClick={() => addManualPrizeEntry(prize.key)}>
                        Add Manual
                      </button>
                    </div>

                    <div style={{ marginTop: '14px' }}>
                      <strong>Pending Upload ({pendingPrizeEntries[prize.key].length}):</strong>
                      {pendingPrizeEntries[prize.key].length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                          {[...(pendingPrizeEntries[prize.key] || [])]
                            .sort((left, right) => Number(left.winningNumber) - Number(right.winningNumber) || String(left.winningNumber).localeCompare(String(right.winningNumber)))
                            .map((entry) => (
                            editingPendingPrizeId === `${prize.key}:${entry.id}` ? (
                              <div
                                key={entry.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                  padding: '8px 12px',
                                  borderRadius: '12px',
                                  backgroundColor: '#eefbf3',
                                  border: '1px solid #68d391'
                                }}
                              >
                                <input
                                  type="text"
                                  value={editingPendingPrizeValue}
                                  onChange={(e) => setEditingPendingPrizeValue(e.target.value.replace(/[^0-9]/g, '').slice(0, prize.digitLength))}
                                  maxLength={prize.digitLength}
                                  style={{ width: '140px' }}
                                />
                                <button type="button" onClick={() => savePendingPrizeEntryEdit(prize.key, entry)}>
                                  Save
                                </button>
                                <button type="button" onClick={cancelEditingPendingPrizeEntry}>
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
                                  backgroundColor: '#e6f4ea',
                                  color: '#1f5132',
                                  fontWeight: '600'
                                }}
                              >
                                {entry.winningNumber}
                                <button
                                  type="button"
                                  onClick={() => startEditingPendingPrizeEntry(prize.key, entry)}
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
                            )
                          ))}
                        </div>
                      ) : (
                        <p style={{ marginTop: '8px' }}>Abhi koi pending number nahi aaya</p>
                      )}
                    </div>

                    <div style={{ marginTop: '14px' }}>
                      <strong>Uploaded Final ({uploadedPrizeResultsByKey[prize.key]?.length || 0}):</strong>
                      {uploadedPrizeResultsByKey[prize.key]?.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                          {[...(uploadedPrizeResultsByKey[prize.key] || [])]
                            .sort((left, right) => Number(left.winningNumber) - Number(right.winningNumber) || String(left.winningNumber).localeCompare(String(right.winningNumber)))
                            .map((entry) => (
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
                                  disabled={editingUploadedLoading}
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
                                <button
                                  type="button"
                                  onClick={() => deleteUploadedPrizeResult(entry)}
                                  disabled={editingUploadedLoading}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#c53030',
                                    cursor: 'pointer',
                                    fontWeight: '700',
                                    padding: 0
                                  }}
                                >
                                  Delete
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <p style={{ margin: 0, color: '#4a5568' }}>
                      Date: {formatDisplayDate(uploadResultDate)} | Session: {uploadResultShift}
                    </p>
                    {uploadedPrizeResults.length > 0 ? (
                      <button
                        type="button"
                        onClick={deleteAllUploadedPrizeResults}
                        disabled={editingUploadedLoading}
                        style={{ backgroundColor: '#c53030' }}
                      >
                        {editingUploadedLoading ? 'Deleting...' : 'Delete All'}
                      </button>
                    ) : null}
                  </div>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Add New Seller
            </button>
            <div className="accordion-content">
              <AddSellerForm
                currentUser={user}
                selectedAmount={initialAmount}
                onSuccess={handleSellerCreateSuccess}
                onError={setError}
              />
            </div>
          </div>
        )}

        {false && !activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'purchase' ? 'active' : ''}`}
              onClick={() => handleTabToggle('purchase')}
            >
              Purchase
            </button>
          </div>
        )}

        {false && activeTab === 'purchase' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Purchase
            </button>
            <div className="accordion-content">
              <RetroPurchasePanel
                screenCode="RAHUL"
                panelTitle="Purchase"
                screenTitle={entryCompanyLabel || 'ADMIN PURCHASE'}
                headerTimestamp={adminPurchaseTimestamp}
                memoNumber={selectedAdminStockMemoOption ? String(selectedAdminStockMemoOption.memoNumber) : '1'}
                formRows={adminStockFormRows}
                entries={[]}
                gridRows={adminStockGridRows}
                editableRow={adminStockEditorVisible ? adminStockEditableRow : null}
                editableRowIndex={adminStockActiveRowIndex}
                activeGridRowIndex={adminStockEditorVisible && adminStockActiveRowIndex < adminStockDraftRows.length ? adminStockActiveRowIndex : null}
                onGridRowClick={(_, index) => {
                  loadAdminStockDraftIntoEditor(index);
                  window.requestAnimationFrame(() => {
                    adminStockCodeInputRef.current?.focus();
                    adminStockCodeInputRef.current?.select?.();
                  });
                }}
                memoProps={{
                  ref: adminStockMemoRef,
                  tabIndex: 0,
                  onFocus: () => {
                    if (!hasPendingAdminStockEditorValues()) {
                      openAdminStockMemoPopup();
                    }
                  },
                  onClick: () => {
                    if (!adminStockMemoPopupOpen) {
                      openAdminStockMemoPopup();
                    }
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!adminStockMemoPopupOpen) {
                        openAdminStockMemoPopup();
                      }
                      setAdminStockMemoSelectionIndex((currentIndex) => {
                        const delta = e.key === 'ArrowDown' ? 1 : -1;
                        const nextIndex = currentIndex + delta;
                        if (nextIndex < 0) {
                          return 0;
                        }
                        if (nextIndex >= adminStockMemoOptions.length) {
                          return Math.max(adminStockMemoOptions.length - 1, 0);
                        }
                        return nextIndex;
                      });
                      return;
                    }

                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closeAdminStockMemoPopup();
                      return;
                    }

                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!adminStockMemoPopupOpen) {
                        openAdminStockMemoPopup();
                        return;
                      }
                      commitAdminStockMemoSelection();
                    }
                  }
                }}
                memoSelector={{
                  isOpen: adminStockMemoPopupOpen,
                  options: adminStockMemoOptions,
                  activeIndex: adminStockMemoSelectionIndex,
                  variant: 'table',
                  onHighlight: setAdminStockMemoSelectionIndex,
                  onSelect: (option, index) => {
                    setAdminStockMemoSelectionIndex(index);
                    commitAdminStockMemoSelection(option);
                  }
                }}
                topShortcuts={ADMIN_PURCHASE_SHORTCUTS}
                footerActions={adminStockActions}
                summaryQuantity={adminStockVisibleQuantity}
                summaryAmount={adminStockVisibleAmount}
                showStatusField={false}
                windowClassName="full-page"
                blockingWarning={activeTab === 'purchase' ? blockingWarning : null}
                onBlockingWarningClose={clearBlockingWarning}
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'purchase-send' ? 'active' : ''}`}
              onClick={() => handleTabToggle('purchase-send')}
            >
              Purchase Send
            </button>
          </div>
        )}

        {activeTab === 'purchase-send' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Purchase Send
            </button>
            <div className="accordion-content">
              <RetroPurchasePanel
                screenCode="RAHUL"
                panelTitle="Purchase Send"
                screenTitle={entryCompanyLabel || 'ADMIN PURCHASE SEND'}
                headerTimestamp={adminPurchaseTimestamp}
                memoNumber={selectedPurchaseMemoOption ? String(selectedPurchaseMemoOption.memoNumber) : '1'}
                formRows={adminPurchaseFormRows}
                entries={purchaseEntries}
                gridRows={adminPurchaseGridRows}
                editableRow={purchaseEditorVisible ? adminPurchaseEditableRow : null}
                editableRowIndex={purchaseActiveRowIndex}
                activeGridRowIndex={purchaseEditorVisible && purchaseActiveRowIndex < purchaseDraftRows.length ? purchaseActiveRowIndex : null}
                onGridRowClick={(_, index) => {
                  loadPurchaseDraftIntoEditor(index);
                  window.requestAnimationFrame(() => {
                    adminSendCodeInputRef.current?.focus();
                    adminSendCodeInputRef.current?.select?.();
                  });
                }}
                memoProps={{
                  ref: adminSendMemoRef,
                  tabIndex: 0,
                  onFocus: openPurchaseMemoPopup,
                  onClick: () => {
                    if (!purchaseMemoPopupOpen) {
                      openPurchaseMemoPopup();
                    }
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!purchaseMemoPopupOpen) {
                        openPurchaseMemoPopup();
                      }
                      setPurchaseMemoSelectionIndex((currentIndex) => {
                        const delta = e.key === 'ArrowDown' ? 1 : -1;
                        const nextIndex = currentIndex + delta;
                        if (nextIndex < 0) {
                          return 0;
                        }
                        if (nextIndex >= purchaseMemoOptions.length) {
                          return Math.max(purchaseMemoOptions.length - 1, 0);
                        }
                        return nextIndex;
                      });
                      return;
                    }

                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closePurchaseMemoPopup();
                      return;
                    }

                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!purchaseMemoPopupOpen) {
                        openPurchaseMemoPopup();
                        return;
                      }
                      commitPurchaseMemoSelection();
                    }
                  }
                }}
                memoSelector={{
                  isOpen: purchaseMemoPopupOpen,
                  options: purchaseMemoOptions.map((option) => ({
                    ...option,
                    drawDate: formatRetroDisplayDate(purchaseBookingDate)
                  })),
                  activeIndex: purchaseMemoSelectionIndex,
                  variant: 'table',
                  onHighlight: setPurchaseMemoSelectionIndex,
                  onSelect: (option, index) => {
                    setPurchaseMemoSelectionIndex(index);
                    commitPurchaseMemoSelection(option);
                  }
                }}
                topShortcuts={ADMIN_UNSOLD_SHORTCUTS}
                footerActions={adminPurchaseActions}
                summaryQuantity={adminSendVisibleQuantity}
                summaryAmount={adminSendVisibleAmount}
                showStatusField={false}
                windowClassName="full-page"
                blockingWarning={activeTab === 'purchase-send' ? blockingWarning : null}
                onBlockingWarningClose={clearBlockingWarning}
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'unsold' ? 'active' : ''}`}
              onClick={() => handleTabToggle('unsold')}
            >
              Unsold
            </button>
          </div>
        )}

        {activeTab === 'unsold' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Unsold
            </button>
            <div className="accordion-content">
              <RetroPurchasePanel
                screenCode="RAHUL"
                panelTitle="Unsold"
                screenTitle={entryCompanyLabel || 'ADMIN UNSOLD'}
                headerTimestamp={adminPurchaseTimestamp}
                memoNumber={defaultAdminUnsoldMemoOption ? String(defaultAdminUnsoldMemoOption.memoNumber) : '1'}
                formRows={adminUnsoldFormRows}
                entries={[]}
                gridRows={adminPurchaseGridRows}
                editableRow={purchaseEditorVisible ? adminPurchaseEditableRow : null}
                editableRowIndex={purchaseActiveRowIndex}
                activeGridRowIndex={purchaseEditorVisible && purchaseActiveRowIndex < purchaseDraftRows.length ? purchaseActiveRowIndex : null}
                onGridRowClick={(_, index) => {
                  loadPurchaseDraftIntoEditor(index);
                  window.requestAnimationFrame(() => {
                    adminSendCodeInputRef.current?.focus();
                    adminSendCodeInputRef.current?.select?.();
                  });
                }}
                memoProps={{
                  ref: adminSendMemoRef,
                  tabIndex: 0,
                  onFocus: openAdminUnsoldMemoPopup,
                  onClick: () => {
                    if (!purchaseMemoPopupOpen) {
                      openAdminUnsoldMemoPopup();
                    }
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!purchaseMemoPopupOpen) {
                        openAdminUnsoldMemoPopup();
                      }
                      setPurchaseMemoSelectionIndex((currentIndex) => {
                        const delta = e.key === 'ArrowDown' ? 1 : -1;
                        const nextIndex = currentIndex + delta;
                        if (nextIndex < 0) {
                          return 0;
                        }
                        if (nextIndex >= currentAdminUnsoldMemoOptions.length) {
                          return Math.max(currentAdminUnsoldMemoOptions.length - 1, 0);
                        }
                        return nextIndex;
                      });
                      return;
                    }

                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closePurchaseMemoPopup();
                      return;
                    }

                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!purchaseMemoPopupOpen) {
                        openAdminUnsoldMemoPopup();
                        return;
                      }
                      commitAdminUnsoldMemoSelection();
                    }
                  }
                }}
                memoSelector={{
                  isOpen: purchaseMemoPopupOpen,
                  options: currentAdminUnsoldMemoOptions,
                  activeIndex: purchaseMemoSelectionIndex,
                  variant: 'table',
                  onHighlight: setPurchaseMemoSelectionIndex,
                  onSelect: (option, index) => {
                    setPurchaseMemoSelectionIndex(index);
                    commitAdminUnsoldMemoSelection(option);
                  }
                }}
                topShortcuts={ADMIN_UNSOLD_SHORTCUTS}
                footerActions={adminUnsoldActions}
                summaryQuantity={adminSendVisibleQuantity}
                summaryAmount={adminSendVisibleAmount}
                showStatusField={false}
                windowClassName="full-page"
                blockingWarning={activeTab === 'unsold' ? blockingWarning : null}
                onBlockingWarningClose={clearBlockingWarning}
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'unsold-remove' ? 'active' : ''}`}
              onClick={() => handleTabToggle('unsold-remove')}
            >
              Unsold Remove
            </button>
          </div>
        )}

        {activeTab === 'unsold-remove' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Unsold Remove
            </button>
            <div className="accordion-content">
              <RetroPurchasePanel
                screenCode="RAHUL"
                panelTitle="Unsold Remove"
                screenTitle={entryCompanyLabel || 'ADMIN UNSOLD REMOVE'}
                headerTimestamp={adminPurchaseTimestamp}
                memoNumber={defaultAdminUnsoldRemoveMemoOption ? String(defaultAdminUnsoldRemoveMemoOption.memoNumber) : '1'}
                formRows={adminUnsoldFormRows}
                entries={[]}
                gridRows={adminPurchaseGridRows}
                editableRow={purchaseEditorVisible ? adminPurchaseEditableRow : null}
                editableRowIndex={purchaseActiveRowIndex}
                activeGridRowIndex={purchaseEditorVisible && purchaseActiveRowIndex < purchaseDraftRows.length ? purchaseActiveRowIndex : null}
                onGridRowClick={(_, index) => {
                  loadPurchaseDraftIntoEditor(index);
                  window.requestAnimationFrame(() => {
                    adminSendCodeInputRef.current?.focus();
                    adminSendCodeInputRef.current?.select?.();
                  });
                }}
                memoProps={{
                  ref: adminSendMemoRef,
                  tabIndex: 0,
                  onFocus: openAdminUnsoldMemoPopup,
                  onClick: () => {
                    if (!purchaseMemoPopupOpen) {
                      openAdminUnsoldMemoPopup();
                    }
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!purchaseMemoPopupOpen) {
                        openAdminUnsoldMemoPopup();
                      }
                      setPurchaseMemoSelectionIndex((currentIndex) => {
                        const delta = e.key === 'ArrowDown' ? 1 : -1;
                        const nextIndex = currentIndex + delta;
                        if (nextIndex < 0) {
                          return 0;
                        }
                        if (nextIndex >= currentAdminUnsoldMemoOptions.length) {
                          return Math.max(currentAdminUnsoldMemoOptions.length - 1, 0);
                        }
                        return nextIndex;
                      });
                      return;
                    }

                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closePurchaseMemoPopup();
                      return;
                    }

                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!purchaseMemoPopupOpen) {
                        openAdminUnsoldMemoPopup();
                        return;
                      }
                      commitAdminUnsoldMemoSelection();
                    }
                  }
                }}
                memoSelector={{
                  isOpen: purchaseMemoPopupOpen,
                  options: currentAdminUnsoldMemoOptions,
                  activeIndex: purchaseMemoSelectionIndex,
                  variant: 'table',
                  onHighlight: setPurchaseMemoSelectionIndex,
                  onSelect: (option, index) => {
                    setPurchaseMemoSelectionIndex(index);
                    commitAdminUnsoldMemoSelection(option);
                  }
                }}
                topShortcuts={ADMIN_UNSOLD_SHORTCUTS}
                footerActions={adminUnsoldRemoveActions}
                summaryQuantity={adminSendVisibleQuantity}
                summaryAmount={adminSendVisibleAmount}
                showStatusField={false}
                showMemoField={false}
                windowClassName="full-page"
                blockingWarning={activeTab === 'unsold-remove' ? blockingWarning : null}
                onBlockingWarningClose={clearBlockingWarning}
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item">
            <button
              className={`accordion-header ${activeTab === 'see-purchase' ? 'active' : ''}`}
              onClick={() => handleTabToggle('see-purchase')}
            >
              See Purchase
            </button>
          </div>
        )}

        {activeTab === 'see-purchase' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              See Purchase
            </button>
            <div className="accordion-content">
              <h2>{seePurchaseTitle}</h2>
              <p style={{ marginBottom: '14px', color: '#4a5568' }}>
                Yahan sirf {seePurchaseTitle} ka purchase dikh raha hai. Evening, day ya dusre rate ka data yahan show nahi hoga.
              </p>

              <div className="form-group">
                <label>Select Date:</label>
                <input
                  type="date"
                  value={seePurchaseDate}
                  onChange={(e) => setSeePurchaseDate(e.target.value)}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Select Shift:</label>
                <select value={seePurchaseShift} onChange={(e) => setSeePurchaseShift(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="ALL">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="DAY">DAY</option>
                  <option value="EVENING">EVENING</option>
                </select>

                <label style={{ marginTop: '12px', display: 'block' }}>Select Seller:</label>
                <div style={{ marginTop: '8px' }}>
                  <SearchableSellerSelect
                    value={seePurchaseSellerFilter}
                    options={seePurchaseSellerOptions}
                    onChange={(seller) => setSeePurchaseSellerFilter(String(seller?.id || ''))}
                    getOptionValue={(seller) => seller.id}
                    getOptionLabel={(seller) => seller.id === '' ? seller.label : `${seller.username} [${getSellerKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
                    getOptionSearchLabel={(seller) => seller.id === '' ? seller.label : `${getSellerKeyword(seller)} ${seller.username} ${getAllowedAmountsLabel(seller)}`}
                    placeholder="All Direct Sellers ya keyword type karo"
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button type="button" onClick={loadSeePurchaseData} disabled={seePurchaseLoading}>
                    {seePurchaseLoading ? 'Loading...' : 'Refresh Purchase View'}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '20px', padding: '16px', borderRadius: '14px', background: '#f8fbff', border: '1px solid #dbe4ff' }}>
                <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', background: '#eef4ff' }}>
                  <strong>Selected View:</strong> {formatDisplayDate(seePurchaseDate)} | {seePurchaseShift || 'ALL'} | {seePurchaseSelectedSellerLabel} | Amount {seePurchaseSelectedAmount}
                </div>
                <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', background: '#eef4ff' }}>
                  <strong>Total Purchase:</strong> {seePurchaseSummary.totalCount} numbers | Pieces {seePurchaseSummary.totalPieces} | Rs. {seePurchaseSummary.totalValue.toFixed(2)} |{' '}
                  <strong>Seller Ko Diya:</strong> {seePurchaseSummary.sentCount} numbers | Pieces {seePurchaseSummary.sentPieces} | Rs. {seePurchaseSummary.sentValue.toFixed(2)} |{' '}
                  <strong>Balance Stock:</strong> {seePurchaseSummary.availableCount} numbers | Pieces {seePurchaseSummary.availablePieces} | Rs. {seePurchaseSummary.availableValue.toFixed(2)}
                </div>

                {seePurchaseTotalGroups.length > 0 ? (
                  <>
                    <h4 style={{ marginBottom: '8px' }}>Total Purchase Added</h4>
                    <table className="entries-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>SEM</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Total Numbers</th>
                          <th>Total Pieces</th>
                          <th>Total Rs.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seePurchaseTotalGroups.map((group) => (
                          <tr key={`see-total-${group.label}-${group.firstRow?.bookingDate}`}>
                            <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                            <td>{group.firstRow?.boxValue || '-'}</td>
                            <td>{group.firstRow?.number || '-'}</td>
                            <td>{group.lastRow?.number || '-'}</td>
                            <td>{group.rows.length}</td>
                            <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0)}</td>
                            <td>Rs. {group.rows.reduce((sum, row) => (
                              sum + (Number(row.amount || 0) * Number(row.boxValue || 0))
                            ), 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p>No purchase found for {seePurchaseTitle}.</p>
                )}

                {seePurchaseSentGroups.length > 0 ? (
                  <>
                    <h4 style={{ margin: '14px 0 8px' }}>Sent To Seller</h4>
                    <table className="entries-table">
                      <thead>
                        <tr>
                          <th>Seller</th>
                          <th>Memo</th>
                          <th>Date</th>
                          <th>SEM</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Total Numbers</th>
                          <th>Total Pieces</th>
                          <th>Total Rs.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seePurchaseSentGroups.map((group) => (
                          <tr key={`see-sent-${group.label}-${group.firstRow?.sellerName}-${group.firstRow?.memoNumber}`}>
                            <td>{group.firstRow?.sellerName || '-'}</td>
                            <td>{group.firstRow?.memoNumber || '-'}</td>
                            <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                            <td>{group.firstRow?.boxValue || '-'}</td>
                            <td>{group.firstRow?.number || '-'}</td>
                            <td>{group.lastRow?.number || '-'}</td>
                            <td>{group.rows.length}</td>
                            <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0)}</td>
                            <td>Rs. {group.rows.reduce((sum, row) => (
                              sum + (Number(row.amount || 0) * Number(row.boxValue || 0))
                            ), 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}

                {seePurchaseAvailableGroups.length > 0 ? (
                  <>
                    <h4 style={{ margin: '14px 0 8px' }}>Balance Stock</h4>
                    <table className="entries-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>SEM</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Available Numbers</th>
                          <th>Available Pieces</th>
                          <th>Available Rs.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seePurchaseAvailableGroups.map((group) => (
                          <tr key={`see-available-${group.label}-${group.firstRow?.bookingDate}`}>
                            <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                            <td>{group.firstRow?.boxValue || '-'}</td>
                            <td>{group.firstRow?.number || '-'}</td>
                            <td>{group.lastRow?.number || '-'}</td>
                            <td>{group.rows.length}</td>
                            <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0)}</td>
                            <td>Rs. {group.rows.reduce((sum, row) => (
                              sum + (Number(row.amount || 0) * Number(row.boxValue || 0))
                            ), 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p style={{ marginTop: '14px' }}>Balance stock nahi bacha.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {false && activeTab === 'stock-transfer' && (
          <div className="accordion-item">
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Stock Transfer
            </button>
            <div className="accordion-content">
              <h2>Stock Transfer</h2>
              <p style={{ marginBottom: '14px', color: '#4a5568' }}>
                Selected date aur selected company ka jo balance stock admin ke paas bacha hai, woh ek baar me selected seller ko transfer hoga.
              </p>

              <div className="form-group">
                <label>Select Date:</label>
                <input
                  type="date"
                  value={stockTransferDate}
                  onChange={(e) => setStockTransferDate(e.target.value)}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Transfer To:</label>
                <div style={{ marginTop: '8px' }}>
                  <SearchableSellerSelect
                    value={stockTransferTargetId}
                    options={stockTransferTargetOptions}
                    onChange={(seller) => setStockTransferTargetId(String(seller?.id || ''))}
                    getOptionLabel={(seller) => `${seller.username}${String(seller.id) === String(user?.id) ? ' (Self)' : ''} [${getSellerKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
                    getOptionSearchLabel={(seller) => `${getSellerKeyword(seller)} ${seller.username} ${getAllowedAmountsLabel(seller)}`}
                    placeholder={stockTransferTargetOptions.length === 0 ? 'No seller' : 'Keyword ya seller name type karo'}
                  />
                </div>

                <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: '10px', background: '#eef4ff' }}>
                  <strong>Selected Stock:</strong> {formatDisplayDate(stockTransferDate)} | {initialSessionMode} | {getPurchaseCategoryLabel(initialPurchaseCategory || adminStockPurchaseCategory)} | Amount {initialAmount || adminStockAmount}
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button type="button" onClick={loadStockTransferEntries} disabled={stockTransferLoading}>
                    {stockTransferLoading ? 'Loading...' : 'Preview Remaining Stock'}
                  </button>
                  <button type="button" onClick={handleStockTransfer} disabled={stockTransferLoading || stockTransferEntries.length === 0} style={{ backgroundColor: '#2f855a' }}>
                    Transfer Full Remaining Stock
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: '10px', background: '#f6f8ff' }}>
                <strong>Remaining Stock:</strong> Total Pieces {stockTransferTotalPieces} | Rs. {stockTransferTotalAmount.toFixed(2)}
              </div>

              {stockTransferGroups.length > 0 ? (
                <table className="entries-table" style={{ marginTop: '16px' }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Session</th>
                      <th>Amount</th>
                      <th>SEM</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Total Pieces</th>
                      <th>Current Holder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockTransferGroups.map((group) => (
                      <tr key={`admin-stock-transfer-${group.firstRow?.id}-${group.lastRow?.id}`}>
                        <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                        <td>{group.firstRow?.sessionMode || '-'}</td>
                        <td>{group.firstRow?.amount || '-'}</td>
                        <td>{group.firstRow?.boxValue || '-'}</td>
                        <td>{group.firstRow?.number || '-'}</td>
                        <td>{group.lastRow?.number || '-'}</td>
                        <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0)}</td>
                        <td>{user?.username || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ marginTop: '16px' }}>Selected date/category/amount me remaining stock nahi hai.</p>
              )}
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
                actionMode="seller-review"
                actionLoadingId={entryActionLoadingId}
                onAccept={(entry) => handleAcceptEntryAction(entry, 'accept')}
                onReject={(entry) => handleAcceptEntryAction(entry, 'reject')}
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
                  <option value="DAY">DAY</option>
                  <option value="EVENING">EVENING</option>
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
                  {summaryAmount6Entries.length > 0 ? renderAdminEntriesTable(summaryAmount6Entries, 'Amount 7') : <p style={{ marginTop: '12px' }}>No booked data found for amount 7.</p>}
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
                <select value={historyShift} onChange={(e) => handleBillShiftChange(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="ALL">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="DAY">DAY</option>
                  <option value="EVENING">EVENING</option>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Generate Bill
            </button>
            <div className="accordion-content">
              <h2>Generate Bill</h2>
              <div className="form-group">
                <label>From Date:</label>
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

                <label style={{ marginTop: '12px', display: 'block' }}>Select Shift:</label>
                <select value={historyShift} onChange={(e) => handleBillShiftChange(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="ALL">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="DAY">DAY</option>
                  <option value="EVENING">EVENING</option>
                </select>

                <label style={{ marginTop: '12px', display: 'block' }}>Select Seller:</label>
                <div style={{ marginTop: '8px' }}>
                  <select
                    value={historySellerFilter}
                    onChange={(event) => setHistorySellerFilter(event.target.value)}
                  >
                    <option value="">ALL All Direct Sellers</option>
                    {directAdminSellers.filter((seller) => sellerSupportsAmount(seller, historyAmountFilter || initialAmount)).map((seller) => (
                      <option key={seller.id || seller.username} value={seller.username}>
                        {`${getSellerKeyword(seller)} ${seller.username} [${getSellerKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button type="button" onClick={() => loadBillPreviewData(getBillFilters())}>
                    Preview Bill Data
                  </button>
                  <button type="button" onClick={generateBill} style={{ backgroundColor: '#2f855a' }}>
                    Generate Bill
                  </button>
                </div>
              </div>

              {Object.keys(adminBillVisibleGroups).length > 0 ? (
                <div className="entries-list-block" style={{ marginTop: '20px' }}>
                  <h3>Seller Totals</h3>
                  <table className="entries-table">
                    <thead>
                      <tr>
                        <th>Seller</th>
                        <th>Purchase</th>
                        <th>Unsold</th>
                        <th>Unsold %</th>
                        <th>Sold</th>
                        <th>Sold %</th>
                        <th>Net Value</th>
                        <th>Prize</th>
                        <th>VC</th>
                        <th>SVC</th>
                        <th>Net Bill</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminVisibleSellerSummaryRows.map((summary) => {
                        const allowedAmountsLabel = billData.rootSellerMeta?.[summary.sellerName]?.allowedAmountsLabel;
                        const sellerLabel = allowedAmountsLabel ? `${summary.sellerName} (${allowedAmountsLabel})` : summary.sellerName;
                        return (
                          <tr key={`seller-summary-${summary.sellerName}`}>
                            <td>{sellerLabel}</td>
                            <td>{Number(summary.totalSentPiece || 0).toFixed(2)}</td>
                            <td>{Number(summary.totalUnsoldPiece || 0).toFixed(2)}</td>
                            <td>{`${(Number(summary.totalSentPiece || 0) > 0 ? ((Number(summary.totalUnsoldPiece || 0) / Number(summary.totalSentPiece || 0)) * 100) : 0).toFixed(2)}%`}</td>
                            <td>{Number(summary.totalSoldPiece || 0).toFixed(2)}</td>
                            <td>{`${(Number(summary.totalSentPiece || 0) > 0 ? ((Number(summary.totalSoldPiece || 0) / Number(summary.totalSentPiece || 0)) * 100) : 0).toFixed(2)}%`}</td>
                            <td>{Number(summary.totalSales || 0).toFixed(2)}</td>
                            <td>{Number(summary.totalPrize || 0).toFixed(2)}</td>
                            <td>{Number(summary.totalVc || 0).toFixed(2)}</td>
                            <td>{Number(summary.totalSvc || 0).toFixed(2)}</td>
                            <td>{`${Number(summary.netBill || 0) < 0 ? '-' : '+'}${Math.abs(Number(summary.netBill || 0)).toFixed(2)}`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                </div>
              ) : (
                <p>No bill data found</p>
              )}

              {Object.keys(adminBillVisibleGroups).length > 0 && (
                <div style={{ marginTop: '20px', padding: '18px 22px', borderRadius: '16px', background: '#eef2ff', fontSize: '28px', lineHeight: 1.45 }}>
                  <strong>Grand Total:</strong> Unsold %{' '}
                  {(Number(adminVisibleBillTotals.totalSentPiece || 0) > 0 ? ((Number(adminVisibleBillTotals.totalUnsoldPiece || 0) / Number(adminVisibleBillTotals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}% | Sold %{' '}
                  {(Number(adminVisibleBillTotals.totalSentPiece || 0) > 0 ? ((Number(adminVisibleBillTotals.totalSoldPiece || 0) / Number(adminVisibleBillTotals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}% | Net {formatSignedRupees(adminVisibleBillTotals.netBill)}
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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

                <label style={{ marginTop: '12px', display: 'block' }}>Shift:</label>
                <select value={prizeTrackerSessionMode} onChange={(e) => setPrizeTrackerSessionMode(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="ALL">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="DAY">DAY</option>
                  <option value="EVENING">EVENING</option>
                </select>

                <label style={{ marginTop: '12px', display: 'block' }}>Seller:</label>
                <SearchableSellerSelect
                  options={adminPrizeTrackerSellerOptions}
                  value={prizeTrackerSellerId}
                  onChange={(seller) => setPrizeTrackerSellerId(String(seller?.id || ''))}
                  placeholder="Keyword ya seller name type karo"
                  getOptionValue={(option) => option.id}
                  getOptionLabel={(option) => option.id ? option.username : 'All Sellers'}
                  onEnter={() => {
                    window.requestAnimationFrame(() => prizeTrackerResultTypeRef.current?.focus());
                  }}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Result Type:</label>
                <select
                  ref={prizeTrackerResultTypeRef}
                  value={prizeTrackerSoldStatus}
                  onChange={(e) => setPrizeTrackerSoldStatus(e.target.value)}
                  style={{ marginTop: '8px' }}
                >
                  <option value="ALL">ALL</option>
                  <option value="SOLD">SOLD</option>
                  <option value="UNSOLD">UNSOLD</option>
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
                        <th>Shift</th>
                        <th>Seller</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>SEM</th>
                        <th>Number</th>
                        <th>Prize</th>
                        <th>Winning Number</th>
                        <th>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prizeTrackerResults.length > 0 ? (
                        prizeTrackerResults.map((entry) => (
                          <tr key={entry.id}>
                            <td>{formatDisplayDate(entry.bookingDate || entry.resultForDate)}</td>
                            <td>{getPrizeShiftLabel(entry.purchaseCategory === 'D' ? 'DAY' : (entry.purchaseCategory === 'E' ? 'EVENING' : 'MORNING'))}</td>
                            <td>{entry.sellerUsername || '-'}</td>
                            <td>{entry.soldStatus || '-'}</td>
                            <td>{entry.amount ?? '-'}</td>
                            <td>{entry.sem ?? '-'}</td>
                            <td>{entry.number || '-'}</td>
                            <td>{entry.prizeLabel}</td>
                            <td>{entry.winningNumber}</td>
                            <td>{entry.calculatedPrize !== null && entry.calculatedPrize !== undefined ? `Rs. ${Number(entry.calculatedPrize).toFixed(2)}` : '-'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="10">Selected filter me koi sold/unsold winning number nahi mila</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {prizeTrackerResults.length > 0 && (
                    <div style={{ marginTop: '14px', padding: '14px 16px', borderRadius: '14px', background: '#eef2ff' }}>
                      <strong>Total Prize Payout:</strong> Rs. {Number(prizeTrackerTotalPrize || 0).toFixed(2)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {!activeTab && (
        <div className="admin-dashboard-actions">
          <PasswordSettingsMenu
            currentUser={user}
            onSuccess={setSuccess}
            onError={setError}
          />
          <button className="logout-btn" onClick={onLogout}>Logout</button>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
    </div>
  );
};

const AddSellerForm = ({ currentUser, selectedAmount = '', onSuccess, onError }) => {
  const [newUsername, setNewUsername] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [rateAmount6, setRateAmount6] = useState('');
  const [rateAmount12, setRateAmount12] = useState('');
  const allowedSellerTypes = currentUser?.role === 'admin'
    ? ['seller', 'sub_seller', 'normal_seller']
    : ['seller'];
  const [sellerType, setSellerType] = useState(allowedSellerTypes[0] || 'seller');
  const [loading, setLoading] = useState(false);
  const showRateAmount6 = String(selectedAmount) !== '12';
  const showRateAmount12 = String(selectedAmount) !== '7';
  const requiresLoginPassword = sellerType !== 'normal_seller';

  const handleCreateSeller = async (e) => {
    e.preventDefault();
    setLoading(true);
    onError('');

    const trimmedUsername = newUsername.trim();
    const trimmedKeyword = newKeyword.trim().toUpperCase();

    if (!trimmedUsername) {
      onError('Username is required');
      setLoading(false);
      return;
    }

    if (!trimmedKeyword) {
      onError('Keyword is required');
      setLoading(false);
      return;
    }

    if (requiresLoginPassword && newPassword.length < 8) {
      onError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    if ((showRateAmount6 && !rateAmount6) && (showRateAmount12 && !rateAmount12)) {
      onError('At least one rate is required');
      setLoading(false);
      return;
    }

    try {
      await userService.createSeller(
        trimmedUsername,
        trimmedKeyword,
        requiresLoginPassword ? newPassword : '',
        showRateAmount6 && rateAmount6 ? parseFloat(rateAmount6) : 0,
        showRateAmount12 && rateAmount12 ? parseFloat(rateAmount12) : 0,
        sellerType
      );
      setNewUsername('');
      setNewKeyword('');
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
          <label>Type:</label>
          <select value={sellerType} onChange={(e) => setSellerType(e.target.value)} required>
            {allowedSellerTypes.map((type) => (
              <option key={type} value={type}>{SELLER_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>{sellerType === 'normal_seller' ? 'Seller Name:' : 'Username:'}</label>
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label>Keyword:</label>
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase())}
            placeholder="Jaise RA, RU, SA"
            required
          />
        </div>
        {requiresLoginPassword ? (
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
        ) : (
          <p style={{ marginTop: '0', color: '#666', fontSize: '14px' }}>
            Seller ka koi login ID nahi banega. Yeh naam Purchase Send, Unsold aur F10 summary me direct use hoga.
          </p>
        )}
        {showRateAmount6 && (
          <div className="form-group">
            <label>Rate for Amount 7:</label>
            <input
              type="text"
              value={rateAmount6}
              onChange={(e) => {
                const nextValue = e.target.value.replace(/[^0-9.]/g, '');
                const parts = nextValue.split('.');
                const normalizedValue = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : nextValue;
                setRateAmount6(normalizedValue);
              }}
              placeholder="Enter rate for amount 7"
              inputMode="decimal"
            />
          </div>
        )}
        {showRateAmount12 && (
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
          Agar rate blank chhoda, to us naam par us amount ka maal assign nahi hoga.
        </p>
        {requiresLoginPassword && (
          <p style={{ marginTop: '0', color: '#666', fontSize: '14px' }}>
            At least one rate is required when creating a new seller.
          </p>
        )}
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Seller'}
        </button>
      </form>
    </>
  );
};

export default AdminDashboard;
