/**
 * In-host verification. Runs inside a real VS Code extension host, against the
 * real `vscode` module and the real omnis-key binary.
 *
 * This is what separates "the logic is right" from "the panel renders it."
 * Unit tests cannot load `vscode`; only this can.
 */
import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import type { OmnisCodeApi } from '../../extension';

type Case = { name: string; fn: () => Promise<void> | void; skip?: string | false };
const cases: Case[] = [];
function test(
  name: string,
  optsOrFn: { skip?: string | false } | (() => Promise<void> | void),
  maybeFn?: () => Promise<void> | void,
): void {
  if (typeof optsOrFn === 'function') {
    cases.push({ name, fn: optsOrFn });
  } else {
    cases.push({ name, fn: maybeFn!, skip: optsOrFn.skip });
  }
}

const EXT_ID = 'jourdanlabs.omnis-code';

async function api(): Promise<OmnisCodeApi> {
  const ext = vscode.extensions.getExtension<OmnisCodeApi>(EXT_ID);
  assert.ok(ext, `extension ${EXT_ID} not found in host`);
  const activated = (await ext.activate()) as OmnisCodeApi;
  assert.ok(activated?.provider, 'activate() returned no provider');
  return activated;
}

/** Render a tree item the way the sidebar would, so we assert on real output. */
async function renderTree(): Promise<{ label: string; description: string }[]> {
  const { provider } = await api();
  await provider.refresh();
  const children = provider.getChildren();
  const out: { label: string; description: string }[] = [];
  for (const child of children) {
    const item = await provider.getTreeItem(child);
    const label =
      typeof item.label === 'string' ? item.label : (item.label?.label ?? '');
    out.push({ label, description: String(item.description ?? '') });
  }
  return out;
}

/**
 * Set OMNIS_EXPECT_STATE to assert the exact first-row verdict on a JCODE_HOME
 * that has never existed. Declared FIRST on purpose: later tests (notably the
 * refusal demo) write to the ledger directory, so a pristine assertion has to
 * run before any of them.
 */
const EXPECT = process.env.OMNIS_EXPECT_STATE;

test(
  'first-run state matches expectation',
  { skip: EXPECT ? false : 'not a fresh-install run' },
  async () => {
    const rows = await renderTree();
    const status = rows[0]!;
    assert.equal(status.label, EXPECT, `fresh install must read ${EXPECT}`);
    assert.notEqual(
      status.label,
      'RECEIPT_CHAIN_INVALID',
      'a fresh install must never read as tampered',
    );
    const entryRows = rows.slice(1).filter((r) => /^\d+\s{2}agent\./.test(r.label));
    assert.equal(entryRows.length, 0, 'a fresh install has no entries to show');
    console.log(`    ↳ fresh-install receipts: ${status.label}`);
  },
);

/**
 * The label was covered; the MARK was not.
 *
 * A fresh install reading EMPTY_NOT_YET_EVIDENCED under a red error icon still
 * tells a new user something is wrong, whatever the words say. This assertion
 * exists because the suite stayed green when only the label was checked.
 */
test(
  'a fresh install carries no alarming mark',
  { skip: EXPECT === 'EMPTY_NOT_YET_EVIDENCED' ? false : 'not a fresh engine-present run' },
  async () => {
    const { provider } = await api();
    await provider.refresh();
    const item = await provider.getTreeItem(provider.getChildren()[0]!);
    const icon = item.iconPath instanceof vscode.ThemeIcon ? item.iconPath.id : '';
    for (const alarming of ['error', 'warning', 'testing-failed-icon', 'close']) {
      assert.notEqual(icon, alarming, `a healthy fresh install must not wear "${alarming}"`);
    }
    const colour =
      item.iconPath instanceof vscode.ThemeIcon
        ? ((item.iconPath.color as { id?: string } | undefined)?.id ?? '')
        : '';
    assert.ok(
      !/failed|error/i.test(colour),
      `a healthy fresh install must not be coloured as failed (got "${colour}")`,
    );
    assert.equal(String(item.contextValue), 'chain-empty');
    assert.match(
      String(item.tooltip ?? ''),
      /not a broken chain/i,
      'the tooltip must say plainly that this is not a break',
    );
    console.log(`    ↳ fresh-install mark: ${icon || '(none)'}  colour: ${colour || '(none)'}`);
  },
);

