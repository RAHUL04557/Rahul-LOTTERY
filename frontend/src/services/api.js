import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL
});

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
  sendAdminPurchase: (payload) => api.post('/lottery/purchases/send', payload),
  replacePurchaseSendMemo: (payload) => api.put('/lottery/purchases/memo', payload),
  sendPurchase: (payload) => api.post('/lottery/purchases/send', payload),
  transferRemainingStock: (payload) => api.post('/lottery/purchases/stock-transfer', payload),
  assignPurchase: (payload) => api.post('/lottery/purchases/assign', payload),
  getPurchases: ({ bookingDate, sessionMode, sellerId, status, purchaseCategory, amount, boxValue, remaining } = {}, requestOptions = {}) =>
    api.get('/lottery/purchases', {
      ...requestOptions,
      params: {
        ...(bookingDate && { bookingDate }),
        ...(sessionMode && { sessionMode }),
        ...(sellerId && { sellerId }),
        ...(status && { status }),
        ...(purchaseCategory && { purchaseCategory })
        ,...(amount && { amount })
        ,...(boxValue && { boxValue })
        ,...(remaining !== undefined && { remaining })
      }
    }),
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
  markPurchaseUnsold: (payload) => api.post('/lottery/purchases/mark-unsold', payload),
  removePurchaseUnsold: (payload) => api.post('/lottery/purchases/remove-unsold', payload),
  checkPurchaseUnsoldRemove: (payload) => api.post('/lottery/purchases/remove-unsold/check', payload),
  replacePurchaseUnsoldMemo: (payload) => api.put('/lottery/purchases/unsold-memo', payload),
  sendPurchaseUnsold: (payload) => api.post('/lottery/purchases/send-unsold', payload),
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
  getPurchaseBillSummary: ({ date, fromDate, toDate, shift, amount, purchaseCategory } = {}, requestOptions = {}) =>
    api.get('/lottery/purchases/bill-summary', {
      ...requestOptions,
      params: {
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(shift && { shift }),
        ...(amount && { amount }),
        ...(purchaseCategory && { purchaseCategory })
      }
    }),
  traceNumber: ({ number, uniqueCode, date, fromDate, toDate, sessionMode, amount, sem } = {}, requestOptions = {}) =>
    api.get('/lottery/trace-number', {
      ...requestOptions,
      params: {
        ...(number && { number }),
        ...(uniqueCode && { uniqueCode }),
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(sessionMode && { sessionMode }),
        ...(amount && { amount }),
        ...(sem && { sem })
      }
    })
};

export const priceService = {
  uploadPrice: ({ entries, sessionMode, purchaseCategory, resultForDate }) => api.post('/prices/upload', { entries, sessionMode, purchaseCategory, resultForDate }),
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
  checkPrize: ({ number, date, sessionMode, purchaseCategory, amount, sem }) =>
    api.get('/prices/check', {
      params: {
        ...(number && { number }),
        ...(date && { date }),
        ...(sessionMode && { sessionMode }),
        ...(purchaseCategory && { purchaseCategory }),
        amount: amount || 'ALL',
        sem: sem || 'ALL'
      }
    }),
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
  getFilteredPrizeResults: ({ date, shift, sellerId, soldStatus } = {}) =>
    api.get('/prices/results', {
      params: {
        ...(date && { date }),
        ...(shift && { shift }),
        ...(sellerId && { sellerId }),
        ...(soldStatus && { soldStatus })
      }
    }),
  getBillPrizes: ({ date, fromDate, toDate, shift, amount, purchaseCategory } = {}) =>
    api.get('/prices/bill-prizes', {
      params: {
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(shift && { shift }),
        ...(amount && { amount }),
        ...(purchaseCategory && { purchaseCategory })
      }
    }),
  getPriceByCode: (uniqueCode) => api.get(`/prices/${uniqueCode}`),
  getAllPrices: ({ resultForDate, sessionMode, purchaseCategory } = {}) =>
    api.get('/prices', {
      params: {
        ...(resultForDate && { resultForDate }),
        ...(sessionMode && { sessionMode }),
        ...(purchaseCategory && { purchaseCategory })
      }
    })
};

export default api;
