const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_PORT = 38100;
const NODE_PORT = 38101;
const AUTH_BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const NODE_URL = `http://127.0.0.1:${NODE_PORT}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch (_error) {
      // service not ready yet
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function assertStatus(response, expectedStatus, context) {
  if (response.status !== expectedStatus) {
    const body = await response.text();
    assert.fail(`${context} failed with ${response.status}: ${body}`);
  }
}

function startProcess(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  child.output = () => output;
  return child;
}

async function stopProcess(child) {
  if (!child || child.killed) return;

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_error) {
        // ignore forced kill failures
      }
    }, 3000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      child.kill();
    } catch (_error) {
      clearTimeout(timer);
      resolve();
    }
  });
}

function cookieHeaderFrom(response) {
  const raw = response.headers.get("set-cookie");
  assert.ok(raw, "expected set-cookie header");
  return raw.split(",").map((part) => part.split(";")[0]).join("; ");
}

test("Phase 1 smoke: backend + node proxy + auth flow", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "planetary-smoke-"));
  const dbPath = path.join(tempDir, "planetary.db");

  const backend = startProcess("python", [
    "-m",
    "uvicorn",
    "backend.app:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(BACKEND_PORT),
  ], {
    PLANETARY_ENV: "test",
    PLANETARY_DB_PATH: dbPath,
    PLANETARY_COOKIE_SECURE: "false",
  });

  const node = startProcess("node", ["server.js"], {
    PLANETARY_ENV: "test",
    PORT: String(NODE_PORT),
    AUTH_BACKEND_URL,
    SMTP_USE_TEST_ACCOUNT: "false",
  });

  const cleanup = async () => {
    for (const child of [node, backend]) {
      await stopProcess(child);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  t.after(cleanup);

  await waitForHealth(`${AUTH_BACKEND_URL}/health`);
  await waitForHealth(`${NODE_URL}/health`);

  const backendHealthResponse = await fetch(`${AUTH_BACKEND_URL}/health`);
  const backendHealth = await backendHealthResponse.json();
  assert.equal(backendHealth.ok, true);
  assert.equal(backendHealth.service, "auth-backend");
  assert.equal(backendHealth.cookie.secure, false);

  const nodeHealthResponse = await fetch(`${NODE_URL}/health`);
  const nodeHealth = await nodeHealthResponse.json();
  assert.equal(nodeHealth.ok, true);
  assert.equal(nodeHealth.service, "planetary-node");
  assert.equal(nodeHealth.authBackend.ok, true);
  assert.equal(nodeHealth.email.mode, "disabled");

  const unique = Date.now();
  const registerPayload = {
    username: `smoke_${unique}`,
    email: `smoke_${unique}@example.com`,
    password: "smoke-password-123",
  };

  const registerResponse = await fetch(`${NODE_URL}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registerPayload),
  });
  await assertStatus(registerResponse, 200, "register");
  const cookieHeader = cookieHeaderFrom(registerResponse);

  const meResponse = await fetch(`${NODE_URL}/api/me`, {
    headers: { cookie: cookieHeader },
  });
  await assertStatus(meResponse, 200, "me");
  const mePayload = await meResponse.json();
  assert.equal(mePayload.user.username, registerPayload.username);

  const logoutResponse = await fetch(`${NODE_URL}/api/logout`, {
    method: "POST",
    headers: { cookie: cookieHeader },
  });
  await assertStatus(logoutResponse, 200, "logout");

  const meAfterLogout = await fetch(`${NODE_URL}/api/me`, {
    headers: { cookie: cookieHeader },
  });
  assert.equal(meAfterLogout.status, 401, `expected unauthorized after logout, got ${meAfterLogout.status}`);
}, { timeout: 30000 });
