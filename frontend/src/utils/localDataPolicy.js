// Shared by the renderer and Electron. Only selected business dates are used.
const CUTOFF = '2026-10-01';
const DATE_FIELDS = ['bookingDate', 'booking_date', 'drawDate', 'resultForDate', 'result_for_date'];

function dateOnly(value) {
  if (typeof value !== 'string') return '';
  let text = value.trim();
  const display = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  if (display) text = `${display[3]}-${display[2]}-${display[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(text)) return '';
  text = text.slice(0, 10);
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : '';
}

function selectedDate(value, fallback = '') {
  if (!value || typeof value !== 'object') return dateOnly(fallback);
  for (const key of DATE_FIELDS) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') {
      return dateOnly(value[key]); // Invalid explicit dates must never inherit a deletion date.
    }
  }
  return dateOnly(fallback);
}

function isRemoved(date, deletedDates = []) {
  const normalized = dateOnly(date);
  return Boolean(normalized && (normalized < CUTOFF || deletedDates.includes(normalized)));
}

function collectDates(value, fallback = '') {
  const found = new Set();
  function visit(item, parent) {
    if (Array.isArray(item)) return item.forEach((row) => visit(row, parent));
    if (!item || typeof item !== 'object') return;
    const date = selectedDate(item, parent);
    if (date) found.add(date);
    Object.values(item).forEach((child) => {
      if (child && typeof child === 'object') visit(child, date);
    });
  }
  visit(value, fallback);
  return [...found];
}

// Filter rows, never use createdAt/updatedAt/savedAt as a date fallback.
function cleanRows(rows, fallback, deletedDates = []) {
  return rows.filter((row) => !isRemoved(selectedDate(row, fallback), deletedDates));
}

function managedStorageKey(key) {
  return /^lottery\.adminBooking\.[^.]+\.[^.]+\.(entries|ui)$/.test(key)
    || key.startsWith('lottery.localDraft:');
}

function cleanStorageValue(key, raw, deletedDates = []) {
  if (!managedStorageKey(key)) return raw;
  let value;
  try { value = JSON.parse(raw); } catch (_) { return raw; }
  if (!value || typeof value !== 'object') return raw;
  if (Array.isArray(value)) {
    const rows = cleanRows(value, '', deletedDates);
    return rows.length === value.length ? raw : JSON.stringify(rows);
  }
  const fallback = key.startsWith('lottery.localDraft:') ? dateOnly(key.split(':')[5]) : selectedDate(value);
  let changed = false;
  const next = { ...value };
  for (const field of ['rows', 'draftRows', 'resultRows']) {
    if (!Array.isArray(value[field])) continue;
    next[field] = cleanRows(value[field], fallback, deletedDates);
    changed = changed || next[field].length !== value[field].length;
  }
  if (key.startsWith('lottery.localDraft:') && Array.isArray(next.rows) && !next.rows.length && isRemoved(fallback, deletedDates)) return null;
  // UI filters/preferences are not entries. Clear only a stale unsaved input.
  if (key.endsWith('.ui') && isRemoved(fallback, deletedDates)) {
    for (const field of ['rangeStart', 'rangeEnd', 'codeInput']) {
      if (next[field]) { next[field] = ''; changed = true; }
    }
  }
  return changed ? JSON.stringify(next) : raw;
}

module.exports = { CUTOFF, dateOnly, selectedDate, isRemoved, collectDates, cleanRows, managedStorageKey, cleanStorageValue };
