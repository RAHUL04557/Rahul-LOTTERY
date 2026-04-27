const bcrypt = require('bcryptjs');
const { query } = require('../config/database');

const mapSeller = (row) => ({
  id: row.id,
  username: row.username,
  keyword: row.keyword || '',
  role: row.role,
  sellerType: row.seller_type || (row.role === 'seller' ? 'seller' : 'admin'),
  parentId: row.parent_id,
  ownerAdminId: row.owner_admin_id,
  canLogin: row.can_login !== undefined ? Boolean(row.can_login) : true,
  rateAmount6: row.rate_amount_6 !== undefined ? Number(row.rate_amount_6) : 0,
  rateAmount12: row.rate_amount_12 !== undefined ? Number(row.rate_amount_12) : 0,
  createdAt: row.created_at
});

const buildTree = (rows, rootId, currentUser) => {
  const nodes = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        username: row.username,
        keyword: row.keyword || '',
        role: row.role,
        sellerType: row.seller_type || (row.role === 'seller' ? 'seller' : 'admin'),
        parentId: row.parent_id,
        ownerAdminId: row.owner_admin_id,
        canLogin: row.can_login !== undefined ? Boolean(row.can_login) : true,
        rateAmount6: row.rate_amount_6 !== undefined ? Number(row.rate_amount_6) : 0,
        rateAmount12: row.rate_amount_12 !== undefined ? Number(row.rate_amount_12) : 0,
        createdAt: row.created_at,
        level: row.level || 0,
        canDelete:
          currentUser.role === 'admin'
            ? row.id !== currentUser.id && row.role !== 'admin'
            : row.parent_id === currentUser.id,
        children: []
      }
    ])
  );

  let root = null;

  rows.forEach((row) => {
    const node = nodes.get(row.id);
    if (row.id === rootId) {
      root = node;
      return;
    }

    const parentNode = nodes.get(row.parent_id);
    if (parentNode) {
      parentNode.children.push(node);
    }
  });

  const decorateCounts = (node) => {
    if (!node) {
      return 0;
    }

    let totalDescendants = 0;
    node.children.forEach((child) => {
      totalDescendants += 1 + decorateCounts(child);
    });
    node.directChildrenCount = node.children.length;
    node.totalDescendants = totalDescendants;
    return totalDescendants;
  };

  decorateCounts(root);
  return root;
};

