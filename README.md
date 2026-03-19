# Planetary

P2P transfer application - Created by Noah Vandebuerie 2026

## Local Run

Backend:

```bash
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Node app:

```bash
node server.js
```

## Verification

Run the Phase 1 smoke test:

```bash
npm test
```

This boots the backend and Node server, checks both health endpoints, and verifies register/login/logout through the Node proxy.

## Deployment

See `DEPLOYMENT.md`.
