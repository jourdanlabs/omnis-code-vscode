/**
 * P3 gate criterion: a receipt lands and the panel reflects it WITHOUT a reload.
 * Proven against the real engine writing into an isolated JCODE_HOME.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readChain, resolveEnginePath, watchLedger } from '../engine';

const ENGINE = resolveEnginePath();
const skip = ENGINE ? false : 'omnis-key not installed';

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'omnis-watch-'));
  mkdirSync(join(home, 'state', 'omnis-key'), { recursive: true });
  chmodSync(home, 0o700);
  chmodSync(join(home, 'state'), 0o700);
  chmodSync(join(home, 'state', 'omnis-key'), 0o700);
  return home;
}

function record(home: string, n: number): void {
  execFileSync(
    ENGINE!,
    [
      'receipts',
      'record',
      '--event-id',
      `watch-${n}`,
      '--evidence-sha256',
      String(n).repeat(64),
      '--json',
      'agent.bash',
      `bash:watch${n}`,
    ],
    { env: { ...process.env, JCODE_HOME: home }, stdio: 'pipe' },
  );
}

test('a new receipt fires the watcher without any reload', { skip }, async () => {
  const home = freshHome();
  const prev = process.env.JCODE_HOME;
  process.env.JCODE_HOME = home;

  try {
    let fired = 0;
    const w = watchLedger(() => fired++, { ...process.env, JCODE_HOME: home }, 30);

    const before = await readChain(ENGINE);
    assert.equal(before.state.kind, 'empty', 'fresh home should start EMPTY');

    record(home, 1);
    await new Promise((r) => setTimeout(r, 400));

    assert.ok(fired > 0, 'watcher did not fire when a receipt was appended');

    const after = await readChain(ENGINE);
    assert.equal(after.state.kind, 'valid', 'panel state did not advance to VALID');
    if (after.state.kind === 'valid') {
      assert.equal(after.state.entryCount, 1);
    }
    w.close();
  } finally {
    process.env.JCODE_HOME = prev;
  }
});

test('the watcher coalesces a burst into few refreshes', { skip }, async () => {
  const home = freshHome();
  const prev = process.env.JCODE_HOME;
  process.env.JCODE_HOME = home;
  try {
    let fired = 0;
    const w = watchLedger(() => fired++, { ...process.env, JCODE_HOME: home }, 120);
    for (let i = 1; i <= 4; i++) {
      record(home, i);
    }
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(fired >= 1, 'watcher never fired');
    assert.ok(fired <= 3, `debounce failed: ${fired} refreshes for one burst`);

    const after = await readChain(ENGINE);
    if (after.state.kind === 'valid') {
      assert.equal(after.state.entryCount, 4);
    }
    w.close();
  } finally {
    process.env.JCODE_HOME = prev;
  }
});

test('a missing state directory does not throw', () => {
  const w = watchLedger(
    () => undefined,
    { ...process.env, JCODE_HOME: '/nonexistent/omnis-home' },
    10,
  );
  w.close();
});
