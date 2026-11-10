// Central configuration. Secrets come from Netlify environment variables (see .env.example).
export const env = (k, d = '') => process.env[k] ?? d;

// Tab names + row-1 column labels. The app creates missing tabs/headers automatically.
export const SHEETS = {
  Records:     { cols: ['id', 'fund', 'uacs', 'desc', 'cls', 'pap', 'office', 'allot', 'oblig', 'disb', 'date'] },
  Funds:       { cols: ['code', 'name'] },
  Users:       { cols: ['username', 'email', 'salt', 'hash', 'resetEnabled', 'mustChange', 'createdAt', 'createdBy'] },
  AdminEmails: { cols: ['email', 'addedBy', 'addedAt'] },
  Settings:    { cols: ['key', 'value'] }
};

export const AUTH = {
  SESSION_SEC: 6 * 3600,   // admin session length
  MAX_FAILS: 5,            // failed logins before a 15-minute lock
  LOCK_SEC: 900,
  RESET_SEC: 900,          // emailed reset code lifetime
  DEFAULT_ADMIN: { username: 'Administrator', password: 'admin123' }   // created on first run – change it!
};
export const DEFAULT_TARGET = 90;
export const CLASSES = ['PS', 'MOOE', 'CO'];
export const CACHE_MS = 15000;   // in-memory read cache per warm function instance
