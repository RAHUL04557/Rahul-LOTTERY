const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lotteryLocalDb', {
  getInfo: () => ipcRenderer.invoke('local-db:get-info'),
  getMetadata: (key) => ipcRenderer.invoke('local-db:get-metadata', key),
  setMetadata: (key, value) => ipcRenderer.invoke('local-db:set-metadata', { key, value }),
  loadDraft: (payload) => ipcRenderer.invoke('local-db:load-draft', payload),
  saveDraft: (payload) => ipcRenderer.invoke('local-db:save-draft', payload),
  clearDraft: (payload) => ipcRenderer.invoke('local-db:clear-draft', payload),
  upsertPurchases: (entries) => ipcRenderer.invoke('local-db:upsert-purchases', entries),
  listPurchases: (payload) => ipcRenderer.invoke('local-db:list-purchases', payload),
  upsertPrizeResults: (results) => ipcRenderer.invoke('local-db:upsert-prize-results', results),
  listPrizeResults: (payload) => ipcRenderer.invoke('local-db:list-prize-results', payload),
  getBillPrizes: (payload) => ipcRenderer.invoke('local-db:get-bill-prizes', payload),
  checkPrize: (payload) => ipcRenderer.invoke('local-db:check-prize', payload),
  getFilteredPrizeResults: (payload) => ipcRenderer.invoke('local-db:get-filtered-prize-results', payload),
  applyOfflinePurchaseMutation: (payload) => ipcRenderer.invoke('local-db:apply-offline-purchase-mutation', payload),
  getPurchaseBillSummary: (payload) => ipcRenderer.invoke('local-db:get-purchase-bill-summary', payload),
  tracePurchases: (payload) => ipcRenderer.invoke('local-db:trace-purchases', payload),
  enqueueSync: (payload) => ipcRenderer.invoke('local-db:enqueue-sync', payload),
  listSyncQueue: (payload) => ipcRenderer.invoke('local-db:list-sync-queue', payload),
  updateSyncItem: (payload) => ipcRenderer.invoke('local-db:update-sync-item', payload)
});
