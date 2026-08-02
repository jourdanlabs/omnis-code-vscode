/**
 * Adapter over the MAP THE SOUL (`mts`) CLI. No `vscode` import, no crypto.
 *
 * 🔴 Rule 1 — the IDE calls the CLI and computes NOTHING.
 *
 * MTS's own README says "core-spec — do not fork the rules in the GUI." There
 * are three authoring surfaces now (CLI, Studio, this). There must remain
 * exactly one implementation of the rules, or two things can disagree about
 * what a soul is and the seal stops meaning one thing.
 *
 * So: nothing in this file hashes, seals, signs, or validates. It builds argv,
 * parses stdout, and renders verdicts the engine issued. If you are ever
 * tempted to add `node:crypto` here, the answer is no — `mts.reimplementation`
 * in the test suite exists to catch exactly that.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Sealing runs a full interview + genesis write; it is slower than a status ping. */
const TIMEOUT_MS = 60_000;

export interface MtsResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Set only when we could not talk to the CLI at all. */
  detail?: string;
}

/**
 * How to invoke MTS on this machine.
 *
 * `mts` is distributed as a Node entry point rather than a compiled binary, so
 * a resolved install may need `node` in front of it. We carry the interpreter
 * explicitly instead of relying on a shebang plus an exec bit that a zip
 * download loses.
 */
export interface MtsCommand {
  bin: string;
  prefixArgs: string[];
  /** Where it was found, shown to the user so an unexpected install is visible. */
  source: string;
}

/**
 * GUI-launched editors on macOS do not inherit the login shell's PATH, so the
 * same probe-known-locations approach the omnis-key adapter uses applies here.
 */
export function candidateMtsPaths(env = process.env): string[] {
  const home = homedir();
  const out: string[] = [];
  if (env.OMNIS_CODE_MTS_PATH) {
    out.push(env.OMNIS_CODE_MTS_PATH);
  }
  out.push(
    join(home, '.local', 'bin', 'mts'),
    '/usr/local/bin/mts',
    '/opt/homebrew/bin/mts',
    join(home, 'projects', 'mts', 'bin', 'mts.mjs'),
  );
  return out;
}

export function resolveMtsCommand(
  configured?: string,
  env = process.env,
): MtsCommand | null {
  const tried = configured?.trim() ? [configured.trim()] : candidateMtsPaths(env);
  for (const p of tried) {
    if (!existsSync(p)) {
      continue;
    }
    return p.endsWith('.mjs') || p.endsWith('.js')
      ? { bin: process.execPath, prefixArgs: [p], source: p }
      : { bin: p, prefixArgs: [], source: p };
  }
  return null;
}

/** Where sealed soul packages live. `mts` resolves this the same way. */
export function soulsDir(env = process.env, cmd?: MtsCommand | null): string {
  if (env.MTS_SOULS_DIR) {
    return env.MTS_SOULS_DIR;
  }
  // The CLI defaults to <packageRoot>/souls. Derive it from the resolved entry
  // point when we have one rather than guessing a fixed path.
  if (cmd?.source.endsWith('.mjs')) {
    return join(cmd.source, '..', '..', 'souls');
  }
  return join(homedir(), 'projects', 'mts', 'souls');
}

function run(cmd: MtsCommand, args: string[]): Promise<MtsResult> {
  return new Promise((resolve) => {
    execFile(
      cmd.bin,
      [...cmd.prefixArgs, ...args],
      { timeout: TIMEOUT_MS, maxBuffer: 8 << 20 },
      (err, stdout, stderr) => {
        // A non-zero exit is product surface: `mts` exits 1 on a REFUSAL as
        // well as on a real error. Resolve with the code; never throw, and
        // never infer which one it was from the code alone.
        const code =
          err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number'
            ? (err as unknown as { code: number }).code
            : err
              ? null
              : 0;
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exitCode: code });
      },
    );
  });
}

export async function runMts(cmd: MtsCommand | null, args: string[]): Promise<MtsResult> {
  if (!cmd) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      detail:
        'mts not found. Set "omnisCode.mtsPath" to the MAP THE SOUL CLI (VS Code does not inherit your shell PATH on macOS).',
    };
  }
  return run(cmd, args);
}

// ── Authoring outcomes ──────────────────────────────────────────────────────

/**
 * What `new-soul` can produce.
 *
 * `refused` is a first-class outcome, not an error. The engine refusing to
 * birth a soul with no refusals is the product working. It is rendered as a
 * verdict with its own mark, in the engine's own words, and it is never
 * softened, retried automatically, or worked around.
 */
