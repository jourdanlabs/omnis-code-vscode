import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  classify,
  mayRenderEntries,
  parseEnvelope,
  truncateHash,
  unsafeRemedy,
} from '../protocol';

/** Captured verbatim from omnis-key 0.1.0 on 2026-08-01. */
const VALID =
  '{"schemaVersion":1,"command":"receipts.status","ok":true,"code":"RECEIPT_CHAIN_VALID","data":{"entryCount":3,"headSha256":"1a74283e2c46960eab0882f113458df0142655f347d4efa897bb7048b66f4cc5","state":"VALID"}}';
const INVALID =
  '{"schemaVersion":1,"command":"receipts.status","ok":false,"code":"RECEIPT_CHAIN_INVALID","data":null}';
const UNSAFE =
  '{"schemaVersion":1,"command":"receipts.status","ok":false,"code":"RECEIPT_STATE_UNSAFE","data":null}';
const EMPTY =
  '{"schemaVersion":1,"command":"receipts.status","ok":false,"code":"EMPTY_NOT_YET_EVIDENCED","data":{"entryCount":0,"headSha256":null,"state":"EMPTY"}}';
/** The no-flag legacy shape: status token, space, then JSON. */
const LEGACY =
  'RECEIPT_CHAIN_VALID {"state":"VALID","entryCount":3,"headSha256":"1a74283e2c46960eab0882f113458df0142655f347d4efa897bb7048b66f4cc5"}';

test('parses the pure-JSON envelope emitted by --json', () => {
  const env = parseEnvelope(VALID)!;
  assert.equal(env.code, 'RECEIPT_CHAIN_VALID');
  assert.equal(env.ok, true);
  assert.equal(env.data!.entryCount, 3);
});

test('parses the legacy token-prefixed shape without throwing', () => {
  const env = parseEnvelope(LEGACY)!;
  assert.equal(env.code, 'RECEIPT_CHAIN_VALID');
  assert.equal(classify(env).kind, 'valid');
});

test('VALID classifies as valid and carries the real head hash', () => {
  const s = classify(parseEnvelope(VALID)!);
  assert.equal(s.kind, 'valid');
  if (s.kind === 'valid') {
    assert.equal(s.entryCount, 3);
    assert.match(s.headSha256, /^[0-9a-f]{64}$/);
  }
});

test('INVALID classifies as invalid', () => {
  assert.equal(classify(parseEnvelope(INVALID)!).kind, 'invalid');
});

test('UNSAFE classifies as unsafe, distinct from invalid', () => {
  assert.equal(classify(parseEnvelope(UNSAFE)!).kind, 'unsafe');
});

/**
 * The gate-failure trap. EMPTY, UNSAFE and INVALID all arrive as ok:false with
 * exit 3. A fresh install must never be rendered as a tampered chain.
 */
test('EMPTY is not invalid — a fresh install is not a tampered chain', () => {
  const s = classify(parseEnvelope(EMPTY)!);
  assert.equal(s.kind, 'empty');
  assert.notEqual(s.kind, 'invalid');
});

test('every non-VALID code refuses to classify as valid', () => {
  for (const payload of [INVALID, UNSAFE, EMPTY]) {
    assert.notEqual(classify(parseEnvelope(payload)!).kind, 'valid');
  }
});

test('an unknown engine code yields no verdict, never a valid one', () => {
  const env = parseEnvelope(
    '{"schemaVersion":2,"command":"receipts.status","ok":true,"code":"SOMETHING_NEW","data":null}',
  )!;
  const s = classify(env);
  assert.equal(s.kind, 'unparseable');
});

/** ok:true must not be enough on its own to manufacture a VALID render. */
test('VALID code with a missing payload does not fabricate a verdict', () => {
  const env = parseEnvelope(
    '{"schemaVersion":1,"command":"receipts.status","ok":true,"code":"RECEIPT_CHAIN_VALID","data":null}',
  )!;
  assert.equal(classify(env).kind, 'unparseable');
});

test('garbage and empty stdout parse to null, not to a state', () => {
  assert.equal(parseEnvelope(''), null);
  assert.equal(parseEnvelope('command not found'), null);
  assert.equal(parseEnvelope('   '), null);
});

/**
 * The view's core honesty invariant. Entries carry no verdict of their own;
 * rendering them under anything but an engine-issued VALID would let the rows
 * imply soundness the engine never granted.
 */
test('entries render ONLY under an engine-issued VALID', () => {
  assert.equal(mayRenderEntries(classify(parseEnvelope(VALID)!)), true);

  for (const payload of [INVALID, UNSAFE, EMPTY]) {
    assert.equal(
      mayRenderEntries(classify(parseEnvelope(payload)!)),
      false,
      `entries must be withheld under ${JSON.stringify(payload).slice(0, 40)}`,
    );
  }
  assert.equal(mayRenderEntries({ kind: 'unreachable', detail: 'x' }), false);
  assert.equal(mayRenderEntries({ kind: 'unparseable', detail: 'x' }), false);
});

test('truncateHash strips the sha256: prefix and shortens', () => {
  assert.equal(truncateHash('sha256:1a74283e2c46960e'), '1a74283e…');
  assert.equal(truncateHash('abc'), 'abc');
});

test('the UNSAFE remedy names the directory chain, not the file', () => {
  const r = unsafeRemedy('/Users/x/.jcode');
  assert.match(r.command, /chmod 700/);
  assert.match(r.command, /state\/omnis-key/);
  assert.ok(!r.command.includes('receipts.jsonl'));
});
