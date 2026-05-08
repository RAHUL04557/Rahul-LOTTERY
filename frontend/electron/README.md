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
