const { query } = require('../config/database');
const INDIA_TIMEZONE = 'Asia/Kolkata';

const generateUniqueCode = () => {
  return String(Math.floor(100000000000 + Math.random() * 900000000000));
};

const getIndiaNowParts = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
};

const getTimeRestriction = (sessionMode) => {
  if (String(sessionMode || '').trim().toUpperCase() === 'NIGHT') {
    return { hour: 20, minute: 0, second: 0 };
  }

  return { hour: 13, minute: 0, second: 0 };
};

const isWithinTimeLimit = (sessionMode) => {
  const indiaNow = getIndiaNowParts();
  const restriction = getTimeRestriction(sessionMode);
  const currentTotalSeconds = (indiaNow.hour * 60 * 60) + (indiaNow.minute * 60) + indiaNow.second;
  const limitTotalSeconds = (restriction.hour * 60 * 60) + (restriction.minute * 60) + (restriction.second || 0);

  return currentTotalSeconds < limitTotalSeconds;
};

const calculateUserLevel = async (userId) => {
  let level = 0;
  let currentResult = await query('SELECT id, parent_id FROM users WHERE id = $1', [userId]);
  let current = currentResult.rows[0];
  
  while (current && current.parent_id) {
    level++;
    currentResult = await query('SELECT id, parent_id FROM users WHERE id = $1', [current.parent_id]);
    current = currentResult.rows[0];
  }

  return level;
};

module.exports = {
  generateUniqueCode,
  getIndiaNowParts,
  getTimeRestriction,
  isWithinTimeLimit,
  calculateUserLevel
};
