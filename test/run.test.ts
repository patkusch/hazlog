import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(env: Record<string, string>, ...args: string[]) {
  return spawnSync(process.execPath, ['src/run.ts', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('with no local model server running, `make run` stops with exit code 2 and says what to do', () => {
  const out = mkdtempSync(join(tmpdir(), 'hazlog-run-'));
  // Port 1 is never listening, so Ollama is unreachable without touching a real one.
  const r = run({ OLLAMA_HOST: 'http://127.0.0.1:1' }, '--out', join(out, 'out'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Ollama is not reachable at http:\/\/127\.0\.0\.1:1/);
  assert.match(r.stderr, /ollama pull gemma3/);
  assert.match(r.stderr, /make demo/);
});

test('it writes nothing when it stops early', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'hazlog-run-')), 'out');
  run({ OLLAMA_HOST: 'http://127.0.0.1:1' }, '--out', out);
  assert.equal(existsSync(out), false);
});