export type AuthorOutcome =
  | { kind: 'sealed'; soulId: string; bedrockHash: string; packageDir: string; signed: boolean }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; detail: string }
  | { kind: 'unreachable'; detail: string };

/**
 * Parse `new-soul --json`.
 *
 * The envelope carries an explicit `refused` flag. We branch on it — never on
 * the exit code, which is 1 for a refusal and 1 for a genuine failure alike.
 * A refusal misfiled as a failure would tell the user something broke when in
 * fact the engine did its job.
 */
export function parseAuthorOutcome(res: MtsResult): AuthorOutcome {
  if (res.detail && !res.stdout.trim()) {
    return { kind: 'unreachable', detail: res.detail };
  }

  const parsed = tryParse(res.stdout);
  if (parsed) {
    if (parsed.refused === true || (parsed.ok === false && typeof parsed.message === 'string')) {
      return { kind: 'refused', message: String(parsed.message ?? 'REFUSED (no message given)') };
    }
    if (parsed.ok === true && typeof parsed.soul_id === 'string') {
      const receipt = (parsed.receipt ?? {}) as Record<string, unknown>;
      return {
        kind: 'sealed',
        soulId: parsed.soul_id,
        bedrockHash: String(parsed.bedrock_hash ?? ''),
        packageDir: String(parsed.package_dir ?? ''),
        // Rule 2: signed ONLY when the engine names a key. Never inferred.
        signed: typeof receipt.signet_key_id === 'string' && receipt.signet_key_id.length > 0,
      };
    }
  }

  // Plain-text fallback so a version drift degrades into a correct read rather
  // than a fabricated one. `REFUSED:` is the engine's own prefix.
  const text = `${res.stdout}\n${res.stderr}`.trim();
  const refusal = text.split('\n').find((l) => l.trim().startsWith('REFUSED:'));
  if (refusal) {
    return { kind: 'refused', message: refusal.trim() };
  }
  return {
    kind: 'failed',
    detail: firstLine(text || 'mts produced no output') ,
  };
}

// ── Verify outcomes ─────────────────────────────────────────────────────────

/**
 * A soul's seal state, as the engine reports it.
 *
 * 🔴 Rule 2 — hash-sealed and operator-signed are different things and must
 * never render the same. A seal proves provenance; a signature proves
 * authenticity. Saying "signed" for a hash-seal ships the CERTIFIED-≠-veracity
 * trap that held RAVEN at the OMNIS KEY door.
 *
 * Verified against mts on 2026-08-02, there are six outcomes, not two:
 *
 *   signed        VERIFIED, engine names a key id            (Bulma, here)
 *   pre-signet    VERIFIED, sealed before any key existed    (Pan)
 *   unsigned      FAILED, signature missing, chain intact    (Lucca)
 *   untrusted     FAILED, real signature by a key this machine does not trust
 *   unverified    FAILED, signature rejected for some other stated reason
 *   broken        FAILED, bedrock or chain mismatch
 *
 * `untrusted` is NOT `unsigned`, and the difference is not pedantry. A soul
 * signed by a stranger's key reports exactly this on anyone else's machine,
 * because a seal event carries `key_id` and `signature` but NOT the public key
 * — verification needs the verifier's own trust store. Calling that "signature
 * missing" states something false about the artifact: the signature is right
 * there. It is the machine that does not recognise the signer.
 *
 * Collapsing `pre-signet` into `unsigned` would report a healthy grandfathered
 * soul as broken; collapsing anything into `broken` would accuse the operator
 * of tampering. Each is a lie in a different direction.
 */
export type SealKind =
  | 'signed'
  | 'pre-signet'
  | 'unsigned'
  | 'untrusted'
  | 'unverified'
  | 'broken';

export interface SoulVerdict {
  soulId: string;
  verified: boolean;
  seal: SealKind;
  /** The engine's own verdict line, rendered verbatim. */
  message: string;
  keyIds: string[];
  issues: string[];
  chainOk: boolean;
  chainCount: number;
}

export type VerifyReading =
  | { kind: 'verdict'; verdict: SoulVerdict }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'unparseable'; detail: string };

