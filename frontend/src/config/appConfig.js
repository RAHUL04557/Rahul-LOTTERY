const getNumberConfig = (key, fallback) => {
  const rawValue = window.APP_CONFIG?.[key] ?? process.env[`REACT_APP_${key}`];
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const getBooleanConfig = (key, fallback) => {
  const rawValue = window.APP_CONFIG?.[key] ?? process.env[`REACT_APP_${key}`];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  return ['true', '1', 'yes', 'on'].includes(String(rawValue).trim().toLowerCase());
};

const getArrayConfig = (key, fallback = []) => {
  const rawValue = window.APP_CONFIG?.[key] ?? process.env[`REACT_APP_${key}`];

  if (Array.isArray(rawValue)) {
    return rawValue.filter(Boolean);
  }

  if (typeof rawValue === 'string' && rawValue.trim()) {
    return rawValue.split(',').map((value) => value.trim()).filter(Boolean);
  }

  return fallback;
};

export const appConfig = {
  apiBaseUrl: window.APP_CONFIG?.API_BASE_URL || process.env.REACT_APP_API_URL || 'https://drawtheprice.in/api',
  apiFallbackUrls: getArrayConfig('API_FALLBACK_URLS', []),
  offlineFirstEnabled: getBooleanConfig('OFFLINE_FIRST_ENABLED', true),
  localRetentionDays: getNumberConfig('LOCAL_RETENTION_DAYS', 365),
  syncBootstrapDays: getNumberConfig('SYNC_BOOTSTRAP_DAYS', 365),
  syncIntervalMs: getNumberConfig('SYNC_INTERVAL_MS', 30000)
};
