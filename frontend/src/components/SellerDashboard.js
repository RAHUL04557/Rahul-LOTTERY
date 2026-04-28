import React, { useEffect, useRef, useState } from 'react';
import { lotteryService, priceService, userService } from '../services/api';
import UserTreeView from './UserTreeView';
import EntriesTableView from './EntriesTableView';
import PasswordSettingsMenu from './PasswordSettingsMenu';
import RetroPurchasePanel from './RetroPurchasePanel';
import DashboardLauncher from './DashboardLauncher';
import ExitConfirmPrompt from './ExitConfirmPrompt';
import SearchableSellerSelect from './SearchableSellerSelect';
import { buildBillAmountSummariesWithPrize, buildBillData, buildBillSummaryWithPrize, formatDisplayDate, formatDisplayDateTime, formatSignedRupees, getAllowedAmountsLabel, groupTransferHistoryByActor, openTransferBill } from '../utils/transferBill';
import { groupConsecutiveNumberRows, sortRowsForConsecutiveNumbers } from '../utils/numberRanges';
import { useFunctionShortcuts } from '../utils/functionShortcuts';
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

const mapApiEntry = (entry) => ({
  id: entry.id,
  userId: entry.userId,
  username: entry.username,
  displaySeller: entry.forwardedByUsername || entry.username,
  forwardedBy: entry.forwardedBy,
  sentToParent: entry.sentToParent,
  uniqueCode: entry.uniqueCode,
  sem: entry.boxValue,
  amount: String(entry.amount),
  number: entry.number,
  price: Number(entry.boxValue || 0) * Number(entry.amount || 0),
  memoNumber: entry.memoNumber ?? entry.memo_number ?? null,
  purchaseMemoNumber: entry.purchaseMemoNumber ?? entry.purchase_memo_number ?? entry.memoNumber ?? entry.memo_number ?? null,
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

const normalizeSeePurchaseEntry = (entry = {}) => ({
  id: entry.id || entry._id || `${entry.number || ''}-${entry.bookingDate || ''}-${entry.sem || entry.boxValue || ''}`,
  number: String(entry.number || '').trim(),
  boxValue: String(entry.sem || entry.boxValue || '').trim(),
  amount: String(entry.amount || '').trim(),
  bookingDate: entry.bookingDate || entry.booking_date || '',
  sessionMode: entry.sessionMode || entry.session_mode || '',
  purchaseCategory: entry.purchaseCategory || (entry.sessionMode === 'NIGHT' || entry.session_mode === 'NIGHT' ? 'E' : 'M'),
  memoNumber: entry.memoNumber ?? entry.memo_number ?? '',
  sellerName: entry.displaySeller || entry.forwardedByUsername || entry.username || entry.fromUsername || entry.actorUsername || '',
  fromUsername: entry.fromUsername || entry.from_username || '',
  toUsername: entry.toUsername || entry.to_username || '',
  status: entry.status || ''
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
const SELLER_PURCHASE_SEND_SHORTCUTS = ['F2-Save', 'F3-Delete', 'A-Add', 'F4-Stock', 'F8-Clear', 'Esc-Exit'];
const SELLER_UNSOLD_SHORTCUTS = ['F2-Save', 'F3-Delete', 'A-Add', 'F4-View', 'F8-Clear', 'Esc-Exit'];
const REMOVABLE_UNSOLD_STATUSES = new Set(['unsold_saved', 'unsold_sent', 'unsold']);
const SELLER_TYPE_LABELS = {
  seller: 'Stokist',
  sub_seller: 'Sub Stokist',
  normal_seller: 'Seller'
};

const normalizeSellerType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return SELLER_TYPE_LABELS[normalized] ? normalized : 'seller';
};

const isRemovableUnsoldEntry = (entry) => REMOVABLE_UNSOLD_STATUSES.has(String(entry.status || '').trim().toLowerCase());

const getAllowedChildSellerTypes = (currentUser) => {
  if (!currentUser) {
    return [];
  }
  if (currentUser.role === 'admin') {
    return ['seller', 'sub_seller', 'normal_seller'];
  }
  const sellerType = normalizeSellerType(currentUser.sellerType);
  if (sellerType === 'seller') {
    return ['sub_seller', 'normal_seller'];
  }
  if (sellerType === 'sub_seller') {
    return ['normal_seller'];
  }
  return [];
};

const getPartyKeyword = (sellerOrUsername = '', fallbackKeyword = '') => {
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
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
};

const buildRetroTicketCode = (sessionMode, semValue, purchaseCategory = '') => {
  const normalizedSem = String(semValue || '').replace(/[^0-9]/g, '');
  if (!normalizedSem) {
    return '';
  }

  const prefix = String(purchaseCategory || '').trim().toUpperCase() || (sessionMode === 'NIGHT' ? 'E' : 'M');
  return `${prefix}${normalizedSem}`;
};

const RIVER_ITEM_NAMES_BY_DAY = ['BRAHMAPUTRA', 'GANGA', 'YAMUNA', 'GODAVARI', 'NARMADA', 'KRISHNA', 'KAVERI'];

const getRetroItemName = (dateValue) => {
  const normalizedDate = formatDateOnly(dateValue);
  const isoDateMatch = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsedDate = isoDateMatch
    ? new Date(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]))
    : new Date(normalizedDate);
  if (Number.isNaN(parsedDate.getTime())) {
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

const flattenVisibleSellerNodes = (treeRoot) => {
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

const getPrizeShiftLabel = (purchaseCategory = '', sessionMode = '') => {
  if (purchaseCategory === 'D') {
    return 'DAY';
  }

  if (purchaseCategory === 'E' || sessionMode === 'NIGHT') {
    return 'EVENING';
  }

  return 'MORNING';
};

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

const createRetroGridRows = (rows = []) => rows.map((row, index) => ({
  id: row.id || `retro-row-${index}`,
  serial: index + 1,
  code: row.code || '',
  itemName: row.itemName || '',
  drawDate: row.drawDate || '',
  day: row.day || '',
  prefix: row.prefix || '',
  series: row.series || '',
  from: row.from || '',
  to: row.to || '',
  quantity: row.quantity || '',
  rate: row.rate || '',
  amount: row.amount || ''
}));

const buildPurchaseMemoSummaries = (entries = []) => {
  const memoMap = new Map();

  entries.forEach((entry) => {
    const memoNumber = Number(entry.purchaseMemoNumber || entry.memoNumber || 0);
    const pieceCount = Number(entry.sem || entry.boxValue || 0);
    if (!Number.isInteger(memoNumber) || memoNumber <= 0) {
      return;
    }

    const sentAtKey = entry.sentAt || entry.createdAt || `${entry.bookingDate || ''}-${memoNumber}`;
    const memoEntry = memoMap.get(memoNumber) || {
      memoNumber,
      totalPieceCount: 0,
      batches: new Map()
    };
    const normalizedBookingDate = getDateOnlyValue(entry.bookingDate || entry.booking_date || '');
    const existingBatch = memoEntry.batches.get(sentAtKey) || {
      id: sentAtKey,
      drawDate: normalizedBookingDate,
      sentAt: entry.sentAt || entry.createdAt || '',
      quantity: 0,
      rowCount: 0
    };

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

const buildCurrentMemoSummaries = (entries = []) => {
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    purchaseMemoNumber: entry.memoNumber ?? entry.memo_number ?? null
  }));

  return buildPurchaseMemoSummaries(normalizedEntries);
};

const buildPurchaseSendDraftRowsFromEntries = (entries = [], amountValue, options = {}) => (
  groupConsecutiveNumberRows(
    sortRowsForConsecutiveNumbers(
      [...entries],
      (entry) => [
        entry.bookingDate,
        entry.sessionMode,
        entry.purchaseCategory,
        entry.amount,
        entry.sem
      ]
    ),
    (entry) => [
      entry.bookingDate,
      entry.sessionMode,
      entry.purchaseCategory,
      entry.amount,
      entry.sem
    ].join('|')
  ).map((group, index) => {
    const entry = group.firstRow || {};
    const count = group.rows.length;
    const semValue = Number(entry.sem || 0);
    const rateValue = Number(entry.amount || amountValue || 0);

    return {
      id: `seller-purchase-send-memo-${entry.id || index}`,
      code: buildRetroTicketCode(entry.sessionMode || 'MORNING', entry.sem, entry.purchaseCategory),
      itemName: getRetroItemName(entry.bookingDate),
      drawDate: formatDateOnly(entry.bookingDate || ''),
      day: getDisplayDay(entry.bookingDate || ''),
      prefix: '',
      series: '',
      from: entry.number || '',
      to: group.lastRow?.number || entry.number || '',
      quantity: semValue * count,
      rate: rateValue.toFixed(2),
      amount: (semValue * count * rateValue).toFixed(2),
      semValue: String(entry.sem || ''),
      bookingAmount: String(entry.amount || amountValue || ''),
      resolvedSessionMode: entry.sessionMode || 'MORNING',
      resolvedPurchaseCategory: entry.purchaseCategory || (entry.sessionMode === 'NIGHT' ? 'E' : 'M'),
      partyId: String(entry.userId || ''),
      partyName: entry.username || entry.displaySeller || '',
      numberStart: entry.number || '',
      numberEnd: group.lastRow?.number || entry.number || '',
      isExistingUnsoldMemoRow: Boolean(options.existingUnsoldMemo),
      isExistingUnsoldRemoveMemoRow: Boolean(options.existingUnsoldRemoveMemo),
      isEditedUnsoldRemoveRow: false,
      entryIds: group.rows.map((row) => row.id).filter(Boolean)
    };
  })
);

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

const normalizeRangeStartNumber = (fromValue, referenceFromValue = '') => {
  const fromDigits = String(fromValue ?? '').replace(/[^0-9]/g, '').slice(0, 5);

  if (fromDigits.length === 5) {
    return { value: fromDigits };
  }

  if (fromDigits.length === 0) {
    return { value: '' };
  }

  const referenceDigits = sanitizeFiveDigitInput(referenceFromValue);
  if (referenceDigits.length !== 5) {
    return { error: 'From Number must be 5 digits' };
  }

  return { value: `${referenceDigits.slice(0, 5 - fromDigits.length)}${fromDigits}` };
};

const getFiveDigitRangeMetrics = (fromValue, toValue, referenceFromValue = '') => {
  const normalizedStart = normalizeRangeStartNumber(fromValue, referenceFromValue);

  if (normalizedStart.error) {
    return { fromNumber: '', toNumber: '', count: 0, error: normalizedStart.error };
  }

  const fromNumber = normalizedStart.value;
  const normalizedEnd = normalizeRangeEndNumber(fromNumber, toValue || fromNumber);

  if (!fromNumber) {
    return { fromNumber: '', toNumber: '', count: 0 };
  }

  if (normalizedEnd.error) {
    return { fromNumber, toNumber: '', count: 0, error: normalizedEnd.error };
  }

  const toNumber = normalizedEnd.value;
  const count = Math.max((Number(toNumber) - Number(fromNumber)) + 1, 1);

  return { fromNumber, toNumber, count };
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
  const normalizedStartA = Number(sanitizeFiveDigitInput(startA));
  const normalizedEndA = Number(sanitizeFiveDigitInput(endA || startA));
  const normalizedStartB = Number(sanitizeFiveDigitInput(startB));
  const normalizedEndB = Number(sanitizeFiveDigitInput(endB || startB));

  if ([normalizedStartA, normalizedEndA, normalizedStartB, normalizedEndB].some(Number.isNaN)) {
    return false;
  }

  return normalizedStartA <= normalizedEndB && normalizedStartB <= normalizedEndA;
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

const formatMissingNumberLabel = (numbers = []) => (
  numbers.length > 5
    ? `${numbers.slice(0, 5).join(', ')} +${numbers.length - 5} more`
    : numbers.join(', ')
);

const SellerDashboard = ({
  user,
  onLogout,
  sessionMode,
  purchaseCategory = '',
  onExitSession,
  initialActiveTab = '',
  initialAmount = '',
  initialBillAmount = '',
  billOnlyMode = false,
  entryCompanyLabel = ''
}) => {
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const [bookingMode, setBookingMode] = useState('single');
  const [number, setNumber] = useState('');
  const [rangeEndNumber, setRangeEndNumber] = useState('');
  const [selectedBox, setSelectedBox] = useState('');
  const [amount, setAmount] = useState(initialAmount || '');
  const [bookingDate, setBookingDate] = useState(getTodayDateValue());
  const [yourLotDate, setYourLotDate] = useState(getTodayDateValue());
  const [entries, setEntries] = useState([]);
  const [sentEntries, setSentEntries] = useState([]);
  const [receivedEntries, setReceivedEntries] = useState([]);
  const [acceptedBookEntries, setAcceptedBookEntries] = useState([]);
  const [transferHistory, setTransferHistory] = useState([]);
  const [purchaseBillRows, setPurchaseBillRows] = useState([]);
  const [billPrizeResults, setBillPrizeResults] = useState([]);
  const [historyFilterMode, setHistoryFilterMode] = useState('single');
  const [historyDate, setHistoryDate] = useState(getTodayDateValue());
  const [historyFromDate, setHistoryFromDate] = useState(getTodayDateValue());
  const [historyToDate, setHistoryToDate] = useState(getTodayDateValue());
  const [historyShift, setHistoryShift] = useState(getInitialBillShift(sessionMode, purchaseCategory));
  const [historySellerFilter, setHistorySellerFilter] = useState('');
  const [historyAmountFilter, setHistoryAmountFilter] = useState(initialBillAmount || initialAmount || '7');
  const [historyPurchaseCategoryFilter, setHistoryPurchaseCategoryFilter] = useState(
    String(purchaseCategory || '').trim().toUpperCase() || (sessionMode === 'NIGHT' ? 'E' : 'M')
  );
  const [treeData, setTreeData] = useState(null);
  const [totalAmount, setTotalAmount] = useState(0);
  const [sendingEntries, setSendingEntries] = useState(false);
  const [entryActionLoadingId, setEntryActionLoadingId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [error, setError] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [blockingWarning, setBlockingWarning] = useState(null);
  const [success, setSuccess] = useState('');
  const [pieceSummaryOpen, setPieceSummaryOpen] = useState(false);
  const [pieceSummaryDate, setPieceSummaryDate] = useState(getTodayDateValue());
  const [pieceSummaryRows, setPieceSummaryRows] = useState([]);
  const [pieceSummaryLoading, setPieceSummaryLoading] = useState(false);
  const [unsoldSendOpen, setUnsoldSendOpen] = useState(false);
  const [unsoldSendSummary, setUnsoldSendSummary] = useState(null);
  const [unsoldSendLoading, setUnsoldSendLoading] = useState(false);
  const [unsoldSendSaving, setUnsoldSendSaving] = useState(false);
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [traceDate, setTraceDate] = useState(getTodayDateValue());
  const [traceNumber, setTraceNumber] = useState('');
  const [traceMode, setTraceMode] = useState('single');
  const [traceRangeEndNumber, setTraceRangeEndNumber] = useState('');
  const [traceAmount, setTraceAmount] = useState(initialAmount || '7');
  const [traceSem, setTraceSem] = useState('');
  const [traceResults, setTraceResults] = useState([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [sellerPrizeDate, setSellerPrizeDate] = useState(getTodayDateValue());
  const [sellerPrizeSessionMode, setSellerPrizeSessionMode] = useState(sessionMode);
  const [sellerPrizeNumber, setSellerPrizeNumber] = useState('');
  const [sellerPrizeAmount, setSellerPrizeAmount] = useState(initialAmount || '7');
  const [sellerPrizeSem, setSellerPrizeSem] = useState('');
  const [sellerPrizeSearchPerformed, setSellerPrizeSearchPerformed] = useState(false);
  const [sellerPrizeResults, setSellerPrizeResults] = useState([]);
  const [sellerPrizeLoading, setSellerPrizeLoading] = useState(false);
  const [sellerPrizeResultType, setSellerPrizeResultType] = useState('');
  const [sellerPrizeMessage, setSellerPrizeMessage] = useState('');
  const [myPrizeAmount, setMyPrizeAmount] = useState(initialAmount || '7');
  const [myPrizeSem, setMyPrizeSem] = useState('');
  const [myPrizeAllResults, setMyPrizeAllResults] = useState([]);
  const [myPrizeResults, setMyPrizeResults] = useState([]);
  const [myPrizeLoading, setMyPrizeLoading] = useState(false);
  const [myPrizeMessage, setMyPrizeMessage] = useState('');
  const [myPrizeSearchPerformed, setMyPrizeSearchPerformed] = useState(false);
  const [myPrizeTotal, setMyPrizeTotal] = useState(0);
  const [myPrizeDate, setMyPrizeDate] = useState(getTodayDateValue());
  const [myPrizeShift, setMyPrizeShift] = useState('ALL');
  const [myPrizeSellerId, setMyPrizeSellerId] = useState('');
  const [myPrizeSoldStatus, setMyPrizeSoldStatus] = useState('ALL');
  const [purchaseEntries, setPurchaseEntries] = useState([]);
  const [purchaseSendMemoEntries, setPurchaseSendMemoEntries] = useState([]);
  const [unsoldMemoEntries, setUnsoldMemoEntries] = useState([]);
  const [unsoldRemoveMemoEntries, setUnsoldRemoveMemoEntries] = useState([]);
  const [seePurchaseLoading, setSeePurchaseLoading] = useState(false);
  const [seePurchaseReceivedEntries, setSeePurchaseReceivedEntries] = useState([]);
  const [seePurchaseSentEntries, setSeePurchaseSentEntries] = useState([]);
  const [seePurchaseAvailableEntries, setSeePurchaseAvailableEntries] = useState([]);
  const [seePurchaseDate, setSeePurchaseDate] = useState(getTodayDateValue());
  const [seePurchaseShift, setSeePurchaseShift] = useState(getInitialBillShift(sessionMode, purchaseCategory));
  const [seePurchaseSellerId, setSeePurchaseSellerId] = useState(String(user?.id || ''));
  const [unsoldEntries, setUnsoldEntries] = useState([]);
  const [stockTransferDate, setStockTransferDate] = useState(getTodayDateValue());
  const [stockTransferTargetId, setStockTransferTargetId] = useState('');
  const [stockTransferEntries, setStockTransferEntries] = useState([]);
  const [stockTransferLoading, setStockTransferLoading] = useState(false);
  const [purchaseSendSellerId, setPurchaseSendSellerId] = useState('');
  const [activePurchaseCategory, setActivePurchaseCategory] = useState(
    String(purchaseCategory || '').trim().toUpperCase() || (sessionMode === 'NIGHT' ? 'E' : 'M')
  );
  const [unsoldMode, setUnsoldMode] = useState('single');
  const [unsoldNumber, setUnsoldNumber] = useState('');
  const [unsoldRangeEndNumber, setUnsoldRangeEndNumber] = useState('');
  const [unsoldLoading, setUnsoldLoading] = useState(false);
  const [unsoldPartyId, setUnsoldPartyId] = useState(String(user?.id || ''));
  const [unsoldDraftRows, setUnsoldDraftRows] = useState([]);
  const [unsoldActiveRowIndex, setUnsoldActiveRowIndex] = useState(0);
  const [unsoldEditorVisible, setUnsoldEditorVisible] = useState(true);
  const [partyKeyword, setPartyKeyword] = useState('');
  const [selectedPartyName, setSelectedPartyName] = useState('');
  const [retroCodeInput, setRetroCodeInput] = useState('');
  const [retroFromInput, setRetroFromInput] = useState('');
  const [retroToInput, setRetroToInput] = useState('');
  const [retroDraftRows, setRetroDraftRows] = useState([]);
  const [retroActiveRowIndex, setRetroActiveRowIndex] = useState(0);
  const [retroEditorVisible, setRetroEditorVisible] = useState(true);
  const [retroSaving, setRetroSaving] = useState(false);
  const [purchaseSendMemoNumber, setPurchaseSendMemoNumber] = useState(null);
  const [purchaseSendMemoPopupOpen, setPurchaseSendMemoPopupOpen] = useState(false);
  const [purchaseSendMemoSelectionIndex, setPurchaseSendMemoSelectionIndex] = useState(0);
  const [unsoldMemoNumber, setUnsoldMemoNumber] = useState(null);
  const [unsoldRemoveMemoNumber, setUnsoldRemoveMemoNumber] = useState(null);
  const [unsoldMemoPopupOpen, setUnsoldMemoPopupOpen] = useState(false);
  const [unsoldMemoSelectionIndex, setUnsoldMemoSelectionIndex] = useState(0);
  const [unsoldCodeInput, setUnsoldCodeInput] = useState('');
  const [unsoldTableFromInput, setUnsoldTableFromInput] = useState('');
  const [unsoldTableToInput, setUnsoldTableToInput] = useState('');
  const [stockLookupLoading, setStockLookupLoading] = useState(false);
  const purchaseDateInputRef = useRef(null);
  const purchaseSellerSelectRef = useRef(null);
  const myPrizeResultTypeRef = useRef(null);
  const purchaseMemoRef = useRef(null);
  const unsoldDateInputRef = useRef(null);
  const unsoldPartySelectRef = useRef(null);
  const unsoldMemoRef = useRef(null);
  const purchaseCodeInputRef = useRef(null);
  const purchaseFromInputRef = useRef(null);
  const purchaseToInputRef = useRef(null);
  const purchaseGridDateInputRef = useRef(null);
  const unsoldCodeInputRef = useRef(null);
  const unsoldFromInputRef = useRef(null);
  const unsoldToInputRef = useRef(null);
  const dashboardRef = useRef(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitConfirmSelected, setExitConfirmSelected] = useState('no');
  const [exitReadyFromFirstControl, setExitReadyFromFirstControl] = useState(false);
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
  const focusUnsoldFromInput = () => {
    window.requestAnimationFrame(() => {
      unsoldFromInputRef.current?.focus();
      unsoldFromInputRef.current?.select?.();
    });
  };
  const focusActiveSellerSelect = () => {
    focusElementReliably(() => (
      activeTab === 'purchase-send'
        ? purchaseSellerSelectRef.current
        : unsoldPartySelectRef.current
    ));
  };
  const focusPurchaseSellerSelectAfterSave = () => {
    focusElementReliably(() => purchaseSellerSelectRef.current);
    window.setTimeout(() => {
      purchaseSellerSelectRef.current?.focus();
      purchaseSellerSelectRef.current?.select?.();
    }, 160);
  };
  const resetDateFieldsToToday = () => {
    const today = getTodayDateValue();
    setBookingDate(today);
    setYourLotDate(today);
    setHistoryDate(today);
    setHistoryFromDate(today);
    setHistoryToDate(today);
    setPieceSummaryDate(today);
    setTraceDate(today);
    setSellerPrizeDate(today);
    setStockTransferDate(today);
    setSeePurchaseDate(today);
  };
  const closePieceSummary = () => {
    setPieceSummaryOpen(false);
    setPieceSummaryDate(getTodayDateValue());
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

  const AMOUNT_OPTIONS = ['7', '12'];
  const sellerRateAmount6 = Number(user?.rateAmount6 || 0);
  const sellerRateAmount12 = Number(user?.rateAmount12 || 0);
  const amountBookingAvailability = {
    '7': sellerRateAmount6 > 0,
    '12': sellerRateAmount12 > 0
  };
  const availableAmountOptions = AMOUNT_OPTIONS.filter((amountOption) => amountBookingAvailability[amountOption]);
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
    if (amount === '7') {
      return ['5', '10', '25', '50', '100', '200'];
    }
    if (amount === '12') {
      return ['5', '10', '15', '20', '30', '50', '100', '200'];
    }
    return [];
  };

  const getAvailableTraceSemOptions = () => {
    if (traceAmount === '') {
      const semOptions = new Set();
      if (amountBookingAvailability['7']) {
        ['5', '10', '25', '50', '100', '200'].forEach((option) => semOptions.add(option));
      }
      if (amountBookingAvailability['12']) {
        ['5', '10', '15', '20', '30', '50', '100', '200'].forEach((option) => semOptions.add(option));
      }
      return Array.from(semOptions);
    }
    if (traceAmount === '7') {
      return ['5', '10', '25', '50', '100', '200'];
    }
    if (traceAmount === '12') {
      return ['5', '10', '15', '20', '30', '50', '100', '200'];
    }
    return [];
  };

  const getAvailableSellerPrizeSemOptions = () => {
    if (sellerPrizeAmount === '') {
      const semOptions = new Set();
      if (amountBookingAvailability['7']) {
        ['5', '10', '25', '50', '100', '200'].forEach((option) => semOptions.add(option));
      }
      if (amountBookingAvailability['12']) {
        ['5', '10', '15', '20', '30', '50', '100', '200'].forEach((option) => semOptions.add(option));
      }
      return Array.from(semOptions);
    }
    if (sellerPrizeAmount === '7') {
      return ['5', '10', '25', '50', '100', '200'];
    }
    if (sellerPrizeAmount === '12') {
      return ['5', '10', '15', '20', '30', '50', '100', '200'];
    }
    return [];
  };

  const getAvailableMyPrizeSemOptions = () => {
    if (myPrizeAmount === '') {
      const semOptions = new Set();
      if (amountBookingAvailability['7']) {
        ['5', '10', '25', '50', '100', '200'].forEach((option) => semOptions.add(option));
      }
      if (amountBookingAvailability['12']) {
        ['5', '10', '15', '20', '30', '50', '100', '200'].forEach((option) => semOptions.add(option));
      }
      return Array.from(semOptions);
    }
    if (myPrizeAmount === '7') {
      return ['5', '10', '25', '50', '100', '200'];
    }
    if (myPrizeAmount === '12') {
      return ['5', '10', '15', '20', '30', '50', '100', '200'];
    }
    return [];
  };

  const amount6Entries = entries.filter((entry) => entry.amount === '7');
  const amount12Entries = entries.filter((entry) => entry.amount === '12');
  const totalAcceptedBookEntries = acceptedBookEntries.length;
  const isTodayBookingDate = bookingDate === getTodayDateValue();
  const isEntryDeadlinePassed = isTodayBookingDate && isSendDeadlinePassed;
  const selectedAmountBookingDisabled = amount ? !amountBookingAvailability[amount] : false;
  const currentSellerType = normalizeSellerType(user?.sellerType);
  const allowedChildSellerTypes = getAllowedChildSellerTypes(user);
  const directChildSellers = (treeData?.children || []).filter((node) => (
    node.role === 'seller' && allowedChildSellerTypes.includes(normalizeSellerType(node.sellerType))
  ));
  const activeAmountChildSellers = directChildSellers.filter((seller) => sellerSupportsAmount(seller, amount));
  const canCreateChildSeller = allowedChildSellerTypes.length > 0;
  const canForwardPurchase = currentSellerType !== 'normal_seller';
  const canUseStockTransfer = currentSellerType === 'seller' || currentSellerType === 'sub_seller';
  const selfPartyOption = user?.id ? {
    id: user.id,
    username: user.username,
    keyword: user.keyword || '',
    rateAmount6: user.rateAmount6 || 0,
    rateAmount12: user.rateAmount12 || 0
  } : null;
  const retroPartyOptions = [
    selfPartyOption,
    ...activeAmountChildSellers.filter((seller) => seller.id).map((seller) => ({
      id: seller.id,
      username: seller.username,
      keyword: seller.keyword || '',
      rateAmount6: seller.rateAmount6 || 0,
      rateAmount12: seller.rateAmount12 || 0
    }))
  ].filter((party) => party?.id);
  const myPrizeSellerOptions = [
    { id: '', username: 'All Sellers', keyword: 'ALL' },
    ...activeAmountChildSellers
      .filter((seller) => seller.id)
      .map((seller) => ({
        id: seller.id,
        username: seller.username,
        keyword: seller.keyword || ''
      }))
  ];
  const stockTransferTargetOptions = [
    selfPartyOption,
    ...activeAmountChildSellers.filter((seller) => (
      currentSellerType === 'sub_seller'
        ? true
        : normalizeSellerType(seller.sellerType) !== 'normal_seller'
    ) && seller.id).map((seller) => ({
      id: seller.id,
      username: seller.username,
      keyword: seller.keyword || '',
      rateAmount6: seller.rateAmount6 || 0,
      rateAmount12: seller.rateAmount12 || 0
    }))
  ].filter((seller) => seller?.id);
  const selectedParty = retroPartyOptions.find((party) => String(party.id) === String(purchaseSendSellerId))
    || retroPartyOptions.find((party) => party.username === selectedPartyName)
    || retroPartyOptions[0]
    || null;
  const unsoldPartyOptions = [
    {
      id: user?.id,
      username: user?.username,
      keyword: user?.keyword || '',
      rateAmount6: user?.rateAmount6 || 0,
      rateAmount12: user?.rateAmount12 || 0
    },
    ...activeAmountChildSellers
  ].filter((party) => party.id);
  const selectedUnsoldParty = unsoldPartyOptions.find((party) => String(party.id) === String(unsoldPartyId))
    || unsoldPartyOptions[0]
    || null;
  const seePurchaseSellerOptions = [
    selfPartyOption,
    ...activeAmountChildSellers.filter((seller) => seller.id).map((seller) => ({
      id: seller.id,
      username: seller.username,
      keyword: seller.keyword || '',
      rateAmount6: seller.rateAmount6 || 0,
      rateAmount12: seller.rateAmount12 || 0
    }))
  ].filter((seller, index, allSellers) => seller?.id && allSellers.findIndex((entry) => String(entry.id) === String(seller.id)) === index);
  const selectedSeePurchaseSeller = seePurchaseSellerOptions.find((seller) => String(seller.id) === String(seePurchaseSellerId))
    || seePurchaseSellerOptions[0]
    || null;
  const loadPieceSummary = async (dateOverride = '') => {
    const summaryDateValue = dateOverride || pieceSummaryDate || getTodayDateValue();

    setPieceSummaryLoading(true);
    setPieceSummaryOpen(true);
    setPieceSummaryDate(summaryDateValue);
    setError('');

    try {
      const response = await lotteryService.getPurchasePieceSummary({
        bookingDate: summaryDateValue,
        sessionMode,
        purchaseCategory: activePurchaseCategory,
        amount
      });

      setPieceSummaryRows((response.data || []).map((row) => ({
        id: row.sellerId || row.seller_id,
        sellerName: `${row.sellerName || row.seller_name || ''}${row.isSelf || row.is_self ? ' (Self)' : ''}`,
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

  const loadUnsoldSendSummary = async () => {
    setUnsoldSendLoading(true);
    setUnsoldSendOpen(true);
    setError('');

    try {
      const response = await lotteryService.getPurchaseUnsoldSendSummary({
        bookingDate,
        sessionMode,
        purchaseCategory: activePurchaseCategory,
        amount
      });
      setUnsoldSendSummary(response.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading unsold send summary');
      setUnsoldSendSummary(null);
    } finally {
      setUnsoldSendLoading(false);
    }
  };

  const sendUnsoldToParent = async () => {
    setUnsoldSendSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await lotteryService.sendPurchaseUnsold({
        bookingDate,
        sessionMode,
        purchaseCategory: activePurchaseCategory,
        amount
      });
      setSuccess(response.data?.message || 'Unsold sent successfully');
      await Promise.all([
        loadUnsoldSendSummary(),
        loadPurchaseEntries(),
        loadUnsoldMemoEntries(),
        loadReceivedEntries()
      ]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error sending unsold');
    } finally {
      setUnsoldSendSaving(false);
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

  const getHistoryFilters = () => (
    historyFilterMode === 'range'
      ? { fromDate: historyFromDate, toDate: historyToDate, shift: getBillApiShift(historyShift), purchaseCategory: getBillPurchaseCategory(historyShift) }
      : { date: historyDate, shift: getBillApiShift(historyShift), purchaseCategory: getBillPurchaseCategory(historyShift) }
  );

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
    loadTree();

    if (billOnlyMode) {
      loadBillPreviewData();
      return;
    }

    loadPurchaseEntries();
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
  }, [billOnlyMode, activeTab, yourLotDate, sessionMode, amount]);

  useEffect(() => {
    if (!billOnlyMode && activeTab === 'accept-seller-lot') {
      loadReceivedEntries();
    }
  }, [billOnlyMode, activeTab, sessionMode, amount]);

  useEffect(() => {
    if (amount && !amountBookingAvailability[amount]) {
      setAmount(initialAmount || availableAmountOptions[0] || '7');
      setSelectedBox('');
    }
  }, [amount, initialAmount, availableAmountOptions, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    if (availableAmountOptions.length === 1 && amount !== availableAmountOptions[0]) {
      setAmount(availableAmountOptions[0]);
      setSelectedBox('');
    }
    if (availableAmountOptions.length > 0 && !amount) {
      setAmount(availableAmountOptions[0]);
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
      setTraceAmount(initialAmount || availableAmountOptions[0] || '7');
      setTraceSem('');
    }
  }, [traceAmount, initialAmount, availableAmountOptions, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    if (sellerPrizeAmount && !amountBookingAvailability[sellerPrizeAmount]) {
      setSellerPrizeAmount(initialAmount || availableAmountOptions[0] || '7');
      setSellerPrizeSem('');
    }
  }, [sellerPrizeAmount, initialAmount, availableAmountOptions, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    if (myPrizeAmount && !amountBookingAvailability[myPrizeAmount]) {
      setMyPrizeAmount(initialAmount || availableAmountOptions[0] || '7');
      setMyPrizeSem('');
    }
  }, [myPrizeAmount, initialAmount, availableAmountOptions, sellerRateAmount6, sellerRateAmount12]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setRetroActiveRowIndex((currentIndex) => Math.min(currentIndex, retroDraftRows.length));
  }, [retroDraftRows.length]);

  useEffect(() => {
    setUnsoldActiveRowIndex((currentIndex) => Math.min(currentIndex, unsoldDraftRows.length));
  }, [unsoldDraftRows.length]);

  useEffect(() => {
    if (activeTab === 'purchase-send') {
      return focusElementReliably(() => purchaseSellerSelectRef.current || purchaseDateInputRef.current);
    }

    if (activeTab === 'unsold' || activeTab === 'unsold-remove') {
      return focusElementReliably(() => unsoldPartySelectRef.current || unsoldDateInputRef.current);
    }

    return focusElementReliably(() => (
      dashboardRef.current?.querySelector('.accordion-content input:not([type="hidden"]):not(:disabled), .accordion-content select:not(:disabled), .accordion-content textarea:not(:disabled), .accordion-content button:not(:disabled)')
    ));
  }, [activeTab]);

  useEffect(() => {
    setExitReadyFromFirstControl(false);
    setExitConfirmOpen(false);
    setExitConfirmSelected('no');
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'purchase-send') {
      loadPurchaseSendMemoEntries();
    }

    if (activeTab === 'unsold') {
      loadUnsoldMemoEntries();
    }
  }, [activeTab, purchaseSendSellerId, unsoldPartyId, bookingDate, sessionMode, activePurchaseCategory, amount]);

  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state?.sellerDashboardRoot) {
        const nextTab = event.state.sellerTab || '';
        if (!nextTab) {
          resetDateFieldsToToday();
        }
        setActiveTab(nextTab);
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
    if (!['purchase-send', 'unsold', 'unsold-remove'].includes(activeTab)) {
      if (blockingWarning) {
        clearBlockingWarning();
      }
      return;
    }

    if (bookingError) {
      openBlockingWarning(bookingError);
      setBookingError('');
      return;
    }

    if (error) {
      openBlockingWarning(error);
      setError('');
    }
  }, [activeTab, bookingError, error, blockingWarning]);

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
  }, [activeTab, billOnlyMode, blockingWarning]);

  useEffect(() => {
    if (billOnlyMode) {
      setActiveTab('generate-bill');
      return;
    }

    setActiveTab(initialActiveTab);
  }, [billOnlyMode, initialActiveTab]);

  useEffect(() => {
    if (initialAmount) {
      setAmount(initialAmount);
      setTraceAmount(initialAmount);
      setSellerPrizeAmount(initialAmount);
      setMyPrizeAmount(initialAmount);
    }
  }, [initialAmount]);

  useEffect(() => {
    setActivePurchaseCategory(String(purchaseCategory || '').trim().toUpperCase() || (sessionMode === 'NIGHT' ? 'E' : 'M'));
    const nextBillShift = getInitialBillShift(sessionMode, purchaseCategory);
    setHistoryShift(nextBillShift);
    setHistoryPurchaseCategoryFilter(getBillPurchaseCategory(nextBillShift));
  }, [purchaseCategory, sessionMode]);

  useEffect(() => {
    setHistoryAmountFilter(initialBillAmount || initialAmount || '7');
  }, [initialBillAmount, initialAmount]);

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
      const response = await lotteryService.getMySentEntries({ sessionMode, bookingDate: yourLotDate, amount });
      setSentEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading your lot');
    }
  };

  const loadReceivedEntries = async () => {
    try {
      const response = await lotteryService.getReceivedEntries({ amount });
      setReceivedEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading seller lot');
    }
  };

  const loadPurchaseEntries = async () => {
    try {
      if (user?.role === 'admin') {
        const response = await lotteryService.getAdminPurchases({ bookingDate, amount });
        setPurchaseEntries(response.data.map(mapApiEntry));
        setUnsoldEntries([]);
        return;
      }

      const [assignedResponse, unsoldResponse] = await Promise.all([
        lotteryService.getPurchases({ bookingDate, status: 'accepted', amount }),
        lotteryService.getPurchases({ bookingDate, status: 'unsold', amount })
      ]);
      setPurchaseEntries(assignedResponse.data.map(mapApiEntry));
      setUnsoldEntries(unsoldResponse.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading purchase entries');
    }
  };

  const refreshUnsoldDerivedViews = async () => {
    const refreshTasks = [];

    if (pieceSummaryOpen) {
      refreshTasks.push(loadPieceSummary());
    }

    if (unsoldSendOpen) {
      refreshTasks.push(loadUnsoldSendSummary());
    }

    if (billOnlyMode || activeTab === 'generate-bill') {
      refreshTasks.push(loadBillPreviewData(getBillFilters()));
    }

    if (refreshTasks.length > 0) {
      await Promise.all(refreshTasks);
    }
  };

  const loadPurchaseSendMemoEntries = async (targetSellerId = purchaseSendSellerId, selectedBookingDate = bookingDate) => {
    if (!targetSellerId) {
      setPurchaseSendMemoEntries([]);
      return [];
    }

    try {
      const [assignedResponse, unsoldResponse] = await Promise.all([
        lotteryService.getPurchases({
          bookingDate: selectedBookingDate,
          sessionMode,
          sellerId: targetSellerId,
          status: 'accepted',
          purchaseCategory: activePurchaseCategory,
          amount
        }),
        lotteryService.getPurchases({
          bookingDate: selectedBookingDate,
          sessionMode,
          sellerId: targetSellerId,
          status: 'unsold',
          purchaseCategory: activePurchaseCategory,
          amount
        })
      ]);

      const mappedEntries = [
        ...assignedResponse.data.map(mapApiEntry),
        ...unsoldResponse.data.map(mapApiEntry)
      ].filter((entry) => getDateOnlyValue(entry.bookingDate) === selectedBookingDate);
      setPurchaseSendMemoEntries(mappedEntries);
      return mappedEntries;
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading purchase memo entries');
      setPurchaseSendMemoEntries([]);
      return [];
    }
  };

  const loadUnsoldMemoEntries = async (targetSellerId = unsoldPartyId, selectedBookingDate = bookingDate) => {
    if (!targetSellerId) {
      setUnsoldMemoEntries([]);
      return;
    }

    try {
      const response = await lotteryService.getPurchases({
        bookingDate: selectedBookingDate,
        sessionMode,
        sellerId: String(targetSellerId) === String(user?.id) ? undefined : targetSellerId,
        status: 'unsold',
        purchaseCategory: activePurchaseCategory,
        amount
      });
      const mappedEntries = (response.data || [])
        .map(mapApiEntry)
        .filter((entry) => activeTab === 'unsold-remove' ? isRemovableUnsoldEntry(entry) : true);
      setUnsoldMemoEntries(mappedEntries);
      return mappedEntries;
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading unsold memo entries');
      setUnsoldMemoEntries([]);
      return [];
    }
  };

  const loadUnsoldRemoveMemoEntries = async (targetSellerId = unsoldPartyId, selectedBookingDate = bookingDate) => {
    if (!targetSellerId) {
      setUnsoldRemoveMemoEntries([]);
      return [];
    }

    try {
      const response = await lotteryService.getPurchaseUnsoldRemoveMemo({
        bookingDate: selectedBookingDate,
        sessionMode,
        sellerId: String(targetSellerId) === String(user?.id) ? undefined : targetSellerId,
        amount,
        purchaseCategory: activePurchaseCategory
      });
      const mappedEntries = (response.data || []).map(mapHistoryRecord);
      setUnsoldRemoveMemoEntries(mappedEntries);
      return mappedEntries;
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading unsold remove memo entries');
      setUnsoldRemoveMemoEntries([]);
      return [];
    }
  };

  useEffect(() => {
    if (activeTab === 'unsold' && unsoldPartyId) {
      loadUnsoldMemoEntries(unsoldPartyId, bookingDate);
    }
  }, [activeTab, unsoldPartyId, bookingDate, sessionMode, activePurchaseCategory, amount]);

  useEffect(() => {
    if (activeTab === 'unsold-remove' && unsoldPartyId) {
      loadUnsoldMemoEntries(unsoldPartyId, bookingDate);
      loadUnsoldRemoveMemoEntries(unsoldPartyId, bookingDate);
    }
  }, [activeTab, unsoldPartyId, bookingDate, sessionMode, activePurchaseCategory, amount]);

  useEffect(() => {
    setSeePurchaseShift(getInitialBillShift(sessionMode, purchaseCategory));
  }, [sessionMode, purchaseCategory]);

  const loadSeePurchaseEntries = async () => {
    setSeePurchaseLoading(true);
    setError('');
    try {
      const response = await lotteryService.getSellerPurchaseView({
        bookingDate: seePurchaseDate,
        sessionMode: getBillApiShift(seePurchaseShift),
        sellerId: seePurchaseSellerId,
        purchaseCategory: getBillPurchaseCategory(seePurchaseShift),
        amount
      });
      setSeePurchaseReceivedEntries((response.data?.received || []).map(mapHistoryRecord));
      setSeePurchaseSentEntries((response.data?.sent || []).map(mapHistoryRecord));
      setSeePurchaseAvailableEntries((response.data?.available || []).map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading purchase view');
      setSeePurchaseReceivedEntries([]);
      setSeePurchaseSentEntries([]);
      setSeePurchaseAvailableEntries([]);
    } finally {
      setSeePurchaseLoading(false);
    }
  };

  const loadStockTransferEntries = async () => {
    setStockTransferLoading(true);
    setError('');

    try {
      const response = await lotteryService.getPurchases({
        bookingDate: stockTransferDate,
        sessionMode,
        status: 'accepted',
        purchaseCategory: activePurchaseCategory,
        amount,
        remaining: true
      });
      setStockTransferEntries(response.data.map(mapApiEntry));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading stock transfer data');
      setStockTransferEntries([]);
    } finally {
      setStockTransferLoading(false);
    }
  };

  const loadAcceptedBookEntries = async () => {
    try {
      const response = await lotteryService.getAcceptedBookEntries({ bookingDate, amount });
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
      const response = await lotteryService.getPendingEntries({ bookingDate, amount });
      setEntries(response.data.map(entry => ({
        _id: entry.id,
        number: entry.number,
        sem: entry.boxValue,
        amount: String(entry.amount),
        uniqueCode: entry.uniqueCode,
        price: Number(entry.boxValue) * Number(entry.amount),
        memoNumber: entry.memoNumber ?? entry.memo_number ?? '',
        username: entry.username || user?.username || '',
        displaySeller: entry.displaySeller || entry.username || user?.username || '',
        bookingDate: entry.bookingDate || entry.booking_date || bookingDate
      })));
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading pending entries');
    }
  };

  useEffect(() => {
    if (billOnlyMode) {
      return;
    }

    loadPurchaseEntries();
    loadAcceptedBookEntries();
  }, [billOnlyMode, bookingDate, sessionMode, activePurchaseCategory, amount]);

  useEffect(() => {
    if (retroPartyOptions.length === 0) {
      if (selectedPartyName) {
        setSelectedPartyName('');
      }
      if (purchaseSendSellerId) {
        setPurchaseSendSellerId('');
      }
      return;
    }

    const matchedParty = retroPartyOptions.find((party) => (
      String(party.id) === String(purchaseSendSellerId) || party.username === selectedPartyName
    ));

    if (!matchedParty) {
      setSelectedPartyName(retroPartyOptions[0].username);
      setPurchaseSendSellerId(String(retroPartyOptions[0].id));
      return;
    }

    if (String(matchedParty.id) !== String(purchaseSendSellerId)) {
      setPurchaseSendSellerId(String(matchedParty.id));
    }

    if (matchedParty.username !== selectedPartyName) {
      setSelectedPartyName(matchedParty.username);
    }
  }, [purchaseSendSellerId, selectedPartyName, retroPartyOptions]);

  useEffect(() => {
    if (stockTransferTargetOptions.length === 0) {
      if (stockTransferTargetId) {
        setStockTransferTargetId('');
      }
      return;
    }

    const matchedTarget = stockTransferTargetOptions.find((seller) => (
      String(seller.id) === String(stockTransferTargetId)
    ));

    if (!matchedTarget) {
      setStockTransferTargetId(String(stockTransferTargetOptions[0].id));
    }
  }, [stockTransferTargetId, stockTransferTargetOptions]);

  useEffect(() => {
    if (seePurchaseSellerOptions.length === 0) {
      if (seePurchaseSellerId) {
        setSeePurchaseSellerId('');
      }
      return;
    }

    const matchedSeller = seePurchaseSellerOptions.find((seller) => String(seller.id) === String(seePurchaseSellerId));
    if (!matchedSeller) {
      setSeePurchaseSellerId(String(seePurchaseSellerOptions[0].id));
    }
  }, [seePurchaseSellerId, seePurchaseSellerOptions]);

  function resetSellerMemoOptionState(tabName) {
    if (tabName === 'purchase-send') {
      setPurchaseSendMemoNumber(nextPurchaseSendMemoNumber);
      setPurchaseSendMemoSelectionIndex(0);
      setPurchaseSendMemoPopupOpen(false);
      setRetroDraftRows([]);
      setRetroActiveRowIndex(0);
      setRetroEditorVisible(true);
      setRetroCodeInput('');
      setRetroFromInput('');
      setRetroToInput('');
      return;
    }

    if (tabName === 'unsold') {
      setUnsoldMemoNumber(nextUnsoldMemoNumber);
      setUnsoldMemoSelectionIndex(0);
      setUnsoldMemoPopupOpen(false);
      setUnsoldDraftRows([]);
      setUnsoldActiveRowIndex(0);
      setUnsoldEditorVisible(true);
      resetUnsoldEditor({ keepCode: false });
      return;
    }

    if (tabName === 'unsold-remove') {
      setUnsoldRemoveMemoNumber(nextUnsoldRemoveMemoNumber);
      setUnsoldMemoSelectionIndex(0);
      setUnsoldMemoPopupOpen(false);
      setUnsoldDraftRows([]);
      setUnsoldActiveRowIndex(0);
      setUnsoldEditorVisible(true);
      resetUnsoldEditor({ keepCode: false });
    }
  }

  const handleSellerUnsoldDateChange = (nextDate) => {
    setBookingDate(nextDate);
    setUnsoldMemoNumber(null);
    setUnsoldRemoveMemoNumber(null);
    setUnsoldMemoSelectionIndex(0);
    setUnsoldMemoPopupOpen(false);
    setUnsoldDraftRows([]);
    setUnsoldActiveRowIndex(0);
    setUnsoldEditorVisible(true);
    resetUnsoldEditor({ keepCode: false });
  };

  const handleTabToggle = (tabName) => {
    if (activeTab === tabName) {
      resetSellerMemoOptionState(tabName);
      resetDateFieldsToToday();
      window.history.back();
      return;
    }

    if (activeTab && activeTab !== tabName) {
      resetSellerMemoOptionState(activeTab);
    }

    if (tabName === 'your-lot') {
      loadMySentEntries();
    }

    if (tabName === 'accept-seller-lot') {
      loadReceivedEntries();
    }

    if (tabName === 'add-seller') {
      if (!canCreateChildSeller) {
        setError('Aap is user se aur seller create nahi kar sakte');
        return;
      }
      loadTree();
    }

    if (tabName === 'tree') {
      loadTree();
    }

    if (tabName === 'purchase-send') {
      if (!canForwardPurchase) {
        setError('Seller purchase send nahi kar sakta');
        return;
      }
      resetSellerMemoOptionState('purchase-send');
      loadPurchaseEntries();
      loadPurchaseSendMemoEntries();
    }

    if (tabName === 'see-purchase') {
      if (currentSellerType === 'normal_seller') {
        setError('Seller ka purchase direct F10 me dikhega');
        return;
      }
      loadSeePurchaseEntries();
    }

    if (tabName === 'stock-transfer') {
      if (!canUseStockTransfer) {
        setError('Stock transfer sirf seller ke liye hai');
        return;
      }
      loadStockTransferEntries();
    }

    if (tabName === 'unsold') {
      resetSellerMemoOptionState('unsold');
      loadPurchaseEntries();
    }

    if (tabName === 'unsold-remove') {
      resetSellerMemoOptionState('unsold-remove');
      loadUnsoldMemoEntries(unsoldPartyId, bookingDate);
      loadUnsoldRemoveMemoEntries(unsoldPartyId, bookingDate);
    }

    if (tabName === 'book-lottery') {
      loadAcceptedBookEntries();
    }

    if (tabName === 'send-record') {
      loadTransferHistory(getHistoryFilters());
    }

    if (tabName === 'generate-bill') {
      loadBillPreviewData(getBillFilters());
    }

    window.history.pushState({ sellerDashboardRoot: true, sellerTab: tabName }, '', '#' + tabName);
    setActiveTab(tabName);
  };

  const handleTabBack = () => {
    if (billOnlyMode) {
      resetDateFieldsToToday();
      if (onExitSession) onExitSession();
      return;
    }

    if (activeTab) {
      resetSellerMemoOptionState(activeTab);
      resetDateFieldsToToday();
      window.history.back();
      return;
    }

    if (onExitSession) {
      resetDateFieldsToToday();
      onExitSession();
    }
  };

  const getFirstActiveControl = () => {
    if (activeTab === 'purchase-send') {
      return purchaseSellerSelectRef.current || purchaseDateInputRef.current || purchaseCodeInputRef.current;
    }

    if (activeTab === 'unsold' || activeTab === 'unsold-remove') {
      return unsoldPartySelectRef.current || unsoldDateInputRef.current || unsoldCodeInputRef.current;
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

  const handleDashboardFocusCapture = (event) => {
    if (!exitReadyFromFirstControl || exitConfirmOpen) {
      return;
    }

    const firstControl = getFirstActiveControl();
    if (firstControl && event.target !== firstControl) {
      setExitReadyFromFirstControl(false);
    }
  };

  const resolvePartyFromKeyword = () => {
    const normalizedKeyword = getPartyKeyword(partyKeyword);
    if (!normalizedKeyword) {
    return selectedParty || retroPartyOptions[0] || null;
  }

  return retroPartyOptions.find((party) => (
      getPartyKeyword(party) === normalizedKeyword
      || String(party.username).toUpperCase().startsWith(normalizedKeyword)
    )) || null;
  };

  const resolveRetroSemValue = () => {
    const parsed = parseRetroCodeValue(retroCodeInput, sessionMode, activePurchaseCategory);
    return parsed.semValue || selectedBox || '';
  };

  const buildPurchasePreview = () => {
    const party = resolvePartyFromKeyword();
    const parsedCode = parseRetroCodeValue(retroCodeInput, sessionMode, activePurchaseCategory);
    const previousRow = retroDraftRows[Math.min(retroActiveRowIndex, retroDraftRows.length) - 1] || null;
    const { fromNumber, toNumber, count } = getFiveDigitRangeMetrics(retroFromInput, retroToInput, previousRow?.from);

    if (!party || parsedCode.error || !parsedCode.semValue || !fromNumber || !toNumber) {
      return null;
    }

    const quantity = Number(parsedCode.semValue) * count;
    const rate = Number(amount || 0);

    return {
      code: buildRetroTicketCode(parsedCode.resolvedSessionMode, parsedCode.semValue, parsedCode.resolvedPurchaseCategory),
      itemName: getRetroItemName(bookingDate),
      drawDate: bookingDate,
      day: new Date(bookingDate).toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase(),
      from: fromNumber,
      to: toNumber || fromNumber,
      quantity,
      rate: rate.toFixed(2),
      amount: (quantity * rate).toFixed(2),
      semValue: parsedCode.semValue,
      resolvedSessionMode: parsedCode.resolvedSessionMode,
      resolvedPurchaseCategory: parsedCode.resolvedPurchaseCategory
    };
  };

  const buildRetroDraftRow = () => {
    const party = resolvePartyFromKeyword();
    const parsedCode = parseRetroCodeValue(retroCodeInput, sessionMode, activePurchaseCategory);
    const semValue = parsedCode.semValue;
    const previousRow = retroDraftRows[Math.min(retroActiveRowIndex, retroDraftRows.length) - 1] || null;
    const { fromNumber, toNumber, count, error: rangeError } = getFiveDigitRangeMetrics(retroFromInput, retroToInput, previousRow?.from);

    if (!party) {
      return { error: 'Party name select karo' };
    }

    if (!amount) {
      return { error: 'Amount select karo' };
    }

    if (parsedCode.error) {
      return { error: parsedCode.error };
    }

    if (!semValue) {
      return { error: 'Code/SEM enter karo' };
    }

    const allowedSemOptions = getAvailableSemOptions();
    if (allowedSemOptions.length > 0 && !allowedSemOptions.includes(String(semValue))) {
      return { error: `Amount ${amount} me sirf SEM ${allowedSemOptions.join(', ')} allowed hai` };
    }

    if (!fromNumber) {
      return { error: 'From number 5 digit hona chahiye' };
    }

    if (rangeError) {
      return { error: rangeError };
    }

    if (!toNumber) {
      return { error: 'To number 5 digit hona chahiye' };
    }

    const quantityValue = Number(semValue) * count;
    const rateValue = Number(amount || 0);

    return {
      row: {
        id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        code: buildRetroTicketCode(parsedCode.resolvedSessionMode, semValue, parsedCode.resolvedPurchaseCategory),
        itemName: getRetroItemName(bookingDate),
        drawDate: bookingDate,
        day: new Date(bookingDate).toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase(),
        prefix: '',
        series: '',
        from: fromNumber,
        to: toNumber,
        quantity: quantityValue,
        rate: rateValue.toFixed(2),
        amount: (quantityValue * rateValue).toFixed(2),
        semValue: String(semValue),
        resolvedSessionMode: parsedCode.resolvedSessionMode,
        resolvedPurchaseCategory: parsedCode.resolvedPurchaseCategory,
        partyName: party.username,
        bookingAmount: String(amount),
        numberStart: fromNumber,
        numberEnd: toNumber
      }
    };
  };

  const findConflictingRetroDraft = (candidateRow, rows = retroDraftRows) => (
    rows.find((row, index) => (
      index !== retroActiveRowIndex
      && String(row.semValue || '') === String(candidateRow.semValue || '')
      && String(row.resolvedSessionMode || '') === String(candidateRow.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(candidateRow.resolvedPurchaseCategory || '')
      && String(row.drawDate || '') === String(candidateRow.drawDate || '')
      && rangesOverlap(row.from, row.to, candidateRow.from, candidateRow.to)
    ))
  );

  const hasPendingRetroEditorValues = () => (
    retroEditorVisible
    && (Boolean(String(retroFromInput || '').trim())
    || Boolean(String(retroToInput || '').trim())
    )
  );

  const startNewRetroDraftRow = () => {
    setRetroEditorVisible(true);
    setRetroCodeInput('');
    setRetroFromInput('');
    setRetroToInput('');
    setRetroActiveRowIndex(retroDraftRows.length);
    window.requestAnimationFrame(() => purchaseFromInputRef.current?.focus());
  };

  const getRetroRowsForSave = async () => {
    const currentRows = [...retroDraftRows];

    if (!hasPendingRetroEditorValues()) {
      return { rows: currentRows };
    }

    const result = buildRetroDraftRow();

    if (result.error) {
      return { error: result.error };
    }

    const conflictingRetroDraft = findConflictingRetroDraft(result.row, currentRows);

    if (conflictingRetroDraft) {
      return {
        error: 'Number already added.',
        details: [`Memo No. ${user?.username || 'N/A'}`],
        title: 'Duplicate Number'
      };
    }

    const stockValidation = await validateRetroRowInStock(result.row);
    if (stockValidation.error) {
      return {
        error: stockValidation.error,
        title: 'Stock Missing'
      };
    }

    if (retroActiveRowIndex < currentRows.length) {
      const updatedRows = [...currentRows];
      updatedRows[retroActiveRowIndex] = {
        ...result.row,
        id: currentRows[retroActiveRowIndex].id,
        entryIds: currentRows[retroActiveRowIndex].entryIds || []
      };
      return { rows: updatedRows, consumedEditor: true, consumedRow: result.row };
    }

    return { rows: [...currentRows, result.row], consumedEditor: true, consumedRow: result.row };
  };

  const validateRetroRowInStock = async (row) => {
    const requestedNumbers = buildConsecutiveNumbers(row.numberStart || row.from, row.numberEnd || row.to);
    if (requestedNumbers.error) {
      return { error: requestedNumbers.error };
    }

    const response = await lotteryService.getPurchases({
      bookingDate: row.drawDate || bookingDate,
      sessionMode: row.resolvedSessionMode || sessionMode,
      status: 'accepted',
      purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory,
      amount: row.bookingAmount || amount,
      boxValue: row.semValue,
      remaining: true
    });

    const availableNumbers = new Set((response.data || []).map((entry) => String(entry.number || '').padStart(5, '0')));
    if (isEditingExistingPurchaseSendMemo) {
      purchaseSendMemoEntries.forEach((entry) => {
        if (
          Number(entry.purchaseMemoNumber || entry.memoNumber || 0) === Number(purchaseSendMemoNumber || 0)
          && String(entry.userId || '') === String(purchaseSendSellerId || '')
          && String(entry.sem || entry.boxValue || '') === String(row.semValue || '')
          && String(entry.amount || '') === String(row.bookingAmount || amount || '')
          && String(entry.sessionMode || '') === String(row.resolvedSessionMode || sessionMode || '')
          && String(entry.purchaseCategory || '') === String(row.resolvedPurchaseCategory || activePurchaseCategory || '')
          && String(getDateOnlyValue(entry.bookingDate || '')) === String(row.drawDate || bookingDate || '')
        ) {
          availableNumbers.add(String(entry.number || '').padStart(5, '0'));
        }
      });
    }
    const missingNumbers = requestedNumbers.numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));

    if (missingNumbers.length > 0) {
      return {
        error: `${formatDisplayDate(row.drawDate || bookingDate)} date me aapke balance stock me ye number nahi hai: ${formatMissingNumberLabel(missingNumbers)}`
      };
    }

    return { ok: true };
  };

  const addRetroDraftRow = () => {
    if (blockingWarning) {
      return;
    }

    const result = buildRetroDraftRow();

    if (result.error) {
      openBlockingWarning(result.error);
      return;
    }

    const conflictingRetroDraft = findConflictingRetroDraft(result.row);

    if (conflictingRetroDraft) {
      openBlockingWarning(
        'Number already added.',
        [`Memo No. ${user?.username || 'N/A'}`],
        'Duplicate Number'
      );
      return;
    }

    Promise.resolve().then(async () => {
      try {
        const stockValidation = await validateRetroRowInStock(result.row);
        if (stockValidation.error) {
          openBlockingWarning(stockValidation.error, [], 'Stock Missing');
          return;
        }
      } catch (err) {
        openBlockingWarning(err.response?.data?.message || 'Stock check nahi ho paya', [], 'Stock Missing');
        return;
      }

      setRetroDraftRows((currentRows) => {
        if (retroActiveRowIndex < currentRows.length) {
          const updatedRows = [...currentRows];
          updatedRows[retroActiveRowIndex] = {
            ...result.row,
            id: currentRows[retroActiveRowIndex].id,
            entryIds: currentRows[retroActiveRowIndex].entryIds || []
          };
          return updatedRows;
        }

        return [...currentRows, result.row];
      });
      setSelectedPartyName(result.row.partyName);
      setPartyKeyword(getPartyKeyword(result.row.partyName));
      setSelectedBox(result.row.semValue);
      setRetroCodeInput(result.row.code || retroCodeInput);
      setRetroFromInput('');
      setRetroToInput('');
      setRetroEditorVisible(true);
      clearBlockingWarning();
      const nextIndex = retroActiveRowIndex < retroDraftRows.length
        ? Math.min(retroActiveRowIndex + 1, retroDraftRows.length)
        : retroDraftRows.length + 1;
      setRetroActiveRowIndex(nextIndex);
      setBookingError('');
      window.requestAnimationFrame(() => {
        purchaseToInputRef.current?.focus();
        purchaseToInputRef.current?.select?.();
      });
    });
  };

  const loadRetroDraftIntoEditor = (targetIndex) => {
    if (targetIndex < retroDraftRows.length) {
      const row = retroDraftRows[targetIndex];
      setRetroEditorVisible(true);
      setRetroCodeInput(row.code || '');
      setRetroFromInput(row.from || '');
      setRetroToInput(row.to || '');
      setSelectedPartyName(row.partyName || selectedPartyName);
      setPartyKeyword(getPartyKeyword(row.partyName || selectedPartyName));
      setSelectedBox(row.semValue || '');
      setRetroActiveRowIndex(targetIndex);
      return;
    }

    setRetroCodeInput('');
    setRetroFromInput('');
    setRetroToInput('');
    setRetroEditorVisible(true);
    setRetroActiveRowIndex(retroDraftRows.length);
  };

  const openPurchaseSendMemoPopup = () => {
    const nextIndex = Math.max(
      purchaseSendMemoOptions.findIndex((option) => Number(option.memoNumber) === Number(purchaseSendMemoNumber) && !option.isNew),
      0
    );
    setPurchaseSendMemoSelectionIndex(nextIndex);
    setPurchaseSendMemoPopupOpen(true);
  };

  const closePurchaseSendMemoPopup = () => {
    setPurchaseSendMemoPopupOpen(false);
  };

  const commitPurchaseSendMemoSelection = (option = highlightedPurchaseSendMemoOption) => {
    if (!option) {
      return;
    }

    setPurchaseSendMemoNumber(option.memoNumber);
    setPurchaseSendMemoSelectionIndex(Math.max(
      purchaseSendMemoOptions.findIndex((currentOption) => currentOption.key === option.key),
      0
    ));
    setPurchaseSendMemoPopupOpen(false);

    if (option.isNew) {
      setRetroDraftRows([]);
      setRetroActiveRowIndex(0);
      setRetroCodeInput('');
      setRetroFromInput('');
      setRetroToInput('');
    } else {
      const selectedEntries = purchaseSendMemoEntries.filter((entry) => (
        Number(entry.purchaseMemoNumber || entry.memoNumber) === Number(option.memoNumber)
      ));
      const draftRows = buildPurchaseSendDraftRowsFromEntries(selectedEntries, amount);
      setRetroDraftRows(draftRows);

      if (draftRows.length > 0) {
        const firstRow = draftRows[0];
        setRetroCodeInput(firstRow.code || '');
        setRetroFromInput(firstRow.from || '');
        setRetroToInput(firstRow.to || '');
        setSelectedPartyName(firstRow.partyName || selectedPartyName);
        setPartyKeyword(getPartyKeyword(firstRow.partyName || selectedPartyName));
        setSelectedBox(firstRow.semValue || '');
        setRetroActiveRowIndex(0);
      } else {
        setRetroActiveRowIndex(0);
        setRetroCodeInput('');
        setRetroFromInput('');
        setRetroToInput('');
      }
    }

    window.requestAnimationFrame(() => purchaseCodeInputRef.current?.focus());
  };

  const unsoldMemoSummaries = buildCurrentMemoSummaries(unsoldMemoEntries);
  const nextUnsoldMemoNumber = unsoldMemoSummaries.length > 0
    ? Math.max(...unsoldMemoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const unsoldMemoOptions = [
    {
      key: `new-unsold-${nextUnsoldMemoNumber}`,
      memoNumber: nextUnsoldMemoNumber,
      isNew: true,
      label: String(nextUnsoldMemoNumber),
      drawDate: bookingDate,
      quantity: ''
    },
    ...unsoldMemoSummaries.map((memo) => ({
      key: `unsold-memo-${memo.memoNumber}`,
      memoNumber: memo.memoNumber,
      isNew: false,
      label: String(memo.memoNumber),
      drawDate: memo.drawDate,
      quantity: memo.totalPieceCount,
      totalPieceCount: memo.totalPieceCount,
      batches: memo.batches
    }))
  ];
  const selectedUnsoldMemoOption = unsoldMemoOptions.find((option) => (
    !option.isNew && Number(option.memoNumber) === Number(unsoldMemoNumber)
  )) || unsoldMemoOptions[0] || null;
  const unsoldRemoveMemoSummaries = buildCurrentMemoSummaries(unsoldRemoveMemoEntries);
  const nextUnsoldRemoveMemoNumber = unsoldRemoveMemoSummaries.length > 0
    ? Math.max(...unsoldRemoveMemoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const unsoldRemoveMemoOptions = [
    {
      key: `unsold-remove-new-${nextUnsoldRemoveMemoNumber}`,
      memoNumber: nextUnsoldRemoveMemoNumber,
      isNew: true,
      label: String(nextUnsoldRemoveMemoNumber),
      drawDate: bookingDate,
      quantity: ''
    },
    ...unsoldRemoveMemoSummaries.map((memo) => ({
      key: `unsold-remove-memo-${memo.memoNumber}`,
      memoNumber: memo.memoNumber,
      isNew: false,
      label: String(memo.memoNumber),
      drawDate: memo.drawDate,
      quantity: memo.totalPieceCount,
      totalPieceCount: memo.totalPieceCount,
      batches: memo.batches
    }))
  ];
  const selectedUnsoldRemoveMemoOption = unsoldRemoveMemoOptions.find((option) => (
    Number(option.memoNumber) === Number(unsoldRemoveMemoNumber)
  )) || unsoldRemoveMemoOptions[0] || null;
  const defaultUnsoldMemoOption = selectedUnsoldMemoOption
    || unsoldMemoOptions.find((option) => !option.isNew)
    || unsoldMemoOptions[0]
    || null;
  const defaultUnsoldRemoveMemoOption = selectedUnsoldRemoveMemoOption
    || unsoldRemoveMemoOptions.find((option) => !option.isNew)
    || unsoldRemoveMemoOptions[0]
    || null;
  const currentUnsoldMemoOptions = activeTab === 'unsold-remove' ? unsoldRemoveMemoOptions : unsoldMemoOptions;
  const currentUnsoldMemoNumber = activeTab === 'unsold-remove' ? unsoldRemoveMemoNumber : unsoldMemoNumber;
  const highlightedUnsoldMemoOption = currentUnsoldMemoOptions[unsoldMemoSelectionIndex]
    || (activeTab === 'unsold-remove' ? selectedUnsoldRemoveMemoOption : selectedUnsoldMemoOption)
    || null;

  const openUnsoldMemoPopup = () => {
    const nextIndex = Math.max(
      currentUnsoldMemoOptions.findIndex((option) => Number(option.memoNumber) === Number(currentUnsoldMemoNumber) && !option.isNew),
      0
    );
    setUnsoldMemoSelectionIndex(nextIndex);
    setUnsoldMemoPopupOpen(true);
  };

  const hydrateUnsoldDraftRowsForMemo = (memoNumber, sourceEntries = unsoldMemoEntries) => {
    const selectedEntries = sourceEntries.filter((entry) => (
      Number(entry.memoNumber) === Number(memoNumber)
    ));
    const draftRows = buildPurchaseSendDraftRowsFromEntries(selectedEntries, amount, {
      existingUnsoldMemo: true,
      existingUnsoldRemoveMemo: true
    });
    setUnsoldDraftRows(draftRows);
    setUnsoldEditorVisible(true);

    if (draftRows.length > 0) {
      const firstRow = draftRows[0];
      setUnsoldActiveRowIndex(0);
      setUnsoldCodeInput(firstRow.code || '');
      setUnsoldTableFromInput(firstRow.from || '');
      setUnsoldTableToInput(firstRow.to || '');
      setUnsoldNumber(firstRow.from || '');
      setUnsoldRangeEndNumber(firstRow.to || '');
      return;
    }

    setUnsoldActiveRowIndex(0);
    setUnsoldCodeInput('');
    setUnsoldTableFromInput('');
    setUnsoldTableToInput('');
    setUnsoldNumber('');
    setUnsoldRangeEndNumber('');
  };

  const hydrateUnsoldRemoveDraftRowsForMemo = (memoNumber, sourceEntries = unsoldRemoveMemoEntries) => {
    const selectedEntries = sourceEntries
      .filter((entry) => Number(entry.memoNumber) === Number(memoNumber))
      .map((entry) => ({
        id: `unsold-remove-history-${entry.id}`,
        number: entry.number,
        sem: entry.boxValue,
        amount: entry.amount,
        bookingDate: entry.bookingDate,
        sessionMode: entry.sessionMode,
        purchaseCategory: entry.purchaseCategory,
        displaySeller: selectedUnsoldParty?.username || user?.username || '',
        userId: selectedUnsoldParty?.id || user?.id || '',
        username: selectedUnsoldParty?.username || user?.username || ''
      }));
    const draftRows = buildPurchaseSendDraftRowsFromEntries(selectedEntries, amount, { existingUnsoldMemo: true });
    setUnsoldDraftRows(draftRows);
    setUnsoldEditorVisible(true);

    if (draftRows.length > 0) {
      const firstRow = draftRows[0];
      setUnsoldActiveRowIndex(0);
      setUnsoldCodeInput(firstRow.code || '');
      setUnsoldTableFromInput(firstRow.from || '');
      setUnsoldTableToInput(firstRow.to || '');
      setUnsoldNumber(firstRow.from || '');
      setUnsoldRangeEndNumber(firstRow.to || '');
      return;
    }

    setUnsoldActiveRowIndex(0);
    setUnsoldCodeInput('');
    setUnsoldTableFromInput('');
    setUnsoldTableToInput('');
    setUnsoldNumber('');
    setUnsoldRangeEndNumber('');
  };

  const commitUnsoldMemoSelection = (option = highlightedUnsoldMemoOption) => {
    if (!option) {
      return;
    }

    if (activeTab === 'unsold-remove') {
      setUnsoldRemoveMemoNumber(option.memoNumber);
    } else {
      setUnsoldMemoNumber(option.memoNumber);
    }
    setUnsoldMemoSelectionIndex(Math.max(
      currentUnsoldMemoOptions.findIndex((currentOption) => currentOption.key === option.key),
      0
    ));
    setUnsoldMemoPopupOpen(false);

    if (option.isNew) {
      setUnsoldDraftRows([]);
      setUnsoldActiveRowIndex(0);
      setUnsoldEditorVisible(true);
      setUnsoldCodeInput('');
      setUnsoldTableFromInput('');
      setUnsoldTableToInput('');
      setUnsoldNumber('');
      setUnsoldRangeEndNumber('');
    } else {
      if (activeTab === 'unsold-remove') {
        hydrateUnsoldRemoveDraftRowsForMemo(option.memoNumber);
      } else {
        hydrateUnsoldDraftRowsForMemo(option.memoNumber);
      }
    }
    window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
  };

  useEffect(() => {
    if (activeTab !== 'unsold' || unsoldMemoNumber !== null || unsoldMemoPopupOpen) {
      return;
    }

    const latestExistingMemoOption = [...unsoldMemoOptions].reverse().find((option) => !option.isNew);
    if (latestExistingMemoOption) {
      setUnsoldMemoNumber(latestExistingMemoOption.memoNumber);
      return;
    }

    const nextNewMemoOption = unsoldMemoOptions[0];
    if (nextNewMemoOption) {
      setUnsoldMemoNumber(nextNewMemoOption.memoNumber);
    }
  }, [activeTab, unsoldMemoNumber, unsoldMemoOptions, unsoldMemoPopupOpen]);

  useEffect(() => {
    if (activeTab !== 'unsold-remove' || unsoldRemoveMemoNumber !== null || unsoldMemoPopupOpen) {
      return;
    }

    const nextNewMemoOption = unsoldRemoveMemoOptions[0];
    if (nextNewMemoOption) {
      setUnsoldRemoveMemoNumber(nextNewMemoOption.memoNumber);
    }
  }, [activeTab, unsoldRemoveMemoNumber, unsoldRemoveMemoOptions, unsoldMemoPopupOpen]);

  useEffect(() => {
    if (activeTab !== 'unsold' || !unsoldMemoNumber || unsoldMemoPopupOpen) {
      return;
    }

    const selectedMemoExists = unsoldMemoEntries.some((entry) => (
      Number(entry.memoNumber) === Number(unsoldMemoNumber)
    ));

    if (selectedMemoExists) {
      hydrateUnsoldDraftRowsForMemo(unsoldMemoNumber, unsoldMemoEntries);
    }
  }, [activeTab, unsoldMemoEntries, unsoldMemoNumber, unsoldMemoPopupOpen]);

  useEffect(() => {
    if (activeTab !== 'unsold-remove' || unsoldMemoPopupOpen) {
      return;
    }

    const selectedMemoExists = unsoldRemoveMemoEntries.some((entry) => (
      Number(entry.memoNumber) === Number(unsoldRemoveMemoNumber)
    ));

    if (selectedMemoExists) {
      hydrateUnsoldRemoveDraftRowsForMemo(unsoldRemoveMemoNumber, unsoldRemoveMemoEntries);
      return;
    }

    setUnsoldDraftRows([]);
    setUnsoldActiveRowIndex(0);
    setUnsoldEditorVisible(true);
    setUnsoldCodeInput('');
    setUnsoldTableFromInput('');
    setUnsoldTableToInput('');
    setUnsoldNumber('');
    setUnsoldRangeEndNumber('');
  }, [activeTab, unsoldRemoveMemoEntries, unsoldRemoveMemoNumber, unsoldMemoPopupOpen, selectedUnsoldParty?.username, amount, user?.username]);

  useEffect(() => {
    const currentMemoOptions = activeTab === 'unsold-remove' ? unsoldRemoveMemoOptions : unsoldMemoOptions;
    const currentMemoNumber = activeTab === 'unsold-remove' ? unsoldRemoveMemoNumber : unsoldMemoNumber;

    if (!['unsold', 'unsold-remove'].includes(activeTab)) {
      return;
    }

    if (currentMemoOptions.length === 0) {
      setUnsoldMemoSelectionIndex(0);
      if (unsoldMemoNumber !== null || unsoldRemoveMemoNumber !== null) {
        setUnsoldMemoNumber(null);
        setUnsoldRemoveMemoNumber(null);
      }
      return;
    }

    const existingMemoOption = currentMemoOptions.find((option) => (
      Number(option.memoNumber) === Number(currentMemoNumber)
    ));

    setUnsoldMemoSelectionIndex((currentIndex) => {
      if (unsoldMemoPopupOpen && currentIndex < currentMemoOptions.length) {
        return currentIndex;
      }

      const selectedIndex = currentMemoOptions.findIndex((option) => option.key === (existingMemoOption || currentMemoOptions[0]).key);
      return Math.max(selectedIndex, 0);
    });
  }, [
    activeTab,
    unsoldMemoOptions,
    unsoldRemoveMemoOptions,
    unsoldMemoNumber,
    unsoldRemoveMemoNumber,
    unsoldMemoPopupOpen
  ]);

  const buildStockLookupFilter = (codeValue) => {
    const normalizedCode = String(codeValue || '').trim();
    if (!normalizedCode) {
      return {
        sessionMode,
        purchaseCategory: activePurchaseCategory,
        boxValue: '',
        label: 'All SEM'
      };
    }

    const parsedCode = parseRetroCodeValue(normalizedCode, sessionMode, activePurchaseCategory);
    if (parsedCode.error) {
      return { error: parsedCode.error };
    }

    return {
      sessionMode: parsedCode.resolvedSessionMode || sessionMode,
      purchaseCategory: parsedCode.resolvedPurchaseCategory || activePurchaseCategory,
      boxValue: parsedCode.semValue,
      label: buildRetroTicketCode(parsedCode.resolvedSessionMode, parsedCode.semValue, parsedCode.resolvedPurchaseCategory)
    };
  };

  const buildStockLookupDetails = (entries = [], filterLabel = 'All SEM') => {
    const normalizedEntries = entries.map((entry) => normalizeSeePurchaseEntry(entry));
    const groupedEntries = groupConsecutiveNumberRows(
      sortRowsForConsecutiveNumbers(
        normalizedEntries,
        (entry) => [entry.bookingDate, entry.sessionMode, entry.purchaseCategory, entry.amount, entry.boxValue, entry.sellerName]
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

  const openStockLookup = async (source) => {
    if (blockingWarning || stockLookupLoading) {
      return;
    }

    const isUnsoldLookup = source === 'unsold';
    const isUnsoldRemoveLookup = source === 'unsold-remove';
    const filter = buildStockLookupFilter((isUnsoldLookup || isUnsoldRemoveLookup) ? unsoldCodeInput : retroCodeInput);
    if (filter.error) {
      openBlockingWarning(filter.error, [], 'F4 Stock');
      return;
    }

    setStockLookupLoading(true);
    setError('');

    try {
      const targetSellerId = (isUnsoldLookup || isUnsoldRemoveLookup) ? unsoldPartyId : '';
      const response = (!isUnsoldLookup && !isUnsoldRemoveLookup && user?.role === 'admin')
        ? await lotteryService.getAdminPurchases({
          bookingDate,
          sessionMode: filter.sessionMode,
          purchaseCategory: filter.purchaseCategory,
          amount,
          boxValue: filter.boxValue || undefined
        })
        : await lotteryService.getPurchases({
          bookingDate,
          sessionMode: filter.sessionMode,
          sellerId: (isUnsoldLookup || isUnsoldRemoveLookup) && String(targetSellerId) !== String(user?.id) ? targetSellerId : undefined,
          status: isUnsoldRemoveLookup ? 'unsold' : 'accepted',
          purchaseCategory: filter.purchaseCategory,
          amount,
          boxValue: filter.boxValue || undefined,
          remaining: (isUnsoldLookup || isUnsoldRemoveLookup) ? undefined : true
        });
      const lookupEntries = isUnsoldRemoveLookup
        ? (response.data || []).map(mapApiEntry).filter(isRemovableUnsoldEntry)
        : isUnsoldLookup
        ? (response.data || []).filter((entry) => {
          const hasMemo = entry.memoNumber !== null && entry.memoNumber !== undefined && String(entry.memoNumber).trim() !== '';
          if (!hasMemo) {
            return false;
          }

          if (String(targetSellerId || user?.id || '') === String(user?.id || '')) {
            return String(entry.forwardedBy || '') === String(user?.id || '');
          }

          return true;
        })
        : (response.data || []);
      const details = buildStockLookupDetails(lookupEntries, filter.label);
      const partyLabel = (isUnsoldLookup || isUnsoldRemoveLookup)
        ? selectedUnsoldParty?.username || user?.username || 'Self'
        : user?.username || 'Self';

      openBlockingWarning(
        lookupEntries.length
          ? isUnsoldRemoveLookup
            ? `${partyLabel} ke unsold remove stock me ye range available hai`
            : `${partyLabel} ke purchase stock me ye range available hai`
          : isUnsoldRemoveLookup
            ? `${partyLabel} ke unsold remove stock me selected filter ka maal nahi hai`
            : `${partyLabel} ke purchase stock me selected filter ka maal nahi hai`,
        details,
        isUnsoldRemoveLookup ? 'F4 Unsold Remove Stock' : isUnsoldLookup ? 'F4 Unsold Stock' : 'F4 Purchase Send Stock'
      );
    } catch (err) {
      openBlockingWarning(err.response?.data?.message || 'Stock lookup error', [], 'F4 Stock');
    } finally {
      setStockLookupLoading(false);
    }
  };

  const moveRetroDraftSelection = (direction) => {
    const nextIndex = Math.min(Math.max(retroActiveRowIndex + direction, 0), retroDraftRows.length);
    loadRetroDraftIntoEditor(nextIndex);
  };

  const deleteRetroDraftRow = async () => {
    if (retroDraftRows.length === 0) {
      setRetroCodeInput('');
      setRetroFromInput('');
      setRetroToInput('');
      setRetroEditorVisible(false);
      return;
    }

    const deleteIndex = retroActiveRowIndex < retroDraftRows.length
      ? retroActiveRowIndex
      : retroDraftRows.length - 1;
    const nextRows = retroDraftRows.filter((_, index) => index !== deleteIndex);

    if (isEditingExistingPurchaseSendMemo) {
      const effectiveMemoNumber = Number(purchaseSendMemoNumber || selectedPurchaseSendMemoOption?.memoNumber || 0);
      if (!effectiveMemoNumber) {
        openBlockingWarning('Memo number select karo');
        return;
      }

      setRetroSaving(true);
      setBookingError('');
      setError('');
      setSuccess('');

      try {
        const currentMemoEntryIds = purchaseSendMemoEntries
          .filter((entry) => (
            Number(entry.purchaseMemoNumber || entry.memoNumber || 0) === effectiveMemoNumber
            && String(entry.userId || '') === String(purchaseSendSellerId || '')
          ))
          .map((entry) => entry.id)
          .filter(Boolean);

        await lotteryService.replacePurchaseSendMemo({
          sellerId: purchaseSendSellerId,
          bookingDate: nextRows[0]?.drawDate || bookingDate,
          memoNumber: effectiveMemoNumber,
          entryIds: currentMemoEntryIds,
          sessionMode,
          amount,
          purchaseCategory: activePurchaseCategory,
          rows: nextRows.map((row) => ({
            rangeStart: row.numberStart || row.from,
            rangeEnd: row.numberEnd || row.to,
            boxValue: row.semValue,
            amount: row.bookingAmount || amount,
            bookingDate: row.drawDate || bookingDate,
            sessionMode: row.resolvedSessionMode || sessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory,
            entryIds: row.entryIds || []
          }))
        });

        await Promise.all([
          loadPurchaseEntries(),
          loadPurchaseSendMemoEntries(purchaseSendSellerId, bookingDate)
        ]);
        setSuccess(nextRows.length === 0
          ? `Memo ${effectiveMemoNumber} deleted; stock returned`
          : `Memo ${effectiveMemoNumber} updated; deleted range stock me wapas aa gaya`);
      } catch (err) {
        setBookingError(err.response?.data?.message || 'Error deleting purchase send row');
        return;
      } finally {
        setRetroSaving(false);
      }
    }

    setRetroDraftRows(nextRows);
    setBookingError('');

    window.requestAnimationFrame(() => {
      if (deleteIndex < nextRows.length) {
        const row = nextRows[deleteIndex];
        setRetroEditorVisible(true);
        setRetroCodeInput(row.code || '');
        setRetroFromInput(row.from || '');
        setRetroToInput(row.to || '');
        setSelectedPartyName(row.partyName || selectedPartyName);
        setPartyKeyword(getPartyKeyword(row.partyName || selectedPartyName));
        setSelectedBox(row.semValue || '');
        setRetroActiveRowIndex(deleteIndex);
      } else {
        setRetroCodeInput('');
        setRetroFromInput('');
        setRetroToInput('');
        setRetroEditorVisible(false);
        setRetroActiveRowIndex(nextRows.length);
      }
      purchaseFromInputRef.current?.focus();
    });
  };

  const saveRetroDraftRows = async () => {
    if (blockingWarning) {
      return;
    }

    if (!purchaseSendSellerId) {
      openBlockingWarning('Sub seller select karo');
      return;
    }

    const rowsForSaveResult = await getRetroRowsForSave();

    if (rowsForSaveResult.error) {
      openBlockingWarning(
        rowsForSaveResult.error,
        rowsForSaveResult.details || [],
        rowsForSaveResult.title || 'Warning'
      );
      return;
    }

    const rowsToSave = rowsForSaveResult.rows || [];

    if (rowsToSave.length === 0 && !isEditingExistingPurchaseSendMemo) {
      openBlockingWarning('Save karne ke liye kam se kam ek row add karo');
      return;
    }

    const isSelfPurchaseSendTarget = String(purchaseSendSellerId) === String(user?.id);
    if (!isSelfPurchaseSendTarget && activeAmountChildSellers.length === 0) {
      openBlockingWarning('Purchase send karne ke liye pehle sub stokist banao');
      return;
    }

    setRetroSaving(true);
    setError('');
    setBookingError('');
    setSuccess('');

    try {
      if (rowsForSaveResult.consumedEditor) {
        setRetroDraftRows(rowsToSave);
        setSelectedPartyName(rowsForSaveResult.consumedRow?.partyName || selectedPartyName);
        setPartyKeyword(getPartyKeyword(rowsForSaveResult.consumedRow?.partyName || selectedPartyName));
        setSelectedBox(rowsForSaveResult.consumedRow?.semValue || selectedBox);
      }

      const effectiveMemoNumber = Number(purchaseSendMemoNumber || nextPurchaseSendMemoNumber);
      const refreshBookingDate = rowsToSave[0]?.drawDate || bookingDate;
      const currentMemoEntryIds = isEditingExistingPurchaseSendMemo
        ? purchaseSendMemoEntries
          .filter((entry) => (
            Number(entry.purchaseMemoNumber || entry.memoNumber || 0) === effectiveMemoNumber
            && String(entry.userId || '') === String(purchaseSendSellerId || '')
          ))
          .map((entry) => entry.id)
          .filter(Boolean)
        : [];

      if (isEditingExistingPurchaseSendMemo) {
        await lotteryService.replacePurchaseSendMemo({
          sellerId: purchaseSendSellerId,
          bookingDate: refreshBookingDate,
          memoNumber: effectiveMemoNumber,
          entryIds: currentMemoEntryIds,
          sessionMode,
          amount,
          purchaseCategory: activePurchaseCategory,
          rows: rowsToSave.map((row) => ({
            rangeStart: row.numberStart || row.from,
            rangeEnd: row.numberEnd || row.to,
            boxValue: row.semValue,
            amount: row.bookingAmount || amount,
            bookingDate: row.drawDate || bookingDate,
            sessionMode: row.resolvedSessionMode || sessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory,
            entryIds: row.entryIds || []
          }))
        });
      } else {
        for (const row of rowsToSave) {
          await lotteryService.sendPurchase({
            sellerId: purchaseSendSellerId,
            series: '',
            rangeStart: row.numberStart,
            rangeEnd: row.numberEnd,
            boxValue: row.semValue,
            amount: row.bookingAmount,
            memoNumber: effectiveMemoNumber,
            bookingDate: row.drawDate || bookingDate,
            sessionMode: row.resolvedSessionMode || sessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory
          });
        }
      }

      const [, refreshedMemoEntries] = await Promise.all([
        loadPurchaseEntries(),
        loadPurchaseSendMemoEntries(purchaseSendSellerId, refreshBookingDate),
        loadSeePurchaseEntries(),
        loadTransferHistory(getHistoryFilters())
      ]);
      const refreshedMemoSummaries = buildCurrentMemoSummaries(refreshedMemoEntries || []);
      const nextMemoNumber = refreshedMemoSummaries.length > 0
        ? Math.max(...refreshedMemoSummaries.map((memo) => memo.memoNumber)) + 1
        : 1;
      setPurchaseSendMemoNumber(nextMemoNumber);
      setPurchaseSendMemoSelectionIndex(0);
      setPurchaseSendMemoPopupOpen(false);
      setRetroDraftRows([]);
      setRetroActiveRowIndex(0);
      setRetroEditorVisible(true);
      setRetroFromInput('');
      setRetroToInput('');
      setRetroCodeInput('');
      setSuccess(isEditingExistingPurchaseSendMemo ? `Memo ${effectiveMemoNumber} updated successfully` : 'Purchase sent successfully');
      focusPurchaseSellerSelectAfterSave();
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Error sending purchase';
      if (String(errorMessage).includes('pehle se use ho chuka hai')) {
        setBookingError('');
        return;
      }
      setBookingError(errorMessage);
    } finally {
      setRetroSaving(false);
    }
  };

  const handleStockTransfer = async () => {
    if (stockTransferTargetOptions.length === 0) {
      setError('Stock transfer ke liye seller nahi mila');
      return;
    }

    if (!stockTransferTargetId) {
      setError('Seller select karo');
      return;
    }

    if (stockTransferEntries.length === 0) {
      setError('No remaining stock to transfer');
      return;
    }

    setStockTransferLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await lotteryService.transferRemainingStock({
        sellerId: stockTransferTargetId,
        bookingDate: stockTransferDate,
        sessionMode,
        purchaseCategory: activePurchaseCategory,
        amount
      });

      setSuccess(response.data?.message || 'Stock transferred successfully');
      setStockTransferEntries([]);
      setBookingDate(stockTransferDate);
      setPurchaseSendSellerId(String(stockTransferTargetId));
      setPurchaseSendMemoNumber(null);
      setPurchaseSendMemoSelectionIndex(0);
      await Promise.all([
        loadPurchaseEntries(),
        loadPurchaseSendMemoEntries(stockTransferTargetId, stockTransferDate),
        loadTransferHistory(getHistoryFilters())
      ]);
    } catch (err) {
      setError(err.response?.data?.message || 'Error transferring stock');
    } finally {
      setStockTransferLoading(false);
    }
  };

  function resetUnsoldEditor({ keepCode = false } = {}) {
    if (!keepCode) {
      setUnsoldCodeInput('');
    }
    setUnsoldTableFromInput('');
    setUnsoldTableToInput('');
    setUnsoldNumber('');
    setUnsoldRangeEndNumber('');
    setUnsoldMode('single');
  }

  function startNewUnsoldRow() {
    if (activeTab === 'unsold') {
      setUnsoldMemoNumber(nextUnsoldMemoNumber);
      setUnsoldMemoSelectionIndex(0);
      setUnsoldMemoPopupOpen(false);
      setUnsoldDraftRows([]);
    }

    setUnsoldEditorVisible(true);
    resetUnsoldEditor({ keepCode: false });
    setUnsoldActiveRowIndex(0);
    window.requestAnimationFrame(() => {
      unsoldCodeInputRef.current?.focus();
      unsoldCodeInputRef.current?.select?.();
    });
  }

  function deleteUnsoldDraftRow() {
    resetUnsoldEditor({ keepCode: false });
    setUnsoldDraftRows((currentRows) => {
      if (currentRows.length === 0 || unsoldActiveRowIndex >= currentRows.length) {
        setUnsoldEditorVisible(false);
        setUnsoldActiveRowIndex(currentRows.length);
        return currentRows;
      }

      setUnsoldEditorVisible(true);
      const nextRows = currentRows.filter((_, index) => index !== unsoldActiveRowIndex);
      setUnsoldActiveRowIndex(Math.min(unsoldActiveRowIndex, nextRows.length));
      return nextRows;
    });
    window.requestAnimationFrame(() => {
      unsoldCodeInputRef.current?.focus();
      unsoldCodeInputRef.current?.select?.();
    });
  }

  useFunctionShortcuts(!billOnlyMode && activeTab === 'purchase-send', {
    A: () => {
      if (blockingWarning) {
        return;
      }
      startNewRetroDraftRow();
    },
    F2: () => {
      if (blockingWarning) {
        return;
      }
      if (!retroSaving) {
        saveRetroDraftRows();
      }
    },
    F3: () => {
      if (blockingWarning) {
        return;
      }
      deleteRetroDraftRow();
    },
    F4: () => {
      openStockLookup('purchase-send');
    },
    F8: () => {
      if (blockingWarning) {
        return;
      }
      setRetroDraftRows([]);
      setRetroActiveRowIndex(0);
      setSelectedBox('');
      setRetroFromInput('');
      setRetroToInput('');
      setRetroCodeInput('');
      setRetroEditorVisible(true);
      setBookingError('');
    },
    ESCAPE: () => {
      if (blockingWarning) {
        clearBlockingWarning();
        return;
      }
      requestExitConfirmation();
    }
  });

  useFunctionShortcuts(!billOnlyMode, {
    F10: () => {
      loadPieceSummary();
    },
    F11: () => {
      loadUnsoldSendSummary();
    }
  });

  useFunctionShortcuts(!billOnlyMode && (activeTab === 'unsold' || activeTab === 'unsold-remove'), {
    A: () => {
      void handleAddUnsoldAction();
    },
    F2: () => {
      if (blockingWarning) {
        return;
      }
      if (!unsoldLoading) {
        document.getElementById(activeTab === 'unsold-remove' ? 'seller-unsold-remove-form' : 'seller-unsold-form')?.requestSubmit();
      }
    },
    F3: () => {
      if (blockingWarning) {
        return;
      }
      deleteUnsoldDraftRow();
    },
    F4: () => {
      openStockLookup(activeTab === 'unsold-remove' ? 'unsold-remove' : 'unsold');
    },
    F8: () => {
      if (blockingWarning) {
        return;
      }
      setUnsoldCodeInput('');
      setUnsoldTableFromInput('');
      setUnsoldTableToInput('');
      setUnsoldNumber('');
      setUnsoldRangeEndNumber('');
      setUnsoldDraftRows([]);
      setUnsoldActiveRowIndex(0);
    },
    ESCAPE: () => {
      if (blockingWarning) {
        clearBlockingWarning();
        return;
      }
      requestExitConfirmation();
    }
  });

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
        entry.amount === amount
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
      setAmount(initialAmount || amount);
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

    if (isTodayBookingDate && isSendDeadlinePassed) {
      setError(`Send Entries time ended for ${sessionMode}. Last time was ${sessionDeadlineLabel}`);
      return;
    }

    setSendingEntries(true);
    setError('');
    setSuccess('');

    try {
      await lotteryService.sendEntries({ bookingDate, amount });
      await Promise.all([loadMySentEntries(), loadReceivedEntries(), loadAcceptedBookEntries(), loadTransferHistory(getHistoryFilters())]);
      setEntries([]);
      setSuccess(`Entries sent successfully`);
    } catch (err) {
      setError(err.response?.data?.message || 'Error sending entries');
    } finally {
      setSendingEntries(false);
    }
  };

  const buildUnsoldDraftRow = () => {
    const parsedCode = parseRetroCodeValue(unsoldCodeInput, sessionMode, activePurchaseCategory);
    const previousRow = unsoldDraftRows[Math.min(unsoldActiveRowIndex, unsoldDraftRows.length) - 1] || null;
    const { fromNumber, toNumber, count, error: rangeError } = getFiveDigitRangeMetrics(unsoldTableFromInput, unsoldTableToInput, previousRow?.from);

    if (!selectedUnsoldParty) {
      return { error: 'Party name select karo' };
    }

    if (!amount) {
      return { error: 'Amount select karo' };
    }

    if (parsedCode.error) {
      return { error: parsedCode.error };
    }

    if (!parsedCode.semValue) {
      return { error: 'Code/SEM enter karo' };
    }

    if (!fromNumber) {
      return { error: 'From number 5 digit hona chahiye' };
    }

    if (rangeError) {
      return { error: rangeError };
    }

    if (!toNumber) {
      return { error: 'To number 5 digit hona chahiye' };
    }

    const quantityValue = Number(parsedCode.semValue) * count;
    const rateValue = Number(amount || 0);

    return {
      row: {
        id: `unsold-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        code: buildRetroTicketCode(parsedCode.resolvedSessionMode, parsedCode.semValue, parsedCode.resolvedPurchaseCategory),
        itemName: getRetroItemName(bookingDate),
        drawDate: bookingDate,
        day: getDisplayDay(bookingDate),
        prefix: '',
        series: '',
        from: fromNumber,
        to: toNumber,
        quantity: quantityValue,
        rate: rateValue.toFixed(2),
        amount: (quantityValue * rateValue).toFixed(2),
        semValue: String(parsedCode.semValue),
        bookingAmount: String(amount),
        resolvedSessionMode: parsedCode.resolvedSessionMode,
        resolvedPurchaseCategory: parsedCode.resolvedPurchaseCategory,
        partyId: String(selectedUnsoldParty.id),
        partyName: selectedUnsoldParty.username,
        numberStart: fromNumber,
        numberEnd: toNumber
      }
    };
  };

  const hasPendingUnsoldEditorValues = () => (
    unsoldEditorVisible
    && (Boolean(String(unsoldTableFromInput || '').trim())
    || Boolean(String(unsoldTableToInput || '').trim())
    )
  );

  const validateUnsoldRowInStock = async (row) => {
    const requestedNumbers = buildConsecutiveNumbers(row.numberStart || row.from, row.numberEnd || row.to);
    if (requestedNumbers.error) {
      return { error: requestedNumbers.error };
    }

    const existingUnsoldNumbers = new Set(
      unsoldMemoEntries
        .filter((entry) => (
          String(entry.sem || '') === String(row.semValue || '')
          && String(entry.amount || '') === String(row.bookingAmount || amount || '')
          && String(entry.sessionMode || '') === String(row.resolvedSessionMode || sessionMode || '')
          && String(entry.purchaseCategory || '') === String(row.resolvedPurchaseCategory || activePurchaseCategory || '')
          && getDateOnlyValue(entry.bookingDate) === getDateOnlyValue(row.drawDate || bookingDate)
        ))
        .map((entry) => String(entry.number || '').padStart(5, '0'))
    );
    const duplicateUnsoldNumbers = requestedNumbers.numbers.filter((currentNumber) => existingUnsoldNumbers.has(currentNumber));

    if (duplicateUnsoldNumbers.length > 0) {
      return {
        error: `Ye number pehle se unsold me save hai: ${formatMissingNumberLabel(duplicateUnsoldNumbers)}`
      };
    }

    const response = await lotteryService.getPurchases({
      bookingDate: row.drawDate || bookingDate,
      sessionMode: row.resolvedSessionMode || sessionMode,
      sellerId: String(row.partyId || '') === String(user?.id) ? undefined : row.partyId,
      status: 'accepted',
      purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory,
      amount: row.bookingAmount || amount,
      boxValue: row.semValue
    });

    const partyId = String(row.partyId || user?.id || '');
    const partyOption = unsoldPartyOptions.find((party) => String(party.id) === partyId) || selectedUnsoldParty || {};
    const memoStockEntries = (response.data || []).filter((entry) => {
      const hasMemo = entry.memoNumber !== null && entry.memoNumber !== undefined && String(entry.memoNumber).trim() !== '';
      if (!hasMemo) {
        return false;
      }

      if (partyId === String(user?.id || '')) {
        return String(entry.forwardedBy || '') === String(user?.id || '');
      }

      return true;
    });
    const availableNumbers = new Set(memoStockEntries.map((entry) => String(entry.number || '').padStart(5, '0')));
    const missingNumbers = requestedNumbers.numbers.filter((currentNumber) => !availableNumbers.has(currentNumber));

    if (missingNumbers.length > 0) {
      return {
        error: `${formatDisplayDate(row.drawDate || bookingDate)} date me ${partyOption.username || 'selected party'} ke ${partyId === String(user?.id || '') ? 'self stock transfer' : 'purchase stock'} me ye number nahi hai: ${formatMissingNumberLabel(missingNumbers)}`
      };
    }

    return { ok: true };
  };

  const handleAddUnsoldAction = async () => {
    if (blockingWarning) {
      return;
    }

    if (!hasPendingUnsoldEditorValues()) {
      startNewUnsoldRow();
      return;
    }

    const canCommit = await validateUnsoldEditorRowBeforeCommit();
    if (!canCommit) {
      return;
    }

    await addUnsoldDraftRow();
  };

  const validateUnsoldRowInRemovableStock = async (row) => {
    const partyId = String(row.partyId || selectedUnsoldParty?.id || user?.id || '');
    const payload = {
      bookingDate: row.drawDate || bookingDate,
      sessionMode: row.resolvedSessionMode || sessionMode,
      purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory,
      sellerId: partyId === String(user?.id || '') ? undefined : partyId,
      amount: row.bookingAmount || amount,
      boxValue: row.semValue,
      rangeStart: row.numberStart || row.from,
      rangeEnd: row.numberEnd || row.to
    };

    try {
      await lotteryService.checkPurchaseUnsoldRemove(payload);
      return { ok: true };
    } catch (err) {
      const requestedNumbers = buildConsecutiveNumbers(payload.rangeStart, payload.rangeEnd);
      if (requestedNumbers.error) {
        return { error: err.response?.data?.message || requestedNumbers.error };
      }

      const response = await lotteryService.getPurchases({
        bookingDate: payload.bookingDate,
        sessionMode: payload.sessionMode,
        sellerId: payload.sellerId,
        status: 'unsold',
        purchaseCategory: payload.purchaseCategory,
        amount: payload.amount,
        boxValue: payload.boxValue
      });
      const lookupEntries = (response.data || []).map(mapApiEntry).filter(isRemovableUnsoldEntry);
      const removableNumbers = new Set(lookupEntries
        .map((entry) => String(entry.number || '').padStart(5, '0')));
      const missingNumbers = requestedNumbers.numbers.filter((currentNumber) => !removableNumbers.has(currentNumber));

      if (missingNumbers.length === 0) {
        return { ok: true };
      }

      const partyOption = unsoldPartyOptions.find((party) => String(party.id) === partyId) || selectedUnsoldParty || {};
      return {
        error: err.response?.data?.message
          || `${formatDisplayDate(payload.bookingDate)} date me ${partyOption.username || 'selected party'} ke unsold remove stock me ye number nahi hai: ${formatMissingNumberLabel(missingNumbers)}`
      };
    }
  };

  const addUnsoldDraftRow = async () => {
    if (blockingWarning) {
      return false;
    }

    const result = buildUnsoldDraftRow();

    if (result.error) {
      openBlockingWarning(result.error);
      return false;
    }

    const isUnsoldRemoveMode = activeTab === 'unsold-remove';
    const editingExistingUnsoldRow = Boolean(unsoldDraftRows[unsoldActiveRowIndex]?.isExistingUnsoldMemoRow);

    try {
      const stockValidation = editingExistingUnsoldRow
        ? { ok: true }
        : isUnsoldRemoveMode
          ? await validateUnsoldRowInRemovableStock(result.row)
          : await validateUnsoldRowInStock(result.row);
      if (stockValidation.error) {
        openBlockingWarning(
          stockValidation.error,
          [],
          isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
          focusUnsoldFromInput
        );
        return false;
      }
    } catch (err) {
      openBlockingWarning(
        err.response?.data?.message || (isUnsoldRemoveMode ? 'Unsold check nahi ho paya' : 'Stock check nahi ho paya'),
        [],
        isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
        focusUnsoldFromInput
      );
      return false;
    }

    const conflictingDraft = unsoldDraftRows.find((row, index) => (
      index !== unsoldActiveRowIndex
      && String(row.partyId || '') === String(result.row.partyId || '')
      && String(row.semValue || '') === String(result.row.semValue || '')
      && String(row.resolvedSessionMode || '') === String(result.row.resolvedSessionMode || '')
      && String(row.resolvedPurchaseCategory || '') === String(result.row.resolvedPurchaseCategory || '')
      && String(row.drawDate || '') === String(result.row.drawDate || '')
      && rangesOverlap(row.from, row.to, result.row.from, result.row.to)
    ));

    if (conflictingDraft) {
      openBlockingWarning('Number already added.', [`Party ${conflictingDraft.partyName || 'N/A'}`], 'Duplicate Number', focusUnsoldFromInput);
      return false;
    }

    setUnsoldDraftRows((currentRows) => {
      if (unsoldActiveRowIndex < currentRows.length) {
        const updatedRows = [...currentRows];
        updatedRows[unsoldActiveRowIndex] = {
          ...result.row,
          id: currentRows[unsoldActiveRowIndex].id,
          isExistingUnsoldMemoRow: currentRows[unsoldActiveRowIndex].isExistingUnsoldMemoRow,
          isExistingUnsoldRemoveMemoRow: currentRows[unsoldActiveRowIndex].isExistingUnsoldRemoveMemoRow,
          isEditedUnsoldRemoveRow: activeTab === 'unsold-remove'
            ? !currentRows[unsoldActiveRowIndex].isExistingUnsoldRemoveMemoRow
            : currentRows[unsoldActiveRowIndex].isEditedUnsoldRemoveRow,
          entryIds: currentRows[unsoldActiveRowIndex].entryIds || []
        };
        return updatedRows;
      }

      return [...currentRows, result.row];
    });
    setUnsoldCodeInput(result.row.code || unsoldCodeInput);
    resetUnsoldEditor({ keepCode: true });
    setUnsoldEditorVisible(true);
    setUnsoldActiveRowIndex((currentIndex) => currentIndex < unsoldDraftRows.length ? currentIndex + 1 : unsoldDraftRows.length + 1);
    window.requestAnimationFrame(() => {
      unsoldFromInputRef.current?.focus();
      unsoldFromInputRef.current?.select?.();
    });
    return true;
  };

  const validateUnsoldEditorRowBeforeCommit = async () => {
    const result = buildUnsoldDraftRow();

    if (result.error) {
      openBlockingWarning(result.error, [], 'Warning', focusUnsoldFromInput);
      return false;
    }

    const isUnsoldRemoveMode = activeTab === 'unsold-remove';
    const editingExistingUnsoldRow = Boolean(unsoldDraftRows[unsoldActiveRowIndex]?.isExistingUnsoldMemoRow);

    try {
      const stockValidation = editingExistingUnsoldRow
        ? { ok: true }
        : isUnsoldRemoveMode
          ? await validateUnsoldRowInRemovableStock(result.row)
          : await validateUnsoldRowInStock(result.row);

      if (stockValidation.error) {
        openBlockingWarning(
          stockValidation.error,
          [],
          isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
          focusUnsoldFromInput
        );
        return false;
      }
    } catch (err) {
      openBlockingWarning(
        err.response?.data?.message || (isUnsoldRemoveMode ? 'Unsold check nahi ho paya' : 'Stock check nahi ho paya'),
        [],
        isUnsoldRemoveMode ? 'Unsold Missing' : 'Stock Missing',
        focusUnsoldFromInput
      );
      return false;
    }

    return true;
  };

  const handleRemoveUnsold = async (event) => {
    event?.preventDefault?.();
    if (blockingWarning) {
      return;
    }
    setError('');
    setSuccess('');

    let rowsToSave = unsoldDraftRows.filter((row) => (
      !row.isExistingUnsoldMemoRow && !row.isExistingUnsoldRemoveMemoRow
    ));

    const activeUnsoldRemoveMemoRow = unsoldDraftRows[unsoldActiveRowIndex];
    if (hasPendingUnsoldEditorValues() && !activeUnsoldRemoveMemoRow?.isExistingUnsoldRemoveMemoRow) {
      openBlockingWarning('Pehle A-Add ya Enter se row confirm karo, uske baad Remove karo', [], 'Warning', focusUnsoldFromInput);
      return;
    }

    if (rowsToSave.length === 0) {
      if (unsoldDraftRows.some((row) => row.isExistingUnsoldRemoveMemoRow)) {
        setSuccess(`Unsold remove memo ${unsoldRemoveMemoNumber || selectedUnsoldRemoveMemoOption?.memoNumber || ''} already saved`);
        focusActiveSellerSelect();
        return;
      }
      openBlockingWarning('Remove karne ke liye kam se kam ek row add karo');
      return;
    }

    setUnsoldLoading(true);

    try {
      const effectiveMemoNumber = unsoldRemoveMemoNumber || selectedUnsoldRemoveMemoOption?.memoNumber || nextUnsoldRemoveMemoNumber;
      if (!effectiveMemoNumber) {
        openBlockingWarning('Unsold remove memo select karo');
        return;
      }
      for (const row of rowsToSave) {
        const effectivePartyId = String(row.partyId || selectedUnsoldParty?.id || user?.id || '');
        await lotteryService.removePurchaseUnsold({
          bookingDate: row.drawDate || bookingDate,
          sessionMode: row.resolvedSessionMode || sessionMode,
          purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory,
          sellerId: effectivePartyId === String(user?.id) ? undefined : effectivePartyId,
          memoNumber: effectiveMemoNumber,
          amount: row.bookingAmount || amount,
          boxValue: row.semValue,
          rangeStart: row.numberStart || row.from,
          rangeEnd: row.numberEnd || row.to
        });
      }

      setSuccess(`Unsold removed successfully in memo ${effectiveMemoNumber}`);
      setUnsoldMemoNumber(null);
      setUnsoldRemoveMemoNumber(effectiveMemoNumber + 1);
      setUnsoldMemoSelectionIndex(0);
      setUnsoldMemoPopupOpen(false);
      setUnsoldDraftRows([]);
      setUnsoldActiveRowIndex(0);
      setUnsoldEditorVisible(true);
      setUnsoldCodeInput('');
      setUnsoldTableFromInput('');
      setUnsoldTableToInput('');
      setUnsoldNumber('');
      setUnsoldRangeEndNumber('');
      focusActiveSellerSelect();
      await Promise.all([
        loadPurchaseEntries(),
        loadUnsoldMemoEntries(unsoldPartyId, bookingDate),
        loadUnsoldRemoveMemoEntries(unsoldPartyId, bookingDate),
        loadTransferHistory(getHistoryFilters())
      ]);
      await refreshUnsoldDerivedViews();
      focusActiveSellerSelect();
    } catch (err) {
      setError(err.response?.data?.message || 'Error removing unsold');
    } finally {
      setUnsoldLoading(false);
    }
  };

  const handleMarkUnsold = async (event) => {
    event?.preventDefault?.();
    if (blockingWarning) {
      return;
    }
    setError('');
    setSuccess('');

    let rowsToSave = [...unsoldDraftRows];

    if (hasPendingUnsoldEditorValues()) {
      openBlockingWarning('Pehle A-Add karke row confirm karo, uske baad Save karo', [], 'Warning', focusUnsoldFromInput);
      return;
    }

    const editingExistingUnsoldMemo = Boolean(selectedUnsoldMemoOption && !selectedUnsoldMemoOption.isNew);

    if (rowsToSave.length === 0 && !editingExistingUnsoldMemo) {
      openBlockingWarning('Save karne ke liye kam se kam ek row add karo');
      return;
    }

    try {
    for (const row of rowsToSave) {
      if (row.isExistingUnsoldMemoRow) {
        continue;
      }
      const stockValidation = await validateUnsoldRowInStock(row);
      if (stockValidation.error) {
        openBlockingWarning(stockValidation.error, [], 'Stock Missing', focusUnsoldFromInput);
          return;
        }
      }
    } catch (err) {
      openBlockingWarning(err.response?.data?.message || 'Stock check nahi ho paya', [], 'Stock Missing', focusUnsoldFromInput);
      return;
    }

    setUnsoldLoading(true);

    try {
      const effectiveMemoNumber = unsoldMemoNumber || selectedUnsoldMemoOption?.memoNumber || nextUnsoldMemoNumber;
      if (editingExistingUnsoldMemo) {
        await lotteryService.replacePurchaseUnsoldMemo({
          sellerId: String(unsoldPartyId || '') === String(user?.id) ? undefined : unsoldPartyId,
          bookingDate,
          memoNumber: effectiveMemoNumber,
          sessionMode,
          amount,
          purchaseCategory: activePurchaseCategory,
          rows: rowsToSave.map((row) => ({
            rangeStart: row.numberStart || row.from,
            rangeEnd: row.numberEnd || row.to,
            boxValue: row.semValue,
            amount: row.bookingAmount || amount,
            bookingDate: row.drawDate || bookingDate,
            sessionMode: row.resolvedSessionMode || sessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory
          }))
        });
      } else {
        for (const row of rowsToSave) {
          await lotteryService.markPurchaseUnsold({
            bookingDate: row.drawDate || bookingDate,
            sessionMode: row.resolvedSessionMode || sessionMode,
            purchaseCategory: row.resolvedPurchaseCategory || activePurchaseCategory,
            sellerId: String(row.partyId || '') === String(user?.id) ? undefined : row.partyId,
            memoNumber: effectiveMemoNumber,
            amount: row.bookingAmount || amount,
            boxValue: row.semValue,
            rangeStart: row.numberStart || row.from,
            rangeEnd: row.numberEnd || row.to
          });
        }
      }

      setSuccess(`Unsold marked successfully in memo ${effectiveMemoNumber}`);
      const [, refreshedUnsoldEntries] = await Promise.all([
        loadPurchaseEntries(),
        loadUnsoldMemoEntries(unsoldPartyId, bookingDate),
        loadMySentEntries(),
        loadTransferHistory(getHistoryFilters())
      ]);
      await refreshUnsoldDerivedViews();
      if (editingExistingUnsoldMemo && rowsToSave.length > 0) {
        setUnsoldMemoNumber(effectiveMemoNumber);
        hydrateUnsoldDraftRowsForMemo(effectiveMemoNumber, refreshedUnsoldEntries);
        focusActiveSellerSelect();
      } else {
        setUnsoldMemoNumber(effectiveMemoNumber + 1);
        setUnsoldDraftRows([]);
        setUnsoldActiveRowIndex(0);
        setUnsoldEditorVisible(true);
        setUnsoldCodeInput('');
        setUnsoldTableFromInput('');
        setUnsoldTableToInput('');
        setUnsoldNumber('');
        setUnsoldRangeEndNumber('');
        focusActiveSellerSelect();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Error marking unsold');
    } finally {
      setUnsoldLoading(false);
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
        groupedEntries.map((currentEntry) => lotteryService.updateReceivedEntryStatus(currentEntry.id, action, { amount }))
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

  const filteredBillPrizeResults = billPrizeResults.filter((record) => {
    const amountMatches = historyAmountFilter
      ? String(record.amount || '') === String(historyAmountFilter)
      : true;
    const categoryMatches = historyPurchaseCategoryFilter
      ? String(record.purchaseCategory || (record.sessionMode === 'NIGHT' ? 'E' : 'M')).trim().toUpperCase() === String(historyPurchaseCategoryFilter).trim().toUpperCase()
      : true;

    return amountMatches && categoryMatches;
  });
  const currentPurchaseBillRows = purchaseBillRows.filter((record) => (
    !historySellerFilter || record.billRootUsername === historySellerFilter || record.sellerName === historySellerFilter
  ));
  const billData = buildBillData({
    records: [],
    prizeRecords: filteredBillPrizeResults,
    treeData,
    selectedSellerUsername: historySellerFilter
  });
  const billTransferHistory = currentPurchaseBillRows;
  const transferHistoryByActor = groupTransferHistoryByActor(transferHistory);
  const billTransferHistoryByActor = currentPurchaseBillRows.reduce((groups, record) => {
    const groupName = record.billRootUsername || record.sellerName || 'Unknown Seller';
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(record);
    return groups;
  }, {});
  const billGroupedSummaries = Object.entries(billTransferHistoryByActor).reduce((accumulator, [billSellerName, records]) => {
    accumulator[billSellerName] = buildBillSummaryWithPrize(records, billData.prizeTotalsByRoot?.[billSellerName] || {});
    return accumulator;
  }, {});
  const billGroupedAmountSummaries = Object.entries(billTransferHistoryByActor).reduce((accumulator, [billSellerName, records]) => {
    accumulator[billSellerName] = buildBillAmountSummariesWithPrize(
      records,
      billData.prizeTotalsByRootAndAmount?.[billSellerName] || {}
    );
    return accumulator;
  }, {});
  const billTransferHistoryTotals = Object.entries(billTransferHistoryByActor).reduce((totals, [billSellerName]) => {
    const summary = billGroupedSummaries[billSellerName];
    if (!summary) {
      return totals;
    }
    totals.recordCount += summary.recordCount;
    totals.totalPiece += summary.totalPiece;
    totals.totalSentPiece += summary.totalSentPiece;
    totals.totalUnsoldPiece += summary.totalUnsoldPiece;
    totals.totalSoldPiece += summary.totalSoldPiece;
    totals.totalSales += summary.totalSales;
    totals.totalPrize += summary.totalPrize;
    totals.totalVc += summary.totalVc;
    totals.totalSvc += summary.totalSvc;
    totals.netBill += summary.netBill;
    return totals;
  }, {
    recordCount: 0,
    totalPiece: 0,
    totalSentPiece: 0,
    totalUnsoldPiece: 0,
    totalSoldPiece: 0,
    totalSales: 0,
    totalPrize: 0,
    totalVc: 0,
    totalSvc: 0,
    netBill: 0
  });
  const sellerBillSummaryRows = Object.entries(billGroupedSummaries)
    .map(([billSellerName, summary]) => ({
      sellerName: billSellerName,
      ...summary
    }))
    .sort((left, right) => String(left.sellerName || '').localeCompare(String(right.sellerName || '')));
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

  const historyPeriodLabel = historyFromDate === historyToDate
    ? formatDisplayDate(historyFromDate)
    : `${formatDisplayDate(historyFromDate)} to ${formatDisplayDate(historyToDate)}`;
  const sellerUnsoldTimestamp = currentDateTime.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).replace(',', '');
  const purchaseSendMemoSummaries = buildPurchaseMemoSummaries(purchaseSendMemoEntries);
  const nextPurchaseSendMemoNumber = purchaseSendMemoSummaries.length > 0
    ? Math.max(...purchaseSendMemoSummaries.map((memo) => memo.memoNumber)) + 1
    : 1;
  const purchaseSendMemoOptions = [
    {
      key: `new-seller-send-${nextPurchaseSendMemoNumber}`,
      memoNumber: nextPurchaseSendMemoNumber,
      isNew: true,
      label: String(nextPurchaseSendMemoNumber),
      drawDate: bookingDate,
      quantity: ''
    },
    ...purchaseSendMemoSummaries.map((memo) => ({
      key: `seller-send-memo-${memo.memoNumber}`,
      memoNumber: memo.memoNumber,
      isNew: false,
      label: String(memo.memoNumber),
      drawDate: memo.drawDate,
      quantity: memo.totalPieceCount,
      totalPieceCount: memo.totalPieceCount,
      batches: memo.batches
    }))
  ];
  const selectedPurchaseSendMemoOption = purchaseSendMemoOptions.find((option) => (
    !option.isNew && Number(option.memoNumber) === Number(purchaseSendMemoNumber)
  )) || purchaseSendMemoOptions[0] || null;
  const isEditingExistingPurchaseSendMemo = purchaseSendMemoSummaries.some((memo) => (
    Number(memo.memoNumber) === Number(purchaseSendMemoNumber)
  ));
  const highlightedPurchaseSendMemoOption = purchaseSendMemoOptions[purchaseSendMemoSelectionIndex] || selectedPurchaseSendMemoOption || null;
  const sellerPurchaseSummaryQuantity = retroDraftRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const sellerPurchaseSummaryAmount = retroDraftRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const sellerUnsoldSummaryQuantity = unsoldDraftRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const sellerUnsoldSummaryAmount = unsoldDraftRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const sellerPurchasePreview = buildPurchasePreview();
  const sellerPurchaseGridRows = createRetroGridRows(retroDraftRows);
  const sellerPurchaseEditableRow = (
    <tr key="seller-purchase-entry">
      <td>{retroActiveRowIndex + 1}</td>
      <td>
        <input
          ref={purchaseFromInputRef}
          type="text"
          value={retroCodeInput}
          onChange={(e) => setRetroCodeInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              moveRetroDraftSelection(-1);
              window.requestAnimationFrame(() => {
                purchaseFromInputRef.current?.focus();
                purchaseFromInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              moveRetroDraftSelection(1);
              window.requestAnimationFrame(() => {
                purchaseFromInputRef.current?.focus();
                purchaseFromInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              e.stopPropagation();
              const rawCode = String(e.currentTarget.value || '').trim();
              if (!rawCode) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => purchaseFromInputRef.current?.focus());
                });
                return;
              }
              const parsed = parseRetroCodeValue(rawCode, sessionMode, activePurchaseCategory);
              if (parsed.error) {
                openBlockingWarning(parsed.error, [], 'Warning', () => {
                  setRetroCodeInput('');
                  window.requestAnimationFrame(() => purchaseFromInputRef.current?.focus());
                });
                return;
              }
              setSelectedBox(parsed.semValue);
              setActivePurchaseCategory(parsed.resolvedPurchaseCategory || activePurchaseCategory);
              setRetroCodeInput(buildRetroTicketCode(parsed.resolvedSessionMode, parsed.semValue, parsed.resolvedPurchaseCategory));
              setBookingError('');
              window.requestAnimationFrame(() => purchaseGridDateInputRef.current?.focus());
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              const rawCode = String(e.currentTarget.value || '').trim();
              if (!rawCode) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => purchaseFromInputRef.current?.focus());
                });
                return;
              }
              const parsed = parseRetroCodeValue(rawCode, sessionMode, activePurchaseCategory);
              if (parsed.error) {
                openBlockingWarning(parsed.error, [], 'Warning', () => {
                  setRetroCodeInput('');
                  window.requestAnimationFrame(() => purchaseFromInputRef.current?.focus());
                });
                return;
              }
              setSelectedBox(parsed.semValue);
              setActivePurchaseCategory(parsed.resolvedPurchaseCategory || activePurchaseCategory);
              setRetroCodeInput(buildRetroTicketCode(parsed.resolvedSessionMode, parsed.semValue, parsed.resolvedPurchaseCategory));
              setBookingError('');
              window.requestAnimationFrame(() => purchaseGridDateInputRef.current?.focus());
            }
          }}
          placeholder="M5 / D5 / E5 / 5"
        />
      </td>
      <td>{sellerPurchasePreview?.itemName || ''}</td>
      <td>
        <input
          ref={purchaseGridDateInputRef}
          type="date"
          value={bookingDate}
          onChange={(e) => setBookingDate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                purchaseFromInputRef.current?.focus();
                purchaseFromInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'ArrowRight' || e.key === 'Enter') {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                purchaseToInputRef.current?.focus();
                purchaseToInputRef.current?.select?.();
              });
            }
          }}
        />
      </td>
      <td>{sellerPurchasePreview?.day || ''}</td>
      <td>
        <input
          ref={purchaseToInputRef}
          type="text"
          value={retroFromInput}
          onChange={(e) => {
            const normalized = String(e.target.value).replace(/[^0-9]/g, '').slice(0, 5);
            setRetroFromInput(normalized);
            if (normalized.length === 5) {
              setRetroToInput(normalized);
              window.requestAnimationFrame(() => {
                purchaseCodeInputRef.current?.focus();
                purchaseCodeInputRef.current?.select?.();
              });
            }
          }}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              moveRetroDraftSelection(-1);
              window.requestAnimationFrame(() => {
                purchaseToInputRef.current?.focus();
                purchaseToInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              moveRetroDraftSelection(1);
              window.requestAnimationFrame(() => {
                purchaseToInputRef.current?.focus();
                purchaseToInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => purchaseGridDateInputRef.current?.focus());
              return;
            }

            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                purchaseCodeInputRef.current?.focus();
                purchaseCodeInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              const previousRow = retroDraftRows[Math.min(retroActiveRowIndex, retroDraftRows.length) - 1] || null;
              if (!String(retroCodeInput || '').trim()) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => purchaseFromInputRef.current?.focus());
                });
                return;
              }
              const normalizedFrom = normalizeRangeStartNumber(retroFromInput, previousRow?.from);
              if (normalizedFrom.error || !normalizedFrom.value) {
                openBlockingWarning('From is empty ya 5 digit nahi hai', [], 'Warning', () => {
                  window.requestAnimationFrame(() => purchaseToInputRef.current?.focus());
                });
                return;
              }
              setRetroFromInput(normalizedFrom.value);
              setRetroToInput(normalizedFrom.value);
              setBookingError('');
              window.requestAnimationFrame(() => {
                purchaseCodeInputRef.current?.focus();
                purchaseCodeInputRef.current?.select?.();
              });
            }
          }}
          placeholder="12500"
        />
      </td>
      <td>
        <input
          ref={purchaseCodeInputRef}
          className={retroToInput && retroToInput === retroFromInput ? 'retro-grid-autofill' : ''}
          type="text"
          value={retroToInput}
          onChange={(e) => setRetroToInput(String(e.target.value).replace(/[^0-9]/g, '').slice(0, 5))}
          onKeyDown={(e) => {
            if (shouldMoveFocusVertical(e, 'ArrowUp')) {
              e.preventDefault();
              moveRetroDraftSelection(-1);
              window.requestAnimationFrame(() => {
                purchaseCodeInputRef.current?.focus();
                purchaseCodeInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusVertical(e, 'ArrowDown')) {
              e.preventDefault();
              moveRetroDraftSelection(1);
              window.requestAnimationFrame(() => {
                purchaseCodeInputRef.current?.focus();
                purchaseCodeInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                purchaseToInputRef.current?.focus();
                purchaseToInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              if (!String(retroCodeInput || '').trim()) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => purchaseFromInputRef.current?.focus());
                });
                return;
              }
              if (!String(retroFromInput || '').trim()) {
                openBlockingWarning('From is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => purchaseToInputRef.current?.focus());
                });
                return;
              }
              if (!String(retroToInput || '').trim()) {
                openBlockingWarning('To is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => purchaseCodeInputRef.current?.focus());
                });
                return;
              }
              addRetroDraftRow();
              window.requestAnimationFrame(() => purchaseToInputRef.current?.focus());
            }
          }}
          placeholder="12500"
        />
      </td>
      <td>{sellerPurchasePreview?.quantity || ''}</td>
      <td>{sellerPurchasePreview?.rate || ''}</td>
      <td>{sellerPurchasePreview?.amount || ''}</td>
    </tr>
  );
  const sellerPurchaseFormRows = [
    {
      label: 'Date',
      className: 'medium',
      content: (
        <input
          ref={purchaseDateInputRef}
          type="date"
          value={bookingDate}
          onChange={(event) => {
            const nextDate = event.target.value || getTodayDateValue();
            setBookingDate(nextDate);
            setPurchaseSendMemoNumber(null);
            setPurchaseSendMemoSelectionIndex(0);
            setPurchaseSendMemoPopupOpen(false);
            setRetroDraftRows([]);
            setRetroActiveRowIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              window.requestAnimationFrame(() => purchaseSellerSelectRef.current?.focus());
            }
          }}
        />
      )
    },
    {
      label: 'Sub Stokist',
      className: 'wide',
      content: (
        <SearchableSellerSelect
          inputRef={purchaseSellerSelectRef}
          value={purchaseSendSellerId}
          options={retroPartyOptions}
          getOptionLabel={(party) => `${party.username}${String(party.id) === String(user?.id) ? ' (Self)' : ''} [${getPartyKeyword(party)}] (${getAllowedAmountsLabel(party)})`}
          getOptionSearchLabel={(party) => `${getPartyKeyword(party)} ${party.username} ${getAllowedAmountsLabel(party)}`}
          onChange={(matchedSeller) => {
            const nextSellerId = String(matchedSeller?.id || '');
            setPurchaseSendSellerId(nextSellerId);
            setSelectedPartyName(matchedSeller?.username || '');
            setPartyKeyword(getPartyKeyword(matchedSeller));
            setPurchaseSendMemoNumber(null);
            setPurchaseSendMemoSelectionIndex(0);
            setPurchaseSendMemoPopupOpen(false);
            setRetroDraftRows([]);
            setRetroActiveRowIndex(0);
          }}
          onEnter={(matchedSeller) => {
            if (matchedSeller) {
              window.requestAnimationFrame(() => purchaseDateInputRef.current?.focus());
            }
          }}
          placeholder={retroPartyOptions.length === 0 ? 'No seller' : 'Keyword ya seller name type karo'}
        />
      )
    }
  ];
  const sellerPurchaseActions = [
    {
      label: 'Add (A)',
      shortcut: 'A',
      onClick: startNewRetroDraftRow
    },
    {
      label: retroSaving ? 'Sending...' : 'Send (F2)',
      shortcut: 'F2',
      variant: 'primary',
      onClick: saveRetroDraftRows,
      disabled: retroSaving
    },
    {
      label: 'Delete (F3)',
      shortcut: 'F3',
      onClick: deleteRetroDraftRow
    },
    {
      label: 'Clear (F8)',
      shortcut: 'F8',
      onClick: () => {
        setRetroDraftRows([]);
        setSelectedBox('');
        setRetroFromInput('');
        setRetroToInput('');
        setRetroCodeInput('');
        setRetroActiveRowIndex(0);
        setRetroEditorVisible(true);
      }
    },
    {
      label: 'Exit (Esc)',
      shortcut: 'ESC',
      variant: 'secondary',
      onClick: requestExitConfirmation
    }
  ];
  const currentUnsoldFormId = activeTab === 'unsold-remove' ? 'seller-unsold-remove-form' : 'seller-unsold-form';
  const sellerUnsoldFormRows = [
    {
      label: 'Party Name',
      className: 'wide',
      content: (
        <SearchableSellerSelect
          inputRef={unsoldPartySelectRef}
          value={unsoldPartyId}
          options={unsoldPartyOptions}
          form={currentUnsoldFormId}
          getOptionLabel={(party) => `${party.username}${String(party.id) === String(user?.id) ? ' (Self)' : ''} [${getPartyKeyword(party)}] (${getAllowedAmountsLabel(party)})`}
          getOptionSearchLabel={(party) => `${getPartyKeyword(party)} ${party.username} ${getAllowedAmountsLabel(party)}`}
          onChange={(party) => {
            setUnsoldPartyId(String(party?.id || ''));
            setUnsoldMemoNumber(null);
            setUnsoldRemoveMemoNumber(null);
            setUnsoldMemoSelectionIndex(0);
            setUnsoldMemoPopupOpen(false);
            setUnsoldDraftRows([]);
            setUnsoldActiveRowIndex(0);
            setUnsoldEditorVisible(true);
          }}
          onEnter={(party) => {
            if (party) {
              window.requestAnimationFrame(() => unsoldDateInputRef.current?.focus());
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
          ref={unsoldDateInputRef}
          type="date"
          value={bookingDate}
          onChange={(e) => handleSellerUnsoldDateChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              window.requestAnimationFrame(() => unsoldMemoRef.current?.focus());
            }
          }}
          form={currentUnsoldFormId}
        />
      )
    }
  ];
  const sellerUnsoldActions = [
    {
      label: 'Add (A)',
      shortcut: 'A',
      onClick: () => {
        void handleAddUnsoldAction();
      }
    },
    {
      label: unsoldLoading ? 'Saving...' : 'Save (F2)',
      shortcut: 'F2',
      type: 'submit',
      form: 'seller-unsold-form',
      variant: 'primary',
      disabled: unsoldLoading
    },
    {
      label: 'Delete (F3)',
      shortcut: 'F3',
      onClick: deleteUnsoldDraftRow
    },
    {
      label: 'View (F4)',
      shortcut: 'F4',
      onClick: () => {
        void openStockLookup(activeTab === 'unsold-remove' ? 'unsold-remove' : 'unsold');
      }
    },
    {
      label: 'Clear (F8)',
      shortcut: 'F8',
      onClick: () => {
        setUnsoldNumber('');
        setUnsoldRangeEndNumber('');
        setUnsoldDraftRows([]);
        setUnsoldActiveRowIndex(0);
        setUnsoldEditorVisible(true);
      }
    },
    {
      label: 'Exit (Esc)',
      shortcut: 'ESC',
      variant: 'secondary',
      onClick: requestExitConfirmation
    }
  ];
  const sellerUnsoldRemoveActions = sellerUnsoldActions.map((action) => (
    action.shortcut === 'F2'
      ? {
        ...action,
        label: unsoldLoading ? 'Removing...' : 'Remove (F2)',
        form: 'seller-unsold-remove-form'
      }
      : action
  ));
  const unsoldParsedCode = parseRetroCodeValue(unsoldCodeInput, sessionMode, activePurchaseCategory);
  const previousUnsoldDraftRow = unsoldDraftRows[Math.min(unsoldActiveRowIndex, unsoldDraftRows.length) - 1] || null;
  const unsoldRangeMetrics = getFiveDigitRangeMetrics(unsoldTableFromInput, unsoldTableToInput, previousUnsoldDraftRow?.from);
  const unsoldResolvedFrom = unsoldRangeMetrics.fromNumber;
  const unsoldResolvedTo = unsoldRangeMetrics.toNumber;
  const unsoldCount = unsoldParsedCode.semValue && unsoldResolvedFrom && unsoldResolvedTo
    ? unsoldRangeMetrics.count
    : 0;
  const unsoldPreviewQuantity = unsoldCount > 0 ? Number(unsoldParsedCode.semValue || 0) * unsoldCount : '';
  const unsoldPreviewRate = amount || '';
  const unsoldPreviewAmount = unsoldPreviewQuantity && unsoldPreviewRate
    ? (Number(unsoldPreviewQuantity) * Number(unsoldPreviewRate)).toFixed(2)
    : '';
  const sellerUnsoldEditableRow = (
    <tr key="seller-unsold-entry">
      <td>{unsoldActiveRowIndex + 1}</td>
      <td>
        <input
          ref={unsoldCodeInputRef}
          type="text"
          value={unsoldCodeInput}
          onChange={(e) => setUnsoldCodeInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              const parsedCode = parseRetroCodeValue(e.currentTarget.value, sessionMode, activePurchaseCategory);
              if (parsedCode.error) {
                openBlockingWarning(parsedCode.error, [], 'Warning', () => {
                  setUnsoldCodeInput('');
                  window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                });
                return;
              }
              if (!parsedCode.semValue) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                });
                return;
              }
              setUnsoldCodeInput(buildRetroTicketCode(parsedCode.resolvedSessionMode, parsedCode.semValue, parsedCode.resolvedPurchaseCategory));
              setError('');
              window.requestAnimationFrame(() => unsoldFromInputRef.current?.focus());
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              const parsedCode = parseRetroCodeValue(e.currentTarget.value, sessionMode, activePurchaseCategory);
              if (parsedCode.error) {
                openBlockingWarning(parsedCode.error, [], 'Warning', () => {
                  setUnsoldCodeInput('');
                  window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                });
                return;
              }
              if (!parsedCode.semValue) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                });
                return;
              }
              setUnsoldCodeInput(buildRetroTicketCode(parsedCode.resolvedSessionMode, parsedCode.semValue, parsedCode.resolvedPurchaseCategory));
              setError('');
              window.requestAnimationFrame(() => unsoldFromInputRef.current?.focus());
            }
          }}
          placeholder="M5 / D5 / E5 / 5"
        />
      </td>
      <td>{`${String(selectedUnsoldParty?.username || '').toUpperCase()} - ${unsoldParsedCode.semValue || ''}`.trim()}</td>
      <td>{bookingDate}</td>
      <td>{new Date(bookingDate).toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</td>
      <td>
        <input
          ref={unsoldFromInputRef}
          type="text"
          value={unsoldTableFromInput}
          onChange={(e) => {
            const normalized = String(e.target.value).replace(/[^0-9]/g, '').slice(0, 5);
            setUnsoldTableFromInput(normalized);
            if (normalized.length === 5) {
              setUnsoldTableToInput(normalized);
              window.requestAnimationFrame(() => {
                unsoldToInputRef.current?.focus();
                unsoldToInputRef.current?.select?.();
              });
            }
          }}
          onKeyDown={(e) => {
            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                unsoldCodeInputRef.current?.focus();
                unsoldCodeInputRef.current?.select?.();
              });
              return;
            }

            if (shouldMoveFocusRight(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                unsoldToInputRef.current?.focus();
                unsoldToInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              const previousRow = unsoldDraftRows[Math.min(unsoldActiveRowIndex, unsoldDraftRows.length) - 1] || null;
              if (!String(unsoldCodeInput || '').trim()) {
                openBlockingWarning('Code is empty', [], 'Warning', () => {
                  window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                });
                return;
              }
              const normalizedFrom = normalizeRangeStartNumber(unsoldTableFromInput, previousRow?.from);
              if (normalizedFrom.error || !normalizedFrom.value) {
                openBlockingWarning('From is empty ya 5 digit nahi hai', [], 'Warning', () => {
                  window.requestAnimationFrame(() => unsoldFromInputRef.current?.focus());
                });
                return;
              }
              setUnsoldTableFromInput(normalizedFrom.value);
              setUnsoldTableToInput(normalizedFrom.value);
              setError('');
              window.requestAnimationFrame(() => {
                unsoldToInputRef.current?.focus();
                unsoldToInputRef.current?.select?.();
              });
            }
          }}
          placeholder="12500"
        />
      </td>
      <td>
        <input
          ref={unsoldToInputRef}
          className={unsoldTableToInput && unsoldTableToInput === unsoldTableFromInput ? 'retro-grid-autofill' : ''}
          type="text"
          value={unsoldTableToInput}
          onChange={(e) => setUnsoldTableToInput(String(e.target.value).replace(/[^0-9]/g, '').slice(0, 5))}
          onKeyDown={(e) => {
            if (shouldMoveFocusLeft(e)) {
              e.preventDefault();
              window.requestAnimationFrame(() => {
                unsoldFromInputRef.current?.focus();
                unsoldFromInputRef.current?.select?.();
              });
              return;
            }

            if (e.key === 'Enter') {
              e.preventDefault();
              void (async () => {
                if (!String(unsoldCodeInput || '').trim()) {
                  openBlockingWarning('Code is empty', [], 'Warning', () => {
                    window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                  });
                  return;
                }
                if (!String(unsoldTableFromInput || '').trim()) {
                  openBlockingWarning('From is empty', [], 'Warning', () => {
                    window.requestAnimationFrame(() => unsoldFromInputRef.current?.focus());
                  });
                  return;
                }
                if (!String(unsoldTableToInput || '').trim()) {
                  openBlockingWarning('To is empty', [], 'Warning', () => {
                    window.requestAnimationFrame(() => unsoldToInputRef.current?.focus());
                  });
                  return;
                }
                if (unsoldRangeMetrics.error) {
                  openBlockingWarning(unsoldRangeMetrics.error, [], 'Warning', () => {
                    window.requestAnimationFrame(() => unsoldToInputRef.current?.focus());
                  });
                  return;
                }

                const nextMode = unsoldResolvedTo && unsoldResolvedTo !== unsoldResolvedFrom ? 'range' : 'single';
                setUnsoldNumber(unsoldResolvedFrom);
                setUnsoldRangeEndNumber(unsoldResolvedTo);
                setUnsoldMode(nextMode);
                await handleAddUnsoldAction();
              })();
            }
          }}
          placeholder="12500"
        />
      </td>
      <td>{unsoldPreviewQuantity}</td>
      <td>{unsoldPreviewRate}</td>
      <td>{unsoldPreviewAmount}</td>
    </tr>
  );
  const sellerUnsoldGridRows = createRetroGridRows(unsoldDraftRows);
  const seePurchaseReceivedRows = seePurchaseReceivedEntries.map((entry) => normalizeSeePurchaseEntry(entry));
  const seePurchaseSentRows = seePurchaseSentEntries.map((entry) => normalizeSeePurchaseEntry(entry));
  const seePurchaseAvailableRows = seePurchaseAvailableEntries.map((entry) => normalizeSeePurchaseEntry(entry));
  const buildSellerSeePurchaseGroups = (rows = [], includeParty = false) => groupConsecutiveNumberRows(
    sortRowsForConsecutiveNumbers(
      rows,
      (entry) => [
        entry.bookingDate,
        entry.sessionMode,
        entry.amount,
        entry.boxValue,
        includeParty ? (entry.toUsername || entry.sellerName) : ''
      ]
    ),
    (entry) => [
      entry.bookingDate,
      entry.sessionMode,
      entry.amount,
      entry.boxValue,
      includeParty ? (entry.toUsername || entry.sellerName) : ''
    ].join('|')
  );
  const seePurchaseReceivedGroups = buildSellerSeePurchaseGroups(seePurchaseReceivedRows);
  const seePurchaseSentGroups = buildSellerSeePurchaseGroups(seePurchaseSentRows, true);
  const seePurchaseAvailableGroups = buildSellerSeePurchaseGroups(seePurchaseAvailableRows);
  const seePurchaseSemSummaries = [...new Set(seePurchaseReceivedRows.map((entry) => String(entry.boxValue || '')).filter(Boolean))]
    .sort((leftValue, rightValue) => Number(leftValue) - Number(rightValue))
    .map((semValue) => {
      const semEntries = seePurchaseReceivedRows.filter((entry) => String(entry.boxValue || '') === semValue);
      const totalPieces = semEntries.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0);
      const totalRate = Number(semEntries[0]?.amount || amount || 0);
      const totalAmount = semEntries.reduce((sum, entry) => sum + (Number(entry.amount || 0) * Number(entry.boxValue || 0)), 0);

      return {
        semValue,
        totalNumbers: semEntries.length,
        totalPieces,
        totalRate,
        totalAmount
      };
    });
  const seePurchaseGrandTotal = seePurchaseSemSummaries.reduce((summary, semSummary) => ({
    totalNumbers: summary.totalNumbers + semSummary.totalNumbers,
    totalPieces: summary.totalPieces + semSummary.totalPieces,
    totalRate: summary.totalRate || semSummary.totalRate,
    totalAmount: summary.totalAmount + semSummary.totalAmount
  }), {
    totalNumbers: 0,
    totalPieces: 0,
    totalRate: 0,
    totalAmount: 0
  });
  const seePurchaseSentTotal = {
    totalNumbers: seePurchaseSentRows.length,
    totalPieces: seePurchaseSentRows.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0),
    totalAmount: seePurchaseSentRows.reduce((sum, entry) => sum + (Number(entry.amount || 0) * Number(entry.boxValue || 0)), 0)
  };
  const seePurchaseAvailableTotal = {
    totalNumbers: seePurchaseAvailableRows.length,
    totalPieces: seePurchaseAvailableRows.reduce((sum, entry) => sum + Number(entry.boxValue || 0), 0),
    totalAmount: seePurchaseAvailableRows.reduce((sum, entry) => sum + (Number(entry.amount || 0) * Number(entry.boxValue || 0)), 0)
  };
  const stockTransferGroupedEntries = groupConsecutiveNumberRows(
    sortRowsForConsecutiveNumbers(
      stockTransferEntries.map((entry) => normalizeSeePurchaseEntry(entry)),
      (entry) => [entry.bookingDate, entry.sessionMode, entry.amount, entry.boxValue, entry.sellerName]
    ),
    (entry) => [entry.bookingDate, entry.sessionMode, entry.amount, entry.boxValue, entry.sellerName].join('|')
  );
  const stockTransferTotalPieces = stockTransferEntries.reduce((sum, entry) => sum + Number(entry.sem || 0), 0);
  const stockTransferTotalAmount = stockTransferEntries.reduce((sum, entry) => sum + Number(entry.price || 0), 0);

  const generateBill = () => {
    setError('');

    if (historyFromDate > historyToDate) {
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
      groupedSummaries: billGroupedSummaries,
      groupedAmountSummaries: billGroupedAmountSummaries,
      rootSellerMeta: billData.rootSellerMeta,
      totals: billTransferHistoryTotals,
      username: user.username,
      sessionMode,
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
      const response = await priceService.getFilteredPrizeResults({
        date: myPrizeDate,
        shift: myPrizeShift || 'ALL',
        sellerId: myPrizeSellerId,
        soldStatus: myPrizeSoldStatus || 'ALL'
      });
      const allResults = response.data?.rows || [];

      setMyPrizeAllResults(allResults);
      setMyPrizeResults(allResults);
      setMyPrizeTotal(Number(response.data?.totalPrize || 0));
      setMyPrizeMessage(
        allResults.length > 0
          ? 'Prize found'
          : 'Selected filter me koi prize nahi mila'
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
        {amount6.length > 0 && renderTable(amount6, '7')}
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
        {amount6.length > 0 && renderTable(amount6, '7')}
        {amount12.length > 0 && renderTable(amount12, '12')}
      </>
    );
  };

  const sellerLauncherItems = [
    { tab: 'purchase-send', label: 'Purchase Send' },
    { tab: 'see-purchase', label: 'See Purchase' },
    { tab: 'unsold', label: 'Unsold' },
    { tab: 'unsold-remove', label: 'Unsold Remove' },
    { tab: 'check-price', label: 'Check Price' },
    { tab: 'tree', label: 'Tree' },
    { tab: 'add-seller', label: 'Add New Seller' },
    { tab: 'your-lot', label: 'Your Lot' },
    { tab: 'accept-seller-lot', label: 'Accept Seller Lot' },
    { tab: 'send-record', label: 'Send Record' },
    { tab: 'generate-bill', label: 'Generate Bill' },
    { tab: 'track-number', label: 'Track Number' },
    { tab: 'my-prizes', label: 'My Prizes' },
    { tab: 'stock-transfer', label: 'Stock Transfer' }
  ].filter((item) => {
    if (item.tab === 'purchase-send') {
      return canForwardPurchase;
    }
    if (item.tab === 'see-purchase') {
      return currentSellerType !== 'normal_seller';
    }
    if (item.tab === 'add-seller') {
      return canCreateChildSeller;
    }
    if (item.tab === 'stock-transfer') {
      return canUseStockTransfer;
    }
    return true;
  });
  const sellerLauncherActions = [
    { id: 'piece-summary', label: 'F10 - Unsold Summary' },
    { id: 'send-unsold', label: 'F11 - Send Unsold' }
  ];
  const launcherTitle = entryCompanyLabel || 'Seller Keyboard Menu';

  return (
    <div
      ref={dashboardRef}
      className="seller-dashboard"
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
      {unsoldSendOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#fff', width: 'min(820px, 100%)', borderRadius: '8px', padding: '20px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ margin: 0 }}>F11 Send Unsold</h2>
              <button type="button" onClick={() => setUnsoldSendOpen(false)}>Close</button>
            </div>
            {unsoldSendLoading ? (
              <p>Loading...</p>
            ) : (
              <>
                <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '8px', background: '#f6f8ff', fontSize: '18px', lineHeight: 1.5 }}>
                  <strong>From:</strong> {unsoldSendSummary?.fromSeller || user?.username} |{' '}
                  <strong>To:</strong> {unsoldSendSummary?.toSeller || 'Parent'} |{' '}
                  <strong>Total Piece:</strong> {Number(unsoldSendSummary?.totalPiece || 0).toFixed(2)} |{' '}
                  <strong>Send Unsold:</strong> {Number(unsoldSendSummary?.unsoldPiece || 0).toFixed(2)} |{' '}
                  <strong>Sold:</strong> {Number(unsoldSendSummary?.soldPiece || 0).toFixed(2)}
                  {unsoldSendSummary?.autoAccept ? <div style={{ color: '#2f855a', fontWeight: 700 }}>Admin ko send hote hi auto accept hoga.</div> : null}
                  {Number(unsoldSendSummary?.alreadySentPiece || 0) > 0 ? (
                    <div style={{ marginTop: '8px', color: '#2b6cb0', fontWeight: 700 }}>
                      You already send {Number(unsoldSendSummary.alreadySentPiece || 0).toFixed(2)} piece.
                    </div>
                  ) : null}
                  {Number(unsoldSendSummary?.pendingSendPiece || 0) > 0 ? (
                    <div style={{ marginTop: '4px', color: '#2f855a', fontWeight: 700 }}>
                      New unsold ready to send: {Number(unsoldSendSummary.pendingSendPiece || 0).toFixed(2)} piece.
                    </div>
                  ) : null}
                </div>
                <table className="entries-table" style={{ marginTop: '16px' }}>
                  <thead>
                    <tr>
                      <th>Seller Name</th>
                      <th>Total Piece</th>
                      <th>Unsold Piece</th>
                      <th>Already Sent</th>
                      <th>New Unsold</th>
                      <th>Sold Piece</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(unsoldSendSummary?.rows || []).map((row) => (
                      <tr key={row.sellerId}>
                        <td>{row.sellerName}</td>
                        <td>{Number(row.totalPiece || 0).toFixed(2)}</td>
                        <td>{Number(row.unsoldPiece || 0).toFixed(2)}</td>
                        <td>{Number(row.alreadySentPiece || 0).toFixed(2)}</td>
                        <td>{Number(row.pendingSendPiece || 0).toFixed(2)}</td>
                        <td>{Number(row.soldPiece || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '18px' }}>
                  <button type="button" onClick={loadUnsoldSendSummary} disabled={unsoldSendLoading || unsoldSendSaving}>Refresh</button>
                  <button
                    type="button"
                    onClick={sendUnsoldToParent}
                    disabled={unsoldSendSaving || Number(unsoldSendSummary?.pendingSendPiece || 0) <= 0}
                    style={{ backgroundColor: '#2f855a' }}
                  >
                    {unsoldSendSaving ? 'Sending...' : 'Send Unsold'}
                  </button>
                </div>
              </>
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
      {!billOnlyMode && (
        <div className={`dashboard-accordion ${!activeTab ? 'dashboard-launcher-active' : ''}`.trim()}>
        {!activeTab ? (
          <DashboardLauncher
            title={launcherTitle}
            subtitle="A-Z keyboard shortcuts se seller pages kholo"
            items={sellerLauncherItems}
            actions={sellerLauncherActions}
            onSelect={(item) => handleTabToggle(item.tab)}
            onAction={(item) => {
              if (item.id === 'piece-summary') {
                loadPieceSummary();
              }
              if (item.id === 'send-unsold') {
                loadUnsoldSendSummary();
              }
            }}
            onExit={requestExitConfirmation}
          />
        ) : null}
        {!activeTab && canCreateChildSeller && (
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              My Prizes
            </button>
            <div className="accordion-content">
              <h2>My Prizes</h2>
              <div className="form-group">
                <label>Date:</label>
                <input
                  type="date"
                  value={myPrizeDate}
                  onChange={(e) => setMyPrizeDate(e.target.value)}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Shift:</label>
                <select value={myPrizeShift} onChange={(e) => setMyPrizeShift(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="ALL">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="DAY">DAY</option>
                  <option value="EVENING">EVENING</option>
                </select>

                <label style={{ marginTop: '12px', display: 'block' }}>Seller:</label>
                <SearchableSellerSelect
                  options={myPrizeSellerOptions}
                  value={myPrizeSellerId}
                  onChange={(seller) => setMyPrizeSellerId(String(seller?.id || ''))}
                  placeholder="Keyword ya seller name type karo"
                  getOptionValue={(option) => option.id}
                  getOptionLabel={(option) => option.id ? option.username : 'All Sellers'}
                  onEnter={() => {
                    window.requestAnimationFrame(() => myPrizeResultTypeRef.current?.focus());
                  }}
                />

                <label style={{ marginTop: '12px', display: 'block' }}>Result Type:</label>
                <select
                  ref={myPrizeResultTypeRef}
                  value={myPrizeSoldStatus}
                  onChange={(e) => setMyPrizeSoldStatus(e.target.value)}
                  style={{ marginTop: '8px' }}
                >
                  <option value="ALL">ALL</option>
                  <option value="SOLD">SOLD</option>
                  <option value="UNSOLD">UNSOLD</option>
                </select>

                <button type="button" onClick={handleMyPrizeSearch} style={{ marginTop: '12px' }} disabled={myPrizeLoading}>
                  {myPrizeLoading ? 'Checking...' : 'Check'}
                </button>
              </div>

              {myPrizeSearchPerformed && (
                <div className="entries-list-block" style={{ marginTop: '20px' }}>
                  <h3>My Prize Result</h3>
                  <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
                    <strong>Applied Filter:</strong> Date {formatDisplayDate(myPrizeDate)} | Shift {myPrizeShift || 'ALL'} | Type {myPrizeSoldStatus || 'ALL'}
                  </div>
                  {myPrizeResults.length > 0 ? (
                    <>
                      <div style={{ marginBottom: '14px', padding: '14px 16px', borderRadius: '14px', background: '#eef3ff', fontSize: '22px', fontWeight: '700' }}>
                        <strong>Total Prize:</strong> Rs. {myPrizeTotal.toFixed(2)}
                      </div>
                      <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '12px', background: '#f6f8ff' }}>
                        <strong>Total Matched Entries:</strong> {myPrizeResults.length} | <strong>Available Today:</strong> {myPrizeAllResults.length}
                      </div>
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
                          {myPrizeResults.map((entry) => (
                            <tr key={entry.id}>
                              <td>{formatDisplayDate(entry.bookingDate || myPrizeDate)}</td>
                              <td>{getPrizeShiftLabel(entry.purchaseCategory, entry.sessionMode)}</td>
                              <td>{entry.sellerUsername || '-'}</td>
                              <td>{entry.soldStatus || '-'}</td>
                              <td>{entry.amount}</td>
                              <td>{entry.sem}</td>
                              <td>{entry.number}</td>
                              <td>{entry.prizeLabel}</td>
                              <td>{entry.winningNumber}</td>
                              <td>Rs. {Number(entry.calculatedPrize || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ marginTop: '18px', padding: '14px 16px', borderRadius: '14px', background: '#dfe8ff', fontSize: '24px', fontWeight: '700' }}>
                        <strong>Grand Total Prize:</strong> Rs. {myPrizeTotal.toFixed(2)}
                      </div>
                      <div style={{ marginTop: '14px', padding: '14px 16px', borderRadius: '14px', background: '#eef3ff' }}>
                        <strong>Prize Numbers:</strong> {[...new Set(myPrizeResults.map((entry) => entry.number))].join(', ')}
                      </div>
                    </>
                  ) : (
                    <p style={{ fontWeight: '600' }}>{myPrizeMessage || 'Selected filter me koi prize nahi mila'}</p>
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
          <div className="accordion-item" style={{ order: 4 }}>
            <button
              className={`accordion-header ${activeTab === 'add-seller' ? 'active' : ''}`}
              onClick={() => handleTabToggle('add-seller')}
            >
              Add New Seller
            </button>
          </div>
        )}

        {activeTab === 'add-seller' && canCreateChildSeller && (
          <div className="accordion-item" style={{ order: 4 }}>
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Add New Seller
            </button>
            <div className="accordion-content">
              <AddSellerForm
                currentUser={user}
                selectedAmount={amount}
                onSuccess={async () => {
                  setSuccess('Seller created successfully');
                  await loadTree();
                }}
                onError={setError}
              />
            </div>
          </div>
        )}

        {!activeTab && canForwardPurchase && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button
              className={`accordion-header ${activeTab === 'purchase-send' ? 'active' : ''}`}
              onClick={() => handleTabToggle('purchase-send')}
            >
              Purchase Send
            </button>
          </div>
        )}

        {activeTab === 'purchase-send' && canForwardPurchase && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Purchase Send
            </button>
            <div className="accordion-content">
              <RetroPurchasePanel
                screenCode="RAHUL"
                panelTitle="Purchase Send"
                screenTitle={entryCompanyLabel || 'SELLER PURCHASE SEND'}
                headerTimestamp={sellerUnsoldTimestamp}
                memoNumber={selectedPurchaseSendMemoOption ? String(selectedPurchaseSendMemoOption.memoNumber) : '1'}
                formRows={sellerPurchaseFormRows}
                gridRows={sellerPurchaseGridRows}
                editableRow={retroEditorVisible ? sellerPurchaseEditableRow : null}
                editableRowIndex={retroActiveRowIndex}
                activeGridRowIndex={retroEditorVisible && retroActiveRowIndex < retroDraftRows.length ? retroActiveRowIndex : null}
                onGridRowClick={(_, index) => {
                  loadRetroDraftIntoEditor(index);
                  window.requestAnimationFrame(() => {
                    purchaseFromInputRef.current?.focus();
                    purchaseFromInputRef.current?.select?.();
                  });
                }}
                memoProps={{
                  ref: purchaseMemoRef,
                  tabIndex: 0,
                  onClick: () => {
                    if (!purchaseSendMemoPopupOpen) {
                      openPurchaseSendMemoPopup();
                    }
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!purchaseSendMemoPopupOpen) {
                        openPurchaseSendMemoPopup();
                      }
                      setPurchaseSendMemoSelectionIndex((currentIndex) => {
                        const delta = e.key === 'ArrowDown' ? 1 : -1;
                        const nextIndex = currentIndex + delta;
                        if (nextIndex < 0) {
                          return 0;
                        }
                        if (nextIndex >= purchaseSendMemoOptions.length) {
                          return Math.max(purchaseSendMemoOptions.length - 1, 0);
                        }
                        return nextIndex;
                      });
                      return;
                    }

                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closePurchaseSendMemoPopup();
                      return;
                    }

                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (purchaseSendMemoPopupOpen) {
                        commitPurchaseSendMemoSelection();
                        return;
                      }
                      window.requestAnimationFrame(() => {
                        purchaseFromInputRef.current?.focus();
                        purchaseFromInputRef.current?.select?.();
                      });
                    }
                  }
                }}
                memoSelector={{
                  isOpen: purchaseSendMemoPopupOpen,
                  options: purchaseSendMemoOptions,
                  activeIndex: purchaseSendMemoSelectionIndex,
                  variant: 'table',
                  onHighlight: setPurchaseSendMemoSelectionIndex,
                  onSelect: (option, index) => {
                    setPurchaseSendMemoSelectionIndex(index);
                    commitPurchaseSendMemoSelection(option);
                  }
                }}
                topShortcuts={SELLER_PURCHASE_SEND_SHORTCUTS}
                footerActions={sellerPurchaseActions}
                summaryQuantity={sellerPurchaseSummaryQuantity}
                summaryAmount={sellerPurchaseSummaryAmount}
                statusLabel={sessionMode}
                windowClassName="full-page"
                blockingWarning={activeTab === 'purchase-send' ? blockingWarning : null}
                onBlockingWarningClose={clearBlockingWarning}
              />
            </div>
          </div>
        )}

        {!activeTab && currentSellerType !== 'normal_seller' && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button
              className={`accordion-header ${activeTab === 'see-purchase' ? 'active' : ''}`}
              onClick={() => handleTabToggle('see-purchase')}
            >
              See Purchase
            </button>
          </div>
        )}

        {activeTab === 'see-purchase' && currentSellerType !== 'normal_seller' && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              See Purchase
            </button>
            <div className="accordion-content">
              <h2>See Purchase</h2>
              <p style={{ marginBottom: '14px', color: '#4a5568' }}>
                Yahan parent/admin se mila hua poora purchase dikh raha hai. Sub seller ko bhejne ke baad bhi total received purchase yahan se nahi hatega.
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
                    value={seePurchaseSellerId}
                    options={seePurchaseSellerOptions}
                    onChange={(seller) => setSeePurchaseSellerId(String(seller?.id || ''))}
                    getOptionValue={(seller) => seller.id}
                    getOptionLabel={(seller) => `${seller.username}${String(seller.id) === String(user?.id) ? ' (Self)' : ''} [${getPartyKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
                    getOptionSearchLabel={(seller) => `${getPartyKeyword(seller)} ${seller.username} ${getAllowedAmountsLabel(seller)}`}
                    placeholder={seePurchaseSellerOptions.length === 0 ? 'No seller' : 'Keyword ya seller name type karo'}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button type="button" onClick={loadSeePurchaseEntries} disabled={seePurchaseLoading}>
                    {seePurchaseLoading ? 'Loading...' : 'Refresh Purchase View'}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: '10px', background: '#eef4ff' }}>
                <strong>Selected View:</strong> {formatDisplayDate(seePurchaseDate)} | {seePurchaseShift || 'ALL'} | {selectedSeePurchaseSeller?.username || user?.username || '-'} | Rate {amount || '-'}
              </div>

              {seePurchaseSemSummaries.length > 0 ? (
                <table className="entries-table" style={{ marginTop: '16px' }}>
                  <thead>
                    <tr>
                      <th>Same</th>
                      <th>Total Pieces</th>
                      <th>Total Rate</th>
                      <th>Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seePurchaseSemSummaries.map((summary) => (
                      <tr key={`see-purchase-summary-${summary.semValue}`}>
                        <td>{summary.semValue} Same</td>
                        <td>{summary.totalPieces}</td>
                        <td>{summary.totalRate}</td>
                        <td>{summary.totalAmount.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: '700', background: '#f8fbff' }}>
                      <td>Grand Total</td>
                      <td>{seePurchaseGrandTotal.totalPieces}</td>
                      <td>{seePurchaseGrandTotal.totalRate}</td>
                      <td>{seePurchaseGrandTotal.totalAmount.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : null}

              <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: '10px', background: '#eef4ff' }}>
                <strong>Total Purchase:</strong> {seePurchaseGrandTotal.totalNumbers} numbers | Pieces {seePurchaseGrandTotal.totalPieces} | Rs. {seePurchaseGrandTotal.totalAmount.toFixed(2)} |{' '}
                <strong>Sub Stokist Ko Diya:</strong> {seePurchaseSentTotal.totalNumbers} numbers | Pieces {seePurchaseSentTotal.totalPieces} | Rs. {seePurchaseSentTotal.totalAmount.toFixed(2)} |{' '}
                <strong>Balance Stock:</strong> {seePurchaseAvailableTotal.totalNumbers} numbers | Pieces {seePurchaseAvailableTotal.totalPieces} | Rs. {seePurchaseAvailableTotal.totalAmount.toFixed(2)}
              </div>

              {seePurchaseReceivedGroups.length > 0 ? (
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
                      <th>Received From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seePurchaseReceivedGroups.map((group) => (
                      <tr key={`see-purchase-received-${group.firstRow?.id}-${group.lastRow?.id}`}>
                        <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                        <td>{group.firstRow?.sessionMode || '-'}</td>
                        <td>{group.firstRow?.amount || '-'}</td>
                        <td>{group.firstRow?.boxValue || '-'}</td>
                        <td>{group.firstRow?.number || '-'}</td>
                        <td>{group.lastRow?.number || '-'}</td>
                        <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0)}</td>
                        <td>{group.firstRow?.fromUsername || group.firstRow?.sellerName || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ marginTop: '16px' }}>Selected date, seller aur shift me parent/admin se koi purchase nahi mila.</p>
              )}

              {seePurchaseSentGroups.length > 0 ? (
                <>
                  <h4 style={{ margin: '16px 0 8px' }}>Sent To Sub Stokist</h4>
                  <table className="entries-table">
                    <thead>
                      <tr>
                        <th>Sub Stokist</th>
                        <th>Memo</th>
                        <th>Date</th>
                        <th>Session</th>
                        <th>Amount</th>
                        <th>SEM</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Total Pieces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seePurchaseSentGroups.map((group) => (
                        <tr key={`see-purchase-sent-${group.firstRow?.id}-${group.lastRow?.id}`}>
                          <td>{group.firstRow?.toUsername || '-'}</td>
                          <td>{group.firstRow?.memoNumber || '-'}</td>
                          <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                          <td>{group.firstRow?.sessionMode || '-'}</td>
                          <td>{group.firstRow?.amount || '-'}</td>
                          <td>{group.firstRow?.boxValue || '-'}</td>
                          <td>{group.firstRow?.number || '-'}</td>
                          <td>{group.lastRow?.number || '-'}</td>
                          <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}

              {seePurchaseAvailableGroups.length > 0 ? (
                <>
                  <h4 style={{ margin: '16px 0 8px' }}>Balance Stock</h4>
                  <table className="entries-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Session</th>
                        <th>Amount</th>
                        <th>SEM</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Total Pieces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seePurchaseAvailableGroups.map((group) => (
                        <tr key={`see-purchase-available-${group.firstRow?.id}-${group.lastRow?.id}`}>
                          <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                          <td>{group.firstRow?.sessionMode || '-'}</td>
                          <td>{group.firstRow?.amount || '-'}</td>
                          <td>{group.firstRow?.boxValue || '-'}</td>
                          <td>{group.firstRow?.number || '-'}</td>
                          <td>{group.lastRow?.number || '-'}</td>
                          <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || 0), 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p style={{ marginTop: '16px' }}>Balance stock nahi bacha.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'stock-transfer' && canUseStockTransfer && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Stock Transfer
            </button>
            <div className="accordion-content">
              <h2>Stock Transfer</h2>
              <p style={{ marginBottom: '14px', color: '#4a5568' }}>
                Selected date, category aur amount ka jo remaining stock aapke paas hai, woh ek baar me selected seller ko transfer hoga.
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
                    getOptionLabel={(seller) => `${seller.username}${String(seller.id) === String(user?.id) ? ' (Self)' : ''} [${getPartyKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
                    getOptionSearchLabel={(seller) => `${getPartyKeyword(seller)} ${seller.username} ${getAllowedAmountsLabel(seller)}`}
                    placeholder={stockTransferTargetOptions.length === 0 ? 'No seller' : 'Keyword ya seller name type karo'}
                  />
                </div>

                <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: '10px', background: '#eef4ff' }}>
                  <strong>Selected Stock:</strong> {formatDisplayDate(stockTransferDate)} | {sessionMode} | {getPurchaseCategoryLabel(activePurchaseCategory)} | Amount {amount || '-'}
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                  <button type="button" onClick={loadStockTransferEntries} disabled={stockTransferLoading}>
                    {stockTransferLoading ? 'Loading...' : 'Preview Remaining Stock'}
                  </button>
                  <button type="button" onClick={handleStockTransfer} disabled={stockTransferLoading || stockTransferEntries.length === 0 || stockTransferTargetOptions.length === 0} style={{ backgroundColor: '#2f855a' }}>
                    Transfer Full Remaining Stock
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: '10px', background: '#f6f8ff' }}>
                <strong>Remaining Stock:</strong> Total Pieces {stockTransferTotalPieces} | Rs. {stockTransferTotalAmount.toFixed(2)}
              </div>

              {stockTransferGroupedEntries.length > 0 ? (
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
                    {stockTransferGroupedEntries.map((group) => (
                      <tr key={`stock-transfer-${group.firstRow?.id}-${group.lastRow?.id}`}>
                        <td>{formatDisplayDate(group.firstRow?.bookingDate)}</td>
                        <td>{group.firstRow?.sessionMode || '-'}</td>
                        <td>{group.firstRow?.amount || '-'}</td>
                        <td>{group.firstRow?.boxValue || '-'}</td>
                        <td>{group.firstRow?.number || '-'}</td>
                        <td>{group.lastRow?.number || '-'}</td>
                        <td>{group.rows.reduce((sum, row) => sum + Number(row.boxValue || row.sem || 0), 0)}</td>
                        <td>{user?.username || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ marginTop: '16px' }}>No remaining stock to transfer.</p>
              )}
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button
              className={`accordion-header ${activeTab === 'unsold' ? 'active' : ''}`}
              onClick={() => handleTabToggle('unsold')}
            >
              Unsold
            </button>
          </div>
        )}

        {activeTab === 'unsold' && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Unsold
            </button>
            <div className="accordion-content">
              <RetroPurchasePanel
                formId="seller-unsold-form"
                onSubmit={handleMarkUnsold}
                screenCode="RAHUL"
                panelTitle="Unsold"
                screenTitle={entryCompanyLabel || 'SELLER UNSOLD'}
                headerTimestamp={sellerUnsoldTimestamp}
                memoNumber={defaultUnsoldMemoOption ? String(defaultUnsoldMemoOption.memoNumber) : '1'}
                formRows={sellerUnsoldFormRows}
                gridRows={sellerUnsoldGridRows}
                editableRow={unsoldEditorVisible ? sellerUnsoldEditableRow : null}
                editableRowIndex={unsoldActiveRowIndex}
                activeGridRowIndex={unsoldEditorVisible && unsoldActiveRowIndex < unsoldDraftRows.length ? unsoldActiveRowIndex : null}
                onGridRowClick={(_, index) => {
                  const row = unsoldDraftRows[index];
                  if (!row) {
                    return;
                  }
                  setUnsoldEditorVisible(true);
                  setUnsoldActiveRowIndex(index);
                  setUnsoldCodeInput(row.code || '');
                  setUnsoldTableFromInput(row.from || '');
                  setUnsoldTableToInput(row.to || '');
                  setUnsoldNumber(row.from || '');
                  setUnsoldRangeEndNumber(row.to || '');
                  window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                }}
                memoProps={{
                  ref: unsoldMemoRef,
                  tabIndex: 0,
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!unsoldMemoPopupOpen) {
                        openUnsoldMemoPopup();
                        return;
                      }
                      commitUnsoldMemoSelection();
                    }

                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (!unsoldMemoPopupOpen) {
                        openUnsoldMemoPopup();
                        return;
                      }
                      setUnsoldMemoSelectionIndex((currentIndex) => {
                        const nextIndex = currentIndex + 1;
                        if (nextIndex >= currentUnsoldMemoOptions.length) {
                          return Math.max(currentUnsoldMemoOptions.length - 1, 0);
                        }
                        return nextIndex;
                      });
                    }

                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!unsoldMemoPopupOpen) {
                        openUnsoldMemoPopup();
                        return;
                      }
                      setUnsoldMemoSelectionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
                    }

                    if (e.key === 'Escape') {
                      e.preventDefault();
                      if (unsoldMemoPopupOpen) {
                        setUnsoldMemoPopupOpen(false);
                      }
                    }
                  }
                }}
                memoSelector={{
                  isOpen: unsoldMemoPopupOpen,
                  options: currentUnsoldMemoOptions,
                  activeIndex: unsoldMemoSelectionIndex,
                  onHighlight: setUnsoldMemoSelectionIndex,
                  onSelect: commitUnsoldMemoSelection,
                  variant: 'table',
                  className: 'table-popup'
                }}
                topShortcuts={SELLER_UNSOLD_SHORTCUTS}
                footerActions={sellerUnsoldActions}
                summaryQuantity={sellerUnsoldSummaryQuantity}
                summaryAmount={sellerUnsoldSummaryAmount}
                statusLabel={sessionMode}
                windowClassName="full-page"
                blockingWarning={activeTab === 'unsold' ? blockingWarning : null}
                onBlockingWarningClose={clearBlockingWarning}
              />
            </div>
          </div>
        )}

        {!activeTab && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button
              className={`accordion-header ${activeTab === 'unsold-remove' ? 'active' : ''}`}
              onClick={() => handleTabToggle('unsold-remove')}
            >
              Unsold Remove
            </button>
          </div>
        )}

        {activeTab === 'unsold-remove' && (
          <div className="accordion-item" style={{ order: 1 }}>
            <button className="accordion-header active" onClick={requestExitConfirmation}>
              Unsold Remove
            </button>
            <div className="accordion-content">
              <RetroPurchasePanel
                formId="seller-unsold-remove-form"
                onSubmit={handleRemoveUnsold}
                screenCode="RAHUL"
                panelTitle="Unsold Remove"
                screenTitle={entryCompanyLabel || 'SELLER UNSOLD REMOVE'}
                headerTimestamp={sellerUnsoldTimestamp}
                memoNumber={defaultUnsoldRemoveMemoOption ? String(defaultUnsoldRemoveMemoOption.memoNumber) : '1'}
                formRows={sellerUnsoldFormRows}
                gridRows={sellerUnsoldGridRows}
                editableRow={unsoldEditorVisible ? sellerUnsoldEditableRow : null}
                editableRowIndex={unsoldActiveRowIndex}
                activeGridRowIndex={unsoldEditorVisible && unsoldActiveRowIndex < unsoldDraftRows.length ? unsoldActiveRowIndex : null}
                onGridRowClick={(_, index) => {
                  const row = unsoldDraftRows[index];
                  if (!row) {
                    return;
                  }
                  setUnsoldEditorVisible(true);
                  setUnsoldActiveRowIndex(index);
                  setUnsoldCodeInput(row.code || '');
                  setUnsoldTableFromInput(row.from || '');
                  setUnsoldTableToInput(row.to || '');
                  setUnsoldNumber(row.from || '');
                  setUnsoldRangeEndNumber(row.to || '');
                  window.requestAnimationFrame(() => unsoldCodeInputRef.current?.focus());
                }}
                memoProps={{
                  ref: unsoldMemoRef,
                  tabIndex: 0,
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!unsoldMemoPopupOpen) {
                        openUnsoldMemoPopup();
                        return;
                      }
                      commitUnsoldMemoSelection();
                    }

                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (!unsoldMemoPopupOpen) {
                        openUnsoldMemoPopup();
                        return;
                      }
                      setUnsoldMemoSelectionIndex((currentIndex) => {
                        const nextIndex = currentIndex + 1;
                        if (nextIndex >= currentUnsoldMemoOptions.length) {
                          return Math.max(currentUnsoldMemoOptions.length - 1, 0);
                        }
                        return nextIndex;
                      });
                    }

                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!unsoldMemoPopupOpen) {
                        openUnsoldMemoPopup();
                        return;
                      }
                      setUnsoldMemoSelectionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
                    }

                    if (e.key === 'Escape') {
                      e.preventDefault();
                      if (unsoldMemoPopupOpen) {
                        setUnsoldMemoPopupOpen(false);
                      }
                    }
                  }
                }}
                memoSelector={{
                  isOpen: unsoldMemoPopupOpen,
                  options: currentUnsoldMemoOptions,
                  activeIndex: unsoldMemoSelectionIndex,
                  onHighlight: setUnsoldMemoSelectionIndex,
                  onSelect: commitUnsoldMemoSelection,
                  variant: 'table',
                  className: 'table-popup'
                }}
                topShortcuts={SELLER_UNSOLD_SHORTCUTS}
                footerActions={sellerUnsoldRemoveActions}
                summaryQuantity={sellerUnsoldSummaryQuantity}
                summaryAmount={sellerUnsoldSummaryAmount}
                statusLabel={sessionMode}
                windowClassName="full-page"
                blockingWarning={activeTab === 'unsold-remove' ? blockingWarning : null}
                onBlockingWarningClose={clearBlockingWarning}
              />
            </div>
          </div>
        )}

        </div>
      )}

      <div className={`dashboard-accordion dashboard-secondary-actions ${!billOnlyMode && !activeTab ? 'dashboard-launcher-active' : ''}`.trim()}>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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
                <select value={historyShift} onChange={(e) => handleBillShiftChange(e.target.value)} style={{ marginTop: '8px' }}>
                  <option value="ALL">ALL</option>
                  <option value="MORNING">MORNING</option>
                  <option value="DAY">DAY</option>
                  <option value="EVENING">EVENING</option>
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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

        {activeTab === 'generate-bill' && (
          <div className="accordion-item">
            {!billOnlyMode && (
              <button className="accordion-header active" onClick={requestExitConfirmation}>
                Generate Bill
              </button>
            )}
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
                    {directChildSellers.filter((seller) => sellerSupportsAmount(seller, historyAmountFilter || amount)).map((seller) => (
                      <option key={seller.id || seller.username} value={seller.username}>
                        {`${getPartyKeyword(seller)} ${seller.username} [${getPartyKeyword(seller)}] (${getAllowedAmountsLabel(seller)})`}
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

              {Object.keys(billTransferHistoryByActor).length > 0 ? (
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
                      {sellerBillSummaryRows.map((summary) => {
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

              {Object.keys(billTransferHistoryByActor).length > 0 && (
                <div style={{ marginTop: '20px', padding: '18px 22px', borderRadius: '16px', background: '#eef2ff', fontSize: '28px', lineHeight: 1.45 }}>
                  <strong>Grand Total:</strong> Unsold % {(Number(billTransferHistoryTotals.totalSentPiece || 0) > 0 ? ((Number(billTransferHistoryTotals.totalUnsoldPiece || 0) / Number(billTransferHistoryTotals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}% | Sold % {(Number(billTransferHistoryTotals.totalSentPiece || 0) > 0 ? ((Number(billTransferHistoryTotals.totalSoldPiece || 0) / Number(billTransferHistoryTotals.totalSentPiece || 0)) * 100) : 0).toFixed(2)}% | Net {formatSignedRupees(billTransferHistoryTotals.netBill)}
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
            <button className="accordion-header active" onClick={requestExitConfirmation}>
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

      {!activeTab && (
        <div className="seller-dashboard-actions">
          <PasswordSettingsMenu
            currentUser={user}
            onSuccess={setSuccess}
            onError={setError}
          />
          <button className="logout-btn" onClick={onLogout}>Logout</button>
        </div>
      )}

      <>
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}
      </>
    </div>
  );
};

const AddSellerForm = ({ currentUser, selectedAmount = '', onSuccess, onError }) => {
  const [newUsername, setNewUsername] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [rateAmount6, setRateAmount6] = useState('');
  const [rateAmount12, setRateAmount12] = useState('');
  const allowedSellerTypes = getAllowedChildSellerTypes(currentUser);
  const [sellerType, setSellerType] = useState(allowedSellerTypes[0] || '');
  const [loading, setLoading] = useState(false);
  const canAssignAmount6 = (String(selectedAmount) !== '12') && (currentUser?.role === 'admin' || Number(currentUser?.rateAmount6 || 0) > 0);
  const canAssignAmount12 = (String(selectedAmount) !== '7') && (currentUser?.role === 'admin' || Number(currentUser?.rateAmount12 || 0) > 0);
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

    if (!sellerType) {
      onError('Aap is user se aur seller create nahi kar sakte');
      setLoading(false);
      return;
    }

    try {
      await userService.createSeller(
        trimmedUsername,
        trimmedKeyword,
        requiresLoginPassword ? newPassword : '',
        canAssignAmount6 ? (rateAmount6 ? parseFloat(rateAmount6) : '') : 0,
        canAssignAmount12 ? (rateAmount12 ? parseFloat(rateAmount12) : '') : 0,
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
    <div className="tab-content">
      <h2>Add New Seller</h2>
      <form onSubmit={handleCreateSeller} className="seller-form">
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
            placeholder="Jaise SA, RU, TA"
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
            Seller ka login nahi banega. Bas naam save hoga aur usi naam par purchase/unsold/F10 summary chalegi.
          </p>
        )}
        {canAssignAmount6 && (
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
          Agar rate blank raha to us naam par us amount ka maal assign nahi hoga.
        </p>
        {requiresLoginPassword && currentUser?.role !== 'admin' && (
          <p style={{ marginTop: '0', color: '#666', fontSize: '14px' }}>
            If a seller leaves a rate blank, the child seller will get the default rate automatically: 7 for amount 7 and 12 for amount 12.
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
