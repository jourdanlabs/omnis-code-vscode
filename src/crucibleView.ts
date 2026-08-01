import * as vscode from 'vscode';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ScanResult, ageLabel, isStale, newestScanDir, parsePipeline } from './crucible';

type Node = HeaderNode | FindingNode | NoteNode;

interface HeaderNode {
  t: 'header';
  scan: ScanResult;
}
interface FindingNode {
  t: 'finding';
  index: number;
}
interface NoteNode {
  t: 'note';
  label: string;
  detail?: string;
  icon?: vscode.ThemeIcon;
}

export function scansRoot(): string {
  return join(homedir(), 'crucible-scans');
}

export class CrucibleProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private scan: ScanResult | null = null;
  private note: string | null = 'No scan loaded.';

  get current(): ScanResult | null {
    return this.scan;
  }

  /**
   * Loads the newest STORED scan for the workspace. Never triggers a scan —
   * a 30–150s job does not run because a view became visible.
   */
  async loadLatest(repoName: string): Promise<void> {
    try {
      const dirs = await readdir(scansRoot());
      const newest = newestScanDir(dirs, repoName);
      if (!newest) {
        this.scan = null;
        this.note = `No stored scan for "${repoName}". Run "CRUCIBLE: scan this repository".`;
      } else {
        const raw = await readFile(join(scansRoot(), newest, 'pipeline.json'), 'utf8');
        const parsed = parsePipeline(newest, raw);
        this.scan = parsed;
        this.note = parsed ? null : `Scan ${newest} could not be parsed.`;
      }
    } catch {
      this.scan = null;
      this.note = 'No scans directory yet. Run a scan to create one.';
    }
    this._onDidChange.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.t === 'note') {
      const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      i.description = node.detail;
      i.iconPath = node.icon;
      return i;
    }
    if (node.t === 'header') {
      const s = node.scan;
      const age = ageLabel(s.scannedAt, new Date());
      const i = new vscode.TreeItem(s.verdict, vscode.TreeItemCollapsibleState.None);
      i.description = `${s.findings.length} findings  ·  ${age}`;
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${s.targetName}** — ${s.verdict}\n\n${s.summary}\n\n`);
      md.appendMarkdown(`_${age}_`);
      i.tooltip = md;
      i.iconPath = isStale(s.scannedAt, new Date())
        ? new vscode.ThemeIcon('history', new vscode.ThemeColor('descriptionForeground'))
        : new vscode.ThemeIcon('checklist');
      return i;
    }

    const f = this.scan!.findings[node.index]!;
    const i = new vscode.TreeItem(f.description, vscode.TreeItemCollapsibleState.None);
    i.description = `${f.file}:${f.line}`;
    i.iconPath = new vscode.ThemeIcon(
      f.severity === 'CRIT' || f.severity === 'HIGH' ? 'warning' : 'info',
    );
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${f.severity}** — ${f.description}\n\n`);
    if (f.fix) {
      md.appendMarkdown(`_fix:_ ${f.fix}\n\n`);
    }
    md.appendMarkdown(`_${ageLabel(this.scan!.scannedAt, new Date())} — not a live result_`);
    i.tooltip = md;

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root) {
      const target = vscode.Uri.joinPath(root, f.file);
      i.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [target, { selection: new vscode.Range(f.line - 1, 0, f.line - 1, 0) }],
      };
    }
    return i;
  }

  getChildren(): Node[] {
    if (!this.scan) {
      return [
        {
          t: 'note',
          label: this.note ?? 'No scan loaded.',
          icon: new vscode.ThemeIcon('info'),
        },
      ];
    }
    const nodes: Node[] = [{ t: 'header', scan: this.scan }];
    if (isStale(this.scan.scannedAt, new Date())) {
      nodes.push({
        t: 'note',
        label: 'These findings are from an earlier scan',
        detail: 'Re-run the scan to see current results.',
        icon: new vscode.ThemeIcon('history'),
      });
    }
    this.scan.findings.forEach((_, index) => nodes.push({ t: 'finding', index }));
    return nodes;
  }
}
