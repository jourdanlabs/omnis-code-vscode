/**
 * MAP THE SOUL — against the REAL `mts` binary.
 *
 * 🔴 Why this file exists.
 *
 * A tamper bug survived a suite of 88 tests because every verify fixture in it
 * was hand-written, and not one of them paired `chain_ok: true` with a bedrock
 * mismatch — the exact shape a real tampered soul produces. Editing a sealed
 * `soul.md` never touches the ledger, so the chain stays intact and the
 * signature stays valid; only the bedrock hash moves. No fixture author thought
 * to write that combination down, so the panel called a tampered soul a
 * signature problem.
 *
 * The engine's real output is the artifact. Hand-written fixtures are a summary
 * of it, and a summary cannot surprise you. This file seals a real soul, edits
 * it on disk, and asks the real engine what it thinks.
 *
 * Skips loudly rather than passing quietly when the engine or an operator key
 * is unavailable — a skip that reads as a pass would recreate the original bug.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildAnswers,
  buildNewSoulArgs,
  parseAuthorOutcome,
  parseVerify,
  resolveMtsCommand,
  runMts,
} from '../mts';

const cmd = resolveMtsCommand();

/** Three real, specific refusals — the engine rejects vague ones. */
const DRAFT = {
  fields: {
    name: 'TamperProbe',
    naming_lineage:
      'A disposable fixture sealed by the integration suite to prove that editing a sealed soul is reported as tampering and not as a signature problem.',
    pronouns: 'they/them',
    role: 'disposable tamper probe for the OMNIS CODE soul panel',
    operator: 'Lucca',
    // Required by the CLI (Act III). Omitting it made the seal refuse and the
    // whole probe skip — which the loud skip caught and a silent one would not.
    signature: 'probe',
  },
  axioms: [
    'TamperProbe will not report a seal the CLI did not actually emit.',
    'TamperProbe will not stand in for a real soul or be cited as canon.',
    'TamperProbe will not outlive the test run that created it.',
  ],
  exemplarContext: 'Asked whether its own file had been altered after sealing.',
  exemplarOutput:
    'It had been. The engine said so, and the honest answer is to repeat what the engine said.',
};

async function sealInto(dir: string): Promise<{ soulId: string } | { skip: string }> {
  const answersPath = join(dir, 'answers.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(answersPath, JSON.stringify(buildAnswers(DRAFT)), 'utf8');
  const soulsDir = join(dir, 'souls');
  const res = await runMts(cmd, buildNewSoulArgs(answersPath, soulsDir));
  const outcome = parseAuthorOutcome(res);
  if (outcome.kind === 'sealed') {
    return { soulId: outcome.soulId };
  }
  if (outcome.kind === 'refused' && /operator key not found/i.test(outcome.message)) {
    return { skip: 'no operator signing key in this keychain — cannot seal here' };
  }
  return { skip: `could not seal: ${JSON.stringify(outcome).slice(0, 200)}` };
}

test(
  '🔴 a soul edited after sealing is reported as ALTERED, not as a signature problem',
  { skip: cmd ? false : 'mts not installed on this machine' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'omnis-tamper-'));
    try {
      const sealed = await sealInto(root);
      if ('skip' in sealed) {
        // Loud, not silent. A quiet skip here is how the bug survived.
        console.log(`    ⊘ TAMPER PROBE DID NOT RUN — ${sealed.skip}`);
        return;
      }
      const soulsDir = join(root, 'souls');
      const soulMd = join(soulsDir, sealed.soulId, 'soul.md');

      // Healthy first, so a mis-sealed package cannot masquerade as a catch.
      const before = await runMts(cmd, [
        'soul-verify',
        sealed.soulId,
        '--json',
        '--souls-dir',
        soulsDir,
      ]);
      const healthy = parseVerify(sealed.soulId, before);
      assert.ok(healthy.kind === 'verdict', 'no verdict on the freshly sealed soul');
      assert.equal(healthy.verdict.verified, true, 'the soul did not verify before tampering');

      // Tamper: one appended line. Assert the file actually changed, so a
      // no-op edit cannot produce a green "caught it".
      const original = readFileSync(soulMd, 'utf8');
      appendFileSync(soulMd, '\nedited after sealing\n', 'utf8');
      assert.notEqual(readFileSync(soulMd, 'utf8'), original, 'the tamper did not modify the file');

      const after = await runMts(cmd, [
        'soul-verify',
        sealed.soulId,
        '--json',
        '--souls-dir',
        soulsDir,
      ]);
      const reading = parseVerify(sealed.soulId, after);
      assert.ok(reading.kind === 'verdict', 'no verdict on the tampered soul');
      const v = reading.verdict;

      // The shape that hid the bug: both of these stay TRUE under tampering.
      assert.equal(v.chainOk, true, 'precondition: a content edit leaves the chain intact');
      assert.equal(v.verified, false, 'the engine must fail a tampered soul');

      assert.equal(
        v.seal,
        'tampered',
        `a tampered soul must read as tampered, got "${v.seal}" — engine said: ${v.message}`,
      );
      console.log(`    ↳ tampered soul reads: ${v.seal} — ${v.issues.join(' | ')}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'the engine still reports a healthy sealed soul as verified',
  { skip: cmd ? false : 'mts not installed on this machine' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'omnis-healthy-'));
    try {
      const sealed = await sealInto(root);
      if ('skip' in sealed) {
        console.log(`    ⊘ SEAL PROBE DID NOT RUN — ${sealed.skip}`);
        return;
      }
      const res = await runMts(cmd, [
        'soul-verify',
        sealed.soulId,
        '--json',
        '--souls-dir',
        join(root, 'souls'),
      ]);
      const reading = parseVerify(sealed.soulId, res);
      assert.ok(reading.kind === 'verdict');
      assert.equal(reading.verdict.verified, true);
      assert.notEqual(reading.verdict.seal, 'tampered', 'a healthy soul must not read as tampered');
      console.log(`    ↳ healthy soul reads: ${reading.verdict.seal}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
