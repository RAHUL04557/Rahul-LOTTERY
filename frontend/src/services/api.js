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

  let localMutationResult = null;
  if (localDb.applyOfflinePurchaseMutation) {
    localMutationResult = await localDb.applyOfflinePurchaseMutation({
      operationType,
      payload: payload?.body || payload,
      userId: currentUser.id
    }).catch((error) => {
      console.warn('Local offline mutation failed:', error.message);
      return null;
    });
  }

  return {
    data: {
      message: 'Internet nahi hai. Entry local queue me save ho gayi, net aane par sync/send ho jayegi.',
      offlineQueued: true,
      localSyncId: queued.localId,
      ...(localMutationResult?.seller && { seller: localMutationResult.seller }),
      ...(localMutationResult?.results && { results: localMutationResult.results })
    }
  };
};

const postWithOfflineQueue = async (url, payload, operationType) => {
  return requestWithOfflineQueue({ method: 'POST', url, data: payload }, operationType);
};

const requestWithOfflineQueue = async ({ method = 'POST', url, data, config = {} }, operationType) => {
  try {
    const response = await api.request({
      ...config,
      method,
      url,
      data
    });
    const localDb = getLocalDb();
    const responseEntries = Array.isArray(response.data?.entries) ? response.data.entries : [];
    const responseResults = Array.isArray(response.data?.results) ? response.data.results : [];
    const responseUsers = [
      ...(response.data?.seller ? [response.data.seller] : []),
      ...(Array.isArray(response.data?.users) ? response.data.users : [])
    ];

    if (
      localDb?.applyOfflinePurchaseMutation
      && ['replace_purchase_send_memo', 'replace_unsold_memo'].includes(operationType)
    ) {
      await localDb.applyOfflinePurchaseMutation({
        operationType,
        payload: {
          ...(data || {}),
          deletedMemoNumber: response.data?.deletedMemoNumber || data?.memoNumber,
          serverSynced: true
        },
        userId: getCurrentUser()?.id
      }).catch((error) => {
        console.warn('Local memo delete update failed:', error.message);
      });
    }
    if (localDb?.upsertPurchases && responseEntries.length > 0) {
      await localDb.upsertPurchases(responseEntries).catch((error) => {
        console.warn('Local purchase update failed:', error.message);
      });
    }
    if (localDb?.upsertPrizeResults && responseResults.length > 0) {
      await localDb.upsertPrizeResults(responseResults).catch((error) => {
        console.warn('Local prize result update failed:', error.message);
      });
    }
    if (responseUsers.length > 0) {
      await mergeLocalVisibleUsers(responseUsers);
    }

    return response;
  } catch (error) {
    if (isNetworkError(error)) {
      return queueOfflineOperation(operationType, { url, method, body: data, params: config.params });
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

const cachePurchaseResponse = async (response) => {
  const localDb = getLocalDb();
  const responseEntries = Array.isArray(response?.data)
    ? response.data
    : Array.isArray(response?.data?.entries)
    ? response.data.entries
    : [];

  if (localDb?.upsertPurchases && responseEntries.length > 0) {
    await localDb.upsertPurchases(responseEntries).catch((error) => {
      console.warn('Local purchase cache update failed:', error.message);
    });
  }
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
  const currentUser = getCurrentUser();

  if (!localDb?.getPurchaseBillSummary || !(await canUseLocalRead()) || !currentUser?.id) {
    return null;
  }

  return {
    data: await localDb.getPurchaseBillSummary({
      ...params,
      user: currentUser
    })
  };
};

const getLocalPurchasePieceSummary = async (params = {}) => {
  const localDb = getLocalDb();
  const currentUser = getCurrentUser();

  if (!localDb?.getPurchasePieceSummary || !(await canUseLocalRead()) || !currentUser?.id) {
    return null;
  }

  return {
    data: await localDb.getPurchasePieceSummary({
      ...params,
      user: currentUser
    })
  };
};

const mergeLocalVisibleUsers = async (users = []) => {
  const localDb = getLocalDb();
  const validUsers = (Array.isArray(users) ? users : []).filter((user) => user?.id);

  if (!localDb || validUsers.length === 0) {
    return;
  }

  if (localDb.upsertUsers) {
    await localDb.upsertUsers(validUsers).catch((error) => {
      console.warn('Local user update failed:', error.message);
    });
  }

  if (localDb.getMetadata && localDb.setMetadata) {
    const existingUsers = await localDb.getMetadata('visibleUsers').catch(() => []);
    const usersById = new Map((Array.isArray(existingUsers) ? existingUsers : []).map((user) => [Number(user.id), user]));
    validUsers.forEach((user) => usersById.set(Number(user.id), user));
    await localDb.setMetadata('visibleUsers', [...usersById.values()]).catch((error) => {
      console.warn('Local visible users update failed:', error.message);
    });
  }
};

const getLocalUserTree = async () => {
  const localDb = getLocalDb();
  const currentUser = getCurrentUser();

  if (!localDb?.getUserTree || !currentUser?.id) {
    return null;
  }

  return { data: await localDb.getUserTree({ user: currentUser }) };
};

const getLocalChildSellers = async () => {
  const localDb = getLocalDb();
  const currentUser = getCurrentUser();

  if (!localDb?.listUsers || !currentUser?.id) {
    return null;
  }

  const users = await localDb.listUsers();
  return {
    data: (Array.isArray(users) ? users : [])
      .filter((user) => Number(user.parentId) === Number(currentUser.id) && String(user.role || '').toLowerCase() === 'seller')
      .sort((left, right) => String(left.username || '').localeCompare(String(right.username || '')))
  };
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
  createSeller: async (username, keyword, password, rateAmount6, rateAmount12, sellerType = 'seller') => {
    const body = { username, keyword, password, rateAmount6, rateAmount12, sellerType };
    let response;

    try {
      response = await api.post('/users/create-seller', body);
    } catch (error) {
      if (isNetworkError(error)) {
        response = await queueOfflineOperation('create_seller', {
          url: '/users/create-seller',
          method: 'POST',
          body
        });
      } else {
        throw error;
      }
    }

    const seller = response.data?.seller;

    if (seller) {
      await mergeLocalVisibleUsers([seller]);
    }

    return response;
  },
  createAdmin: (username, password, resultUploadPassword) => requestWithOfflineQueue({
    method: 'POST',
    url: '/users/create-admin',
    data: { username, password, resultUploadPassword }
  }, 'create_admin'),
  getAdmins: () => api.get('/users/admins'),
  deleteAdmin: (userId) => api.delete(`/users/admins/${userId}`),
  changeAdminPassword: (userId, newPassword) => api.patch(`/users/admins/${userId}/password`, { newPassword }),
  changeAdminResultUploadPassword: (userId, newPassword) => api.patch(`/users/admins/${userId}/result-upload-password`, { newPassword }),
  verifyResultUploadPassword: (password) => api.post('/users/result-upload-password/verify', { password }),
  getChildSellers: async () => {
    try {
      return await api.get('/users/child-sellers');
    } catch (error) {
      if (isNetworkError(error)) {
        const localResult = await getLocalChildSellers();
        if (localResult) {
          return localResult;
        }
      }
      throw error;
    }
  },
  getAllSellers: async () => {
    try {
      return await api.get('/users/all-sellers');
    } catch (error) {
      if (isNetworkError(error)) {
        const localDb = getLocalDb();
        if (localDb?.listUsers) {
          const users = await localDb.listUsers();
          return {
            data: (Array.isArray(users) ? users : [])
              .filter((user) => String(user.role || '').toLowerCase() === 'seller')
              .sort((left, right) => String(left.username || '').localeCompare(String(right.username || '')))
          };
        }
      }
      throw error;
    }
  },
  getUserTree: async () => {
    try {
      const response = await api.get('/users/tree');
      const flattenTree = (node) => {
        if (!node) {
          return [];
        }
        return [node, ...(node.children || []).flatMap(flattenTree)];
      };
      await mergeLocalVisibleUsers(flattenTree(response.data));
      return response;
    } catch (error) {
      if (isNetworkError(error)) {
        const localResult = await getLocalUserTree();
        if (localResult) {
          return localResult;
        }
      }
      throw error;
    }
  },
  changeChildPassword: (userId, newPassword) => requestWithOfflineQueue({
    method: 'PATCH',
    url: `/users/${userId}/password`,
    data: { newPassword }
  }, 'change_child_password'),
  deleteUser: (userId) => requestWithOfflineQueue({
    method: 'DELETE',
    url: `/users/${userId}`
  }, 'delete_user')
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

export const billCacheService = {
  saveGeneratedBill: async ({ filters, bill }) => {
    const localDb = getLocalDb();
    const currentUser = getCurrentUser();

    if (!localDb?.saveGeneratedBill || !currentUser?.id) {
      return { skipped: true };
    }

    return localDb.saveGeneratedBill({
      userId: currentUser.id,
      filters,
      bill
    });
  },
  loadGeneratedBill: async ({ filters }) => {
    const localDb = getLocalDb();
    const currentUser = getCurrentUser();

    if (!localDb?.loadGeneratedBill || !currentUser?.id) {
      return null;
    }

    return localDb.loadGeneratedBill({
      userId: currentUser.id,
      filters
    });
  }
};

export const bookingService = {
  replaceMemo: (payload) => requestWithOfflineQueue({
    method: 'PUT',
    url: '/booking/memo',
    data: payload
  }, 'replace_booking_memo'),
  getEntries: ({ sellerId, bookingDate, fromDate, toDate, sessionMode, purchaseCategory, amount, status } = {}, requestOptions = {}) =>
    api.get('/booking/entries', {
      ...requestOptions,
      params: {
        ...(sellerId && { sellerId }),
        ...(bookingDate && { bookingDate }),
        ...(fromDate && { fromDate }),
        ...(toDate && { toDate }),
        ...(sessionMode && { sessionMode }),
        ...(purchaseCategory && { purchaseCategory }),
        ...(amount && { amount }),
        ...(status && { status })
      }
    })
};

export const lotteryService = {
  addEntry: (payload) => requestWithOfflineQueue({ method: 'POST', url: '/lottery/add-entry', data: payload }, 'add_entry'),
  addAdminPurchase: (payload) => requestWithOfflineQueue({ method: 'POST', url: '/lottery/admin-purchases', data: payload }, 'add_admin_purchase'),
  replaceAdminPurchaseMemo: (payload) => requestWithOfflineQueue({ method: 'PUT', url: '/lottery/admin-purchases/memo', data: payload }, 'replace_admin_purchase_memo'),
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
  getAdminPurchaseSentHistory: ({ bookingDate, sessionMode, amount, boxValue, purchaseCategory } = {}, requestOptions = {}) =>
    api.get('/lottery/admin-purchases/sent-history', {
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
  replacePurchaseSendMemo: (payload) => requestWithOfflineQueue({ method: 'PUT', url: '/lottery/purchases/memo', data: payload }, 'replace_purchase_send_memo'),
  sendPurchase: (payload) => postWithOfflineQueue('/lottery/purchases/send', payload, 'purchase_send'),
  transferRemainingStock: (payload) => postWithOfflineQueue('/lottery/purchases/stock-transfer', payload, 'stock_transfer'),
  assignPurchase: (payload) => requestWithOfflineQueue({ method: 'POST', url: '/lottery/purchases/assign', data: payload }, 'assign_purchase'),
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
      const response = await api.get('/lottery/purchases', {
        ...requestOptions,
        params
      });
      await cachePurchaseResponse(response);
      return response;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }

      const localResult = await getPurchasesFromLocalDb(params);
      if (localResult) {
        return localResult;
      }

      throw error;
    }
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
  getPurchasePieceSummary: async ({ bookingDate, sessionMode, purchaseCategory, amount } = {}, requestOptions = {}) => {
    const params = {
      ...(bookingDate && { bookingDate }),
      ...(sessionMode && { sessionMode }),
      ...(purchaseCategory && { purchaseCategory }),
      ...(amount && { amount })
    };

    try {
      const localResult = await getLocalPurchasePieceSummary(params);
      if (localResult) {
        return localResult;
      }
    } catch (error) {
      console.warn('Local piece summary failed, falling back to server:', error.message);
    }

    return api.get('/lottery/purchases/piece-summary', {
      ...requestOptions,
      params
    });
  },
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
  replacePurchaseUnsoldMemo: (payload) => requestWithOfflineQueue({ method: 'PUT', url: '/lottery/purchases/unsold-memo', data: payload }, 'replace_unsold_memo'),
  sendPurchaseUnsold: (payload) => postWithOfflineQueue('/lottery/purchases/send-unsold', payload, 'unsold_send'),
  getPendingEntries: ({ bookingDate, amount } = {}) =>
    api.get('/lottery/pending-entries', {
      params: {
        ...(bookingDate && { bookingDate }),
        ...(amount && { amount })
      }
    }),
  deletePendingEntry: (entryId, { bookingDate } = {}) =>
    requestWithOfflineQueue({
      method: 'DELETE',
      url: `/lottery/pending-entries/${entryId}`,
      config: {
        params: {
          ...(bookingDate && { bookingDate })
        }
      }
    }, 'delete_pending_entry'),
  sendEntries: ({ bookingDate, amount } = {}) => requestWithOfflineQueue({
    method: 'POST',
    url: '/lottery/send-entries',
    data: {
      ...(bookingDate && { bookingDate }),
      ...(amount && { amount })
    }
  }, 'send_entries'),
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
  updateReceivedEntryStatus: (entryId, action, { amount } = {}) => requestWithOfflineQueue({
    method: 'PATCH',
    url: `/lottery/received-entries/${entryId}`,
    data: {
      action,
      ...(amount && { amount })
    }
  }, 'update_received_entry_status'),
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
  uploadPrice: async ({ entries, sessionMode, purchaseCategory, resultForDate, resultUploadPassword }) => {
    return requestWithOfflineQueue({
      method: 'POST',
      url: '/prices/upload',
      data: { entries, sessionMode, purchaseCategory, resultForDate, resultUploadPassword }
    }, 'price_upload');
  },
  updatePrizeResult: (id, winningNumber, resultUploadPassword) => requestWithOfflineQueue({
    method: 'PATCH',
    url: `/prices/${id}`,
    data: { winningNumber, resultUploadPassword }
  }, 'update_prize_result'),
  deletePrizeResult: (id, resultUploadPassword) => requestWithOfflineQueue({
    method: 'DELETE',
    url: `/prices/${id}`,
    data: { resultUploadPassword }
  }, 'delete_prize_result'),
  deletePrizeResults: ({ resultForDate, sessionMode, purchaseCategory, resultUploadPassword }) =>
    requestWithOfflineQueue({
      method: 'DELETE',
      url: '/prices/bulk-delete',
      data: {
        resultForDate,
        sessionMode,
        purchaseCategory,
        resultUploadPassword
      }
    }, 'delete_prize_results'),
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
