/**
 * MAP THE SOUL adapter tests.
 *
 * Every fixture below is REAL output captured from `mts` on 2026-08-01, not a
 * shape invented to match the parser. Where a fixture was trimmed, only fields
 * were dropped — none were added or reworded.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  MtsResult,
  buildAnswers,
  buildNewSoulArgs,
  parseAuthorOutcome,
  parseVerify,
  sealPresentation,
} from '../mts';

const SRC = join(__dirname, '..', '..', 'src');

function res(stdout: string, exitCode: number | null = 0, detail?: string): MtsResult {
  return { stdout, stderr: '', exitCode, detail };
}

// ── Refusal is a verdict, never an error ────────────────────────────────────

/** Captured: `new-soul` driven with two axioms instead of three. */
const REFUSAL_JSON = `{
  "ok": false,
  "refused": true,
  "message": "REFUSED: fewer than 3 negative axioms — a soul with no refusals cannot be born"
}`;

test('a refusal parses as a refusal, not a failure', () => {
  // Note the exit code: `mts` exits 1 for a refusal AND for a real error.
  // Branching on the code alone would misfile the product working as a crash.
  const out = parseAuthorOutcome(res(REFUSAL_JSON, 1));
  assert.equal(out.kind, 'refused');
});

test("the engine's refusal text is carried verbatim", () => {
  const out = parseAuthorOutcome(res(REFUSAL_JSON, 1));
  assert.equal(out.kind, 'refused');
  assert.equal(
    (out as { message: string }).message,
    'REFUSED: fewer than 3 negative axioms — a soul with no refusals cannot be born',
  );
});

test('a refusal is still recognised if the engine stops emitting JSON', () => {
  const plain = 'REFUSED: fewer than 3 negative axioms — a soul with no refusals cannot be born';
  const out = parseAuthorOutcome(res(plain, 1));
  assert.equal(out.kind, 'refused', 'version drift must degrade to a correct read');
  assert.equal((out as { message: string }).message, plain);
});

/**
 * Captured: three axioms that are aspirations rather than refusals. A second,
 * different refusal — proof the wizard renders whatever the engine declines,
 * rather than special-casing the one refusal it was designed around.
 */
const REFUSAL_VAGUE = `{
  "ok": false,
  "refused": true,
  "message": "REFUSED: vague axioms detected — be specific, not aspirational"
}`;

test('a refusal the wizard was not designed around still renders as a refusal', () => {
  const out = parseAuthorOutcome(res(REFUSAL_VAGUE, 1));
  assert.equal(out.kind, 'refused');
  assert.match((out as { message: string }).message, /vague axioms detected/);
});

test('a non-refusal failure is never dressed up as a refusal', () => {
  const out = parseAuthorOutcome(res('', 1, 'mts not found.'));
  assert.equal(out.kind, 'unreachable');
});

// ── Rule 2: hash-sealed ≠ operator-signed ───────────────────────────────────

/** Captured: a real scripted seal, signed because an operator key was present. */
const SEALED_SIGNED = `{
  "ok": true,
  "soul_id": "soul_440d4f78be8c",
  "bedrock_hash": "440d4f78be8c97220afb9e601b5167849513fee3b84b6670d3a390f65b24dbef",
  "package_dir": "/tmp/souls/soul_440d4f78be8c",
  "receipt": { "signet_key_id": "pan-ed25519-70865355708de6a6" }
}`;

test('a seal is reported signed only when the engine names a key', () => {
  const signed = parseAuthorOutcome(res(SEALED_SIGNED, 0));
  assert.equal(signed.kind, 'sealed');
  assert.equal((signed as { signed: boolean }).signed, true);

  const unsigned = parseAuthorOutcome(
    res(SEALED_SIGNED.replace('"pan-ed25519-70865355708de6a6"', 'null'), 0),
  );
  assert.equal(unsigned.kind, 'sealed');
  assert.equal(
    (unsigned as { signed: boolean }).signed,
    false,
    'signet_key_id: null is hash-sealed, never operator-signed',
  );
});

