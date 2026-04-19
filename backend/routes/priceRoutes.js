const express = require('express');
const {
  uploadPrice,
  updatePrizeResult,
  getPriceByCode,
  getAllPrices,
  getPrizeTracker,
  getFilteredPrizeResults,
  getBillPrizes,
  checkPrize,
  getMyPrizes
} = require('../controllers/priceController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Upload price (admin only)
router.post('/upload', authenticateToken, authorizeRole(['admin']), uploadPrice);

// Edit uploaded price/result (admin only)
router.patch('/:id', authenticateToken, authorizeRole(['admin']), updatePrizeResult);

// Check prize
router.get('/check', authenticateToken, checkPrize);

// My prizes
router.get('/my-prizes', authenticateToken, getMyPrizes);

// Prize tracker with winners
router.get('/tracker', authenticateToken, authorizeRole(['admin']), getPrizeTracker);

// Filtered sold/unsold prize results
router.get('/results', authenticateToken, getFilteredPrizeResults);

// Bill prize deductions
router.get('/bill-prizes', authenticateToken, getBillPrizes);

// Get price by unique code
router.get('/:uniqueCode', authenticateToken, getPriceByCode);

// Get all prices (admin only)
router.get('/', authenticateToken, authorizeRole(['admin']), getAllPrices);

module.exports = router;
