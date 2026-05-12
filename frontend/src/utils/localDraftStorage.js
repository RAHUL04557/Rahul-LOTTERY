const DRAFT_PREFIX = 'lottery.localDraft';

const getStorage = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  return window.localStorage;
};

const getLocalDb = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.lotteryLocalDb || null;
};

const getDraftTypeFromTab = (tab) => {
  if (tab === 'purchase-send') {
    return 'purchase_send';
  }
  if (tab === 'unsold-remove') {
    return 'unsold_remove';
  }
  if (tab === 'unsold') {
    return 'unsold';
  }

  return '';
};

export const parseDraftKey = (key) => {
  const parts = String(key || '').split(':');
  const [, role, userId, tab, targetSellerId, bookingDate, sessionMode, purchaseCategory, amount, memoNumber] = parts;
  const type = getDraftTypeFromTab(tab);

  return {
    role,
    userId: Number(userId || 0),
    tab,
    type,
    targetSellerId: Number(targetSellerId || 0),
    bookingDate,
    sessionMode,
    purchaseCategory,
    amount,
    memoNumber: memoNumber === undefined || memoNumber === null || String(memoNumber).trim() === '' || Number.isNaN(Number(memoNumber))
      ? null
      : Number(memoNumber)
  };
};

export const buildDraftStorageKey = (parts = []) => (
  [DRAFT_PREFIX, ...parts.map((part) => String(part ?? '').trim() || 'none')].join(':')
);

const loadDraftRowsFromLocalStorage = (key) => {
  const storage = getStorage();
  if (!storage || !key) {
    return [];
  }

  try {
    const savedValue = storage.getItem(key);
    if (!savedValue) {
      return [];
    }

    const parsedValue = JSON.parse(savedValue);
    return Array.isArray(parsedValue?.rows) ? parsedValue.rows : [];
  } catch (error) {
    return [];
  }
};

const listDraftRowsFromLocalStorage = ({ role = '', userId = 0, tab = '' } = {}) => {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const drafts = [];

  for (let index = 0; index < storage.length; index += 1) {
    const draftKey = storage.key(index);
    if (!draftKey || !draftKey.startsWith(`${DRAFT_PREFIX}:`)) {
      continue;
    }

    const draftInfo = parseDraftKey(draftKey);
    if (
      (role && draftInfo.role !== role)
      || (userId && Number(draftInfo.userId || 0) !== Number(userId || 0))
      || (tab && draftInfo.tab !== tab)
    ) {
      continue;
    }

    try {
      const parsedValue = JSON.parse(storage.getItem(draftKey) || '{}');
      const rows = Array.isArray(parsedValue?.rows) ? parsedValue.rows : [];
      if (rows.length > 0) {
        drafts.push({
          ...draftInfo,
          draftKey,
          rows,
          savedAt: parsedValue.savedAt || ''
        });
      }
    } catch (error) {
      // Ignore malformed local draft rows.
    }
  }

  return drafts;
};

const saveDraftRowsToLocalStorage = (key, rows = []) => {
  const storage = getStorage();
  if (!storage || !key) {
    return;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    storage.removeItem(key);
    return;
  }

  storage.setItem(key, JSON.stringify({
    savedAt: new Date().toISOString(),
    rows
  }));
};

const clearDraftRowsFromLocalStorage = (key) => {
  const storage = getStorage();
  if (!storage || !key) {
    return;
  }

  storage.removeItem(key);
};

export const loadDraftRows = async (key) => {
  const localDb = getLocalDb();
  const draftInfo = parseDraftKey(key);

  if (localDb && draftInfo.type) {
    try {
      const savedDraft = await localDb.loadDraft({
        type: draftInfo.type,
        draftKey: key
      });

      if (savedDraft && Array.isArray(savedDraft.rows)) {
        return savedDraft.rows;
      }
    } catch (error) {
      // Fall back to localStorage when Electron local DB is unavailable.
    }
  }

  return loadDraftRowsFromLocalStorage(key);
};

export const saveDraftRows = async (key, rows = []) => {
  const localDb = getLocalDb();
  const draftInfo = parseDraftKey(key);

  if (localDb && draftInfo.type) {
    try {
      if (!Array.isArray(rows) || rows.length === 0) {
        await localDb.clearDraft({
          type: draftInfo.type,
          draftKey: key
        });
        clearDraftRowsFromLocalStorage(key);
        return;
      }

      await localDb.saveDraft({
        type: draftInfo.type,
        draftKey: key,
        userId: draftInfo.userId,
        targetSellerId: draftInfo.targetSellerId,
        memoNumber: draftInfo.memoNumber,
        rows,
        bookingDate: draftInfo.bookingDate,
        sessionMode: draftInfo.sessionMode,
        purchaseCategory: draftInfo.purchaseCategory,
        amount: draftInfo.amount
      });
      clearDraftRowsFromLocalStorage(key);
      return;
    } catch (error) {
      // Fall back to localStorage when Electron local DB is unavailable.
    }
  }

  saveDraftRowsToLocalStorage(key, rows);
};

export const clearDraftRows = async (key) => {
  const localDb = getLocalDb();
  const draftInfo = parseDraftKey(key);

  if (localDb && draftInfo.type) {
    try {
      await localDb.clearDraft({
        type: draftInfo.type,
        draftKey: key
      });
    } catch (error) {
      // localStorage is cleared below regardless.
    }
  }

  clearDraftRowsFromLocalStorage(key);
};

export const listDraftRows = async ({ role = '', userId = 0, tab = '' } = {}) => {
  const localDrafts = listDraftRowsFromLocalStorage({ role, userId, tab });
  const localDb = getLocalDb();
  const type = getDraftTypeFromTab(tab);
  const byKey = new Map(localDrafts.map((draft) => [draft.draftKey, draft]));

  if (localDb?.listDrafts && type) {
    try {
      const dbDrafts = await localDb.listDrafts({
        type,
        userId
      });

      (Array.isArray(dbDrafts) ? dbDrafts : []).forEach((draft) => {
        const draftKey = draft.draftKey || draft.draft_key;
        const draftInfo = parseDraftKey(draftKey);
        if (
          (role && draftInfo.role !== role)
          || (userId && Number(draftInfo.userId || 0) !== Number(userId || 0))
          || (tab && draftInfo.tab !== tab)
        ) {
          return;
        }

        const rows = Array.isArray(draft.rows) ? draft.rows : [];
        if (rows.length > 0) {
          byKey.set(draftKey, {
            ...draftInfo,
            draftKey,
            rows,
            savedAt: draft.updatedAt || draft.updated_at || draft.savedAt || ''
          });
        }
      });
    } catch (error) {
      // Local storage drafts are still returned when Electron local DB is unavailable.
    }
  }

  return Array.from(byKey.values()).sort((left, right) => (
    String(right.savedAt || '').localeCompare(String(left.savedAt || ''))
  ));
};