/**
 * Captured from three real souls. All three matter: Pan and Lucca BOTH carry
 * signet_key_id: null, yet one verifies and one fails. Collapsing them would
 * either accuse a healthy soul of being broken or excuse a real gap.
 */
const VERIFY_SIGNED = `{"ok":true,"verdict":"VERIFIED","soul_id":"soul_1915af6c9d86","chain_ok":true,"chain_count":1,"signet_required":true,"signet_ok":true,"signet_key_ids":["pan-ed25519-70865355708de6a6"],"issues":[],"message":"VERIFIED — soul_1915af6c9d86 bedrock intact, chain ok (1 events)"}`;

const VERIFY_PRE_SIGNET = `{"ok":true,"verdict":"VERIFIED","soul_id":"soul_bb75a9fa2823","chain_ok":true,"chain_count":1,"signet_required":true,"signet_ok":false,"signet_key_ids":[],"signet_status":"PRE_SIGNET","pre_signet_events":[1],"issues":[],"message":"VERIFIED — soul_bb75a9fa2823 bedrock intact, chain ok (1 events) · PRE_SIGNET: event 1 sealed before any trusted key existed — unsigned by history, not by tampering"}`;

const VERIFY_UNSIGNED = `{"ok":false,"verdict":"FAILED","soul_id":"soul_44c49c0559c4","bedrock_hash":"44c49c0559c4532febb0c7d4daf78cdc1fdf8b8d85ca5979f903592c484bb150","lock_hash":"44c49c0559c4532febb0c7d4daf78cdc1fdf8b8d85ca5979f903592c484bb150","chain_ok":true,"chain_count":1,"signet_required":true,"signet_ok":false,"signet_key_ids":[],"issues":["SIGNET: seal signature missing (event 1)"],"message":"FAILED — SIGNET: seal signature missing (event 1)"}`;

/**
 * Captured by verifying a genuinely signed soul against a trust store that does
 * not hold its key — i.e. exactly what a stranger's soul looks like on anyone
 * else's machine. Note `chain_ok: true` and `signet_key_ids: []`, identical to
 * the signature-missing case: only the issue text separates them.
 */
const VERIFY_UNTRUSTED = `{"ok":false,"verdict":"FAILED","soul_id":"soul_1915af6c9d86","chain_ok":true,"chain_count":1,"signet_required":true,"signet_ok":false,"signet_key_ids":[],"issues":["SIGNET: signer pan-ed25519-70865355708de6a6 is not trusted and ACTIVE (event 1)"],"message":"FAILED — SIGNET: signer pan-ed25519-70865355708de6a6 is not trusted and ACTIVE (event 1)"}`;

/**
 * Captured from a REAL tampered soul: sealed with the real key, then one line
 * appended to `soul.md`.
 *
 * This is the combination no hand-written fixture contained, and its absence is
 * what let a tampered soul render as a signature problem: `chain_ok: true`,
 * `signet_ok: true`, a NON-EMPTY key id — everything about the signature is
 * fine. Only `bedrock_hash` and `lock_hash` diverge.
 */
const VERIFY_TAMPERED = `{"ok":false,"verdict":"FAILED","soul_id":"soul_440d4f78be8c","bedrock_hash":"c8401a4c5c1160a79ab889ac2bb5f70cde040936e69126c00a90b7b7a88777fe","lock_hash":"440d4f78be8c97220afb9e601b5167849513fee3b84b6670d3a390f65b24dbef","chain_ok":true,"chain_count":1,"signet_required":true,"signet_ok":true,"signet_key_ids":["pan-ed25519-70865355708de6a6"],"issues":["SIGNET: self-cert mismatch — current bedrock derives soul_c8401a4c5c11, not soul_440d4f78be8c","TAMPER: bedrock_hash mismatch","TAMPER: bedrock section §9 hash mismatch"],"message":"FAILED — SIGNET: self-cert mismatch — current bedrock derives soul_c8401a4c5c11, not soul_440d4f78be8c; TAMPER: bedrock_hash mismatch; TAMPER: bedrock section §9 hash mismatch"}`;

