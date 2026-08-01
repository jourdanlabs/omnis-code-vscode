/**
 * Live-engine probes. These run the real omnis-key binary against an isolated
 * JCODE_HOME — never the operator's ledger.
 *
 * Skipped (not silently passed) when the binary is absent.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readChain, resolveEnginePath, verifyChain } from '../engine';

const ENGINE = resolveEnginePath();
const skip = ENGINE ? false : 'omnis-key not installed';

/** A three-entry chain produced by the engine itself, in a throwaway home. */
function seededHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'omnis-ext-'));
  mkdirSync(join(home, 'state', 'omnis-key'), { recursive: true });
  chmodSync(home, 0o700);
  chmodSync(join(home, 'state'), 0o700);
  chmodSync(join(home, 'state', 'omnis-key'), 0o700);

  for (let i = 1; i <= 3; i++) {
    execFileSync(
      ENGINE!,
      [
        'receipts',
        'record',
        '--event-id',
        `test-event-${i}`,
        '--evidence-sha256',
        String(i).repeat(64),
        '--json',
        'agent.bash',
        `bash:probe${i}`,
      ],
      { env: { ...process.env, JCODE_HOME: home }, stdio: 'pipe' },
    );
  }
  return home;
}

function ledgerFile(home: string): string {
  return join(home, 'state', 'omnis-key', 'receipts.jsonl');
}

test('a seeded chain reads VALID from the real engine', { skip }, async () => {
  const home = seededHome();
  const prev = process.env.JCODE_HOME;
  process.env.JCODE_HOME = home;
  try {
    const r = await readChain(ENGINE);
    assert.equal(r.state.kind, 'valid');
    assert.equal(r.exitCode, 0);
  } finally {
    process.env.JCODE_HOME = prev;
  }
});

/**
 * GATE CRITERION 2 — the tamper probe.
 * Flip one byte; the panel state must become invalid and the exit code must
 * survive to the surface. A `valid` here is an outright gate failure.
 */
test('one flipped byte flips the panel to INVALID with exit 3', { skip }, async () => {
  const home = seededHome();
  const file = ledgerFile(home);
  const buf = readFileSync(file);
  const i = buf.indexOf(Buffer.from('probe1'));
  assert.ok(i > 0, 'fixture must contain the subject we intend to tamper with');
  buf[i + 5] = buf[i + 5] === 0x39 ? 0x38 : 0x39; // '1' -> '9'
  writeFileSync(file, buf);

  const prev = process.env.JCODE_HOME;
  process.env.JCODE_HOME = home;
  try {
    const status = await readChain(ENGINE);
    assert.equal(status.state.kind, 'invalid', 'tampered chain must not read VALID');
    assert.equal(status.exitCode, 3, 'exit code must reach the surface');

    const verified = await verifyChain(ENGINE);
    assert.equal(verified.state.kind, 'invalid');
    assert.equal(verified.exitCode, 3);
    assert.match(verified.raw, /RECEIPT_CHAIN_INVALID/);
  } finally {
    process.env.JCODE_HOME = prev;
  }
});

/** A fresh install is EMPTY, not INVALID. */
test('an unseeded home reads EMPTY, never INVALID', { skip }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'omnis-ext-empty-'));
  chmodSync(home, 0o700);
  const prev = process.env.JCODE_HOME;
  process.env.JCODE_HOME = home;
  try {
    const r = await readChain(ENGINE);
    assert.equal(r.state.kind, 'empty');
    assert.notEqual(r.state.kind, 'invalid');
  } finally {
    process.env.JCODE_HOME = prev;
  }
});

/** GATE CRITERION 3 — engine down. No stale state presented as current. */
test('a missing engine reports unreachable, not a verdict', async () => {
  const r = await readChain(null);
  assert.equal(r.state.kind, 'unreachable');
  assert.equal(r.exitCode, null);

  const bogus = await readChain('/nonexistent/omnis-key-does-not-exist');
  assert.notEqual(bogus.state.kind, 'valid');
  assert.notEqual(bogus.state.kind, 'invalid');
});
