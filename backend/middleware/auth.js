const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    try {
      const userResult = await query(
        'SELECT id, username, keyword, role, seller_type, parent_id, can_login, rate_amount_6, rate_amount_12 FROM users WHERE id = $1 LIMIT 1',
        [user.id]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ message: 'User not found' });
      }

      const currentUser = userResult.rows[0];
      req.user = {
        id: currentUser.id,
        username: currentUser.username,
        keyword: currentUser.keyword || '',
        role: currentUser.role,
        sellerType: currentUser.seller_type || (currentUser.role === 'seller' ? 'seller' : 'admin'),
        parentId: currentUser.parent_id,
        canLogin: currentUser.can_login !== undefined ? Boolean(currentUser.can_login) : true,
        rateAmount6: currentUser.rate_amount_6 !== undefined ? Number(currentUser.rate_amount_6) : 0,
        rateAmount12: currentUser.rate_amount_12 !== undefined ? Number(currentUser.rate_amount_12) : 0
      };

      next();
    } catch (error) {
      return res.status(500).json({ message: 'Server error', error: error.message });
    }
  });
};

const authorizeRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRole };
