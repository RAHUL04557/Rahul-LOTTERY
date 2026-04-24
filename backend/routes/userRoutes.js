const express = require('express');
const { createSeller, createAdmin, getAdmins, getChildSellers, getAllSellers, getVisibleUserTree, deleteSeller, changeChildPassword } = require('../controllers/userController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Create a new seller (seller can create sub-sellers)
router.post('/create-seller', authenticateToken, createSeller);

// Super admin can create and view admin IDs
router.post('/create-admin', authenticateToken, authorizeRole(['superadmin']), createAdmin);
router.get('/admins', authenticateToken, authorizeRole(['superadmin']), getAdmins);

// Get child sellers
router.get('/child-sellers', authenticateToken, getChildSellers);

// Get all sellers (admin only)
router.get('/all-sellers', authenticateToken, authorizeRole(['admin']), getAllSellers);

// Get visible user tree for current user
router.get('/tree', authenticateToken, getVisibleUserTree);

// Change password for direct child seller/sub-seller
router.patch('/:userId/password', authenticateToken, changeChildPassword);

// Delete seller/subtree
router.delete('/:userId', authenticateToken, deleteSeller);

module.exports = router;
