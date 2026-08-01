import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  AmbientProviderError,
  FORBIDDEN_FLAGS,
  availableProviders,
  buildTurnArgs,
  parseAuthStatus,
  parseNdjsonChunk,
} from '../turn';

const OK = { message: 'add a test', provider: 'claude' };

/**
 * The product's stated position is explicit provider selection. `--provider`
 * DEFAULTS to `auto`, so omitting it is exactly as wrong as passing it.
 */
test('a turn always carries an explicit provider', () => {
  const args = buildTurnArgs(OK);
  const i = args.indexOf('--provider');
  assert.ok(i >= 0, 'turn must pass --provider explicitly');
  assert.equal(args[i + 1], 'claude');
  assert.ok(!args.includes('auto'), 'never pass the ambient auto-detect provider');
});

test('provider "auto" is refused outright', () => {
  assert.throws(() => buildTurnArgs({ ...OK, provider: 'auto' }), AmbientProviderError);
});

test('an empty or whitespace provider is refused', () => {
  assert.throws(() => buildTurnArgs({ ...OK, provider: '' }), AmbientProviderError);
  assert.throws(() => buildTurnArgs({ ...OK, provider: '   ' }), AmbientProviderError);
});

/**
 * `--receipt-full-argv` is documented DANGEROUS by the engine: it writes raw
 * bash argv into the plaintext ledger. `--no-receipts` disables the very thing
 * this extension exists to show.
 */
test('no turn ever emits a receipt-weakening flag', () => {
  const variants = [
    buildTurnArgs(OK),
    buildTurnArgs({ ...OK, model: 'claude-opus-4-8' }),
    buildTurnArgs({ ...OK, cwd: '/tmp/x' }),
    buildTurnArgs({ ...OK, message: '--receipt-full-argv' }),
  ];
  for (const args of variants) {
    for (const flag of FORBIDDEN_FLAGS) {
      // The message is a positional and may legitimately contain any text, so
      // check only the flag positions, not the trailing message.
      const flags = args.slice(0, -1);
      assert.ok(!flags.includes(flag), `turn must never pass ${flag}`);
    }
  }
});

test('the message is passed as a positional, never interpreted as flags', () => {
  const args = buildTurnArgs({ ...OK, message: '--no-receipts --receipt-full-argv' });
  assert.equal(args[args.length - 1], '--no-receipts --receipt-full-argv');
  assert.equal(args.slice(0, -1).includes('--no-receipts'), false);
});

test('model and cwd are forwarded when supplied', () => {
  const args = buildTurnArgs({ ...OK, model: 'claude-opus-4-8', cwd: '/repo' });
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-4-8');
  assert.equal(args[args.indexOf('--cwd') + 1], '/repo');
});

test('turns stream as ndjson so the panel can react during the run', () => {
  assert.ok(buildTurnArgs(OK).includes('--ndjson'));
});

/** Captured from `omnis-code auth status` on 2026-08-01. */
const AUTH = [
  'claude\tavailable\tOAuth\tOAuth (account: `claude-1`)\treadiness: request valid',
  'anthropic-api\tnot_configured\tAPI key\tnot configured\treadiness: not configured',
  'bedrock\tavailable\tAPI key\tBedrock API key\treadiness: credential present',
  'openai\tnot_configured\tOAuth\tnot configured\treadiness: unknown',
].join('\n');

test('only configured providers are offered', () => {
  const avail = availableProviders(AUTH).map((p) => p.id);
  assert.deepEqual(avail, ['claude', 'bedrock']);
  assert.ok(!avail.includes('openai'), 'unconfigured providers must not be offered');
});

test('auth parsing ignores banner and malformed lines', () => {
  const rows = parseAuthStatus('some banner text\n\nclaude\tavailable\tOAuth\tx\ty');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, 'claude');
});

test('ndjson parsing drops malformed frames rather than showing them raw', () => {
  const events = parseNdjsonChunk(
    ['{"type":"text","text":"hello"}', '{"type":"tool"', 'not json', ''].join('\n'),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'text');
  assert.equal(events[0]!.text, 'hello');
});
