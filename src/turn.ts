/**
 * OMNIS CODE turn construction. Pure — no `vscode`, no I/O.
 *
 * ── Three flags this extension must never emit ──────────────────────────────
 * Verified against `omnis-code run --help`, omnis-key 0.1.0:
 *
 *  --provider auto        `auto` is ambient provider discovery. The product's
 *                         stated position is explicit provider selection, and
 *                         the flag DEFAULTS to auto — so omitting it is just as
 *                         wrong as passing it. We always pass an explicit one.
 *  --receipt-full-argv    The engine calls this DANGEROUS: it writes raw bash
 *                         argv into the plaintext ledger. It is off by default
 *                         and this extension never turns it on.
 *  --no-receipts          Opts out of receipting the very thing we exist to show.
 *
 * buildTurnArgs is the single place a turn command line is constructed, so these
 * rules are enforceable by one test rather than by vigilance.
 */

export const FORBIDDEN_FLAGS = ['--receipt-full-argv', '--no-receipts'] as const;

/** `auto` means "discover a provider ambiently" and is never acceptable. */
export const FORBIDDEN_PROVIDER = 'auto';

export class AmbientProviderError extends Error {
  constructor() {
    super(
      'Provider must be chosen explicitly. OMNIS CODE does not auto-detect credentials.',
    );
    this.name = 'AmbientProviderError';
  }
}

export interface TurnOptions {
  message: string;
  /** Explicit provider id. Never "auto", never empty. */
  provider: string;
  cwd?: string;
  model?: string;
}

export function buildTurnArgs(opts: TurnOptions): string[] {
  const provider = opts.provider?.trim();
  if (!provider || provider === FORBIDDEN_PROVIDER) {
    throw new AmbientProviderError();
  }
  const args = ['run', '--ndjson', '--provider', provider];
  if (opts.model?.trim()) {
    args.push('--model', opts.model.trim());
  }
  if (opts.cwd?.trim()) {
    args.push('--cwd', opts.cwd.trim());
  }
  // Message last: it is a positional argument.
  args.push(opts.message);
  return args;
}

/** A provider row from `omnis-code auth status`. */
export interface ProviderStatus {
  id: string;
  available: boolean;
  method: string;
}

/**
 * Parse `omnis-code auth status` (tab-separated). We surface only providers the
 * user has already configured — the picker never implies we found a credential
 * they did not deliberately set up.
 */
export function parseAuthStatus(stdout: string): ProviderStatus[] {
  const rows: ProviderStatus[] = [];
  for (const line of stdout.split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 3) {
      continue;
    }
    const id = (cols[0] ?? '').trim();
    const state = (cols[1] ?? '').trim();
    if (!/^[a-z0-9-]+$/.test(id)) {
      continue;
    }
    rows.push({ id, available: state === 'available', method: (cols[2] ?? '').trim() });
  }
  return rows;
}

export function availableProviders(stdout: string): ProviderStatus[] {
  return parseAuthStatus(stdout).filter((p) => p.available);
}

/** One streamed NDJSON event, reduced to what we are willing to display. */
export interface TurnEvent {
  type: string;
  text?: string;
}

/**
 * Parse NDJSON stream chunks. Unparseable lines are dropped rather than shown
 * raw — a malformed frame could contain anything.
 */
export function parseNdjsonChunk(chunk: string): TurnEvent[] {
  const events: TurnEvent[] = [];
  for (const line of chunk.split('\n')) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const type = typeof o.type === 'string' ? o.type : 'unknown';
      const text =
        typeof o.text === 'string'
          ? o.text
          : typeof o.content === 'string'
            ? o.content
            : undefined;
      events.push({ type, ...(text !== undefined ? { text } : {}) });
    } catch {
      // Not a complete JSON frame yet, or not one at all. Skip it.
    }
  }
  return events;
}
