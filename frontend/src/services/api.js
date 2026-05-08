import axios from 'axios';
import { appConfig } from '../config/appConfig';

const API_BASE_URL = appConfig.apiBaseUrl;

const api = axios.create({
  baseURL: API_BASE_URL
});

const getApiBaseUrls = () => [
  API_BASE_URL,
  ...(Array.isArray(appConfig.apiFallbackUrls) ? appConfig.apiFallbackUrls : [])
].filter(Boolean);

const getLocalDb = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.lotteryLocalDb || null;
};

const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch (error) {
    return null;
  }
};

const isNetworkError = (error) => !error?.response;

const queueOfflineOperation = async (operationType, payload) => {
  const localDb = getLocalDb();
  const currentUser = getCurrentUser();

  if (!localDb?.enqueueSync || !currentUser?.id) {
    throw new Error('Local sync queue available nahi hai');
  }

  const queued = await localDb.enqueueSync({
    userId: currentUser.id,
    operationType,
    payload
  });

  if (localDb.applyOfflinePurchaseMutation) {
    await localDb.applyOfflinePurchaseMutation({
      operationType,
      payload: payload?.body || payload,
      userId: currentUser.id
    }).catch((error) => {
      console.warn('Local offline mutation failed:', error.message);
    });
  }

  return {
    data: {
      message: 'Internet nahi hai. Entry local queue me save ho gayi, net aane par sync/send ho jayegi.',
      offlineQueued: true,
      localSyncId: queued.localId
    }
  };
};

const postWithOfflineQueue = async (url, payload, operationType) => {
  try {
    const response = await api.post(url, payload);
    const localDb = getLocalDb();
    const responseEntries = Array.isArray(response.data?.entries) ? response.data.entries : [];

    if (localDb?.upsertPurchases && responseEntries.length > 0) {
      await localDb.upsertPurchases(responseEntries).catch((error) => {
        console.warn('Local purchase update failed:', error.message);
      });
    }

    return response;
  } catch (error) {
    if (isNetworkError(error)) {
      return queueOfflineOperation(operationType, { url, method: 'POST', body: payload });
    }

    throw error;
  }
};

const getPurchasesFromLocalDb = async (params = {}) => {
  const localDb = getLocalDb();

  if (!localDb?.listPurchases || !appConfig.offlineFirstEnabled) {
    return null;
  }

  const bootstrapState = localDb.getMetadata ? await localDb.getMetadata('lastBootstrapAt') : null;
  if (!bootstrapState) {
    return null;
  }

  const data = await localDb.listPurchases(params);
  return { data };
};

const canUseLocalRead = async () => {
  const localDb = getLocalDb();

  if (!localDb || !appConfig.offlineFirstEnabled) {
    return false;
  }

  const bootstrapState = localDb.getMetadata ? await localDb.getMetadata('lastBootstrapAt') : null;
  return Boolean(bootstrapState);
};

const getLocalPurchaseBillSummary = async (params = {}) => {
  const localDb = getLocalDb();

  if (!localDb?.getPurchaseBillSummary || !(await canUseLocalRead())) {
    return null;
  }

  return { data: await localDb.getPurchaseBillSummary(params) };
};

const traceFromLocalDb = async (params = {}) => {
  const localDb = getLocalDb();

  if (!localDb?.tracePurchases || !(await canUseLocalRead())) {
    return null;
  }

  return { data: await localDb.tracePurchases(params) };
};

const getLocalPrizeResults = async (params = {}) => {
  const localDb = getLocalDb();

  if (!localDb?.listPrizeResults || !(await canUseLocalRead())) {
    return null;
  }

  return { data: await localDb.listPrizeResults(params) };
};

const getLocalBillPrizes = async (params = {}) => {
  const localDb = getLocalDb();

  if (!localDb?.getBillPrizes || !(await canUseLocalRead())) {
    return null;
  }

  return { data: await localDb.getBillPrizes(params) };
};

const checkPrizeFromLocalDb = async (params = {}) => {
  const localDb = getLocalDb();

  if (!localDb?.checkPrize || !(await canUseLocalRead())) {
    return null;
  }

  return { data: await localDb.checkPrize(params) };
};

const getFilteredPrizeResultsFromLocalDb = async (params = {}) => {
  const localDb = getLocalDb();

  if (!localDb?.getFilteredPrizeResults || !(await canUseLocalRead())) {
    return null;
  }

  return { data: await localDb.getFilteredPrizeResults(params) };
};

