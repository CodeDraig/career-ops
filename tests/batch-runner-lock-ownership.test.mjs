import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { ROOT, getBash, rmSync } from './helpers.mjs';

test('batch invocations release only a lock they acquired and still own', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'co-batch-owner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const batch = join(root, 'batch');
  const bin = join(root, 'bin');
  mkdirSync(batch);
  mkdirSync(bin);
  const script = join(batch, 'batch-runner.sh');
  copyFileSync(join(ROOT, 'batch/batch-runner.sh'), script);
  writeFileSync(join(batch, 'batch-prompt.md'), 'Fictional fixture');
  // Empty input means a successful real run can acquire and release the lock
  // without ever invoking a worker.
  writeFileSync(join(batch, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n');
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nexit 99\n', { mode: 0o755 });
  const lock = join(batch, 'batch-runner.pid');
  const env = { ...process.env, PATH: bin + delimiter + process.env.PATH };
  const run = (args) => spawnSync(getBash(), [script, ...args], { env, encoding: 'utf8', timeout: 15_000 });

  // BASHPID is the real lock format and is meaningful to kill -0 on Git Bash
  // too, where a Windows Node PID may not be a valid MSYS shell PID.
  for (const args of [['--status'], ['--dry-run', '--model', 'fixture'], ['--model', 'fixture']]) {
    const command = 'printf "%s\\n" "$BASHPID" > "$1"; bash "$2" "${@:3}"; result=$?; test -f "$1" && test "$(cat "$1")" = "$BASHPID" || exit 91; exit "$result"';
    const result = spawnSync(getBash(), ['-c', command, 'fixture', lock, script, ...args], { env, encoding: 'utf8', timeout: 15_000 });
    assert.ifError(result.error);
    assert.equal(result.status, args[0] === '--model' ? 1 : 0, result.stdout + result.stderr);
    assert.ok(existsSync(lock), `${args}: active owner lock survived`);
  }
  // The prior shell has exited: the stale lock may now be replaced and the
  // successful empty batch must clean up the lock it actually acquires.
  const completed = run(['--model', 'fixture']);
  assert.ifError(completed.error);
  assert.equal(completed.status, 0, completed.stdout + completed.stderr);
  assert.equal(existsSync(lock), false);

  // A successor can replace the PID after acquisition; cleanup must not remove
  // that successor's lock. Exercise the real functions without starting main.
  const source = readFileSync(script, 'utf8');
  const functions = source.slice(source.indexOf('acquire_lock() {'), source.indexOf('# Validate prerequisites'));
  const replaced = spawnSync(getBash(), ['-c', 'set -eu; LOCK_FILE="$1"; MAIN_PID="$BASHPID"; LOCK_ACQUIRED=false; ' + functions + '\nacquire_lock\nprintf "successor\\n" > "$LOCK_FILE"\n', 'fixture', lock], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(readFileSync(lock, 'utf8'), 'successor\n');
});