export function parseVerify(soulId: string, res: MtsResult): VerifyReading {
  if (res.detail && !res.stdout.trim()) {
    return { kind: 'unreachable', detail: res.detail };
  }
  const p = tryParse(res.stdout);
  if (!p || typeof p.verdict !== 'string') {
    const text = `${res.stderr}\n${res.stdout}`.trim();
    return { kind: 'unparseable', detail: firstLine(text || 'mts produced no output') };
  }

  const keyIds = Array.isArray(p.signet_key_ids) ? p.signet_key_ids.map(String) : [];
  const issues = Array.isArray(p.issues) ? p.issues.map(String) : [];
  const verified = p.ok === true;
  const preSignet = p.signet_status === 'PRE_SIGNET';
  const chainOk = p.chain_ok === true;

  let seal: SealKind;
  if (verified && keyIds.length > 0) {
    seal = 'signed';
  } else if (verified && preSignet) {
    seal = 'pre-signet';
  } else if (verified) {
    // Verified with neither a key nor a grandfather note. We do not upgrade
    // this to "signed" — absence of a key id means absence of a signature.
    seal = 'pre-signet';
  } else if (chainOk) {
    // Chain intact, signature problem of some kind. Never tampering.
    //
    // The engine reports `verified:false, chain_ok:true, signet_key_ids:[]` for
    // BOTH a missing signature and a present-but-untrusted one, so its issue
    // text is the only thing that separates them. We match its words, and if we
    // do not recognise them we fall back to a vaguer statement that is still
    // true rather than guessing the specific one — an unrecognised wording must
    // never become a confident "signature missing".
    const said = issues.join(' ');
    if (/not trusted|untrusted|not\s+ACTIVE/i.test(said)) {
      seal = 'untrusted';
    } else if (/signature missing/i.test(said)) {
      seal = 'unsigned';
    } else {
      seal = 'unverified';
    }
  } else {
    seal = 'broken';
  }

  return {
    kind: 'verdict',
    verdict: {
      soulId: typeof p.soul_id === 'string' ? p.soul_id : soulId,
      verified,
      seal,
      message: String(p.message ?? (verified ? 'VERIFIED' : 'FAILED')),
      keyIds,
      issues,
      chainOk,
      chainCount: Number(p.chain_count ?? 0),
    },
  };
}

/**
 * The single place the product is allowed to describe a seal in words.
 *
 * Rule 2 lives here so it cannot drift across views. `signed` is returned for
 * exactly one case: the engine named a key id.
 */
export function sealPresentation(seal: SealKind): {
  label: string;
  gloss: string;
  icon: string;
} {
  switch (seal) {
    case 'signed':
      return {
        label: 'operator-signed',
        gloss:
          'Sealed and signed by an operator key the trust store recognises. Provenance and authenticity both attested.',
        icon: 'verified-filled',
      };
    case 'pre-signet':
      return {
        label: 'hash-sealed',
        gloss:
          'Hash-sealed, NOT operator-signed. The bedrock and chain are intact, and the engine is not claiming a signature. Sign it explicitly if you need authenticity as well as provenance.',
        icon: 'shield',
      };
    case 'unsigned':
      return {
        label: 'hash-sealed · signature missing',
        gloss:
          'The chain is intact and no signature is present where the engine expected one. A signature problem, not evidence of tampering.',
        icon: 'unlock',
      };
    case 'untrusted':
      return {
        // Carefully not "signature missing": it is present. And carefully not
        // "operator-signed" either — this machine cannot confirm by whom.
        label: 'signed · signer not trusted here',
        gloss:
          'This soul carries a real signature, but the signing key is not trusted and ACTIVE in this machine\'s trust store, so the engine cannot confirm who sealed it. A seal event carries a key id, never the public key — verification needs the signer\'s key installed here. This is a trust-distribution gap, not evidence of tampering.',
        icon: 'question',
      };
    case 'unverified':
      return {
        label: 'hash-sealed · signature not verified',
        gloss:
          'The chain is intact and the engine declined the signature. Its own words are shown below; this panel will not guess at a more specific reason than it gave.',
        icon: 'unlock',
      };
    case 'broken':
      return {
        label: 'FAILED',
        gloss: 'The engine could not verify this soul. Its own words are shown below.',
        icon: 'error',
      };
  }
}

// ── Souls on this machine ───────────────────────────────────────────────────

export interface SoulRef {
  soulId: string;
  name: string;
}

/**
 * Souls present on disk.
 *
 * This is a directory listing and a name lookup — deliberately NOT a verdict.
 * Every soul listed here is rendered with `unverified` state until the CLI has
 * spoken about it. Presence on disk proves nothing about integrity.
 */
export function listSouls(dir: string): SoulRef[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SoulRef[] = [];
  for (const soulId of entries.sort()) {
    if (!soulId.startsWith('soul_')) {
      continue;
    }
    if (!existsSync(join(dir, soulId, 'soul.md'))) {
      continue;
    }
    out.push({ soulId, name: readSoulName(join(dir, soulId, 'soul.md')) });
  }
  return out;
}