// Add token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  const savedEntryConfig = localStorage.getItem('entryConfig');
  let activeSessionMode = '';

  if (savedEntryConfig) {
    try {
      activeSessionMode = JSON.parse(savedEntryConfig)?.sessionMode || '';
    } catch (error) {
      activeSessionMode = '';
    }
  }

  const sellerSessionMode = activeSessionMode || localStorage.getItem('sellerSessionMode');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (sellerSessionMode && config.withSessionMode !== false && typeof config.headers['X-Session-Mode'] === 'undefined') {
    config.headers['X-Session-Mode'] = sellerSessionMode;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!isNetworkError(error) || !error.config || error.config.__apiFallbackTried) {
      throw error;
    }

    const baseUrls = getApiBaseUrls();
    const currentBaseUrl = error.config.baseURL || API_BASE_URL;
    const fallbackUrls = baseUrls.filter((baseUrl) => baseUrl !== currentBaseUrl);

    for (const fallbackUrl of fallbackUrls) {
      try {
        return await api.request({
          ...error.config,
          baseURL: fallbackUrl,
          __apiFallbackTried: true
        });
      } catch (fallbackError) {
        if (!isNetworkError(fallbackError)) {
          throw fallbackError;
        }
      }
    }

    throw error;
  }
);

export const authService = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  getCurrentUser: () => api.get('/auth/me')
};

export const userService = {
  createSeller: (username, keyword, password, rateAmount6, rateAmount12, sellerType = 'seller') => api.post('/users/create-seller', { username, keyword, password, rateAmount6, rateAmount12, sellerType }),
  createAdmin: (username, password) => api.post('/users/create-admin', { username, password }),
  getAdmins: () => api.get('/users/admins'),
  getChildSellers: () => api.get('/users/child-sellers'),
  getAllSellers: () => api.get('/users/all-sellers'),
  getUserTree: () => api.get('/users/tree'),
  changeChildPassword: (userId, newPassword) => api.patch(`/users/${userId}/password`, { newPassword }),
  deleteUser: (userId) => api.delete(`/users/${userId}`)
};

export const syncService = {
  bootstrap: ({ days, since } = {}) => api.get('/sync/bootstrap', {
    params: {
      ...(days && { days }),
      ...(since && { since })
    },
    withSessionMode: false
  })
};

