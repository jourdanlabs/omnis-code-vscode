/**
 * GATE CRITERION 6 — the overclaim sweep, automated.
 *
 * "An extension can observe. Only a fork can gate."
 *
 * No user-visible string may imply this extension blocks, prevents, or refuses
 * anything on the user's behalf. A README overclaim once survived four gates;
 * this test exists so the next one fails CI instead.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Phrases that assert this software stops something. Matched case-insensitively
 * against user-visible copy.
 */
const OVERCLAIMS: RegExp[] = [
  /\bblocks?\s+(the\s+)?(write|agent|edit|command|action)/i,
  /\bprevents?\s+(the\s+)?(write|agent|edit|command|action|it)/i,
  /\bstops?\s+(the\s+)?(agent|write|edit)/i,
  /\brefuses?\s+to\s+(let|allow|permit)/i,
  /\bthe\s+IDE\s+that\s+refuses/i,
  /\benforces?\b/i,
  /\bgates?\s+(the\s+)?(write|agent|edit)/i,
  /\bwon'?t\s+let\s+(the\s+)?agent/i,
  /\bintercepts?\s+(the\s+)?(write|agent)/i,
  /\bguarantees?\s+(that\s+)?(no|nothing)/i,
];

/** Copy that is user-visible: docs, manifest, and any string in source. */
function userVisibleFiles(): string[] {
  const files = [join(ROOT, 'README.md'), join(ROOT, 'package.json')];
  const src = join(ROOT, 'src');
  for (const f of readdirSync(src)) {
    if (f.endsWith('.ts')) {
      files.push(join(src, f));
    }
  }
  return files;
}

test('no user-visible string claims this extension blocks anything', () => {
  const hits: string[] = [];
  for (const file of userVisibleFiles()) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      // The "does not do" section states these phrases in order to deny them.
      // A denial is the opposite of an overclaim, so allow explicit negations.
      if (/\bdoes not\b|\bcannot\b|\bnot\b .*\bblock\b|\bno extension\b/i.test(line)) {
        return;
      }
      for (const rx of OVERCLAIMS) {
        if (rx.test(line)) {
          hits.push(`${file.replace(ROOT + '/', '')}:${i + 1}  ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(hits, [], `overclaim(s) found:\n${hits.join('\n')}`);
});

test('the README states the observe/gate boundary explicitly', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /can observe/i);
  assert.match(readme, /cannot gate/i);
  assert.match(
    readme,
    /does not block writes/i,
    'the README must deny the blocking claim in plain words',
  );
});

test('the canonical tagline is unchanged in both README and manifest', () => {
  const TAGLINE = 'Proves what it did, or refuses to say.';
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    description: string;
    displayName: string;
    publisher: string;
  };
  assert.ok(readme.includes(TAGLINE), 'README must carry the canon tagline verbatim');
  assert.equal(pkg.description, TAGLINE, 'marketplace description must be the canon tagline');
  assert.equal(pkg.displayName, 'OMNIS CODE — AI agent receipts');
  assert.equal(pkg.publisher, 'jourdanlabs');
});

/**
 * The panel must never label a state with a word the engine did not emit.
 * Every rendered status label is an engine code or an explicit no-verdict.
 */
test('status labels are engine codes or explicit no-verdict banners', () => {
  const view = readFileSync(join(ROOT, 'src', 'receiptsView.ts'), 'utf8');
  const labels = [...view.matchAll(/label = '([A-Z_ ]+)';/g)].map((m) => m[1]!);
  const allowed = new Set([
    'RECEIPT_CHAIN_VALID',
    'RECEIPT_CHAIN_INVALID',
    'RECEIPT_STATE_UNSAFE',
    'EMPTY_NOT_YET_EVIDENCED',
    'ENGINE UNREACHABLE',
    'UNRECOGNIZED ENGINE OUTPUT',
  ]);
  assert.ok(labels.length >= 6, 'expected a label for every chain state');
  for (const l of labels) {
    assert.ok(allowed.has(l), `unapproved status label: ${l}`);
  }
});
