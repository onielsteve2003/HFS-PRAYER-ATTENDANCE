# HFS Prayer Attendance

Mini attendance web app for Tuesday/Thursday prayer sessions.

## Features

- Attendance can only be submitted on Tuesdays and Thursdays between 9:00pm and 10:00pm.
- One submission per device per prayer session.
- Optional name deduplication per session (enabled by default in backend index).
- Attendance history grouped by prayer day, ordered newest first.

## Tech

- Backend: Node.js, Express, MongoDB (Mongoose)
- Frontend: Vanilla HTML/CSS/JS

## Setup

1. Install root tools:

```bash
npm install
```

2. Install backend dependencies:

```bash
npm run server:install
```

3. Install frontend dependencies:

```bash
npm run client:install
```

4. Configure backend env:

- Copy `server/.env.example` to `server/.env`
- Set values:
  - `MONGODB_URI`
  - `TIMEZONE` (recommend `Africa/Lagos`)
  - `DEVICE_HASH_SALT` (any long secret)
  - `ALLOWED_ORIGIN` (for local use, `http://localhost:5173`)

5. Configure frontend env:

- Copy `client/.env.example` to `client/.env`
- Set:
  - `VITE_API_BASE_URL` (for local use, `http://localhost:5000/api`)

6. Start app (server + frontend dev server):

```bash
npm run dev
```

- Client: `http://localhost:5173`
- API: `http://localhost:5000`

## API Summary

- `GET /api/status?deviceToken=...`
  - Returns prayer-window state and whether current device already submitted for active session.
- `POST /api/attendance`
  - Body: `{ "name": "Your Name", "deviceToken": "..." }`
- `GET /api/attendance`
  - Returns grouped attendance history in descending order.

## Deploy Notes (Vercel + external backend)

- This app uses a separate Node server and MongoDB.
- If frontend is deployed on Vercel, set backend `ALLOWED_ORIGIN` to your Vercel domain.
- In Vercel Project Settings > Environment Variables, set `VITE_API_BASE_URL` to your Render API URL, e.g. `https://your-render-service.onrender.com/api`.
- Keep time checks on the backend only.

## Important Limitation

Device-based restriction is practical but not perfect. A user can bypass it by changing browser storage, incognito mode, or another device.
