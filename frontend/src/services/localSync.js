import { appConfig } from '../config/appConfig';
import api, { syncService } from './api';

const getLocalDb = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.lotteryLocalDb || null;
};

export const bootstrapLocalData = async () => {
  const localDb = getLocalDb();

  if (!appConfig.offlineFirstEnabled || !localDb?.upsertPurchases) {
    return { skipped: true, saved: 0 };
  }

  const lastBootstrapAt = localDb.getMetadata ? await localDb.getMetadata('lastBootstrapAt') : null;
  const response = await syncService.bootstrap({
    days: appConfig.syncBootstrapDays,
    since: lastBootstrapAt || undefined
  });
  const purchases = Array.isArray(response.data?.purchases) ? response.data.purchases : [];
  const prizeResults = Array.isArray(response.data?.prizeResults) ? response.data.prizeResults : [];
  const users = Array.isArray(response.data?.users) ? response.data.users : [];
  const savedResult = await localDb.upsertPurchases(purchases);
  const savedPrizeResult = localDb.upsertPrizeResults
    ? await localDb.upsertPrizeResults(prizeResults)
    : { saved: 0 };
  const savedUsersResult = localDb.upsertUsers
    ? await localDb.upsertUsers(users)
    : { saved: 0 };

  if (localDb.setMetadata) {
    await localDb.setMetadata('lastBootstrapAt', response.data?.serverTime || new Date().toISOString());
    await localDb.setMetadata('bootstrapDays', response.data?.days || appConfig.syncBootstrapDays);
    await localDb.setMetadata('visibleUsers', users);
  }

  return {
    skipped: false,
    saved: savedResult?.saved || purchases.length,
    prizeResults: savedPrizeResult?.saved || prizeResults.length,
    users: savedUsersResult?.saved || users.length
  };
};

export const flushSyncQueue = async () => {
  const localDb = getLocalDb();

  if (!appConfig.offlineFirstEnabled || !localDb?.listSyncQueue || !localDb?.updateSyncItem) {
    return { skipped: true, synced: 0 };
  }

  const [pendingItems, failedItems] = await Promise.all([
    localDb.listSyncQueue({ status: 'pending', limit: 50 }),
    localDb.listSyncQueue({ status: 'failed', limit: 20 })
  ]);
  const syncItems = [...pendingItems, ...failedItems];
  let synced = 0;

  for (const item of syncItems) {
    const payload = item.payload || {};
    try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(payload.method || '').toUpperCase())) {
        const response = await api.request({
          method: payload.method,
          url: payload.url,
          data: payload.body || {},
          params: payload.params || undefined
        });
        const responseEntries = Array.isArray(response.data?.entries) ? response.data.entries : [];
        const responseResults = Array.isArray(response.data?.results) ? response.data.results : [];
        const responseUsers = [
          ...(response.data?.seller ? [response.data.seller] : []),
          ...(Array.isArray(response.data?.users) ? response.data.users : [])
        ];

        if (responseEntries.length > 0 && localDb.upsertPurchases) {
          await localDb.upsertPurchases(responseEntries);
        }

        if (responseResults.length > 0 && localDb.upsertPrizeResults) {
          await localDb.upsertPrizeResults(responseResults);
        }

        if (responseUsers.length > 0 && localDb.upsertUsers) {
          await localDb.upsertUsers(responseUsers);
        }
      } else {
        throw new Error(`Unsupported offline sync method: ${payload.method || 'UNKNOWN'}`);
      }

      await localDb.updateSyncItem({ localId: item.local_id, status: 'synced' });
      synced += 1;
    } catch (error) {
      const status = error.response ? 'failed' : 'pending';
      await localDb.updateSyncItem({
        localId: item.local_id,
        status,
        lastError: error.response?.data?.message || error.message || 'Sync failed'
      });

      if (!error.response) {
        break;
      }
    }
  }

  return { skipped: false, synced };
};

export const getSyncQueueSummary = async () => {
  const localDb = getLocalDb();

  if (!localDb?.listSyncQueue) {
    return { pending: 0, failed: 0, items: [] };
  }

  const [pendingItems, failedItems] = await Promise.all([
    localDb.listSyncQueue({ status: 'pending', limit: 100 }),
    localDb.listSyncQueue({ status: 'failed', limit: 100 })
  ]);

  return {
    pending: pendingItems.length,
    failed: failedItems.length,
    items: [...pendingItems, ...failedItems]
  };
};