const getVisibleUserTree = async (req, res) => {
  try {
    const treeResult = await query(
      `WITH RECURSIVE user_tree AS (
        SELECT id, username, keyword, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12, created_at, 0 AS level
        FROM users
        WHERE id = $1
        UNION ALL
        SELECT u.id, u.username, u.keyword, u.role, u.seller_type, u.parent_id, u.owner_admin_id, u.can_login, u.rate_amount_6, u.rate_amount_12, u.created_at, ut.level + 1
        FROM users u
        INNER JOIN user_tree ut ON u.parent_id = ut.id
      )
      SELECT * FROM user_tree ORDER BY level ASC, created_at ASC`,
      [req.user.id]
    );

    if (treeResult.rows.length === 0) {
      return res.status(404).json({ message: 'User tree not found' });
    }

    res.json(buildTree(treeResult.rows, req.user.id, req.user));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const deleteSeller = async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);

    if (!targetUserId) {
      return res.status(400).json({ message: 'Valid user id required' });
    }

    if (targetUserId === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete yourself' });
    }

    const targetUserResult = await query(
      'SELECT id, username, role, parent_id FROM users WHERE id = $1 LIMIT 1',
      [targetUserId]
    );

    if (targetUserResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetUser = targetUserResult.rows[0];

    if (targetUser.role === 'admin') {
      return res.status(403).json({ message: 'Admin cannot be deleted' });
    }

    if (req.user.role !== 'admin' && targetUser.parent_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const branchResult = await query(
      `WITH RECURSIVE branch_users AS (
        SELECT id
        FROM users
        WHERE id = $1
        UNION ALL
        SELECT u.id
        FROM users u
        INNER JOIN branch_users bu ON u.parent_id = bu.id
      )
      SELECT id FROM branch_users`,
      [targetUserId]
    );

    const branchIds = branchResult.rows.map((row) => row.id);

    await query('DELETE FROM users WHERE id = ANY($1::int[])', [branchIds]);

    res.json({
      message: 'Seller deleted successfully',
      deletedCount: branchIds.length
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const SELLER_TYPE_OPTIONS = ['seller', 'sub_seller', 'normal_seller'];

const getAllowedChildSellerTypes = (user) => {
  if (!user) {
    return [];
  }

  if (user.role === 'admin') {
    return SELLER_TYPE_OPTIONS;
  }

  if (user.role !== 'seller') {
    return [];
  }

  const sellerType = user.sellerType || user.seller_type || 'seller';
  if (sellerType === 'seller') {
    return ['sub_seller', 'normal_seller'];
  }
  if (sellerType === 'sub_seller') {
    return ['normal_seller'];
  }
  return [];
};

const createSeller = async (req, res) => {
  try {
    const { username, password, rateAmount6, rateAmount12 } = req.body;
    const normalizedKeyword = String(req.body.keyword || '').trim().toUpperCase();
    const requestedSellerType = String(req.body.sellerType || req.body.seller_type || 'seller').trim().toLowerCase();
    const canLogin = requestedSellerType !== 'normal_seller';
    const allowedSellerTypes = getAllowedChildSellerTypes(req.user);
    const parentId = req.user.id;
    const ownerAdminId = req.user.role === 'admin' ? req.user.id : req.user.ownerAdminId;
    const parentCanAssignAmount6 = req.user.role === 'admin' || Number(req.user.rateAmount6 || 0) > 0;
    const parentCanAssignAmount12 = req.user.role === 'admin' || Number(req.user.rateAmount12 || 0) > 0;
    const rawRateAmount6 = rateAmount6 === undefined || rateAmount6 === null ? '' : String(rateAmount6).trim();
    const rawRateAmount12 = rateAmount12 === undefined || rateAmount12 === null ? '' : String(rateAmount12).trim();

    if (!username) {
      return res.status(400).json({ message: 'Username required' });
    }

    if (!normalizedKeyword) {
      return res.status(400).json({ message: 'Keyword required' });
    }

    if (!/^[A-Z0-9]{1,10}$/.test(normalizedKeyword)) {
      return res.status(400).json({ message: 'Keyword me sirf A-Z aur 0-9 chalega (max 10)' });
    }

    if (!SELLER_TYPE_OPTIONS.includes(requestedSellerType)) {
      return res.status(400).json({ message: 'Valid seller type required' });
    }

    if (!allowedSellerTypes.includes(requestedSellerType)) {
      return res.status(403).json({ message: 'Is user type ko aap create nahi kar sakte' });
    }

    if (canLogin && String(password || '').length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    if (rawRateAmount6 !== '' && Number.isNaN(Number(rawRateAmount6))) {
      return res.status(400).json({ message: 'Rate for amount 7 must be a valid number' });
    }

    if (rawRateAmount12 !== '' && Number.isNaN(Number(rawRateAmount12))) {
      return res.status(400).json({ message: 'Rate for amount 12 must be a valid number' });
    }

    const existingUserResult = await query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if (existingUserResult.rows.length > 0) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const existingKeywordResult = await query(
      'SELECT id FROM users WHERE owner_admin_id = $1 AND UPPER(COALESCE(keyword, \'\')) = $2 LIMIT 1',
      [ownerAdminId, normalizedKeyword]
    );
    if (existingKeywordResult.rows.length > 0) {
      return res.status(400).json({ message: 'Keyword already exists' });
    }

    const normalizedRateAmount6 = !parentCanAssignAmount6
      ? 0
      : rawRateAmount6 !== ''
        ? Number(rawRateAmount6)
        : req.user.role === 'admin'
          ? 0
          : 7;
    const normalizedRateAmount12 = !parentCanAssignAmount12
      ? 0
      : rawRateAmount12 !== ''
        ? Number(rawRateAmount12)
        : req.user.role === 'admin'
          ? 0
          : 12;

    if (req.user.role === 'admin' && normalizedRateAmount6 <= 0 && normalizedRateAmount12 <= 0) {
      return res.status(400).json({ message: 'At least one rate is required to create a seller' });
    }

    if (!parentCanAssignAmount6 && normalizedRateAmount6 > 0) {
      return res.status(403).json({ message: 'You cannot assign rate for amount 7' });
    }

    if (!parentCanAssignAmount12 && normalizedRateAmount12 > 0) {
      return res.status(403).json({ message: 'You cannot assign rate for amount 12' });
    }

    const resolvedPassword = canLogin
      ? String(password)
      : await bcrypt.hash(`virtual-${username}-${Date.now()}`, 10);
    const hashedPassword = canLogin
      ? await bcrypt.hash(resolvedPassword, 10)
      : resolvedPassword;
    const sellerResult = await query(
      `INSERT INTO users (username, keyword, password, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, username, keyword, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12, created_at`,
      [
        username,
        normalizedKeyword,
        hashedPassword,
        'seller',
        requestedSellerType,
        parentId,
        ownerAdminId,
        canLogin,
        parentCanAssignAmount6 ? normalizedRateAmount6 : 0,
        parentCanAssignAmount12 ? normalizedRateAmount12 : 0
      ]
    );

    const createdTypeLabel = requestedSellerType === 'sub_seller'
      ? 'Sub Stokist'
      : requestedSellerType === 'normal_seller'
        ? 'Seller'
        : 'Stokist';

    res.status(201).json({
      message: canLogin ? `${createdTypeLabel} created successfully` : 'Seller naam se save ho gaya',
      seller: mapSeller(sellerResult.rows[0])
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getChildSellers = async (req, res) => {
  try {
    const sellersResult = await query(
      'SELECT id, username, keyword, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12, created_at FROM users WHERE parent_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(sellersResult.rows.map(mapSeller));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getAllSellers = async (req, res) => {
  try {
    const sellersResult = await query(
      `WITH RECURSIVE branch_users AS (
        SELECT id, username, keyword, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12, created_at
        FROM users
        WHERE id = $1
        UNION ALL
        SELECT u.id, u.username, u.keyword, u.role, u.seller_type, u.parent_id, u.owner_admin_id, u.can_login, u.rate_amount_6, u.rate_amount_12, u.created_at
        FROM users u
        INNER JOIN branch_users bu ON u.parent_id = bu.id
      )
      SELECT * FROM branch_users WHERE role = 'seller' ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(sellersResult.rows.map(mapSeller));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const createAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only super admin can create admin IDs' });
    }

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username) {
      return res.status(400).json({ message: 'Admin username required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const existingUserResult = await query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
    if (existingUserResult.rows.length > 0) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const adminResult = await query(
      `INSERT INTO users (username, password, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12)
       VALUES ($1, $2, 'admin', 'admin', $3, NULL, TRUE, 0, 0)
       RETURNING id, username, keyword, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12, created_at`,
      [username, hashedPassword, req.user.id]
    );
    await query('UPDATE users SET owner_admin_id = id WHERE id = $1', [adminResult.rows[0].id]);

    res.status(201).json({
      message: 'Admin ID created successfully',
      admin: mapSeller({
        ...adminResult.rows[0],
        owner_admin_id: adminResult.rows[0].id
      })
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getAdmins = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only super admin can view admin IDs' });
    }

    const adminsResult = await query(
      `SELECT id, username, keyword, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12, created_at
       FROM users
       WHERE role = 'admin'
       ORDER BY created_at DESC`
    );

    res.json(adminsResult.rows.map(mapSeller));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const changeChildPassword = async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    const newPassword = req.body.newPassword || '';

    if (!targetUserId) {
      return res.status(400).json({ message: 'Valid user id required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const targetUserResult = await query(
      'SELECT id, username, role, seller_type, parent_id, can_login FROM users WHERE id = $1 LIMIT 1',
      [targetUserId]
    );

    if (targetUserResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetUser = targetUserResult.rows[0];

    if (targetUser.role === 'admin') {
      return res.status(403).json({ message: 'Admin password cannot be changed from this screen' });
    }

    if (targetUser.can_login === false || targetUser.seller_type === 'normal_seller') {
      return res.status(400).json({ message: 'Seller ka login password nahi hota' });
    }

    if (targetUser.parent_id !== req.user.id) {
      return res.status(403).json({
        message: req.user.role === 'admin'
          ? 'You can only change password of your direct stokist'
          : 'You can only change password of your direct sub stokist'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, targetUser.id]);

    res.json({
      message: `Password updated successfully for ${targetUser.username}`
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { createSeller, createAdmin, getAdmins, getChildSellers, getAllSellers, getVisibleUserTree, deleteSeller, changeChildPassword };
