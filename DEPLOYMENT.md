# Deployment

## Phase 1 Scope

This Phase 1 setup is intended for a single-instance deployment:

- one Node process serving the web app and Socket.IO
- one FastAPI process serving auth and event log APIs
- one SQLite database file

Realtime room state is still in-memory in `server.js`, so horizontal scaling is not supported in Phase 1.

## Required Services

1. Node.js 20+
2. Python 3.11+
3. A writable filesystem path for the SQLite database
4. An SMTP provider if invite email via `/create-transfer` is required

## Environment Variables

Copy `.env.example` and set at least:

- `PLANETARY_ENV=production`
- `PORT`
- `AUTH_BACKEND_URL`
- `PLANETARY_DB_PATH`
- `PLANETARY_COOKIE_SECURE=true`

For invite emails in production, also set:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

If SMTP is not configured:

- the app still starts
- `/health` reports email mode and readiness
- `/create-transfer` returns `503`

## Start Commands

Backend:

```bash
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Node app:

```bash
node server.js
```

## Health Checks

Backend:

```bash
GET /health
```

Node:

```bash
GET /health
```

The Node health endpoint checks:

- Node app availability
- auth backend reachability
- email transport readiness

## Pre-Deploy Checklist

1. Run `npm test`
2. Verify backend health is `200`
3. Verify Node health is `200`
4. Confirm cookie security is enabled in backend health output
5. Confirm SMTP is configured if invite emails are required
6. Confirm database path is writable

## Production Notes

- Use HTTPS in front of both services.
- Keep `PLANETARY_COOKIE_SECURE=true` in production.
- Keep this deployment single-instance until room state is externalized.
