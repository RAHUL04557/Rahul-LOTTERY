import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL
});

// Add token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  const sellerSessionMode = localStorage.getItem('sellerSessionMode');
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
  createSeller: (username, password, rateAmount6, rateAmount12) => api.post('/users/create-seller', { username, password, rateAmount6, rateAmount12 }),
  getChildSellers: () => api.get('/users/child-sellers'),
  getAllSellers: () => api.get('/users/all-sellers'),
  getUserTree: () => api.get('/users/tree'),
  changeChildPassword: (userId, newPassword) => api.patch(`/users/${userId}/password`, { newPassword }),
  deleteUser: (userId) => api.delete(`/users/${userId}`)
};

export const lotteryService = {
  addEntry: (payload) => api.post('/lottery/add-entry', payload),
  getPendingEntries: ({ bookingDate } = {}) =>
    api.get('/lottery/pending-entries', {
      params: {
        ...(bookingDate && { bookingDate })
      }
    }),
  deletePendingEntry: (entryId, { bookingDate } = {}) =>
    api.delete(`/lottery/pending-entries/${entryId}`, {
      params: {
        ...(bookingDate && { bookingDate })
      }
    }),
  sendEntries: ({ bookingDate } = {}) => api.post('/lottery/send-entries', { ...(bookingDate && { bookingDate }) }),
  getSentEntries: ({ date, fromDate, toDate, sessionMode } = {}, requestOptions = {}) =>
    api.get('/lottery/sent-entries', {
      ...requestOptions,
      params: {
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(sessionMode && { sessionMode })
      }
    }),
  getMySentEntries: ({ sessionMode, bookingDate } = {}, requestOptions = {}) =>
    api.get('/lottery/my-sent-entries', {
      ...requestOptions,
      params: {
        ...(sessionMode && { sessionMode }),
        ...(bookingDate && { bookingDate })
      }
    }),
  getReceivedEntries: () => api.get('/lottery/received-entries'),
  updateReceivedEntryStatus: (entryId, action) => api.patch(`/lottery/received-entries/${entryId}`, { action }),
  getAcceptedBookEntries: ({ bookingDate } = {}) =>
    api.get('/lottery/accepted-book-entries', {
      params: {
        ...(bookingDate && { bookingDate })
      }
    }),
  getTransferHistory: ({ date, fromDate, toDate, shift, includeBookings } = {}, requestOptions = {}) =>
    api.get('/lottery/transfer-history', {
      ...requestOptions,
      params: {
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(shift && { shift }),
        ...(includeBookings && { includeBookings })
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
  uploadPrice: ({ entries, sessionMode, resultForDate }) => api.post('/prices/upload', { entries, sessionMode, resultForDate }),
  updatePrizeResult: (id, winningNumber) => api.patch(`/prices/${id}`, { winningNumber }),
  checkPrize: ({ number, date, sessionMode, amount, sem }) =>
    api.get('/prices/check', {
      params: {
        ...(number && { number }),
        ...(date && { date }),
        ...(sessionMode && { sessionMode }),
        amount: amount || 'ALL',
        sem: sem || 'ALL'
      }
    }),
  getMyPrizes: ({ sessionMode, amount, sem }) =>
    api.get('/prices/my-prizes', {
      params: {
        ...(sessionMode && { sessionMode }),
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
  getBillPrizes: ({ date, fromDate, toDate, shift } = {}) =>
    api.get('/prices/bill-prizes', {
      params: {
        ...(date && { date }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(shift && { shift })
      }
    }),
  getPriceByCode: (uniqueCode) => api.get(`/prices/${uniqueCode}`),
  getAllPrices: ({ resultForDate, sessionMode } = {}) =>
    api.get('/prices', {
      params: {
        ...(resultForDate && { resultForDate }),
        ...(sessionMode && { sessionMode })
      }
    })
};

export default api;
