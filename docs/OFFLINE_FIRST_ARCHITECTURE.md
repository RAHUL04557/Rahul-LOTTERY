# Offline-First Architecture

## Goal

The app should be fast even when the server or internet is slow. Small day-to-day work should use the laptop's local database first. The online server should be used only for login, purchase send, unsold send, and sync/update.

## Current Foundation

- API server/domain is already configurable from `frontend/public/runtime-config.js`.
- The frontend uses `window.APP_CONFIG.API_BASE_URL`, so a future backend/domain move should not require source code changes.
- `Purchase Send`, `Unsold`, and `Unsold Remove` draft rows are now auto-saved in browser local storage per user/date/shift/seller/amount. This is a temporary first step, not the final local database.

## Final Target Architecture

```text
React/Electron UI
  -> Local data service
  -> SQLite local database on each laptop
  -> Sync queue
  -> Backend API
  -> PostgreSQL central server database
```

SQLite should be used for production offline-first storage because localStorage is only good for small drafts. SQLite can safely hold 1+ year of local purchase, unsold, bill, and history data.

## Server Usage Rules

Use server only for:

- Login and permission refresh
- Initial bootstrap/download after login
- Purchase Send final sync
- F11 Unsold Send final sync
- Manual/automatic sync update
- Admin upload/result/server-side reports when required

Use local database for:

- Purchase stock lookup
- Purchase Send entry grid/drafts
- Unsold Add entry grid/drafts
- Unsold Remove entry grid/drafts
- Old records
- Bills and local summaries
- Search/trace inside downloaded local data

## Local Database Tables

Recommended SQLite tables:

```sql
local_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

local_purchase_entries (
  local_id TEXT PRIMARY KEY,
  server_id INTEGER,
  user_id INTEGER NOT NULL,
  owner_user_id INTEGER,
  forwarded_by INTEGER,
  sent_to_parent INTEGER,
  number TEXT NOT NULL,
  box_value TEXT NOT NULL,
  amount TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  session_mode TEXT NOT NULL,
  purchase_category TEXT NOT NULL,
  status TEXT NOT NULL,
  memo_number INTEGER,
  purchase_memo_number INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'synced'
);

local_purchase_send_drafts (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  target_seller_id INTEGER NOT NULL,
  memo_number INTEGER,
  rows_json TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  session_mode TEXT NOT NULL,
  purchase_category TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

local_unsold_drafts (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  target_seller_id INTEGER NOT NULL,
  memo_number INTEGER,
  rows_json TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  session_mode TEXT NOT NULL,
  purchase_category TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

sync_queue (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Useful indexes:

```sql
CREATE INDEX idx_local_purchase_lookup
ON local_purchase_entries (user_id, booking_date, session_mode, purchase_category, amount, box_value, status, number);

CREATE INDEX idx_local_purchase_memo
ON local_purchase_entries (user_id, booking_date, session_mode, purchase_category, amount, memo_number);

CREATE INDEX idx_sync_queue_pending
ON sync_queue (status, created_at);
```

## Login Bootstrap Flow

After login:

1. Save token and user profile locally.
2. Call `GET /sync/bootstrap?since=<lastSyncAt>&days=365`.
3. Server returns all purchase stock, sent purchase, accepted unsold, remove history, users, rates, and metadata visible to that user.
4. App upserts this data into SQLite.
5. UI reads from SQLite, not from server.

This means if Admin sent purchase to Seller yesterday, Seller's laptop downloads it automatically after login and can use it locally.

## Purchase Send Flow

1. User adds rows in Purchase Send.
2. Rows are saved immediately to local SQLite as a draft.
3. Local stock is reduced/locked in SQLite so the same laptop cannot reuse the same number.
4. If internet is available, app pushes the finalized memo to server immediately.
5. If internet is not available, app keeps a pending item in `sync_queue`.
6. Later, when internet returns, app syncs pending Purchase Send to server.
7. Server remains final authority and can reject conflicts.

## Unsold Flow

1. User adds Unsold rows.
2. Rows are saved locally first.
3. Unsold rows do not need to hit server immediately.
4. When user presses F11 Unsold Send, app sends the complete unsold memo/batch to server.
5. If offline at F11 time, app queues the send and marks it pending.
6. After sync success, local rows become synced.

## Conflict Rules

Server is final authority. If local data says a number is available but server rejects it:

- Mark sync item as `conflict`.
- Keep the user's local draft.
- Show exact rejected numbers.
- User can edit/remove those rows and retry sync.

Common conflict examples:

- Number already sent by another laptop/user.
- Purchase memo already changed online.
- Unsold was already accepted or sent.
- Seller permission/rate changed after offline work.

## One-Year Local Retention

Keep at least 365 days of local data per user. Add config:

```js
LOCAL_RETENTION_DAYS: 365
```

Cleanup should run only after successful sync and should never delete:

- Pending drafts
- Pending sync queue items
- Conflicts
- Current day data

## Server Migration Safety

Keep these settings outside compiled code:

- API base URL
- Sync retention days
- Request timeout
- Feature flag for offline-first mode
- App environment name

Frontend config file:

```js
window.APP_CONFIG = {
  API_BASE_URL: 'https://api.example.com/api',
  OFFLINE_FIRST_ENABLED: true,
  LOCAL_RETENTION_DAYS: 365,
  SYNC_BOOTSTRAP_DAYS: 365
};
```

Backend must continue using environment variables:

- `DATABASE_URL`
- `PGPOOL_MAX`
- `PGPOOL_IDLE_TIMEOUT_MS`
- `PGPOOL_CONNECTION_TIMEOUT_MS`
- `PGSSLMODE`

This allows database/server/domain migration without changing app code.

## Migration Order

1. Keep current online API as final authority.
2. Add SQLite to Electron.
3. Move Purchase Send draft read/write from localStorage to SQLite.
4. Move Unsold and Unsold Remove drafts to SQLite.
5. Add `/sync/bootstrap` to download 365 days after login.
6. Add `/sync/push` for pending local operations.
7. Change Purchase/Unsold screens to read stock from SQLite.
8. Add conflict screen.
9. Add background sync every 30-60 seconds when online.
10. Move old records/bills/search to SQLite-backed views.

## Important Note

Offline-first cannot guarantee cross-laptop duplicate prevention without server sync. The laptop can prevent duplicates inside its local data. Final duplicate validation must happen on the server during sync.
