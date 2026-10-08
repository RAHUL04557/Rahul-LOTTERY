const express = require('express');
const { bootstrapLocalData } = require('../controllers/syncController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

router.get('/bootstrap', authenticateToken, authorizeRole(['admin', 'seller']), bootstrapLocalData);

module.exports = router;
