/**
 * Claim Ledger protocol — pure. No `vscode` import, no I/O.
 *
 * ── The load-bearing idea ───────────────────────────────────────────────────
 * A refusal is a SUCCESSFUL turn. `REFUSED_NO_VERIFIER "this is faster"` means
 * the system declined to assert something it cannot ground. That is the product
 * working. It gets its own visual weight — never an error icon, never a warning
 * triangle, never a red squiggle.
 *
 * Only REFUTED is a failure: the agent claimed something and the codebase
 * disproved it.
 *
 * ── Redaction, and why it is stricter here than for receipts ────────────────
 * The receipt ledger redacts at the source (argv_program + argv_sha256, never
 * argv_full). The CLAIM ledger does not: `verification.evidence` carries the
 * full command argv, stdout/stderr excerpts, and an absolute cwd. Verified
 * against omnis-key 0.1.0 on 2026-08-01.
 *
 * So this module renders NOTHING from `evidence` except the verifier name and
 * exit code. The bound/decision strings are static verifier descriptions and
 * are safe. Everything else is dropped.
 */

/** Verified vocabulary, read from `claims status`.verdict_vocabulary. */
export const VERDICT_VOCABULARY = [
  'CERTIFIED',
  'REFUTED',
  'REFUSED_NO_VERIFIER',
  'REFUSED_UNRESOLVED',
  'UNGROUNDED',
] as const;

export type Verdict = (typeof VERDICT_VOCABULARY)[number];

/**
 * How a verdict should read on the glass.
 *
 * `weight` drives icon choice in the view. It is deliberately NOT a severity
 * scale: `refusal` and `ungrounded` are not lesser forms of `failure`.
 */
export type VerdictWeight = 'grounded' | 'failure' | 'refusal' | 'ungrounded';

export interface VerdictPresentation {
  weight: VerdictWeight;
  /** Plain-language gloss. Never implies a refusal was an error. */
  gloss: string;
}

export function present(verdict: string): VerdictPresentation {
  switch (verdict) {
    case 'CERTIFIED':
      return { weight: 'grounded', gloss: 'Grounded in the codebase.' };
    case 'REFUTED':
      return { weight: 'failure', gloss: 'The codebase disproved this claim.' };
    case 'REFUSED_NO_VERIFIER':
      return {
        weight: 'refusal',
        gloss: 'Refused — no verifier exists for this kind of claim, so it was not asserted.',
      };
    case 'REFUSED_UNRESOLVED':
      return {
        weight: 'refusal',
        gloss: 'Refused — the claim could not be resolved, so it was not asserted.',
      };
    case 'UNGROUNDED':
      return {
        weight: 'ungrounded',
        gloss: 'Not falsifiable, so it carries no grounding either way.',
      };
    default:
      return { weight: 'ungrounded', gloss: `Unrecognized verdict: ${verdict}` };
  }
}

/** A refusal is a successful turn, not a failure. */
export function isRefusal(verdict: string): boolean {
  return present(verdict).weight === 'refusal';
}

/** Only REFUTED is a genuine failure. */
export function isFailure(verdict: string): boolean {
  return present(verdict).weight === 'failure';
}

export interface SafeOutcome {
  claimId: string;
  kindName: string;
  verdict: string;
  /** The claim as stated, e.g. "this is faster". Author-supplied, not machine output. */
  surface: string;
  /** Why the engine reached this verdict. A static verifier string. */
  reason: string;
  /** Verifier name only — never the command, stdout, stderr, or cwd. */
  verifier?: string;
  exitCode?: number;
  /** Scope disclaimer, e.g. "exit code only — does not interpret build output". */
  bound?: string;
  decision?: string;
  entryHash?: string;
  sequence?: number;
}

export interface ClaimsSummary {
  code: string;
  certified: number;
  refused: number;
  ungrounded: number;
  anyRefuted: boolean;
  outcomes: SafeOutcome[];
}

