import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const EXE_PATH = path.resolve(process.cwd(), 'release', 'win-unpacked', 'Facet.exe');
const API_BASE = 'http://127.0.0.1:36912';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok === true) return json;
      }
    } catch {
      // Wait for LocalApiServer to start
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${API_BASE}/health after ${timeoutMs}ms`);
}

function startLocalMockProxy() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('local-mock-proxy-ok');
    });
    server.on('connect', (_req, clientSocket) => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      clientSocket.end();
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

async function verifyRunAsNodeFuseDisabled() {
  const proc = spawn(EXE_PATH, ['-e', 'console.log("RUN_AS_NODE_LEAK")'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  proc.stdout.on('data', (d) => {
    stdout += d.toString('utf8');
  });
  await sleep(1500);
  try {
    proc.kill();
  } catch {
    // Already exited
  }
  if (stdout.includes('RUN_AS_NODE_LEAK')) {
    throw new Error('SECURITY FAILURE: RunAsNode Fuse is NOT disabled!');
  }
  console.log('[smoke] RunAsNode=false Fuse verified (ELECTRON_RUN_AS_NODE ignored).');
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    throw new Error(`Packaged binary not found: ${EXE_PATH}. Run "npm run dist:win" first.`);
  }

  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-smoke-'));
  const { server: mockProxy, port: mockProxyPort } = await startLocalMockProxy();
  let appProc = null;

  try {
    console.log(`[smoke] Launching packaged binary: ${EXE_PATH}`);
    const dataDir = path.join(tmpUserData, 'data');
    appProc = spawn(EXE_PATH, [], {
      env: {
        ...process.env,
        APPDATA: tmpUserData,
        ANTIDETECT_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    let appStderr = '';
    appProc.stderr.on('data', (d) => {
      appStderr += d.toString('utf8');
    });
    appProc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`[smoke] Facet.exe exited early with code ${code}: ${appStderr}`);
      }
    });

    // 1. Wait for Local API /health
    const health = await waitForHealth(20000);
    console.log('[smoke] Local API /health OK:', JSON.stringify(health));
    if (health.service !== 'antidetect-local-api') {
      throw new Error(`Unexpected /health service: ${health.service}`);
    }

    // 2. Read generated localApiKey from temp SQLite DB using Node built-in node:sqlite
    const dbPath = path.join(dataDir, 'antidetect.db');
    let apiKey = '';
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(dbPath)) {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        const row = db.prepare("SELECT value FROM settings WHERE key = 'localApiKey'").get();
        db.close();
        if (row && row.value) {
          apiKey = String(row.value);
          break;
        }
      }
      await sleep(250);
    }
    if (!apiKey) {
      throw new Error('Could not read localApiKey from temp antidetect.db');
    }

    // 3. Create a Chrome profile pointing to local mock proxy (manual geo, zero external calls)
    const createRes = await fetch(`${API_BASE}/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        name: 'Smoke Test Chrome',
        platform: 'windows',
        browser: 'chrome',
        proxy: {
          type: 'http',
          host: '127.0.0.1',
          port: mockProxyPort,
          username: '',
          password: '',
        },
        geo: {
          mode: 'manual',
          timezone: 'America/New_York',
          language: 'en-US',
          lat: 40.7128,
          lon: -74.006,
        },
      }),
    });
    if (!createRes.ok) {
      throw new Error(`POST /profiles failed: ${createRes.status} ${await createRes.text()}`);
    }
    const { profile } = await createRes.json();
    console.log(`[smoke] Created profile via Local API: ${profile.id}`);

    // 4. Launch & close the real Chrome profile from packaged app
    const startRes = await fetch(`${API_BASE}/profiles/${profile.id}/start`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
    });
    if (!startRes.ok) {
      throw new Error(
        `POST /profiles/:id/start failed: ${startRes.status} ${await startRes.text()}`,
      );
    }
    const startJson = await startRes.json();
    console.log('[smoke] Chrome profile launched:', JSON.stringify(startJson));
    await sleep(1500);

    const stopRes = await fetch(`${API_BASE}/profiles/${profile.id}/stop`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
    });
    if (!stopRes.ok) {
      throw new Error(`POST /profiles/:id/stop failed: ${stopRes.status} ${await stopRes.text()}`);
    }
    console.log('[smoke] Chrome profile stopped cleanly.');

    // 5. Verify RunAsNode=false Fuse
    await verifyRunAsNodeFuseDisabled();
    console.log('[smoke] ALL PACKAGED SMOKE CHECKS PASSED!');
  } finally {
    if (appProc && !appProc.killed) {
      try {
        appProc.kill();
      } catch {
        // Ignore
      }
      await sleep(800);
    }
    mockProxy.close();
    try {
      fs.rmSync(tmpUserData, { recursive: true, force: true });
    } catch {
      // Ignore transient Windows handle lock
    }
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
