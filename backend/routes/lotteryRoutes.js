const express = require('express');
const {
  addLotteryEntry,
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
router.get('/received-entries', authenticateToken, authorizeRole(['seller']), getReceivedEntries);

// Accept or reject direct child entry
router.patch('/received-entries/:entryId', authenticateToken, authorizeRole(['seller']), updateReceivedEntryStatus);

// Get accepted child entries for current seller book lottery
router.get('/accepted-book-entries', authenticateToken, authorizeRole(['seller']), getAcceptedEntriesForBookLottery);

// Get transfer/send history for last 30 days or selected date
router.get('/transfer-history', authenticateToken, getTransferHistory);

// Trace number ownership / holder
router.get('/trace-number', authenticateToken, searchNumberTrace);

module.exports = router;
