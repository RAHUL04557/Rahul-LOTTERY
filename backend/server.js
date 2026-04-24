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

const app = express();

app.use(cors());
app.use(express.json());

const initializeAdmin = async () => {
  try {
    const adminResult = await query('SELECT id, username, password, role FROM users WHERE username = $1 LIMIT 1', [
      process.env.ADMIN_USERNAME
    ]);

    if (adminResult.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      const insertedAdmin = await query(
        'INSERT INTO users (username, password, role, seller_type, parent_id, rate) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [process.env.ADMIN_USERNAME, hashedPassword, 'admin', 'admin', null, 0]
      );
      await query('UPDATE users SET owner_admin_id = id WHERE id = $1', [insertedAdmin.rows[0].id]);
      console.log('Admin user created');
      return;
    }

    const adminUser = adminResult.rows[0];
    const isPasswordValid = await bcrypt.compare(process.env.ADMIN_PASSWORD, adminUser.password).catch(() => false);
    const updates = [];
    const values = [];

    if (adminUser.role !== 'admin') {
      values.push('admin');
      updates.push(`role = $${values.length}`);
    }

    values.push('admin');
    updates.push(`seller_type = $${values.length}`);

    updates.push('owner_admin_id = id');

    if (!isPasswordValid) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      values.push(hashedPassword);
      updates.push(`password = $${values.length}`);
    }

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