test('🔴 a tampered soul is not described as a signature problem', () => {
  const out = parseVerify('x', res(VERIFY_TAMPERED, 1));
  assert.ok(out.kind === 'verdict');
  // The preconditions that made this look like a signature failure:
  assert.equal(out.verdict.chainOk, true, 'a content edit leaves the chain intact');
  assert.equal(out.verdict.seal, 'tampered');

  const label = sealPresentation(out.verdict.seal).label;
  for (const wrong of [/signature/i, /hash-sealed/i, /sign this/i]) {
    assert.ok(!wrong.test(label), `a tampered soul must not read as ${wrong} (got "${label}")`);
  }
  assert.match(label, /ALTERED/);
});

test('🔴 a tampered soul never reads as operator-signed, despite a valid signature', () => {
  // signet_ok is true and a key id IS named — the signature over the original
  // event is still good. Only `verified` separates this from a healthy seal.
  const out = parseVerify('x', res(VERIFY_TAMPERED, 1));
  assert.ok(out.kind === 'verdict');
  assert.ok(out.verdict.keyIds.length > 0, 'precondition: the engine still names a key');
  assert.notEqual(out.verdict.seal, 'signed');
  assert.ok(!/operator-signed/.test(sealPresentation(out.verdict.seal).label));
});

/**
 * Replace the engine's issue list so only the structural fields can decide.
 *
 * Rewrites `message` alongside `issues`, because the engine derives one from
 * the other — leaving a stale message would make the fixture state something
 * the real engine never would, and a fixture that cannot occur proves nothing.
 */
function withIssues(fixture: string, issues: string[]): string {
  const message = issues.length ? `FAILED — ${issues.join('; ')}` : 'FAILED';
  return fixture
    .replace(/"issues":\[[^\]]*\]/, `"issues":${JSON.stringify(issues)}`)
    .replace(/"message":"[^"]*"/, `"message":${JSON.stringify(message)}`);
}

/**
 * 🔴 The two mechanisms are tested SEPARATELY, on purpose.
 *
 * Every fixture captured from a real tampered soul happens to carry the word
 * TAMPER, so a test that exercises both at once passes even with the structural
 * check dead — the fallback silently does the primary's job, the primary looks
 * like code no test needs, and the next person deletes it. That is coverage
 * passing by coincidence of fixture data, which is exactly what hid the
 * original bug. Each branch gets a case that ONLY it can satisfy.
 */
test('🔴 the structural check alone catches tampering, with no TAMPER wording present', () => {
  // Bedrock no longer matches the lock, and the engine says nothing about
  // tampering. Only `bedrock_hash !== lock_hash` can reach the right answer.
  const quiet = withIssues(VERIFY_TAMPERED, ['SIGNET: seal signature missing (event 1)']);
  assert.ok(!/TAMPER|self-cert/i.test(quiet), 'fixture must carry no tamper wording');

  const out = parseVerify('x', res(quiet, 1));
  assert.ok(out.kind === 'verdict');
  assert.equal(
    out.verdict.seal,
    'tampered',
    'bedrock mismatch must be caught structurally, not by reading the issue text',
  );
});

test('🔴 the structural check needs no issue list at all', () => {
  const silent = withIssues(VERIFY_TAMPERED, []);
  const out = parseVerify('x', res(silent, 1));
  assert.ok(out.kind === 'verdict');
  assert.equal(out.verdict.seal, 'tampered');
});

test('bedrock mismatch outranks every signature branch', () => {
  // Tampered AND unsigned, with no tamper wording to lean on. Still tampering,
  // not unsigned: the content no longer matches the seal, which is the more
  // serious claim.
  const both = withIssues(VERIFY_TAMPERED, [
    'SIGNET: seal signature missing (event 1)',
    'SIGNET: signer is not trusted and ACTIVE (event 1)',
  ]);
  const out = parseVerify('x', res(both, 1));
  assert.ok(out.kind === 'verdict');
  assert.equal(out.verdict.seal, 'tampered');
});

test('an intact soul is never called tampered by the structural check', () => {
  // The other direction: matching hashes must not trip it, or every unsigned
  // soul would be accused of tampering.
  const intact = VERIFY_UNSIGNED;
  assert.ok(/"lock_hash"/.test(intact), 'fixture must state both hashes');
  const out = parseVerify('x', res(intact, 1));
  assert.ok(out.kind === 'verdict');
  assert.notEqual(out.verdict.seal, 'tampered');
  assert.equal(out.verdict.seal, 'unsigned');
});