/** Free text we are willing to show. Rejects anything secret-shaped. */
function safeText(v: unknown, max = 300): string {
  if (typeof v !== 'string') {
    return '';
  }
  const t = v.slice(0, max);
  // Defense in depth: never surface a token-shaped string even from a field we
  // otherwise trust.
  if (/sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|Bearer\s+\S+|AKIA[0-9A-Z]{12,}/i.test(t)) {
    return '[redacted]';
  }
  return t;
}

function safeIdent(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : undefined;
}

export function toSafeOutcome(raw: Record<string, unknown>): SafeOutcome {
  const receipt = (raw.receipt ?? {}) as Record<string, unknown>;
  const verification = (raw.verification ?? {}) as Record<string, unknown>;
  // NOTE: `evidence` holds full argv, stdout/stderr and cwd. We read exactly
  // two scalars out of it and never the rest.
  const evidence = (verification.evidence ?? {}) as Record<string, unknown>;

  return {
    claimId: safeText(raw.claim_id, 64) || '—',
    kindName: safeText(raw.kind_name, 64) || '—',
    verdict: safeText(raw.verdict, 40) || 'UNKNOWN',
    surface: safeText(raw.surface),
    reason: safeText(raw.reason),
    verifier: safeIdent(evidence.verifier),
    exitCode: typeof evidence.exit_code === 'number' ? evidence.exit_code : undefined,
    bound: safeText(verification.bound),
    decision: safeIdent(verification.decision),
    entryHash: safeIdent(receipt.entry_hash),
    sequence: typeof receipt.seq === 'number' ? receipt.seq : undefined,
  };
}

/** Parse a `claims verify --json` envelope into safe, renderable outcomes. */
export function parseClaimsVerify(stdout: string): ClaimsSummary | null {
  let env: Record<string, unknown>;
  try {
    env = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof env.code !== 'string') {
    return null;
  }
  const data = (env.data ?? {}) as Record<string, unknown>;
  const rawOutcomes = Array.isArray(data.outcomes) ? data.outcomes : [];
  return {
    code: env.code,
    certified: Number(data.certified_count ?? 0),
    refused: Number(data.refused_count ?? 0),
    ungrounded: Number(data.ungrounded_count ?? 0),
    anyRefuted: Boolean(data.any_refuted),
    outcomes: rawOutcomes.map((o) => toSafeOutcome(o as Record<string, unknown>)),
  };
}

export interface ClaimChainState {
  kind: 'valid' | 'invalid' | 'empty' | 'unsafe' | 'unreachable';
  code: string;
  entryCount?: number;
  headSha256?: string;
  detail?: string;
}

/**
 * The claim ledger reports the same first-install state the receipt ledger does.
 *
 * An earlier version of this function mapped everything that was not
 * CLAIM_CHAIN_VALID to `invalid` — which rendered a brand-new install as a
 * tampered claim chain. That is the exact bug this codebase branches on `code`
 * to avoid for receipts, reproduced one panel over. Caught by a fresh-install
 * probe, not by reasoning.
 */
export function parseClaimsStatus(stdout: string): ClaimChainState | null {
  let env: Record<string, unknown>;
  try {
    env = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof env.code !== 'string') {
    return null;
  }
  const data = (env.data ?? {}) as Record<string, unknown>;
  switch (env.code) {
    case 'CLAIM_CHAIN_VALID':
      return {
        kind: 'valid',
        code: env.code,
        entryCount: Number(data.entry_count ?? 0),
        headSha256: typeof data.head_sha256 === 'string' ? data.head_sha256 : undefined,
      };
    case 'EMPTY_NOT_YET_EVIDENCED':
      return { kind: 'empty', code: env.code };
    case 'RECEIPT_STATE_UNSAFE':
    case 'CLAIM_STATE_UNSAFE':
      return { kind: 'unsafe', code: env.code };
    case 'CLAIM_CHAIN_INVALID':
      return { kind: 'invalid', code: env.code };
    default:
      // An unrecognized code is not a verdict. Report it verbatim rather than
      // guessing which side of valid/invalid it falls on.
      return { kind: 'unreachable', code: env.code, detail: `unrecognized code ${env.code}` };
  }
}