/** The same first-install question for the claims panel, which got it wrong. */
test(
  'first-run claims chain is not rendered as invalid',
  { skip: EXPECT ? false : 'not a fresh-install run' },
  async () => {
    const { claims } = await api();
    await claims.refresh();
    const first = await claims.getTreeItem(claims.getChildren()[0]!);
    const label = typeof first.label === 'string' ? first.label : '';
    assert.notEqual(
      String(first.contextValue),
      'claimchain-invalid',
      'a fresh install must not read as a tampered claim chain',
    );
    console.log(`    ↳ fresh-install claims: ${label} (${String(first.contextValue)})`);
  },
);

test('the extension activates in a real host', async () => {
  const { provider } = await api();
  assert.ok(provider);
});

test('all four commands are registered with the host', async () => {
  await api();
  const all = await vscode.commands.getCommands(true);
  for (const id of [
    'omnisCode.receipts.refresh',
    'omnisCode.receipts.verify',
    'omnisCode.receipts.copyHead',
    'omnisCode.receipts.copyRemedy',
  ]) {
    assert.ok(all.includes(id), `command not registered: ${id}`);
  }
});

test('the tree view is registered and resolves without throwing', async () => {
  const rows = await renderTree();
  assert.ok(rows.length >= 1, 'tree produced no rows');
});

test('the panel renders a real engine verdict as its first row', async () => {
  const rows = await renderTree();
  const status = rows[0]!;
  const known = [
    'RECEIPT_CHAIN_VALID',
    'RECEIPT_CHAIN_INVALID',
    'RECEIPT_STATE_UNSAFE',
    'EMPTY_NOT_YET_EVIDENCED',
    'ENGINE UNREACHABLE',
    'UNRECOGNIZED ENGINE OUTPUT',
  ];
  assert.ok(
    known.includes(status.label),
    `first row must be an engine verdict, got ${JSON.stringify(status.label)}`,
  );
  console.log(`    ↳ panel status: ${status.label}  ${status.description}`);
});

/**
 * The honesty invariant, observed at the rendering layer rather than inferred:
 * entry rows appear only beneath a VALID verdict.
 */
test('entry rows appear only beneath a VALID verdict', async () => {
  const rows = await renderTree();
  const status = rows[0]!;
  const entryRows = rows.slice(1).filter((r) => /^\d+\s{2}agent\./.test(r.label));
  if (status.label === 'RECEIPT_CHAIN_VALID') {
    assert.ok(entryRows.length > 0, 'VALID chain rendered no entries');
    console.log(`    ↳ ${entryRows.length} entry rows rendered`);
  } else {
    assert.equal(entryRows.length, 0, `entries leaked under ${status.label}`);
  }
});

test('the verify command executes in-host without throwing', async () => {
  await api();
  await vscode.commands.executeCommand('omnisCode.receipts.verify');
});

/** No rendered string may carry a raw credential. */
test('no rendered row contains a secret-shaped string', async () => {
  const rows = await renderTree();
  const blob = JSON.stringify(rows);
  for (const rx of [/sk-[A-Za-z0-9_-]{8,}/, /Bearer\s+\S+/i, /ghp_[A-Za-z0-9]{8,}/]) {
    assert.ok(!rx.test(blob), `secret-shaped string rendered: ${rx}`);
  }
});

// ── P2: claims ──────────────────────────────────────────────────────────────

