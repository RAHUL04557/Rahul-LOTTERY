# Lottery Booking Desktop App

This Electron wrapper opens the local React build in a Windows desktop window. Backend traffic is handled by the React API configuration.

## Configure Your Domain

Create `frontend/.env` from `frontend/.env.example` and set:

```env
REACT_APP_API_URL=http://localhost:5000/api
```

Use the full public backend API base URL. Include `/api` if your AWS backend routes are mounted under `/api`.

## Run Locally

```powershell
cd frontend
npm install
npm run electron:dev
```

From the repo root, you can also run:

```powershell
npm run electron:dev
```

## Build Windows App

```powershell
cd frontend
npm run dist
```

The Windows installer will be created in `frontend/release/`.

## Version 2.5.0 local data

On the first launch after installation, the app backs up the local SQLite database
and managed browser entry keys, then removes entries whose **selected**
booking/draw/result date is before `2026-10-01`. Creation/upload timestamps are not
used. Cleanup runs before login restoration and sync. Server records, accounts,
credentials and original uploaded files are not deleted.

Desktop booking keys are migrated into SQLite and removed from browser localStorage
only after the database has committed them. Subsequent launches load those keys from
SQLite, so booking history and previews do not fill the browser storage quota.
Legacy full-booking reset logic has been removed; the selected-date cleanup owns retention.

Daily snapshots are maintained at the Windows Desktop location in
`Lottery Booking Data/YYYY-MM-DD/entries.json`. SQLite remains the working database.
To remove a date locally, close the app completely, delete that date's **folder**,
then reopen the app. The date is recorded as excluded, its local entries are removed,
and downloaded records for that date are filtered out. Editing/deleting only
`entries.json` is not a supported delete operation. Do not move/delete the root
folder or its `.lottery-data.json` marker; a missing root stops startup rather than
deleting all dates. Redirected/OneDrive Desktop paths use Electron's Desktop path.

The initial recovery database, browser backup and cleanup report are stored under
the app's `userData/recovery-2.5.0` directory, whose exact path is written to
`Lottery Booking Data/READ-ME.txt`. These backups intentionally retain old data.
Invalid/missing dates are preserved. Mixed-date or unresolved queued operations
are held as `needs_review` instead of being partly replayed. Cached bills spanning
a removed date are invalidated; original retained entries are unchanged.

From the repository root, run the isolated database migration checks with:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\frontend\node_modules\electron\dist\electron.exe .\frontend\electron\tests\dateStorage.test.js | Out-Host
Remove-Item Env:ELECTRON_RUN_AS_NODE
npm.cmd --prefix frontend test -- --watchAll=false --runInBand --runTestsByPath src/utils/dateStorage.test.js
```

Tests use temporary databases and Desktop folders, not installed application data.