export const lotteryService = {
  addEntry: (payload) => api.post('/lottery/add-entry', payload),
  addAdminPurchase: (payload) => api.post('/lottery/admin-purchases', payload),
  replaceAdminPurchaseMemo: (payload) => api.put('/lottery/admin-purchases/memo', payload),
  getAdminPurchases: ({ bookingDate, sessionMode, amount, boxValue, purchaseCategory } = {}, requestOptions = {}) =>
    api.get('/lottery/admin-purchases', {
      ...requestOptions,
      params: {
        ...(bookingDate && { bookingDate }),
        ...(sessionMode && { sessionMode }),
        ...(amount && { amount }),
        ...(boxValue && { boxValue }),
        ...(purchaseCategory && { purchaseCategory })
      }
    }),
  sendAdminPurchase: (payload) => postWithOfflineQueue('/lottery/purchases/send', payload, 'purchase_send'),
  replacePurchaseSendMemo: (payload) => api.put('/lottery/purchases/memo', payload),
  sendPurchase: (payload) => postWithOfflineQueue('/lottery/purchases/send', payload, 'purchase_send'),
  transferRemainingStock: (payload) => postWithOfflineQueue('/lottery/purchases/stock-transfer', payload, 'stock_transfer'),
  assignPurchase: (payload) => api.post('/lottery/purchases/assign', payload),
  getPurchases: async ({ bookingDate, sessionMode, sellerId, status, purchaseCategory, amount, boxValue, remaining } = {}, requestOptions = {}) => {
    const params = {
      ...(bookingDate && { bookingDate }),
      ...(sessionMode && { sessionMode }),
      ...(sellerId && { sellerId }),
      ...(status && { status }),
      ...(purchaseCategory && { purchaseCategory }),
      ...(amount && { amount }),
      ...(boxValue && { boxValue }),
      ...(remaining !== undefined && { remaining })
    };

    try {
      const localResult = await getPurchasesFromLocalDb(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local purchase read failed, falling back to server:', error.message);
    }

    return api.get('/lottery/purchases', {
      ...requestOptions,
      params
    });
  },
  getSellerPurchaseView: ({ bookingDate, sessionMode, sellerId, purchaseCategory, amount } = {}, requestOptions = {}) =>
    api.get('/lottery/purchases/seller-view', {
      ...requestOptions,
      params: {
        ...(bookingDate && { bookingDate }),
        ...(sessionMode && { sessionMode }),
        ...(sellerId && { sellerId }),
        ...(purchaseCategory && { purchaseCategory }),
        ...(amount && { amount })
      }
    }),
  getPurchasePieceSummary: ({ bookingDate, sessionMode, purchaseCategory, amount } = {}, requestOptions = {}) =>
    api.get('/lottery/purchases/piece-summary', {
      ...requestOptions,
      params: {
        ...(bookingDate && { bookingDate }),
        ...(sessionMode && { sessionMode }),
        ...(purchaseCategory && { purchaseCategory }),
        ...(amount && { amount })
      }
    }),
  getPurchaseUnsoldSendSummary: ({ bookingDate, sessionMode, purchaseCategory, amount } = {}, requestOptions = {}) =>
    api.get('/lottery/purchases/unsold-send-summary', {
      ...requestOptions,
      params: {
        ...(bookingDate && { bookingDate }),
        ...(sessionMode && { sessionMode }),
        ...(purchaseCategory && { purchaseCategory }),
        ...(amount && { amount })
      }
    }),
  getPurchaseUnsoldRemoveMemo: ({ bookingDate, sessionMode, sellerId, purchaseCategory, amount } = {}, requestOptions = {}) =>
    api.get('/lottery/purchases/unsold-remove-memo', {
      ...requestOptions,
      params: {
        ...(bookingDate && { bookingDate }),
        ...(sessionMode && { sessionMode }),
        ...(sellerId && { sellerId }),
        ...(purchaseCategory && { purchaseCategory }),
        ...(amount && { amount })
      }
    }),
  markPurchaseUnsold: (payload) => postWithOfflineQueue('/lottery/purchases/mark-unsold', payload, 'unsold_save'),
  removePurchaseUnsold: (payload) => postWithOfflineQueue('/lottery/purchases/remove-unsold', payload, 'unsold_remove'),
  checkPurchaseUnsoldRemove: (payload) => api.post('/lottery/purchases/remove-unsold/check', payload),
  replacePurchaseUnsoldMemo: (payload) => api.put('/lottery/purchases/unsold-memo', payload),
  sendPurchaseUnsold: (payload) => postWithOfflineQueue('/lottery/purchases/send-unsold', payload, 'unsold_send'),
  getPendingEntries: ({ bookingDate, amount } = {}) =>
    api.get('/lottery/pending-entries', {
      params: {
        ...(bookingDate && { bookingDate }),
        ...(amount && { amount })
      }
    }),
  deletePendingEntry: (entryId, { bookingDate } = {}) =>
    api.delete(`/lottery/pending-entries/${entryId}`, {
      params: {
        ...(bookingDate && { bookingDate })
      }
    }),
  sendEntries: ({ bookingDate, amount } = {}) => api.post('/lottery/send-entries', {
    ...(bookingDate && { bookingDate }),
    ...(amount && { amount })
  }),
  getSentEntries: ({ date, fromDate, toDate, sessionMode, purchaseCategory } = {}, requestOptions = {}) =>
    api.get('/lottery/sent-entries', {
      ...requestOptions,
      params: {
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(sessionMode && { sessionMode }),
        ...(purchaseCategory && { purchaseCategory })
      }
    }),
  getMySentEntries: ({ sessionMode, bookingDate, amount } = {}, requestOptions = {}) =>
    api.get('/lottery/my-sent-entries', {
      ...requestOptions,
      params: {
        ...(sessionMode && { sessionMode }),
        ...(bookingDate && { bookingDate }),
        ...(amount && { amount })
      }
    }),
  getReceivedEntries: ({ amount } = {}) => api.get('/lottery/received-entries', {
    params: {
      ...(amount && { amount })
    }
  }),
  updateReceivedEntryStatus: (entryId, action, { amount } = {}) => api.patch(`/lottery/received-entries/${entryId}`, {
    action,
    ...(amount && { amount })
  }),
  getAcceptedBookEntries: ({ bookingDate, amount } = {}) =>
    api.get('/lottery/accepted-book-entries', {
      params: {
        ...(bookingDate && { bookingDate }),
        ...(amount && { amount })
      }
    }),
  getTransferHistory: ({ date, fromDate, toDate, shift, amount, purchaseCategory, includeBookings } = {}, requestOptions = {}) =>
    api.get('/lottery/transfer-history', {
      ...requestOptions,
      params: {
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(shift && { shift }),
        ...(amount && { amount }),
        ...(purchaseCategory && { purchaseCategory }),
        ...(includeBookings && { includeBookings })
      }
    }),
  getPurchaseBillSummary: async ({ date, fromDate, toDate, shift, amount, purchaseCategory } = {}, requestOptions = {}) => {
    const params = {
      ...(date && { date }),
      ...(fromDate && { fromDate }),
      ...(toDate && { toDate }),
      ...(shift && { shift }),
      ...(amount && { amount }),
      ...(purchaseCategory && { purchaseCategory })
    };

    try {
      const localResult = await getLocalPurchaseBillSummary(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local bill summary failed, falling back to server:', error.message);
    }

    return api.get('/lottery/purchases/bill-summary', {
      ...requestOptions,
      params
    });
  },
  traceNumber: async ({ number, uniqueCode, date, fromDate, toDate, sessionMode, amount, sem } = {}, requestOptions = {}) => {
    const params = {
      ...(number && { number }),
      ...(uniqueCode && { uniqueCode }),
      ...(date && { date }),
      ...(fromDate && { fromDate }),
      ...(toDate && { toDate }),
      ...(sessionMode && { sessionMode }),
      ...(amount && { amount }),
      ...(sem && { sem })
    };

    try {
      const localResult = await traceFromLocalDb(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local trace failed, falling back to server:', error.message);
    }

    return api.get('/lottery/trace-number', {
      ...requestOptions,
      params
    });
  }
};

export const priceService = {
  uploadPrice: async ({ entries, sessionMode, purchaseCategory, resultForDate }) => {
    const response = await api.post('/prices/upload', { entries, sessionMode, purchaseCategory, resultForDate });
    const localDb = getLocalDb();
    const results = Array.isArray(response.data?.results) ? response.data.results : [];

    if (localDb?.upsertPrizeResults && results.length > 0) {
      await localDb.upsertPrizeResults(results).catch((error) => {
        console.warn('Local prize result update failed:', error.message);
      });
    }

    return response;
  },
  updatePrizeResult: (id, winningNumber) => api.patch(`/prices/${id}`, { winningNumber }),
  deletePrizeResult: (id) => api.delete(`/prices/${id}`),
  deletePrizeResults: ({ resultForDate, sessionMode, purchaseCategory }) =>
    api.delete('/prices/bulk-delete', {
      data: {
        resultForDate,
        sessionMode,
        purchaseCategory
      }
    }),
  checkPrize: async ({ number, date, sessionMode, purchaseCategory, amount, sem }) => {
    const params = {
      ...(number && { number }),
      ...(date && { date }),
      ...(sessionMode && { sessionMode }),
      ...(purchaseCategory && { purchaseCategory }),
      amount: amount || 'ALL',
      sem: sem || 'ALL'
    };

    try {
      const localResult = await checkPrizeFromLocalDb(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local prize check failed, falling back to server:', error.message);
    }

    return api.get('/prices/check', {
      params: {
        ...params
      }
    });
  },
  getMyPrizes: ({ sessionMode, purchaseCategory, amount, sem }) =>
    api.get('/prices/my-prizes', {
      params: {
        ...(sessionMode && { sessionMode }),
        ...(purchaseCategory && { purchaseCategory }),
        amount: amount || 'ALL',
        sem: sem || 'ALL'
      }
    }),
  getPrizeTracker: ({ resultForDate, sessionMode } = {}) =>
    api.get('/prices/tracker', {
      params: {
        ...(resultForDate && { resultForDate }),
        sessionMode: sessionMode || 'ALL'
      }
    }),
  getFilteredPrizeResults: async ({ date, shift, sellerId, soldStatus } = {}) => {
    const params = {
      ...(date && { date }),
      ...(shift && { shift }),
      ...(sellerId && { sellerId }),
      ...(soldStatus && { soldStatus })
    };

    try {
      const localResult = await getFilteredPrizeResultsFromLocalDb(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local prize results failed, falling back to server:', error.message);
    }

    return api.get('/prices/results', { params });
  },
  getBillPrizes: async ({ date, fromDate, toDate, shift, amount, purchaseCategory } = {}) => {
    const params = {
      ...(date && { date }),
      ...(fromDate && { fromDate }),
      ...(toDate && { toDate }),
      ...(shift && { shift }),
      ...(amount && { amount }),
      ...(purchaseCategory && { purchaseCategory })
    };

    try {
      const localResult = await getLocalBillPrizes(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local bill prizes failed, falling back to server:', error.message);
    }

    return api.get('/prices/bill-prizes', { params });
  },
  getPriceByCode: (uniqueCode) => api.get(`/prices/${uniqueCode}`),
  getAllPrices: async ({ resultForDate, sessionMode, purchaseCategory } = {}) => {
    const params = {
      ...(resultForDate && { resultForDate }),
      ...(sessionMode && { sessionMode }),
      ...(purchaseCategory && { purchaseCategory })
    };

    try {
      const localResult = await getLocalPrizeResults(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local prize list failed, falling back to server:', error.message);
    }

    return api.get('/prices', { params });
  }
};

export default api;
