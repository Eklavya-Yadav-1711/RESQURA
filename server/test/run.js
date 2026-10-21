// Boots the server against a throwaway database, runs both suites, cleans up.
//   npm test
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = path.join(__dirname, 'tmp');
const SERVER = path.join(__dirname, '..', 'index.js');

function reset() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
}

function startServer() {
  return spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(TMP, 'test.db'),
      UPLOAD_DIR: path.join(TMP, 'uploads'),
      PUSH_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/config`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not come up on ${BASE}`);
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      // Suites get the same database path so they can simulate elapsed time.
      env: { ...process.env, BASE, DB_PATH: path.join(TMP, 'test.db') },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

(async () => {
  reset();
  const server = startServer();
  let failed = 0;

  try {
    await waitForServer();
    failed += await runSuite('e2e.js');
    failed += await runSuite('contract.js');
  } catch (err) {
    console.error(err.message);
    failed = 1;
  } finally {
    server.kill();
    setTimeout(() => fs.rmSync(TMP, { recursive: true, force: true }), 300);
  }

  console.log(failed ? '\nTESTS FAILED' : '\nAll suites passed');
  process.exitCode = failed ? 1 : 0;
})();
