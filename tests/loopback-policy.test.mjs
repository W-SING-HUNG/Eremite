import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nextArguments } from '../scripts/next-listen-policy.mjs';

// Observe the real wrapper's child argv in a contained synthetic installation.
// The stand-in prints argv only; it does not claim a real Next listener test.
mkdirSync('.qa', { recursive: true });
const fixture = mkdtempSync(path.resolve('.qa/loopback-policy-'));
try {
  mkdirSync(path.join(fixture, 'scripts'));
  for (const file of ['run-next.mjs', 'next-listen-policy.mjs']) {
    cpSync(path.join('scripts', file), path.join(fixture, 'scripts', file));
  }
  writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
  for (const name of ['next', 'react', 'react-dom']) {
    mkdirSync(path.join(fixture, 'node_modules', name), { recursive: true });
    writeFileSync(path.join(fixture, 'node_modules', name, 'package.json'), JSON.stringify({ name }));
  }
  const nextDirectory = path.join(fixture, 'node_modules/next/dist/bin');
  mkdirSync(nextDirectory, { recursive: true });
  writeFileSync(path.join(nextDirectory, 'next.js'), 'console.log(JSON.stringify(process.argv.slice(2)));');
  for (const command of ['dev', 'start']) {
    for (const arguments_ of [[], ['--port', '3011'], ['-H', '127.0.0.1'], ['--hostname=127.0.0.1']]) {
      const result = spawnSync(process.execPath, ['scripts/run-next.mjs', command, ...arguments_], {
        cwd: fixture, encoding: 'utf8', env: { ...process.env, HOSTNAME: '0.0.0.0' },
      });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      const observed = JSON.parse(result.stdout.trim());
      assert.equal(observed[0], command);
      assert.deepEqual(observed.slice(-2), ['--hostname', '127.0.0.1']);
      assert.equal(observed.filter(value => value === '--hostname').length, 1);
      if (arguments_.includes('--port')) assert.ok(observed.includes('3011'));
    }
    for (const arguments_ of [
      ['-H', '0.0.0.0'], ['--hostname', '::'], ['--hostname=[::]'],
      ['-H=192.168.1.2'], ['-H0.0.0.0'], ['--hostname', 'localhost'],
      ['--hostname'], ['--'], ['-H', '127.0.0.1', '-H', '0.0.0.0'],
    ]) {
      const result = spawnSync(process.execPath, ['scripts/run-next.mjs', command, ...arguments_], {
        cwd: fixture, encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '', 'invalid hostname must fail before Next runs');
      assert.match(result.stderr, /127\.0\.0\.1/);
    }
  }
  assert.deepEqual(nextArguments('build', ['--debug']), ['build', '--debug']);
  console.log('Loopback policy and real wrapper child-argv tests passed (dev/start).');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
