import * as vscode from 'vscode';
import {
  MtsCommand,
  SoulRef,
  SoulVerdict,
  VerifyReading,
  listSouls,
  parseVerify,
  resolveMtsCommand,
  runMts,
  sealPresentation,
  soulsDir,
} from './mts';

type Node = SoulNode | NoteNode | IssueNode;

interface SoulNode {
  t: 'soul';
  ref: SoulRef;
  reading: VerifyReading | null;
}
interface NoteNode {
  t: 'note';
  label: string;
  detail?: string;
  icon?: vscode.ThemeIcon;
}
interface IssueNode {
  t: 'issue';
  soulId: string;
  text: string;
}

export function configuredMtsPath(): string | undefined {
  return vscode.workspace.getConfiguration('omnisCode').get<string>('mtsPath');
}

export function configuredSoulsDir(): string {
  const override = vscode.workspace.getConfiguration('omnisCode').get<string>('soulsDir');
  if (override?.trim()) {
    return override.trim();
  }
  return soulsDir(process.env, resolveMtsCommand(configuredMtsPath()));
}

export class SoulsProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private cmd: MtsCommand | null = null;
  private souls: SoulNode[] = [];
  private unreachable: string | null = null;

  /** Last readings, so in-host tests can assert on real rendered state. */
  get readings(): { soulId: string; reading: VerifyReading | null }[] {
    return this.souls.map((s) => ({ soulId: s.ref.soulId, reading: s.reading }));
  }

  /**
   * List souls, then ask the CLI for a verdict on each.
   *
   * Listing is a directory read and carries no verdict of its own. Nothing is
   * rendered as sound until `soul-verify` has spoken about it.
   */
  async refresh(): Promise<void> {
    this.cmd = resolveMtsCommand(configuredMtsPath());
    if (!this.cmd) {
      this.unreachable =
        'mts not found. Set "omnisCode.mtsPath" to the MAP THE SOUL CLI (VS Code does not inherit your shell PATH on macOS).';
      this.souls = [];
      this._onDidChange.fire();
      return;
    }
    this.unreachable = null;

    const dir = configuredSoulsDir();
    this.souls = listSouls(dir).map((ref) => ({ t: 'soul' as const, ref, reading: null }));
    this._onDidChange.fire();

    for (const node of this.souls) {
      node.reading = await this.verifyOne(node.ref.soulId);
      this._onDidChange.fire();
    }
  }

  async verifyOne(soulId: string): Promise<VerifyReading> {
    const args = ['soul-verify', soulId, '--json'];
    const dir = configuredSoulsDir();
    if (dir) {
      args.push('--souls-dir', dir);
    }
    const res = await runMts(this.cmd ?? resolveMtsCommand(configuredMtsPath()), args);
    return parseVerify(soulId, res);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.t === 'note') {
      const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      i.description = node.detail;
      i.tooltip = node.detail;
      i.iconPath = node.icon;
      return i;
    }
    if (node.t === 'issue') {
      const i = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      i.iconPath = new vscode.ThemeIcon('circle-small-filled');
      i.tooltip = node.text;
      i.contextValue = 'soul-issue';
      return i;
    }
    return soulItem(node);
  }

  getChildren(node?: Node): Node[] {
    if (node) {
      // Issues hang under the soul they belong to, in the engine's own words.
      if (node.t === 'soul' && node.reading?.kind === 'verdict') {
        return node.reading.verdict.issues.map((text) => ({
          t: 'issue' as const,
          soulId: node.ref.soulId,
          text,
        }));
      }
      return [];
    }

    if (this.unreachable) {
      return [
        {
          t: 'note',
          label: 'MTS UNREACHABLE',
          detail: this.unreachable,
          icon: new vscode.ThemeIcon('debug-disconnect'),
        },
      ];
    }
    if (!this.souls.length) {
      return [
        {
          t: 'note',
          label: 'No souls on this machine',
          detail: 'Run "MAP THE SOUL: author a soul" to map one.',
          icon: new vscode.ThemeIcon('circle-large-outline'),
        },
      ];
    }
    return this.souls;
  }
}

function soulItem(node: SoulNode): vscode.TreeItem {
  const { ref, reading } = node;
  const label = ref.name ? `${ref.name}` : ref.soulId;

  if (!reading) {
    const i = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    i.description = 'verifying…';
    i.iconPath = new vscode.ThemeIcon('loading~spin');
    i.contextValue = 'soul-pending';
    return i;
  }

  if (reading.kind === 'unreachable' || reading.kind === 'unparseable') {
    const i = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    i.description = 'no verdict';
    i.tooltip = reading.detail;
    i.iconPath = new vscode.ThemeIcon('debug-disconnect');
    i.contextValue = 'soul-noverdict';
    return i;
  }

  const v: SoulVerdict = reading.verdict;
  const p = sealPresentation(v.seal);
  const i = new vscode.TreeItem(
    label,
    v.issues.length
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None,
  );

  // Rule 2 rendered: the seal word comes from one place and "signed" appears
  // only when the engine named a key.
  i.description = `${v.verified ? 'VERIFIED' : 'FAILED'}  ·  ${p.label}`;
  i.iconPath = new vscode.ThemeIcon(
    p.icon,
    v.verified
      ? new vscode.ThemeColor(v.seal === 'signed' ? 'testing.iconPassed' : 'descriptionForeground')
      : new vscode.ThemeColor('testing.iconFailed'),
  );

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${ref.name || ref.soulId}** · \`${v.soulId}\`\n\n`);
  md.appendMarkdown(`${v.message}\n\n`);
  md.appendMarkdown(`**${p.label}** — ${p.gloss}\n\n`);
  if (v.keyIds.length) {
    md.appendMarkdown(`signing key: \`${v.keyIds.join('`, `')}\`\n\n`);
  } else {
    md.appendMarkdown('_No signing key. This soul is not operator-signed._\n\n');
  }
  md.appendMarkdown(`chain: ${v.chainOk ? 'ok' : 'BROKEN'} · ${v.chainCount} events`);
  i.tooltip = md;
  i.contextValue = `soul-${v.seal}`;
  return i;
}