/** Display name only. Read from the soul's own frontmatter, never invented. */
function readSoulName(soulMd: string): string {
  try {
    const text = readFileSync(soulMd, 'utf8').slice(0, 4000);
    const m = /^name:\s*(.+)$/m.exec(text);
    return m ? m[1]!.trim() : '';
  } catch {
    return '';
  }
}

// ── The interview, for presentation only ────────────────────────────────────

export interface InterviewField {
  id: string;
  act: 'I' | 'II' | 'III' | 'IV' | 'V';
  label: string;
  required: boolean;
  minLen: number;
  multiline: boolean;
}

/**
 * Mirror of `mts/lib/new-soul.mjs` INTERVIEW_SCRIPT, for laying out the form.
 *
 * ⚠️ Presentation only. This is NOT a validator and must never become one —
 * the CLI is the authority on what a soul requires. `required`/`minLen` here
 * only drive which fields look optional in the UI. If MTS adds or tightens a
 * field and this list goes stale, the CLI still refuses and we render that
 * refusal verbatim, so the failure mode is an honest refusal rather than a
 * soul that quietly skipped a rule.
 */
export const INTERVIEW: InterviewField[] = [
  { id: 'name', act: 'I', label: "What's their name?", required: true, minLen: 1, multiline: false },
  { id: 'naming_lineage', act: 'I', label: 'Where does the name come from?', required: true, minLen: 20, multiline: true },
  { id: 'pronouns', act: 'I', label: 'Pronouns?', required: true, minLen: 2, multiline: false },
  { id: 'role', act: 'I', label: 'What do they do, and for whom?', required: true, minLen: 10, multiline: true },
  { id: 'operator', act: 'I', label: 'Who operates them?', required: false, minLen: 0, multiline: false },
  { id: 'axiom_origins', act: 'II', label: 'For any axiom — was there a moment that birthed it? (one per line)', required: false, minLen: 0, multiline: true },
  { id: 'signature', act: 'III', label: 'Their signature or sign-off', required: true, minLen: 1, multiline: false },
  { id: 'tone', act: 'III', label: 'How do they sound when they are working correctly?', required: false, minLen: 0, multiline: true },
  { id: 'dedications', act: 'IV', label: 'Who or what do they carry?', required: false, minLen: 0, multiline: true },
  { id: 'relationship', act: 'IV', label: 'How do they relate to their operator?', required: false, minLen: 0, multiline: true },
  { id: 'disciplines', act: 'V', label: 'What disciplines do they hold?', required: false, minLen: 0, multiline: true },
];

export const ACTS: { id: string; title: string }[] = [
  { id: 'I', title: 'Act I — Identity' },
  { id: 'II', title: 'Act II — Refusals' },
  { id: 'III', title: 'Act III — Voice' },
  { id: 'IV', title: 'Act IV — Bonds' },
  { id: 'V', title: 'Act V — Disciplines' },
];

export interface AuthorDraft {
  fields: Record<string, string>;
  axioms: string[];
  exemplarContext: string;
  exemplarOutput: string;
}

/**
 * Build the `--answers-file` payload.
 *
 * Straight transcription of what the user typed. No defaults are injected, no
 * field is invented, and an empty axiom list is passed through to the CLI
 * exactly as empty — so the engine gets to refuse it rather than us quietly
 * fixing it up first.
 */
export function buildAnswers(draft: AuthorDraft): { soul: Record<string, unknown> } {
  const soul: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft.fields)) {
    if (typeof v === 'string' && v.trim()) {
      soul[k] = v.trim();
    }
  }
  soul.axioms = draft.axioms.map((a) => a.trim()).filter(Boolean);
  const ctx = draft.exemplarContext.trim();
  const out = draft.exemplarOutput.trim();
  if (ctx || out) {
    soul.exemplar_raw = `${ctx}\n\n${out}`.trim();
  }
  return { soul };
}

/** argv for a scripted seal. */
export function buildNewSoulArgs(answersPath: string, soulsDirOverride?: string): string[] {
  const args = [
    'new-soul',
    '--non-interactive',
    '--answers-file',
    answersPath,
    '--yes',
    '--json',
  ];
  if (soulsDirOverride?.trim()) {
    args.push('--souls-dir', soulsDirOverride.trim());
  }
  return args;
}

function tryParse(text: string): Record<string, any> | null {
  const t = text.trim();
  if (!t.startsWith('{')) {
    return null;
  }
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function firstLine(s: string): string {
  return s.split('\n')[0]!.slice(0, 400);
}
