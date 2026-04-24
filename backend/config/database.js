const { Pool } = require('pg');

const resolveConnectionString = () => {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_URI,
    process.env.POSTGRES_DRIVER,
    process.env.PG_URI,
    process.env.PG_CONNECTION_STRING
  ];

  if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('postgres')) {
    candidates.push(process.env.MONGODB_URI);
  }

  return candidates.find((value) => value && value.trim());
};

const connectionString = resolveConnectionString();

const pool = new Pool(
  connectionString
    ? {
        connectionString,
        ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'lottery_booking',
        ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
      }
);

const query = async (text, params = []) => {
  return pool.query(text, params);
};

const getClient = async () => pool.connect();

const initDB = async () => {
  await query('SELECT NOW()');
  console.log('PostgreSQL connected successfully');

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      keyword VARCHAR(30),
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'seller',
      seller_type VARCHAR(30) NOT NULL DEFAULT 'seller',
      parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
      rate_amount_6 NUMERIC(12, 2) NOT NULL DEFAULT 0,
      rate_amount_12 NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS keyword VARCHAR(30)
  `);

  await query(`
    UPDATE users
    SET keyword = 'RA'
    WHERE username = 'Rahu12'
      AND (keyword IS NULL OR TRIM(keyword) = '')
  `);

  await query(`
    UPDATE users
    SET keyword = 'RU'
    WHERE username = 'rahu12'
  `);

  await query(`
    UPDATE users
    SET keyword = 'SA'
    WHERE LOWER(username) = 'sandesh'
      AND (keyword IS NULL OR TRIM(keyword) = '')
  `);

  await query(`
    UPDATE users
    SET keyword = 'ST'
    WHERE LOWER(username) = 'satya'
      AND (keyword IS NULL OR TRIM(keyword) = '')
  `);

  await query(`
    UPDATE users
    SET keyword = 'TA'
    WHERE LOWER(username) = 'tanay'
      AND (keyword IS NULL OR TRIM(keyword) = '')
  `);

  await query(`
    UPDATE users
    SET keyword = 'SN'
    WHERE LOWER(username) = 'snehan'
      AND (keyword IS NULL OR TRIM(keyword) = '')
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_keyword_unique
    ON users (UPPER(keyword))
    WHERE keyword IS NOT NULL AND TRIM(keyword) <> ''
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS seller_type VARCHAR(30) NOT NULL DEFAULT 'seller'
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS can_login BOOLEAN NOT NULL DEFAULT TRUE
  `);

  await query(`
    UPDATE users
    SET seller_type = 'seller'
    WHERE role = 'seller' AND (seller_type IS NULL OR TRIM(seller_type) = '')
  `);

  await query(`
    UPDATE users
    SET seller_type = 'admin'
    WHERE role = 'admin'
  `);

  await query(`
    UPDATE users
    SET can_login = CASE
      WHEN role = 'admin' THEN TRUE
      WHEN seller_type = 'normal_seller' THEN FALSE
      ELSE TRUE
    END
    WHERE can_login IS DISTINCT FROM CASE
      WHEN role = 'admin' THEN TRUE
      WHEN seller_type = 'normal_seller' THEN FALSE
      ELSE TRUE
    END
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rate_amount_6 NUMERIC(12, 2) NOT NULL DEFAULT 0
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS rate_amount_12 NUMERIC(12, 2) NOT NULL DEFAULT 0
  `);

  await query(`
    UPDATE users
    SET
      rate_amount_6 = COALESCE(rate_amount_6, rate, 0),
      rate_amount_12 = COALESCE(rate_amount_12, rate, 0)
    WHERE rate_amount_6 = 0 AND rate_amount_12 = 0 AND COALESCE(rate, 0) <> 0
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS prices (
      id SERIAL PRIMARY KEY,
      unique_code VARCHAR(255) UNIQUE NOT NULL,
      price NUMERIC(12, 2) NOT NULL,
      result_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS prize_results (
      id SERIAL PRIMARY KEY,
      prize_key VARCHAR(50) NOT NULL,
      prize_label VARCHAR(255) NOT NULL,
      prize_amount NUMERIC(12, 2) NOT NULL,
      digit_length INTEGER NOT NULL,
      winning_number VARCHAR(20) NOT NULL,
      session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING',
      purchase_category VARCHAR(1),
      result_for_date DATE NOT NULL DEFAULT CURRENT_DATE,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      result_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    ALTER TABLE prize_results
    ADD COLUMN IF NOT EXISTS session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING'
  `);

  await query(`
    ALTER TABLE prize_results
    ADD COLUMN IF NOT EXISTS result_for_date DATE NOT NULL DEFAULT CURRENT_DATE
  `);

  await query(`
    ALTER TABLE prize_results
    ADD COLUMN IF NOT EXISTS purchase_category VARCHAR(1)
  `);

  await query(`
    UPDATE prize_results
    SET purchase_category = CASE
      WHEN session_mode = 'NIGHT' THEN 'E'
      ELSE 'M'
    END
    WHERE purchase_category IS NULL OR TRIM(purchase_category) = ''
  `);

  await query(`
    DROP INDEX IF EXISTS idx_prize_results_prize_key_number
  `);

  await query(`
    DROP INDEX IF EXISTS idx_prize_results_unique_upload
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prize_results_unique_upload
    ON prize_results (result_for_date, session_mode, purchase_category, prize_key, winning_number)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS lottery_entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      series VARCHAR(255),
      number VARCHAR(10) NOT NULL,
      box_value VARCHAR(20) NOT NULL,
      unique_code VARCHAR(255) UNIQUE NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      sent_to_parent INTEGER REFERENCES users(id) ON DELETE SET NULL,
      forwarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP NULL
    )
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS forwarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING'
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS booking_date DATE NOT NULL DEFAULT CURRENT_DATE
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS entry_source VARCHAR(20) NOT NULL DEFAULT 'booking'
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS memo_number INTEGER
  `);

  await query(`
    UPDATE lottery_entries
    SET session_mode = CASE
      WHEN EXTRACT(HOUR FROM COALESCE(sent_at, created_at)) < 15 THEN 'MORNING'
      ELSE 'NIGHT'
    END
    WHERE session_mode IS NULL OR session_mode = ''
  `);

  await query(`
    UPDATE lottery_entries
    SET booking_date = DATE(created_at)
    WHERE booking_date IS NULL
  `);

  await query(`
    UPDATE lottery_entries
    SET entry_source = 'booking'
    WHERE entry_source IS NULL OR TRIM(entry_source) = ''
  `);

  await query(`
    ALTER TABLE lottery_entries
    ADD COLUMN IF NOT EXISTS purchase_category VARCHAR(1)
  `);

  await query(`
    UPDATE lottery_entries
    SET purchase_category = CASE
      WHEN session_mode = 'NIGHT' THEN 'E'
      ELSE 'M'
    END
    WHERE purchase_category IS NULL OR TRIM(purchase_category) = ''
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_lottery_entries_purchase_uniqueness_lookup
    ON lottery_entries (
      entry_source,
      booking_date,
      session_mode,
      purchase_category,
      amount,
      box_value,
      number
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS lottery_entry_history (
      id SERIAL PRIMARY KEY,
      entry_id INTEGER REFERENCES lottery_entries(id) ON DELETE SET NULL,
      unique_code VARCHAR(255) NOT NULL,
      number VARCHAR(10) NOT NULL,
      box_value VARCHAR(20) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      from_username VARCHAR(255) NOT NULL,
      to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      to_username VARCHAR(255) NOT NULL,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_username VARCHAR(255) NOT NULL,
      action_type VARCHAR(50) NOT NULL,
      status_before VARCHAR(20),
      status_after VARCHAR(20),
      session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING',
      booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    ALTER TABLE lottery_entry_history
    ADD COLUMN IF NOT EXISTS session_mode VARCHAR(20) NOT NULL DEFAULT 'MORNING'
  `);

  await query(`
    ALTER TABLE lottery_entry_history
    ADD COLUMN IF NOT EXISTS booking_date DATE NOT NULL DEFAULT CURRENT_DATE
  `);

  await query(`
    ALTER TABLE lottery_entry_history
    ADD COLUMN IF NOT EXISTS memo_number INTEGER
  `);

  await query(`
    UPDATE lottery_entry_history
    SET session_mode = CASE
      WHEN EXTRACT(HOUR FROM created_at) < 15 THEN 'MORNING'
      ELSE 'NIGHT'
    END
    WHERE session_mode IS NULL OR session_mode = ''
  `);

  await query(`
    UPDATE lottery_entry_history
    SET booking_date = DATE(created_at)
    WHERE booking_date IS NULL
  `);
};

module.exports = {
  pool,
  query,
  getClient,
  initDB
};
