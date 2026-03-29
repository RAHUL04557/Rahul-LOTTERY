const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const mapUser = (row) => ({
  id: row.id,
  username: row.username,
  role: row.role,
  parentId: row.parent_id,
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
      'INSERT INTO users (username, password, role, parent_id, rate_amount_6, rate_amount_12) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [adminUsername, hashedPassword, 'admin', null, 0, 0]
    );
    return insertedAdminResult.rows[0];
  }

  await query('UPDATE users SET password = $1, role = $2 WHERE id = $3', [hashedPassword, 'admin', existingAdmin.id]);
  return {
    ...existingAdmin,
    password: hashedPassword,
    role: 'admin'
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

    const adminUsername = (process.env.ADMIN_USERNAME || '').trim();
    const adminPassword = process.env.ADMIN_PASSWORD || '';

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
      { id: user.id, username: user.username, role: user.role, parentId: user.parent_id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: user.role === 'admin' ? 'Admin login successful' : 'Seller login successful',
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
      'SELECT id, username, role, parent_id, rate_amount_6, rate_amount_12, created_at FROM users WHERE id = $1 LIMIT 1',
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

module.exports = { login, getCurrentUser };
