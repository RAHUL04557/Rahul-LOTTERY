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
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'seller',
      parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
      rate_amount_6 NUMERIC(12, 2) NOT NULL DEFAULT 0,
      rate_amount_12 NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
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
    DROP INDEX IF EXISTS idx_prize_results_prize_key_number
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prize_results_unique_upload
    ON prize_results (result_for_date, session_mode, prize_key, winning_number)
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
