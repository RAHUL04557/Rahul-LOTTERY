require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { initDB, query } = require('./config/database');
const { ensureDefaultSuperAdminUser } = require('./controllers/authController');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const lotteryRoutes = require('./routes/lotteryRoutes');
const priceRoutes = require('./routes/priceRoutes');
const syncRoutes = require('./routes/syncRoutes');

const app = express();
const DEFAULT_RESULT_UPLOAD_PASSWORD = 'rahul@9749';

app.use(cors());
app.use(express.json());

const initializeAdmin = async () => {
  try {
    const adminResult = await query('SELECT id, username, password, current_password, role FROM users WHERE username = $1 LIMIT 1', [
      process.env.ADMIN_USERNAME
    ]);

    if (adminResult.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      const hashedResultUploadPassword = await bcrypt.hash(DEFAULT_RESULT_UPLOAD_PASSWORD, 10);
      const insertedAdmin = await query(
        'INSERT INTO users (username, password, current_password, result_upload_password, current_result_upload_password, role, seller_type, parent_id, rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
        [process.env.ADMIN_USERNAME, hashedPassword, process.env.ADMIN_PASSWORD, hashedResultUploadPassword, DEFAULT_RESULT_UPLOAD_PASSWORD, 'admin', 'admin', null, 0]
      );
      await query('UPDATE users SET owner_admin_id = id WHERE id = $1', [insertedAdmin.rows[0].id]);
      console.log('Admin user created');
      return;
    }

    const adminUser = adminResult.rows[0];
    const isPasswordValid = adminUser.password === process.env.ADMIN_PASSWORD
      || await bcrypt.compare(process.env.ADMIN_PASSWORD, adminUser.password).catch(() => false);
    const updates = [];
    const values = [];

    if (adminUser.role !== 'admin') {
      values.push('admin');
      updates.push(`role = $${values.length}`);
    }

    values.push('admin');
    updates.push(`seller_type = $${values.length}`);

    updates.push('owner_admin_id = id');

    values.push(isPasswordValid);
    const passwordValidParam = values.length;
    values.push(process.env.ADMIN_PASSWORD);
    updates.push(`current_password = CASE WHEN (current_password IS NULL OR TRIM(current_password) = '') AND $${passwordValidParam} = TRUE THEN $${values.length} ELSE current_password END`);

    values.push(await bcrypt.hash(DEFAULT_RESULT_UPLOAD_PASSWORD, 10));
    updates.push(`result_upload_password = COALESCE(NULLIF(result_upload_password, ''), $${values.length})`);

    values.push(DEFAULT_RESULT_UPLOAD_PASSWORD);
    updates.push(`current_result_upload_password = CASE WHEN current_result_upload_password IS NULL OR TRIM(current_result_upload_password) = '' THEN $${values.length} ELSE current_result_upload_password END`);

    values.push(adminUser.id);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    console.log('Admin user synchronized with environment credentials');
  } catch (error) {
    console.error('Error initializing admin:', error.message);
  }
};

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/lottery', lotteryRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/sync', syncRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ message: 'Server error', error: err.message });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await initDB();
    await ensureDefaultSuperAdminUser();
    await initializeAdmin();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;
