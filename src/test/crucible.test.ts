import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ageLabel,
  isStale,
  newestScanDir,
  parsePipeline,
  parseScanTimestamp,
} from '../crucible';

const SECRET = 'sk-live-DEADBEEF-CAPTAIN-CREDENTIAL-9f3a';

const PIPELINE = JSON.stringify({
  target: {
    id: 'app-114f39d9',
    name: 'app',
    root_path: '/Users/sokpyeon/projects/bacchus-audit/bacchus-rush/app',
  },
  leg1_vantage: {
    verdict: 'APPROVED',
    score: 0.8944,
    summary: 'Analyzed 22 files, 87 functions.',
    files_analyzed: 22,
    issues: [
      {
        severity: 'MED',
        file: 'bacchus/academy/dish/page.tsx',
        line: 34,
        description: 'DishMasteryPage() is 132 lines long (limit: 100)',
        fix: 'Decompose DishMasteryPage() into smaller functions',
      },
    ],
  },
  pipeline_receipt_sha256: 'd'.repeat(64),
});

test('parses a real pipeline.json into findings', () => {
  const s = parsePipeline('app-20260705-191343', PIPELINE)!;
  assert.equal(s.verdict, 'APPROVED');
  assert.equal(s.findings.length, 1);
  assert.equal(s.findings[0]!.file, 'bacchus/academy/dish/page.tsx');
  assert.equal(s.findings[0]!.line, 34);
  assert.equal(s.filesAnalyzed, 22);
});

/** target.root_path is absolute and identifies the user. It must never render. */
test('the absolute root_path never reaches a scan result', () => {
  const s = parsePipeline('app-20260705-191343', PIPELINE)!;
  const blob = JSON.stringify(s);
  assert.ok(!blob.includes('/Users/'), 'absolute path leaked from CRUCIBLE target');
  assert.ok(!blob.includes('bacchus-audit'));
});

test('absolute or traversing finding paths are dropped, not rendered as links', () => {
  const evil = JSON.stringify({
    target: { name: 'x' },
    leg1_vantage: {
      verdict: 'APPROVED',
      issues: [
        { severity: 'MED', file: '/etc/passwd', line: 1, description: 'x' },
        { severity: 'MED', file: '../../../.ssh/id_rsa', line: 1, description: 'x' },
        { severity: 'MED', file: 'ok/real.ts', line: 2, description: 'fine' },
      ],
    },
  });
  const s = parsePipeline('x-20260705-191343', evil)!;
  assert.equal(s.findings.length, 1);
  assert.equal(s.findings[0]!.file, 'ok/real.ts');
});

test('a secret in a finding description is redacted', () => {
  const j = JSON.stringify({
    target: { name: 'x' },
    leg1_vantage: {
      verdict: 'APPROVED',
      issues: [{ severity: 'HIGH', file: 'a.ts', line: 1, description: `key ${SECRET}` }],
    },
  });
  const s = parsePipeline('x-20260705-191343', j)!;
  assert.ok(!JSON.stringify(s).includes(SECRET));
});

test('a scan timestamp is parsed from the directory name', () => {
  const d = parseScanTimestamp('app-20260705-191343')!;
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth() + 1, 7);
  assert.equal(d.getDate(), 5);
});

/** An unknown scan time must read as unknown — never as "now". */
test('an unparseable scan name yields null, and reads as unknown and stale', () => {
  assert.equal(parseScanTimestamp('weird-name'), null);
  assert.equal(ageLabel(null, new Date()), 'scan time unknown');
  assert.equal(isStale(null, new Date()), true);
});

test('stored results older than a day are flagged stale', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  assert.equal(isStale(new Date('2026-08-01T11:00:00Z'), now), false);
  assert.equal(isStale(new Date('2026-07-28T11:00:00Z'), now), true);
});

test('age labels never imply a stored scan is live', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  assert.equal(ageLabel(new Date('2026-08-01T11:00:00Z'), now), 'scanned 1h ago');
  assert.equal(ageLabel(new Date('2026-07-30T12:00:00Z'), now), 'scanned 2d ago');
});

test('the newest scan for a repo is selected by timestamp, not by listing order', () => {
  const dirs = ['app-20260705-191343', 'app-20260801-090000', 'other-20261231-235959'];
  assert.equal(newestScanDir(dirs, 'app'), 'app-20260801-090000');
  assert.equal(newestScanDir(dirs, 'nothing'), null);
});

test('malformed pipeline JSON yields null, never a partial verdict', () => {
  assert.equal(parsePipeline('x-20260705-191343', 'not json'), null);
  assert.equal(parsePipeline('x-20260705-191343', '{}'), null);
});

/** If the operator's real scan is present, parse it for real. */
const REAL = join(homedir(), 'crucible-scans', 'app-20260705-191343', 'pipeline.json');
test(
  'the operator real stored scan parses',
  { skip: existsSync(REAL) ? false : 'no stored scan' },
  () => {
    const s = parsePipeline('app-20260705-191343', readFileSync(REAL, 'utf8'))!;
    assert.ok(s, 'real scan failed to parse');
    assert.equal(s.verdict, 'APPROVED');
    assert.ok(s.findings.length >= 1);
    assert.ok(!JSON.stringify(s).includes('/Users/'));
  },
);
