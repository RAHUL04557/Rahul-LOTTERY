const express = require('express');
const {
  addLotteryEntry,
  addAdminPurchaseEntries,
  replaceAdminPurchaseMemoEntries,
  assignPurchasedEntries,
  getAdminPurchaseEntries,
  getPurchaseEntries,
  getSellerPurchaseView,
  getPurchasePieceSummary,
  getPurchaseBillSummary,
  getPurchaseUnsoldSendSummary,
  markPurchaseEntriesUnsold,
  removePurchaseUnsoldEntries,
  getPurchaseUnsoldRemoveMemoEntries,
  replacePurchaseUnsoldMemoEntries,
  sendPurchaseUnsoldToParent,
  sendAdminPurchaseEntries,
  replacePurchaseSendMemoEntries,
  transferRemainingPurchaseStock,
  getPendingEntries,
  deletePendingEntry,
  sendEntries,
  getSentEntries,
  getMySentEntries,
  getReceivedEntries,
  updateReceivedEntryStatus,
  getAcceptedEntriesForBookLottery,
  getTransferHistory,
  searchNumberTrace
} = require('../controllers/lotteryController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Add lottery entry
router.post('/add-entry', authenticateToken, authorizeRole(['seller']), addLotteryEntry);

// Admin saves purchase stock
router.post('/admin-purchases', authenticateToken, authorizeRole(['admin']), addAdminPurchaseEntries);

// Admin replaces one memo in purchase stock
router.put('/admin-purchases/memo', authenticateToken, authorizeRole(['admin']), replaceAdminPurchaseMemoEntries);

// Admin views purchase stock
router.get('/admin-purchases', authenticateToken, authorizeRole(['admin']), getAdminPurchaseEntries);

// Admin or seller sends purchase stock to seller/sub-seller
router.post('/purchases/send', authenticateToken, authorizeRole(['admin', 'seller']), sendAdminPurchaseEntries);

// Admin or seller replaces an existing purchase send memo
router.put('/purchases/memo', authenticateToken, authorizeRole(['admin', 'seller']), replacePurchaseSendMemoEntries);

// Admin or seller transfers all remaining stock for the selected context
router.post('/purchases/stock-transfer', authenticateToken, authorizeRole(['admin', 'seller']), transferRemainingPurchaseStock);

// Assign purchase range to seller
router.post('/purchases/assign', authenticateToken, authorizeRole(['admin']), assignPurchasedEntries);

// Get purchase entries / unsold records
router.get('/purchases', authenticateToken, getPurchaseEntries);

// Seller see-purchase view from received purchase history
router.get('/purchases/seller-view', authenticateToken, authorizeRole(['seller']), getSellerPurchaseView);

// Get current-holder purchase piece summary
router.get('/purchases/piece-summary', authenticateToken, authorizeRole(['admin', 'seller']), getPurchasePieceSummary);

// Get current purchase bill summary
router.get('/purchases/bill-summary', authenticateToken, authorizeRole(['admin', 'seller']), getPurchaseBillSummary);

// Get unsold send summary for F11
router.get('/purchases/unsold-send-summary', authenticateToken, authorizeRole(['seller']), getPurchaseUnsoldSendSummary);

// Admin/seller marks assigned purchase numbers as unsold
router.post('/purchases/mark-unsold', authenticateToken, authorizeRole(['admin', 'seller']), markPurchaseEntriesUnsold);

// Admin/seller removes saved unsold numbers
router.post('/purchases/remove-unsold', authenticateToken, authorizeRole(['admin', 'seller']), removePurchaseUnsoldEntries);

// Admin/seller views unsold remove memo history
router.get('/purchases/unsold-remove-memo', authenticateToken, authorizeRole(['admin', 'seller']), getPurchaseUnsoldRemoveMemoEntries);

// Admin or seller replaces an existing unsold memo
router.put('/purchases/unsold-memo', authenticateToken, authorizeRole(['admin', 'seller']), replacePurchaseUnsoldMemoEntries);

// Seller sends saved unsold to parent
router.post('/purchases/send-unsold', authenticateToken, authorizeRole(['seller']), sendPurchaseUnsoldToParent);

// Get pending entries
router.get('/pending-entries', authenticateToken, authorizeRole(['seller']), getPendingEntries);

// Delete pending entry
router.delete('/pending-entries/:entryId', authenticateToken, authorizeRole(['seller']), deletePendingEntry);

// Send entries to parent
router.post('/send-entries', authenticateToken, authorizeRole(['seller']), sendEntries);

// Get sent entries (entries sent from child users)
router.get('/sent-entries', authenticateToken, getSentEntries);

// Get entries sent by current user
router.get('/my-sent-entries', authenticateToken, authorizeRole(['seller']), getMySentEntries);

// Get direct child entries received by current seller
router.get('/received-entries', authenticateToken, authorizeRole(['admin', 'seller']), getReceivedEntries);

// Accept or reject direct child entry
router.patch('/received-entries/:entryId', authenticateToken, authorizeRole(['admin', 'seller']), updateReceivedEntryStatus);

// Get accepted child entries for current seller book lottery
router.get('/accepted-book-entries', authenticateToken, authorizeRole(['seller']), getAcceptedEntriesForBookLottery);

// Get transfer/send history for last 30 days or selected date
router.get('/transfer-history', authenticateToken, getTransferHistory);

// Trace number ownership / holder
router.get('/trace-number', authenticateToken, searchNumberTrace);

module.exports = router;
