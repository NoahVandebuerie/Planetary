# 🪐 Deploying Planetary on Vercel

This project is now fully configured and wowed to deploy directly on **Vercel** with zero-friction. 

The configuration includes a custom `vercel.json` file that maps all front-end assets directly to Vercel's Edge CDN and maps dynamic backend logic (auth proxying, email triggers, and room status updates) to serverless Vercel Node.js functions.

---

## 🛠️ Step-by-Step Vercel Deployment

### Option 1: Using the Vercel Dashboard (Recommended)

1. Push your Planetary repository to **GitHub**, **GitLab**, or **Bitbucket**.
2. Go to the [Vercel Dashboard](https://vercel.com/dashboard) and click **"Add New"** -> **"Project"**.
3. Import your Planetary repository.
4. Expand the **Environment Variables** section and configure the variables listed below.
5. Click **"Deploy"**. Vercel will automatically discover `vercel.json`, build the project, and serve it!

### Option 2: Using the Vercel CLI

Ensure you have the Vercel CLI installed (`npm install -g vercel`), then run:

```bash
# Log in to your Vercel account
vercel login

# Deploy the project
vercel --prod
```

---

## 🔑 Required Environment Variables

To ensure the backend APIs, authentication, and email triggers function correctly in your production Vercel environment, add the following environment variables to your Vercel project:

| Variable Name | Description | Example Value |
| :--- | :--- | :--- |
| `NODE_ENV` | Target environment mode | `production` |
| `PLANETARY_ENV` | Application environment mode | `production` |
| `AUTH_BACKEND_URL` | URL of your hosted Python auth/event-log backend | `https://planetary-backend.railway.app` |
| `PLANETARY_COOKIE_SECURE` | Enables HTTPS-only cookie attributes | `true` |

### Optional SMTP (E-mail invite system)

If you wish to use the orbital code email invite system (`/create-transfer`) in production:

| Variable Name | Description |
| :--- | :--- |
| `SMTP_HOST` | Hostname of your email server (e.g., `smtp.resend.com` or `smtp.sendgrid.net`) |
| `SMTP_PORT` | Port of your email server (typically `587` or `465`) |
| `SMTP_SECURE` | Set to `true` if port is `465`, or `false` for `587` |
| `SMTP_USER` | Email provider username |
| `SMTP_PASS` | Email provider password or API key |
| `SMTP_FROM` | Verified sender address (e.g., `noreply@yourdomain.com`) |

---

## 🚀 Important Architectural Considerations for Serverless

> [!NOTE]
> **Planetary** was designed as a single-instance stateful Node.js + Python server where active rooms and peer listings are held in-memory.

Because Vercel runs on a **Serverless Architecture**, serverless function containers spin up on-demand to handle requests and shut down when inactive. This has two main effects:

1. **Active Rooms & Socket.IO State**: Active room configurations are held in memory. In serverless instances, this memory is ephemeral and is not shared between different serverless function containers. Socket.IO will automatically fall back to **HTTP Long Polling** on Vercel, but clients may experience disconnects or "unknown session" errors if subsequent polls land on different serverless function instances.
2. **SQLite Database**: The local SQLite database (`data/planetary.db`) is read-only on Vercel. Database modifications will not persist.

### 💡 Highly Recommended Production Architecture

For a stable, scale-ready production deployment:
1. **Deploy the Frontend + Proxy on Vercel**: Use Vercel to host your static assets and route traffic.
2. **Deploy the Server & Backend on a Persistent Instance**: Host your `server.js` Node app and your Python `backend` together on a persistent single-instance container service like **Railway**, **Render**, or **Fly.io**. This maintains active WebSockets and stateful SQLite files flawlessly while utilizing Vercel to cache and serve the frontend at the absolute edge!
