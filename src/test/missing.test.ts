/**
 * Missing-engine path. A stranger with no binaries must be told the named
 * tool and the setting that locates it — never a spinner, a green mark, or a
 * guessed verdict.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readChain,
  resolveAgentPath,
  resolveEnginePath,
  resolveScannerPath,
  resolveSiblingBinary,
  runAgent,
  runEngine,
  setConfiguredEnginePath,
  streamScan,
  verifyChain,
} from '../engine';
import {
  MISSING_CAIRN,
  MISSING_CRUCIBLE,
  MISSING_MTS,
  MISSING_OMNIS_CODE,
  MISSING_OMNIS_KEY,
  resolveCairnScript,
} from '../missing';
import { runMts } from '../mts';

test('readChain(null) names omnis-key and omnisCode.enginePath', async () => {
  const r = await readChain(null);
  assert.equal(r.state.kind, 'unreachable');
  assert.equal(r.exitCode, null);
  assert.notEqual(r.state.kind, 'valid');
  assert.notEqual(r.state.kind, 'empty');
  if (r.state.kind === 'unreachable') {
    assert.equal(r.state.detail, MISSING_OMNIS_KEY);
    assert.match(r.state.detail, /omnis-key/);
    assert.match(r.state.detail, /omnisCode\.enginePath/);
  }
});

test('verifyChain(null) uses the same missing-engine copy', async () => {
  const r = await verifyChain(null);
  assert.equal(r.state.kind, 'unreachable');
  if (r.state.kind === 'unreachable') {
    assert.equal(r.state.detail, MISSING_OMNIS_KEY);
  }
});

test('a configured path that does not exist is unreachable, not a verdict', () => {
  assert.equal(resolveEnginePath('/nonexistent/omnis-key-does-not-exist'), null);
  assert.equal(resolveEnginePath('   '), null);
});

test('runEngine with no binary names omnis-key and the setting', async () => {
  setConfiguredEnginePath('/nonexistent/omnis-key-does-not-exist');
  try {
    const res = await runEngine(['receipts', 'status', '--json']);
    assert.equal(res.exitCode, null);
    assert.equal(res.detail, MISSING_OMNIS_KEY);
    assert.equal(res.stdout, '');
  } finally {
    setConfiguredEnginePath(undefined);
  }
});

test('missing-binary copy names each tool and its setting', () => {
  assert.match(MISSING_OMNIS_KEY, /omnis-key not found/);
  assert.match(MISSING_OMNIS_KEY, /omnisCode\.enginePath/);
  assert.match(MISSING_OMNIS_CODE, /omnis-code not found/);
  assert.match(MISSING_OMNIS_CODE, /omnisCode\.enginePath/);
  assert.match(MISSING_CRUCIBLE, /crucible-scan not found/);
  assert.match(MISSING_CRUCIBLE, /omnisCode\.enginePath/);
  assert.match(MISSING_MTS, /mts not found/);
  assert.match(MISSING_MTS, /omnisCode\.mtsPath/);
  assert.match(MISSING_CAIRN, /cairn not found/);
  assert.match(MISSING_CAIRN, /omnisCode\.cairnServerScript/);
});

test(
  'runAgent with no binary names omnis-code and enginePath',
  { skip: resolveAgentPath() ? 'omnis-code present on this machine' : false },
  async () => {
    setConfiguredEnginePath('/nonexistent/omnis-key-does-not-exist');
    try {
      const res = await runAgent(['auth', 'status']);
      assert.equal(res.exitCode, null);
      assert.equal(res.detail, MISSING_OMNIS_CODE);
    } finally {
      setConfiguredEnginePath(undefined);
    }
  },
);

test(
  'streamScan with no binary names crucible-scan and enginePath',
  { skip: resolveScannerPath() ? 'crucible-scan present on this machine' : false },
  async () => {
    setConfiguredEnginePath('/nonexistent/omnis-key-does-not-exist');
    try {
      let text = '';
      const run = streamScan('/tmp', (c) => {
        text += c;
      });
      const code = await run.done;
      assert.equal(code, null);
      assert.equal(text.trim(), MISSING_CRUCIBLE);
    } finally {
      setConfiguredEnginePath(undefined);
    }
  },
);

test('runMts(null) names mts and omnisCode.mtsPath', async () => {
  const res = await runMts(null, ['soul-verify', 'x', '--json']);
  assert.equal(res.exitCode, null);
  assert.equal(res.detail, MISSING_MTS);
  assert.match(res.detail!, /mts not found/);
  assert.match(res.detail!, /omnisCode\.mtsPath/);
});

test('cairn copy names cairn and omnisCode.cairnServerScript', () => {
  assert.match(MISSING_CAIRN, /cairn not found/);
  assert.match(MISSING_CAIRN, /omnisCode\.cairnServerScript/);
  assert.equal(resolveCairnScript('/nonexistent/cairn/server.mjs'), null);
});

test('siblings resolve beside a configured engine path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnis-sib-'));
  const engine = join(dir, 'omnis-key');
  const agent = join(dir, 'omnis-code');
  const scan = join(dir, 'crucible-scan');
  writeFileSync(engine, '');
  writeFileSync(agent, '');
  writeFileSync(scan, '');
  setConfiguredEnginePath(engine);
  try {
    assert.equal(resolveSiblingBinary('omnis-code'), agent);
    assert.equal(resolveSiblingBinary('crucible-scan'), scan);
  } finally {
    setConfiguredEnginePath(undefined);
  }
});

test('a missing sibling next to a configured engine is not invented', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnis-sib-empty-'));
  mkdirSync(dir, { recursive: true });
  const engine = join(dir, 'omnis-key');
  writeFileSync(engine, '');
  setConfiguredEnginePath(engine);
  try {
    // These may still resolve from PATH probes on a machine that has them.
    // The contract: we never return a path that does not exist.
    const agent = resolveSiblingBinary('omnis-code');
    const scan = resolveSiblingBinary('crucible-scan');
    if (agent) {
      assert.notEqual(agent, join(dir, 'omnis-code'));
    }
    if (scan) {
      assert.notEqual(scan, join(dir, 'crucible-scan'));
    }
  } finally {
    setConfiguredEnginePath(undefined);
  }
});
