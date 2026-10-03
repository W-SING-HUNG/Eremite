import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

assert.equal(process.platform, 'win32', 'Listener inspection gate requires supported Windows runtime');
// Next dev rewrites this generated declaration; restore its pre-test bytes.
const originalNextEnvironment = await readFile('next-env.d.ts');
await mkdir('.qa', { recursive: true });
const temporaryRoot = await mkdtemp(path.resolve('.qa/loopback-http-'));
try {
  for (const command of ['dev', 'start']) {
    const port = await reservePort();
    const dataDirectory = path.join(temporaryRoot, command);
    await mkdir(dataDirectory);
    const environment = { ...process.env, EREMITE_DATA_DIR: dataDirectory, NEXT_TELEMETRY_DISABLED: '1' };
    for (const key of ['EREMITE_AI_BASE_URL', 'EREMITE_AI_API_KEY', 'EREMITE_AI_MODEL']) delete environment[key];
    const server = spawn(process.execPath, ['scripts/run-next.mjs', command, '--port', String(port)], {
      cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
    const exited = new Promise(resolve => server.once('exit', resolve));
    try {
      const deadline = Date.now() + 120000;
      let ready = false;
      while (Date.now() < deadline && server.exitCode === null) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/login`, { signal: AbortSignal.timeout(5000) });
          if (response.ok) { ready = true; break; }
        } catch { /* wait for local startup */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.ok(ready, `${command} failed to serve login: ${output}`);
      const inspection = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Select-Object LocalAddress,OwningProcess | ConvertTo-Json -Compress`],
      { encoding: 'utf8' });
      assert.equal(inspection.status, 0, inspection.stderr);
      const parsed = JSON.parse(inspection.stdout.trim());
      const listeners = Array.isArray(parsed) ? parsed : [parsed];
      assert.ok(listeners.length > 0);
      for (const listener of listeners) assert.equal(listener.LocalAddress, '127.0.0.1', `${command} has a non-loopback listener`);
      console.log(`${command}: actual Windows listener 127.0.0.1:${port}; HTTP login PASS.`);
    } finally {
      if (server.exitCode === null) {
        const stopped = spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { encoding: 'utf8' });
        assert.equal(stopped.status, 0, stopped.stderr);
      }
      await exited;
    }
  }
} finally {
  try {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } finally {
    await writeFile('next-env.d.ts', originalNextEnvironment);
  }
}

async function reservePort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}
