/**
 * Adapter over the omnis-key CLI. No `vscode` import — keeps it unit-testable
 * and portable into a Code-OSS fork unchanged.
 *
 * Rule: engine unreachable → say `unreachable`. Never a cached, defaulted, or
 * guessed state.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChainState, classify, parseEnvelope } from './protocol';
import { SafeReceiptRow, parseLedger } from './ledger';

const TIMEOUT_MS = 10_000;

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * GUI-launched editors on macOS do not inherit the login shell's PATH, so a
 * user-local install at ~/.local/bin is invisible even though it works in a
 * terminal. Probe the known locations rather than reporting a false
 * "engine not installed".
 */
export function candidateEnginePaths(env = process.env): string[] {
  const home = homedir();
  const out: string[] = [];
  if (env.OMNIS_CODE_ENGINE_PATH) {
    out.push(env.OMNIS_CODE_ENGINE_PATH);
  }
  out.push(
    join(home, '.local', 'bin', 'omnis-key'),
    join(home, '.cargo', 'bin', 'omnis-key'),
    '/usr/local/bin/omnis-key',
    '/opt/homebrew/bin/omnis-key',
  );
  return out;
}

export function resolveEnginePath(configured?: string): string | null {
  if (configured && configured.trim()) {
    return existsSync(configured) ? configured : null;
  }
  for (const p of candidateEnginePaths()) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

export function jcodeHome(env = process.env): string {
  return env.JCODE_HOME || join(homedir(), '.jcode');
}

export function ledgerPath(env = process.env): string {
  return join(jcodeHome(env), 'state', 'omnis-key', 'receipts.jsonl');
}

function run(bin: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      // A non-zero exit is product surface here, not a failure: exit 3 carries
      // RECEIPT_CHAIN_INVALID. Resolve with the code rather than throwing.
      const code =
        err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number'
          ? ((err as unknown as { code: number }).code)
          : err
            ? null
            : 0;
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
    });
  });
}

export interface ChainReading {
  state: ChainState;
  /** Raw exit code, surfaced verbatim. Never swallowed into a generic failure. */
  exitCode: number | null;
  raw: string;
}

export async function readChain(enginePath: string | null): Promise<ChainReading> {
  if (!enginePath) {
    return {
      state: {
        kind: 'unreachable',
        detail:
          'omnis-key not found. Set "omnisCode.enginePath" to its full path (VS Code does not inherit your shell PATH on macOS).',
      },
      exitCode: null,
      raw: '',
    };
  }

  const res = await run(enginePath, ['receipts', 'status', '--json']);
  const env = parseEnvelope(res.stdout);
  if (!env) {
    const detail = res.stderr.trim() || res.stdout.trim() || 'engine produced no output';
    return {
      state: { kind: 'unreachable', detail: firstLine(detail) },
      exitCode: res.code,
      raw: res.stdout,
    };
  }
  return { state: classify(env), exitCode: res.code, raw: res.stdout };
}

export async function verifyChain(enginePath: string | null): Promise<ChainReading> {
  if (!enginePath) {
    return {
      state: { kind: 'unreachable', detail: 'omnis-key not found.' },
      exitCode: null,
      raw: '',
    };
  }
  const res = await run(enginePath, ['receipts', 'verify', '--json']);
  const env = parseEnvelope(res.stdout);
  if (!env) {
    return {
      state: {
        kind: 'unreachable',
        detail: firstLine(res.stderr.trim() || 'engine produced no output'),
      },
      exitCode: res.code,
      raw: res.stdout,
    };
  }
  return { state: classify(env), exitCode: res.code, raw: res.stdout };
}

/**
 * Entries for display. Returns [] on any read problem — the caller only ever
 * renders these under an engine-issued VALID verdict, so an empty list can
 * never masquerade as a healthy chain.
 */
export async function readEntries(env = process.env): Promise<SafeReceiptRow[]> {
  try {
    return parseLedger(await readFile(ledgerPath(env), 'utf8'));
  } catch {
    return [];
  }
}

function firstLine(s: string): string {
  return s.split('\n')[0]!.slice(0, 300);
}
