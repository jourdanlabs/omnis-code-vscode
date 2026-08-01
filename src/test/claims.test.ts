import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  VERDICT_VOCABULARY,
  isFailure,
  isRefusal,
  parseClaimsStatus,
  parseClaimsVerify,
  present,
  toSafeOutcome,
} from '../claims';

const SECRET = 'sk-live-DEADBEEF-CAPTAIN-CREDENTIAL-9f3a';

/** Captured verbatim from omnis-key 0.1.0, `claims verify --refuse-demo --json`. */
const REFUSE_DEMO = JSON.stringify({
  schemaVersion: 1,
  command: 'claims verify',
  ok: true,
  code: 'CLAIMS_EVALUATED',
  data: {
    any_refuted: false,
    certified_count: 0,
    refused_count: 1,
    ungrounded_count: 1,
    outcomes: [
      {
        claim_id: 'demo-faster',
        kind_name: 'performance_faster',
        reason: 'we do not benchmark; speed claims are REFUSED_NO_VERIFIER (demo refusal)',
        surface: 'this is faster',
        verdict: 'REFUSED_NO_VERIFIER',
        receipt: { seq: 17, entry_hash: 'a'.repeat(64), verdict: 'REFUSED_NO_VERIFIER' },
      },
      {
        claim_id: 'demo-idiomatic',
        kind_name: 'more_idiomatic',
        reason: 'idiomatic is not falsifiable; UNGROUNDED (demo)',
        surface: 'this is more idiomatic',
        verdict: 'UNGROUNDED',
        receipt: { seq: 18, entry_hash: 'b'.repeat(64), verdict: 'UNGROUNDED' },
      },
    ],
  },
});

test('the verdict vocabulary matches the engine exactly', () => {
  assert.deepEqual(
    [...VERDICT_VOCABULARY],
    ['CERTIFIED', 'REFUTED', 'REFUSED_NO_VERIFIER', 'REFUSED_UNRESOLVED', 'UNGROUNDED'],
  );
});

/**
 * THE cell. A refusal is a successful turn — it must never carry failure
 * weight, which is what drives the error icon in the view.
 */
test('a refusal is not a failure', () => {
  for (const v of ['REFUSED_NO_VERIFIER', 'REFUSED_UNRESOLVED']) {
    assert.equal(isRefusal(v), true, `${v} must read as a refusal`);
    assert.equal(isFailure(v), false, `${v} must NOT read as a failure`);
    assert.equal(present(v).weight, 'refusal');
  }
});

test('UNGROUNDED is neither a failure nor a refusal', () => {
  assert.equal(present('UNGROUNDED').weight, 'ungrounded');
  assert.equal(isFailure('UNGROUNDED'), false);
  assert.equal(isRefusal('UNGROUNDED'), false);
});

test('only REFUTED carries failure weight', () => {
  const failures = VERDICT_VOCABULARY.filter((v) => isFailure(v));
  assert.deepEqual(failures, ['REFUTED']);
});

test('CERTIFIED reads as grounded', () => {
  assert.equal(present('CERTIFIED').weight, 'grounded');
});

test('no refusal gloss describes the refusal as an error or failure', () => {
  for (const v of ['REFUSED_NO_VERIFIER', 'REFUSED_UNRESOLVED', 'UNGROUNDED']) {
    const g = present(v).gloss.toLowerCase();
    for (const bad of ['error', 'failed', 'failure', 'problem', 'wrong']) {
      assert.ok(!g.includes(bad), `${v} gloss must not say "${bad}": ${g}`);
    }
  }
});

test('parses the real --refuse-demo envelope into two verdicts', () => {
  const s = parseClaimsVerify(REFUSE_DEMO)!;
  assert.equal(s.code, 'CLAIMS_EVALUATED');
  assert.equal(s.outcomes.length, 2);
  assert.equal(s.refused, 1);
  assert.equal(s.ungrounded, 1);
  assert.equal(s.anyRefuted, false);
  assert.equal(s.outcomes[0]!.verdict, 'REFUSED_NO_VERIFIER');
  assert.equal(s.outcomes[0]!.surface, 'this is faster');
});

/**
 * The claim ledger — unlike the receipt ledger — stores the full command argv,
 * stdout/stderr excerpts, and an absolute cwd. Verified against omnis-key 0.1.0.
 * None of it may reach a rendered outcome.
 */
test('claim verification evidence never leaks argv, output, or cwd', () => {
  const o = toSafeOutcome({
    claim_id: 'build-1',
    kind_name: 'build',
    verdict: 'CERTIFIED',
    surface: 'build passes',
    reason: 'exit code only',
    verification: {
      bound: 'exit code only — does not interpret build output semantics',
      decision: 'PROVED_TRUE',
      evidence: {
        command: ['sh', '-c', `deploy --token ${SECRET}`],
        exit_code: 0,
        facts: { cwd: '/Users/sokpyeon/secret-client-work', exit_code: 0 },
        stdout_excerpt: `token=${SECRET}`,
        stderr_excerpt: SECRET,
        verifier: 'build',
      },
    },
  });

  const blob = JSON.stringify(o);
  assert.ok(!blob.includes(SECRET), 'secret leaked from claim evidence');
  assert.ok(!blob.includes('/Users/'), 'absolute cwd leaked from claim evidence');
  assert.ok(!blob.includes('deploy'), 'command argv leaked from claim evidence');
  assert.ok(!blob.includes('stdout_excerpt'));

  // What we DO keep is safe and useful.
  assert.equal(o.verifier, 'build');
  assert.equal(o.exitCode, 0);
  assert.equal(o.decision, 'PROVED_TRUE');
  assert.match(o.bound!, /exit code only/);
});

test('a token-shaped string in a trusted text field is redacted', () => {
  const o = toSafeOutcome({
    claim_id: 'c',
    kind_name: 'k',
    verdict: 'CERTIFIED',
    surface: `deployed with ${SECRET}`,
    reason: `used Bearer ${SECRET}`,
  });
  assert.ok(!JSON.stringify(o).includes(SECRET));
  assert.equal(o.surface, '[redacted]');
});

test('claims status parses the real CLAIM_CHAIN_VALID envelope', () => {
  const s = parseClaimsStatus(
    JSON.stringify({
      schemaVersion: 1,
      command: 'claims status',
      ok: true,
      code: 'CLAIM_CHAIN_VALID',
      data: { entry_count: 16, head_sha256: 'c'.repeat(64) },
    }),
  )!;
  assert.equal(s.kind, 'valid');
  assert.equal(s.entryCount, 16);
});

test('garbage claims output yields null, never a verdict', () => {
  assert.equal(parseClaimsVerify('command not found'), null);
  assert.equal(parseClaimsStatus(''), null);
});

test('an unrecognized verdict does not masquerade as grounded', () => {
  assert.notEqual(present('TOTALLY_NEW_VERDICT').weight, 'grounded');
});
