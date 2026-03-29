const express = require('express');
const { login, getCurrentUser } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.get('/me', authenticateToken, getCurrentUser);

module.exports = router;
