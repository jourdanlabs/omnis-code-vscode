/**
 * Adapter over the omnis-key CLI. No `vscode` import — keeps it unit-testable
 * and portable into a Code-OSS fork unchanged.
 *
 * Rule: engine unreachable → say `unreachable`. Never a cached, defaulted, or
 * guessed state.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  MISSING_CRUCIBLE,
  MISSING_OMNIS_CODE,
  MISSING_OMNIS_KEY,
} from './missing';
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

/**
 * The configured engine path, pushed in from the view layer so this module
 * stays free of any `vscode` import (and therefore unit-testable and portable
 * into a Code-OSS fork).
 */
let configuredEnginePath: string | undefined;

export function setConfiguredEnginePath(p: string | undefined): void {
  configuredEnginePath = p;
}

export interface EngineResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Populated when we could not talk to the engine at all. */
  detail?: string;
}

/** Generic invocation. Non-zero exits are returned, never thrown or swallowed. */
export async function runEngine(args: string[]): Promise<EngineResult> {
  const bin = resolveEnginePath(configuredEnginePath);
  if (!bin) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      detail: MISSING_OMNIS_KEY,
    };
  }
  const res = await run(bin, args);
  return {
    stdout: res.stdout,
    stderr: res.stderr,
    exitCode: res.code,
    detail: res.stdout.trim() ? undefined : firstLine(res.stderr.trim() || 'engine produced no output'),
  };
}

/**
 * Locate a sibling of omnis-key (`omnis-code`, `crucible-scan`).
 *
 * Prefer the directory of a configured engine path so a user who pointed
 * `omnisCode.enginePath` at a non-PATH install does not then lose the
 * siblings that live next to it.
 */
export function resolveSiblingBinary(name: 'omnis-code' | 'crucible-scan'): string | null {
  const configured = configuredEnginePath?.trim();
  if (configured) {
    const sibling = join(dirname(configured), name);
    if (existsSync(sibling)) {
      return sibling;
    }
  }
  for (const p of candidateEnginePaths()) {
    const sibling = p.replace(/omnis-key$/, name);
    if (existsSync(sibling)) {
      return sibling;
    }
  }
  return null;
}

export function resolveAgentPath(): string | null {
  return resolveSiblingBinary('omnis-code');
}

/** Streams a long-running agent process, surfacing output as it arrives. */
/** One-shot agent invocation (e.g. `auth status`). */
export async function runAgent(args: string[]): Promise<EngineResult> {
  const bin = resolveAgentPath();
  if (!bin) {
    return { stdout: '', stderr: '', exitCode: null, detail: MISSING_OMNIS_CODE };
  }
  const res = await run(bin, args);
  return { stdout: res.stdout, stderr: res.stderr, exitCode: res.code };
}

export function streamAgent(
  args: string[],
  onData: (chunk: string) => void,
  cwd?: string,
): { done: Promise<number | null>; cancel: () => void } {
  const bin = resolveAgentPath();
  if (!bin) {
    onData(`${MISSING_OMNIS_CODE}\n`);
    return { done: Promise.resolve(null), cancel: () => undefined };
  }
  const child = spawn(bin, args, { cwd });
  child.stdout.on('data', (d: Buffer) => onData(d.toString()));
  child.stderr.on('data', (d: Buffer) => onData(d.toString()));
  const done = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', (e) => {
      onData(`\n${e.message}\n`);
      resolve(null);
    });
  });
  return { done, cancel: () => child.kill() };
}

export function resolveScannerPath(): string | null {
  return resolveSiblingBinary('crucible-scan');
}

/**
 * Long-running CRUCIBLE scan (30–150s). Streams progress, cancellable, and
 * never blocks. The exit code is reported but is NOT proof of success:
 * crucible-scan exits 0 even when given a bad argument.
 */
export function streamScan(
  repoPath: string,
  onData: (chunk: string) => void,
): { done: Promise<number | null>; cancel: () => void } {
  const bin = resolveScannerPath();
  if (!bin) {
    onData(`${MISSING_CRUCIBLE}\n`);
    return { done: Promise.resolve(null), cancel: () => undefined };
  }
  const child = spawn(bin, [repoPath]);
  child.stdout.on('data', (d: Buffer) => onData(d.toString()));
  child.stderr.on('data', (d: Buffer) => onData(d.toString()));
  const done = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', (e) => {
      onData(`\n${e.message}\n`);
      resolve(null);
    });
  });
  return { done, cancel: () => child.kill() };
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
        detail: MISSING_OMNIS_KEY,
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
      state: { kind: 'unreachable', detail: MISSING_OMNIS_KEY },
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

/**
 * Watch the receipt ledger and fire when it changes.
 *
 * We watch the containing directory rather than the file: the ledger may not
 * exist yet on a fresh install, and an atomic rewrite would break a watch bound
 * to the original inode. Debounced, because one append can emit several events.
 */
export function watchLedger(
  onChange: () => void,
  env = process.env,
  debounceMs = 150,
): { close: () => void } {
  const dir = join(jcodeHome(env), 'state', 'omnis-key');
  let timer: NodeJS.Timeout | undefined;
  let watcher: import('node:fs').FSWatcher | undefined;

  const fire = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(onChange, debounceMs);
  };

  try {
    watcher = watch(dir, (_event, filename) => {
      if (!filename || filename.toString().startsWith('receipts.jsonl')) {
        fire();
      }
    });
  } catch {
    // No state directory yet. The panel still works; it just will not
    // auto-refresh until something creates one. We do not pretend otherwise.
  }

  return {
    close: () => {
      if (timer) {
        clearTimeout(timer);
      }
      watcher?.close();
    },
  };
}