test('the claims view renders the claim chain', async () => {
  const { claims } = await api();
  await claims.refresh();
  const rows = claims.getChildren();
  const first = await claims.getTreeItem(rows[0]!);
  const label = typeof first.label === 'string' ? first.label : '';
  assert.ok(
    ['CLAIM_CHAIN_VALID', 'EMPTY_NOT_YET_EVIDENCED', 'ENGINE UNREACHABLE'].includes(label),
    `unexpected claim chain label: ${label}`,
  );
  console.log(`    ↳ claims: ${label}  ${String(first.description ?? '')}`);
});

/**
 * The product cell: a refusal renders as a verdict with its own weight, and
 * never as an error.
 */
test('a refusal renders as a verdict, not an error', { skip: EXPECT === 'ENGINE UNREACHABLE' ? 'no engine to refuse with' : false }, async () => {
  const { claims } = await api();
  await claims.showRefusal();
  const summary = claims.lastSummary;
  assert.ok(summary, 'refuse-demo produced no summary');
  assert.ok(summary!.refused >= 1, 'expected at least one refusal');

  const rows = claims.getChildren();
  const rendered: { label: string; icon: string; context: string }[] = [];
  for (const r of rows) {
    const item = await claims.getTreeItem(r);
    const label = typeof item.label === 'string' ? item.label : '';
    const icon = item.iconPath instanceof vscode.ThemeIcon ? item.iconPath.id : '';
    rendered.push({ label, icon, context: String(item.contextValue ?? '') });
  }

  const refusal = rendered.find((r) => r.label === 'REFUSED_NO_VERIFIER');
  assert.ok(refusal, 'the refusal verdict was not rendered');
  assert.equal(refusal!.icon, 'circle-slash', 'refusal must have its own mark');
  assert.notEqual(refusal!.icon, 'error', 'a refusal must never carry the error icon');
  assert.notEqual(refusal!.icon, 'warning', 'a refusal must never carry a warning icon');
  assert.equal(refusal!.context, 'verdict-refusal');

  const ungrounded = rendered.find((r) => r.label === 'UNGROUNDED');
  assert.ok(ungrounded, 'the ungrounded verdict was not rendered');
  assert.notEqual(ungrounded!.icon, 'error');
  console.log(
    `    ↳ refusal icon: ${refusal!.icon}   ungrounded icon: ${ungrounded!.icon}`,
  );
});

// ── P4: CRUCIBLE + CAIRN ────────────────────────────────────────────────────

test('the CRUCIBLE view resolves without triggering a scan', async () => {
  await api();
  const started = Date.now();
  await vscode.commands.executeCommand('omnisCode.crucible.load');
  assert.ok(
    Date.now() - started < 5000,
    'loading stored results must not run a 30–150s scan',
  );
});

test('CRUCIBLE and turn commands are registered', async () => {
  await api();
  const all = await vscode.commands.getCommands(true);
  for (const id of [
    'omnisCode.run',
    'omnisCode.crucible.scan',
    'omnisCode.crucible.load',
    'omnisCode.claims.showRefusal',
  ]) {
    assert.ok(all.includes(id), `command not registered: ${id}`);
  }
});

/** CAIRN is contributed natively via MCP rather than re-implemented. */
test('the CAIRN MCP server definition provider is available', async () => {
  await api();
  assert.ok(
    typeof vscode.lm?.registerMcpServerDefinitionProvider === 'function',
    'this VS Code build lacks the MCP definition API the extension targets',
  );
});

/**
 * Someone installs from the marketplace and has never heard of omnis-key.
 * Every panel must degrade honestly rather than crash or invent a state.
 */
test('with no engine at all, every panel says so and nothing throws', { skip: EXPECT === 'ENGINE UNREACHABLE' ? false : 'engine present' }, async () => {
  const { claims } = await api();
  await claims.refresh();
  const claimRows = claims.getChildren();
  const first = await claims.getTreeItem(claimRows[0]!);
  assert.equal(
    typeof first.label === 'string' ? first.label : '',
    'ENGINE UNREACHABLE',
    'claims panel must report the missing engine',
  );

  // Commands must not throw when there is nothing to talk to.
  await vscode.commands.executeCommand('omnisCode.receipts.verify');
  await vscode.commands.executeCommand('omnisCode.crucible.load');
  console.log('    ↳ no-engine: all panels reported unreachable, no throw');
});

