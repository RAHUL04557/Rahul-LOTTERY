import policy from './localDataPolicy';

let deletedDates = [];
let enabled = false;
const desktopValues = new Map();

export function readLocalValue(key) {
  return enabled && policy.managedStorageKey(key) ? desktopValues.get(key) ?? null : window.localStorage.getItem(key);
}

export function localEntryStorage() {
  if (!enabled) return window.localStorage;
  return {
    get length() { return desktopValues.size; },
    key: (index) => [...desktopValues.keys()][index] ?? null,
    getItem: readLocalValue
  };
}

export function keepLocalRow(row, fallback = '') {
  return !enabled || !policy.isRemoved(policy.selectedDate(row, fallback), deletedDates);
}

export function filterLocalData(value, fallback = '') {
  if (!enabled || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.filter((row) => keepLocalRow(row, fallback)).map((row) => filterLocalData(row, fallback));
  const date = policy.selectedDate(value, fallback);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    child && typeof child === 'object' ? filterLocalData(child, date) : child
  ]));
}

export function assertLocalDateAllowed(value) {
  if (!enabled) return;
  if (policy.collectDates(value).some((date) => policy.isRemoved(date, deletedDates))) {
    const error = new Error('Is selected date ka local data delete ho chuka hai. 01 October 2026 ya uske baad ki available date select karo.');
    // Existing API code treats missing response as offline; do not enqueue this error.
    error.response = { status: 409, data: { message: error.message } };
    throw error;
  }
}

export function writeLocalValue(key, raw) {
  const bridge = window.lotteryLocalDb;
  let value = raw;
  if (enabled && policy.managedStorageKey(key)) {
    const result = bridge.saveBrowserStorage(key, raw);
    if (result.error) throw new Error(result.error);
    value = result.value;
    if (value === null) desktopValues.delete(key);
    else desktopValues.set(key, value);
    window.localStorage.removeItem(key);
    return;
  }
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

export async function initializeDateStorage() {
  if (!window.lotteryLocalDb?.initializeDateStorage) return;
  const values = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (policy.managedStorageKey(key)) values[key] = window.localStorage.getItem(key);
  }
  const result = await window.lotteryLocalDb.initializeDateStorage(values);
  deletedDates = result.deletedDates;
  desktopValues.clear();
  for (const [key, value] of Object.entries(result.values)) {
    if (value !== null) desktopValues.set(key, value);
  }
  // SQLite has committed the migration. Entries no longer consume the browser quota.
  for (const key of Object.keys(values)) window.localStorage.removeItem(key);
  enabled = true;
}
