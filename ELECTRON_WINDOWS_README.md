# Electron Windows App Notes

This branch adds Windows Electron desktop support for the existing React app while keeping the backend hosted separately on AWS.

## What changed

- Added Electron app wrapper files in `frontend/electron/`.
- Added Electron build scripts and packaging configuration in `frontend/package.json`.
- Added Electron-related development dependencies in `frontend/package-lock.json`.
- Updated the frontend API base URL to use `REACT_APP_API_URL` in `frontend/src/services/api.js`.
- Added `frontend/.env.example` with the public API URL placeholder.
- Added `release/` to `.gitignore` so generated Windows installers are not committed.
- Added missing backend dependency `mongoose` because existing backend model files import it.

## What did not change

- No CSS changes were made.
- No UI design, layout, colors, spacing, or styling changes were made.
- No business logic or API request payload/response handling was changed.
- Electron production still loads the local React build from `build/index.html`.
- Electron development still loads the React dev server from `http://localhost:3000`.

## Where to add the AWS backend domain

Create a file named `.env` inside the `frontend/` folder:

```env
REACT_APP_API_URL=https://YOUR_BACKEND_DOMAIN_HERE/api
```

Replace `https://YOUR_BACKEND_DOMAIN_HERE/api` with the real AWS/domain API URL.

Examples:

```env
REACT_APP_API_URL=https://api.example.com/api
```

```env
REACT_APP_API_URL=https://example.com/api
```

Do not put secrets, passwords, database URLs, or private keys in this frontend `.env` file. This value is bundled into the React app and should only be a public API base URL.

## Development

From the `frontend/` folder:

```bash
npm install
npm run electron:dev
```

This starts the React dev server on `http://localhost:3000` and opens Electron. API calls use `REACT_APP_API_URL` from `frontend/.env`.

## Production Windows build

From the `frontend/` folder:

```bash
npm install
npm run dist
```

The Windows installer is generated in:

```text
frontend/release/
```

The `release/` folder is ignored by Git because it contains generated build output.

## Important build note

React reads environment variables at build time. If you change `REACT_APP_API_URL`, rebuild the desktop app:

```bash
npm run dist
```