test('a TAMPER finding is honoured even if the engine stops emitting lock_hash', () => {
  // Structural check unavailable → fall back to the engine's own wording rather
  // than describing a content edit as a signature problem.
  const noLock = VERIFY_TAMPERED.replace(
    /"lock_hash":"[0-9a-f]+",/,
    '',
  );
  const out = parseVerify('x', res(noLock, 1));
  assert.ok(out.kind === 'verdict');
  assert.equal(out.verdict.seal, 'tampered');
});

test('the six real verify outcomes stay distinct', () => {
  const signed = parseVerify('a', res(VERIFY_SIGNED));
  const pre = parseVerify('b', res(VERIFY_PRE_SIGNET));
  const unsigned = parseVerify('c', res(VERIFY_UNSIGNED, 1));
  const untrusted = parseVerify('e', res(VERIFY_UNTRUSTED, 1));
  const broken = parseVerify(
    'd',
    res(VERIFY_UNSIGNED.replace('"chain_ok":true', '"chain_ok":false'), 1),
  );

  assert.equal(signed.kind === 'verdict' && signed.verdict.seal, 'signed');
  assert.equal(pre.kind === 'verdict' && pre.verdict.seal, 'pre-signet');
  assert.equal(unsigned.kind === 'verdict' && unsigned.verdict.seal, 'unsigned');
  assert.equal(untrusted.kind === 'verdict' && untrusted.verdict.seal, 'untrusted');
  assert.equal(broken.kind === 'verdict' && broken.verdict.seal, 'broken');
});

test('🔴 a real signature by an untrusted key is never called missing', () => {
  const untrusted = parseVerify('e', res(VERIFY_UNTRUSTED, 1));
  assert.ok(untrusted.kind === 'verdict');
  assert.equal(untrusted.verdict.seal, 'untrusted');
  const label = sealPresentation(untrusted.verdict.seal).label;
  assert.ok(
    !/missing/i.test(label),
    `the signature is present; calling it missing states something false (got "${label}")`,
  );
  // Nor may it be upgraded to signed — this machine cannot confirm the signer.
  assert.ok(!/operator-signed/.test(label));
});

test('an unrecognised signature complaint degrades to a vaguer TRUE statement', () => {
  // A future engine wording we have never seen must not become a confident
  // "signature missing".
  const odd = VERIFY_UNSIGNED.replace(
    'SIGNET: seal signature missing (event 1)',
    'SIGNET: seal signature rejected for reasons invented in 2027',
  );
  const out = parseVerify('f', res(odd, 1));
  assert.ok(out.kind === 'verdict');
  assert.equal(out.verdict.seal, 'unverified');
  assert.ok(!/missing/i.test(sealPresentation('unverified').label));
});

test('a pre-SIGNET soul verifies and is never called tampered', () => {
  const pre = parseVerify('b', res(VERIFY_PRE_SIGNET));
  assert.ok(pre.kind === 'verdict');
  assert.equal(pre.verdict.verified, true);
  assert.equal(pre.verdict.chainOk, true);
  assert.equal(pre.verdict.issues.length, 0);
});

test('a missing signature is not rendered as a broken chain', () => {
  const unsigned = parseVerify('c', res(VERIFY_UNSIGNED, 1));
  assert.ok(unsigned.kind === 'verdict');
  assert.equal(unsigned.verdict.verified, false);
  assert.equal(unsigned.verdict.chainOk, true, 'the chain is intact; only the signature is absent');
  assert.notEqual(unsigned.verdict.seal, 'broken');
});

test('🔴 the word "signed" is reachable ONLY for an engine-named key', () => {
  // Rule 2, enforced at the single place the product is allowed to say it.
  for (const seal of [
    'pre-signet',
    'unsigned',
    'untrusted',
    'unverified',
    'tampered',
    'broken',
  ] as const) {
    const p = sealPresentation(seal);
    assert.ok(
      !/\boperator-signed\b/.test(p.label),
      `${seal} must never present as operator-signed (got "${p.label}")`,
    );
  }
  assert.equal(sealPresentation('signed').label, 'operator-signed');
  assert.match(sealPresentation('pre-signet').label, /hash-sealed/);
});

