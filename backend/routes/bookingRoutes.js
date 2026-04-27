const express = require('express');
const {
  createBookingEntries,
  replaceBookingMemoEntries,
  getBookingEntries,
  sendBookingEntries,
  acceptBookingEntries,
  getBookingRecord,
  getBookingBillSummary,
  getBookingPriceTrack
} = require('../controllers/bookingController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.post('/entries', authenticateToken, authorizeRole(['admin', 'seller']), createBookingEntries);
router.put('/memo', authenticateToken, authorizeRole(['admin', 'seller']), replaceBookingMemoEntries);
router.get('/entries', authenticateToken, authorizeRole(['admin', 'seller']), getBookingEntries);
router.post('/send', authenticateToken, authorizeRole(['seller']), sendBookingEntries);
router.post('/accept', authenticateToken, authorizeRole(['admin']), acceptBookingEntries);
router.get('/record', authenticateToken, authorizeRole(['admin', 'seller']), getBookingRecord);
router.get('/bill-summary', authenticateToken, authorizeRole(['admin', 'seller']), getBookingBillSummary);
router.get('/price-track', authenticateToken, authorizeRole(['admin', 'seller']), getBookingPriceTrack);

module.exports = router;
