const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const mapUser = (row) => ({
  id: row.id,
  username: row.username,
  keyword: row.keyword || '',
  role: row.role,
  sellerType: row.seller_type || (row.role === 'seller' ? 'seller' : 'admin'),
  parentId: row.parent_id,
  ownerAdminId: row.owner_admin_id,
  canLogin: row.can_login !== undefined ? Boolean(row.can_login) : true,
  rateAmount6: row.rate_amount_6 !== undefined ? Number(row.rate_amount_6) : 0,
  rateAmount12: row.rate_amount_12 !== undefined ? Number(row.rate_amount_12) : 0
});

const ensureDefaultAdminUser = async () => {
  const adminUsername = (process.env.ADMIN_USERNAME || '').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (!adminUsername || !adminPassword) {
    return null;
  }

  const existingAdminResult = await query('SELECT * FROM users WHERE username = $1 LIMIT 1', [adminUsername]);
  const existingAdmin = existingAdminResult.rows[0];
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  if (!existingAdmin) {
    const insertedAdminResult = await query(
      'INSERT INTO users (username, password, role, seller_type, parent_id, rate_amount_6, rate_amount_12) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [adminUsername, hashedPassword, 'admin', 'admin', null, 0, 0]
    );
    await query('UPDATE users SET owner_admin_id = id WHERE id = $1', [insertedAdminResult.rows[0].id]);
    return {
      ...insertedAdminResult.rows[0],
      owner_admin_id: insertedAdminResult.rows[0].id
    };
  }

  await query('UPDATE users SET password = $1, role = $2, seller_type = $3, owner_admin_id = id WHERE id = $4', [hashedPassword, 'admin', 'admin', existingAdmin.id]);
  return {
    ...existingAdmin,
    password: hashedPassword,
    role: 'admin',
    seller_type: 'admin'
  };
};

const ensureDefaultSuperAdminUser = async () => {
  const superAdminUsername = (process.env.SUPER_ADMIN_USERNAME || 'superadmin').trim();
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';

  if (!superAdminUsername || !superAdminPassword) {
    return null;
  }

  const existingResult = await query('SELECT * FROM users WHERE username = $1 LIMIT 1', [superAdminUsername]);
  const existingUser = existingResult.rows[0];
  const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

  if (!existingUser) {
    const insertedResult = await query(
      `INSERT INTO users (username, password, role, seller_type, parent_id, owner_admin_id, rate_amount_6, rate_amount_12)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [superAdminUsername, hashedPassword, 'superadmin', 'superadmin', null, null, 0, 0]
    );
    return insertedResult.rows[0];
  }

  await query(
    'UPDATE users SET password = $1, role = $2, seller_type = $3, parent_id = NULL, owner_admin_id = NULL WHERE id = $4',
    [hashedPassword, 'superadmin', 'superadmin', existingUser.id]
  );

  return {
    ...existingUser,
    password: hashedPassword,
    role: 'superadmin',
    seller_type: 'superadmin',
    parent_id: null,
    owner_admin_id: null
  };
};

const login = async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    let userResult = await query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
    let user = userResult.rows[0];

    const superAdminUsername = (process.env.SUPER_ADMIN_USERNAME || 'superadmin').trim();
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
    const adminUsername = (process.env.ADMIN_USERNAME || '').trim();
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (
      username === superAdminUsername &&
      password === superAdminPassword &&
      (!user || user.role !== 'superadmin')
    ) {
      user = await ensureDefaultSuperAdminUser();
    }

    if (
      username === adminUsername &&
      password === adminPassword &&
      (!user || user.role !== 'admin')
    ) {
      user = await ensureDefaultAdminUser();
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    if (user.can_login === false) {
      return res.status(403).json({ message: 'Ye normal seller login ID nahi hai. Iska hisaab parent account se chalega.' });
    }

    let isPasswordValid = false;
    try {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } catch (error) {
      isPasswordValid = false;
    }

    if (!isPasswordValid && user.password === password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
      isPasswordValid = true;
      user.password = hashedPassword;
    }

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, sellerType: user.seller_type, parentId: user.parent_id, ownerAdminId: user.owner_admin_id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: user.role === 'superadmin' ? 'Super admin login successful' : user.role === 'admin' ? 'Admin login successful' : 'Seller login successful',
      token,
      user: mapUser(user)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const userResult = await query(
      'SELECT id, username, keyword, role, seller_type, parent_id, owner_admin_id, can_login, rate_amount_6, rate_amount_12, created_at FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(mapUser(userResult.rows[0]));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { login, getCurrentUser, ensureDefaultSuperAdminUser };