test('a hash-sealed soul is told plainly that it is not signed', () => {
  assert.match(sealPresentation('pre-signet').gloss, /NOT operator-signed/);
});

// ── Never autofill, never route around the gate ─────────────────────────────

test('an empty axiom list is passed to the engine as empty', () => {
  const answers = buildAnswers({
    fields: { name: 'X' },
    axioms: [],
    exemplarContext: '',
    exemplarOutput: '',
  });
  assert.deepEqual(
    answers.soul.axioms,
    [],
    'the extension must not invent, default, or pad axioms — the engine gets to refuse',
  );
});

test('no field is invented for the user', () => {
  const answers = buildAnswers({
    fields: { name: 'X', role: '' },
    axioms: ['a'],
    exemplarContext: '',
    exemplarOutput: '',
  });
  assert.equal(answers.soul.name, 'X');
  assert.ok(!('role' in answers.soul), 'an empty field is omitted, never defaulted');
  assert.ok(!('operator' in answers.soul));
});

test('the seal argv never uses --draft-only, which cannot seal', () => {
  const args = buildNewSoulArgs('/tmp/a.json');
  assert.ok(!args.includes('--draft-only'));
  assert.ok(args.includes('--non-interactive'));
  assert.ok(args.includes('--json'));
});

// ── 🔴 No reimplementation. The CLI is the only authority. ───────────────────

test('the extension implements no hashing, sealing, or signing of its own', () => {
  const banned = [
    /createHash\s*\(/,
    /createHmac\s*\(/,
    /createSign\s*\(/,
    /createVerify\s*\(/,
    /\bsha256\s*\(/,
    /createPrivateKey\s*\(/,
    /createPublicKey\s*\(/,
  ];
  for (const file of ['mts.ts', 'soulsView.ts', 'soulWizard.ts']) {
    const text = readFileSync(join(SRC, file), 'utf8');
    for (const rx of banned) {
      assert.ok(!rx.test(text), `${file} must not compute crypto itself: ${rx}`);
    }
  }
});

/**
 * Comments are stripped first, deliberately.
 *
 * The rationale above `SoulWizard` names the temptations it refuses — "skip for
 * now", suggesting an axiom — so a naive grep over the raw file matches the
 * explanation of the rule as if it were a violation of it. What has to hold is
 * that no such affordance reaches the user, so the sweep runs over code and
 * markup only. It still covers every string the webview can render.
 */
function sourceWithoutComments(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the wizard offers no example axiom, no autofill, and no skip', () => {
  const text = sourceWithoutComments('soulWizard.ts');
  // An axiom textarea that ships with content would be an autofill.
  assert.ok(
    /<textarea id="axioms" rows="8"><\/textarea>/.test(text),
    'the axioms field must be empty — no placeholder, no default, no example',
  );
  assert.ok(
    !/placeholder=/.test(text),
    'no placeholder text anywhere: a ghosted example is still an example',
  );
  for (const rx of [/>\s*Skip\b/i, /skip for now/i, /suggest/i, /generate an axiom/i, /for example/i]) {
    assert.ok(!rx.test(text), `the wizard must offer no way past the gate: ${rx}`);
  }
});

test('the comment-stripping sweep still sees the markup it is guarding', () => {
  // Guards the test above from passing because it stopped reading anything.
  const text = sourceWithoutComments('soulWizard.ts');
  assert.match(text, /id="axioms"/, 'the sweep must still cover the axioms field');
  assert.match(text, /REFUSED/, 'the sweep must still cover the refusal rendering');
});

test('the seal button is not disabled below three axioms', () => {
  const text = readFileSync(join(SRC, 'soulWizard.ts'), 'utf8');
  assert.ok(
    !/seal'\)\.disabled/.test(text) && !/getElementById\('seal'\)\.disabled/.test(text),
    'blocking submission client-side would stop the engine refusing in its own words',
  );
});