// ── MAP THE SOUL ────────────────────────────────────────────────────────────

test('the souls view registers and resolves without throwing', async () => {
  const { souls } = await api();
  await souls.refresh();
  const rows = souls.getChildren();
  assert.ok(rows.length >= 1, 'souls tree produced no rows');
  const first = await souls.getTreeItem(rows[0]!);
  const label = typeof first.label === 'string' ? first.label : '';
  console.log(`    ↳ souls: ${rows.length} row(s), first "${label}"`);
});

test('MAP THE SOUL commands are registered', async () => {
  await api();
  const all = await vscode.commands.getCommands(true);
  for (const id of [
    'omnisCode.souls.author',
    'omnisCode.souls.verify',
    'omnisCode.souls.refresh',
  ]) {
    assert.ok(all.includes(id), `command not registered: ${id}`);
  }
});

/**
 * 🔴 The probe that matters most.
 *
 * Drive the real wizard with two axioms against the real CLI. It must come back
 * REFUSED, in the engine's own words, and no soul may be created. Swallowing,
 * softening, or auto-filling past this is an outright failure.
 */
test('🔴 authoring with fewer than three axioms is REFUSED by the engine', async () => {
  const { wizard } = await api();
  const outcome = await wizard.seal({
    fields: {
      name: 'HostProbe',
      naming_lineage: 'A fixture authored inside the in-host suite to prove the refusal fires.',
      pronouns: 'they/them',
      role: 'in-host refusal probe for the soul wizard',
    },
    axioms: [
      'HostProbe will not claim a seal the CLI did not actually emit.',
      'HostProbe will not stand in for a real soul or be treated as canon.',
    ],
    exemplarContext: 'Asked whether the refusal fired.',
    exemplarOutput: 'It fired, and no soul was created.',
  });

  if (outcome.kind === 'unreachable') {
    console.log('    ⊘ mts not installed on this machine — refusal probe inconclusive');
    return;
  }
  assert.equal(outcome.kind, 'refused', `expected a refusal, got ${outcome.kind}`);
  assert.match(
    (outcome as { message: string }).message,
    /fewer than 3 negative axioms/,
    "the engine's own words must survive to the surface",
  );
  console.log(`    ↳ ${(outcome as { message: string }).message}`);
});

/** Rule 2, observed at the rendering layer rather than inferred from a unit. */
test('no soul row claims to be signed without a key', async () => {
  const { souls } = await api();
  await souls.refresh();
  for (const { soulId, reading } of souls.readings) {
    if (reading?.kind !== 'verdict') {
      continue;
    }
    const node = souls.getChildren().find((n) => (n as { ref?: { soulId: string } }).ref?.soulId === soulId);
    if (!node) {
      continue;
    }
    const item = await souls.getTreeItem(node);
    const desc = String(item.description ?? '');
    if (/operator-signed/.test(desc)) {
      assert.ok(
        reading.verdict.keyIds.length > 0,
        `${soulId} rendered as operator-signed with no signing key`,
      );
    }
    console.log(`    ↳ ${soulId}: ${desc}`);
  }
});

export async function runAll(): Promise<void> {
  let pass = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const c of cases) {
    if (c.skip) {
      console.log(`  ⊘ ${c.name}  (${c.skip})`);
      skipped++;
      continue;
    }
    try {
      await c.fn();
      console.log(`  ✔ ${c.name}`);
      pass++;
    } catch (e) {
      console.log(`  ✖ ${c.name}`);
      console.log(`      ${(e as Error).message}`);
      failures.push(c.name);
    }
  }
  console.log(
    `\n  in-host: ${pass}/${cases.length - skipped} passed${skipped ? ` (${skipped} skipped)` : ''}`,
  );
  if (failures.length) {
    throw new Error(`in-host failures: ${failures.join(', ')}`);
  }
}
