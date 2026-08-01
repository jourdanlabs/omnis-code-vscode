import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EVIDENCE_ALLOWLIST, parseLedger, toSafeRow } from '../ledger';

const SECRET = 'sk-live-DEADBEEF-CAPTAIN-CREDENTIAL-9f3a';

/** Every string a row could possibly render, flattened. */
function surfaceOf(row: unknown): string {
  return JSON.stringify(row);
}

test('a secret in a non-allowlisted evidence field never reaches a row', () => {
  const row = toSafeRow({
    sequence: 1,
    kind: 'agent.bash',
    subject: 'bash:curl',
    evidence: {
      argv_program: 'curl',
      argv_full: `curl -H "Authorization: Bearer ${SECRET}" https://x`,
      stdout: SECRET,
      stderr: SECRET,
      env: { TOKEN: SECRET },
      exit_code: 0,
    },
  });
  assert.ok(!surfaceOf(row).includes(SECRET), 'secret leaked into a rendered row');
  assert.equal(row.label, 'curl');
  assert.equal(row.detail, 'exit 0');
});

/**
 * Contract-violation defense: if a future engine ever put arguments into
 * argv_program, the allowlist alone would pass them through. The shape guard
 * must reject it rather than render it.
 */
test('argv_program carrying arguments is rejected, not rendered', () => {
  const row = toSafeRow({
    sequence: 2,
    kind: 'agent.bash',
    subject: 'bash:curl',
    evidence: { argv_program: `curl -H Bearer:${SECRET}`, exit_code: 1 },
  });
  assert.ok(!surfaceOf(row).includes(SECRET));
  assert.equal(row.label, '—');
});

test('a target path is reduced to a basename, never a full user path', () => {
  const row = toSafeRow({
    sequence: 3,
    kind: 'agent.edit',
    subject: 'edit:cart.js',
    evidence: {
      tool: 'edit',
      target: '/Users/sokpyeon/secret-client-work/cart.js',
      content_before_sha256: 'sha256:' + 'b'.repeat(64),
      content_after_sha256: 'sha256:' + '7'.repeat(64),
    },
  });
  assert.equal(row.label, 'cart.js');
  assert.ok(!surfaceOf(row).includes('secret-client-work'));
  assert.ok(!surfaceOf(row).includes('/Users/'));
  assert.equal(row.detail, 'bbbb… → 7777…');
});

test('non-hash values are never abbreviated into something that looks like a hash', () => {
  const row = toSafeRow({
    sequence: 4,
    kind: 'agent.edit',
    subject: 'edit:x',
    evidence: { content_before_sha256: SECRET, content_after_sha256: SECRET },
  });
  assert.ok(!surfaceOf(row).includes(SECRET));
  assert.ok(!surfaceOf(row).includes(SECRET.slice(0, 4)));
});

test('a whole ledger containing secrets renders no secret anywhere', () => {
  const jsonl = [
    JSON.stringify({
      sequence: 1,
      kind: 'agent.bash',
      subject: `bash:${SECRET}`,
      evidence: { argv_program: 'node', argv_full: SECRET, exit_code: 0 },
    }),
    JSON.stringify({
      sequence: 2,
      kind: 'agent.edit',
      subject: 'edit:a.js',
      evidence: { target: 'a.js', content: SECRET, tool: 'edit' },
    }),
    'not json at all',
    '',
  ].join('\n');

  const rows = parseLedger(jsonl);
  assert.equal(rows.length, 2, 'malformed line must be skipped, not guessed at');
  assert.ok(!surfaceOf(rows).includes(SECRET));
  assert.equal(rows[0]!.sequence, 2, 'rows render newest-first');
});

const FORBIDDEN_FIELDS = [
  'argv_full',
  'stdout',
  'stderr',
  'content',
  'content_before',
  'content_after',
  'env',
  'token',
  'cwd',
];

/** Layer 2: the row builder reads only named keys, so unknown fields never render. */
test('a row built entirely from forbidden fields renders nothing', () => {
  const row = toSafeRow({
    sequence: 1,
    kind: 'agent.bash',
    subject: 's',
    evidence: Object.fromEntries(FORBIDDEN_FIELDS.map((f) => [f, SECRET])),
  });
  assert.ok(!surfaceOf(row).includes(SECRET));
  assert.equal(row.label, '—');
  assert.equal(row.detail, '');
});

/**
 * Layer 1: the allowlist itself.
 *
 * This asserts the constant directly rather than inferring it from output.
 * An earlier version of this test checked only rendered output and therefore
 * stayed green when `argv_full` was added to the allowlist — the row builder
 * masked it. Binding to the set is what makes widening it fail here.
 */
test('the evidence allowlist itself admits no raw-content field', () => {
  for (const f of FORBIDDEN_FIELDS) {
    assert.ok(
      !EVIDENCE_ALLOWLIST.has(f),
      `${f} must never be allowlisted — it can carry raw command or file content`,
    );
  }
});

/** Anything allowlisted must be a hash, a bare program name, a basename, or an exit code. */
test('every allowlisted field is a known-safe shape', () => {
  const known = new Set([
    'argv_program',
    'tool',
    'target',
    'exit_code',
    'content_before_sha256',
    'content_after_sha256',
  ]);
  for (const f of EVIDENCE_ALLOWLIST) {
    assert.ok(known.has(f), `unreviewed field in allowlist: ${f}`);
  }
});
