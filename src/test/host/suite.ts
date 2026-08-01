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

type Case = { name: string; fn: () => Promise<void> | void };
const cases: Case[] = [];
function test(name: string, fn: () => Promise<void> | void): void {
  cases.push({ name, fn });
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
    ['CLAIM_CHAIN_VALID', 'ENGINE UNREACHABLE'].includes(label),
    `unexpected claim chain label: ${label}`,
  );
  console.log(`    ↳ claims: ${label}  ${String(first.description ?? '')}`);
});

/**
 * The product cell: a refusal renders as a verdict with its own weight, and
 * never as an error.
 */
test('a refusal renders as a verdict, not an error', async () => {
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

export async function runAll(): Promise<void> {
  let pass = 0;
  const failures: string[] = [];
  for (const c of cases) {
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
  console.log(`\n  in-host: ${pass}/${cases.length} passed`);
  if (failures.length) {
    throw new Error(`in-host failures: ${failures.join(', ')}`);
  }
}
