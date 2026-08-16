import * as vscode from 'vscode';
import { basename } from 'node:path';
import { ReceiptsProvider } from './receiptsView';
import { ClaimsProvider } from './claimsView';
import { CrucibleProvider } from './crucibleView';
import {
  jcodeHome,
  resolveAgentPath,
  resolveEnginePath,
  resolveScannerPath,
  runAgent,
  setConfiguredEnginePath,
  streamAgent,
  streamScan,
  verifyChain,
  watchLedger,
} from './engine';
import {
  MISSING_CAIRN,
  MISSING_CRUCIBLE,
  MISSING_MTS,
  MISSING_OMNIS_CODE,
  MISSING_OMNIS_KEY,
  resolveCairnScript,
} from './missing';
import { resolveMtsCommand } from './mts';
import { unsafeRemedy } from './protocol';
import { availableProviders, buildTurnArgs, parseNdjsonChunk } from './turn';
import { SoulsProvider } from './soulsView';
import { SoulWizard } from './soulWizard';

/** Exposed so in-host tests can inspect what the panel actually renders. */
export interface OmnisCodeApi {
  provider: ReceiptsProvider;
  claims: ClaimsProvider;
  souls: SoulsProvider;
  wizard: SoulWizard;
}

export function activate(context: vscode.ExtensionContext): OmnisCodeApi {
  setConfiguredEnginePath(
    vscode.workspace.getConfiguration('omnisCode').get<string>('enginePath'),
  );
  const output = vscode.window.createOutputChannel('OMNIS CODE');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = 'omnisCode.showMissingBinaries';
  context.subscriptions.push(output, status);

  const reportMissing = (): void => {
    setConfiguredEnginePath(
      vscode.workspace.getConfiguration('omnisCode').get<string>('enginePath'),
    );
    const missing = missingBinaries();
    if (missing.length === 0) {
      status.hide();
      return;
    }
    const names = missing.map((m) => m.binary).join(', ');
    status.text = `OMNIS · ${names} missing`;
    status.tooltip = missing.map((m) => m.detail).join('\n');
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    status.show();
  };

  const onPathsChanged = (e: vscode.ConfigurationChangeEvent): void => {
    if (
      e.affectsConfiguration('omnisCode.enginePath') ||
      e.affectsConfiguration('omnisCode.mtsPath') ||
      e.affectsConfiguration('omnisCode.cairnServerScript')
    ) {
      reportMissing();
    }
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onPathsChanged));

  const provider = new ReceiptsProvider();
  const claims = new ClaimsProvider();
  const view = vscode.window.createTreeView('omnisCode.receipts', {
    treeDataProvider: provider,
  });
  const claimsView = vscode.window.createTreeView('omnisCode.claims', {
    treeDataProvider: claims,
  });

  context.subscriptions.push(
    view,
    claimsView,

    vscode.commands.registerCommand('omnisCode.claims.refresh', () => claims.refresh()),

    /**
     * "Show me a refusal" — the pitch surface. The engine really refuses, and
     * really records that refusal. This is a successful outcome, so it is not
     * reported as an error anywhere in this flow.
     */
    vscode.commands.registerCommand('omnisCode.claims.showRefusal', async () => {
      await claims.showRefusal();
      output.appendLine('$ omnis-key claims verify --refuse-demo --json');
      output.appendLine(claims.lastOutput.trim() || '(no stdout)');
      output.appendLine('');
      output.show(true);
    }),

    vscode.commands.registerCommand('omnisCode.receipts.refresh', () => provider.refresh()),

    /**
     * Verify writes its result to the panel and to a persistent output channel.
     * Rule §4.1: results on the glass. A failing verify must not evaporate into
     * a toast the user can miss.
     */
    vscode.commands.registerCommand('omnisCode.receipts.verify', async () => {
      const enginePath = resolveEnginePath(
        vscode.workspace.getConfiguration('omnisCode').get<string>('enginePath'),
      );
      const reading = await verifyChain(enginePath);
      output.appendLine(`$ omnis-key receipts verify --json`);
      output.appendLine(reading.raw.trim() || '(no stdout)');
      output.appendLine(`exit ${reading.exitCode ?? '—'}`);
      output.appendLine('');
      output.show(true);
      await provider.refresh();
    }),

    /**
     * Run one OMNIS CODE turn.
     *
     * Provider selection is explicit and required. There is no auto-detect
     * path here, and no "we found a key in your environment" shortcut — that
     * is the product's stated position, so the UI must not quietly violate it.
     */
    vscode.commands.registerCommand('omnisCode.run', async () => {
      const auth = await runAgent(['auth', 'status']);
      if (auth.detail && !auth.stdout.trim()) {
        output.appendLine(auth.detail);
        output.show(true);
        return;
      }
      const providers = availableProviders(auth.stdout);
      if (providers.length === 0) {
        output.appendLine(
          'No provider is configured. Run `omnis-code login <provider>` and try again.',
        );
        output.show(true);
        return;
      }

      const picked = await vscode.window.showQuickPick(
        providers.map((p) => ({ label: p.id, description: p.method })),
        { title: 'OMNIS CODE — choose a provider', placeHolder: 'Provider (required)' },
      );
      if (!picked) {
        return;
      }

      const message = await vscode.window.showInputBox({
        title: 'OMNIS CODE — run a turn',
        prompt: 'What should the agent do?',
      });
      if (!message?.trim()) {
        return;
      }

      let args: string[];
      try {
        args = buildTurnArgs({
          message,
          provider: picked.label,
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        });
      } catch (e) {
        output.appendLine((e as Error).message);
        output.show(true);
        return;
      }

      output.appendLine(`$ omnis-code ${args.slice(0, 4).join(' ')} …`);
      output.show(true);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `OMNIS CODE turn (${picked.label})`,
          cancellable: true,
        },
        async (_progress, token) => {
          const run = streamAgent(
            args,
            (chunk) => {
              for (const ev of parseNdjsonChunk(chunk)) {
                output.appendLine(ev.text ? `${ev.type}: ${ev.text}` : ev.type);
              }
            },
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          );
          token.onCancellationRequested(() => run.cancel());
          const code = await run.done;
          output.appendLine(`\nturn exited ${code ?? '—'}`);
          // The watcher normally catches this; refresh anyway so the panel is
          // current the instant the turn ends.
          await provider.refresh();
        },
      );
    }),

    vscode.commands.registerCommand('omnisCode.receipts.copyHead', async () => {
      const s = provider.current?.state;
      if (s?.kind === 'valid') {
        await vscode.env.clipboard.writeText(s.headSha256);
        vscode.window.setStatusBarMessage('Head hash copied', 2000);
      }
    }),

    vscode.commands.registerCommand('omnisCode.receipts.copyRemedy', async () => {
      await vscode.env.clipboard.writeText(unsafeRemedy(jcodeHome()).command);
      vscode.window.setStatusBarMessage('Remedy command copied', 2000);
    }),
  );

  /**
   * CAIRN, natively.
   *
   * VS Code speaks MCP, so we hand it CAIRN's server definition rather than
   * shelling out and re-implementing a client. We deliberately do NOT build an
   * ask/answer panel: VS Code gives extensions no MCP *client* API (only the
   * ability to publish server definitions), so a panel would have to
   * re-implement the transport — and any answer it displayed while the engine
   * was down would be a fabricated one. The chat surface owns the asking.
   *
   * Registration does not require CAIRN to be running; if the server script is
   * absent we contribute nothing rather than register a definition that cannot
   * start.
   */
  if (vscode.lm?.registerMcpServerDefinitionProvider) {
    context.subscriptions.push(
      vscode.lm.registerMcpServerDefinitionProvider('omnisCode.cairn', {
        provideMcpServerDefinitions: async () => {
          const script = resolveCairnScript(
            vscode.workspace.getConfiguration('omnisCode').get<string>('cairnServerScript'),
          );
          if (!script) {
            return [];
          }
          return [
            new vscode.McpStdioServerDefinition(
              'CAIRN',
              'node',
              [script],
              { CAIRN_URL: cairnUrl() },
            ),
          ];
        },
      }),
    );
  }

  const crucible = new CrucibleProvider();
  const crucibleView = vscode.window.createTreeView('omnisCode.crucible', {
    treeDataProvider: crucible,
  });
  context.subscriptions.push(
    crucibleView,

    vscode.commands.registerCommand('omnisCode.crucible.load', () => loadCrucible(crucible)),

    /**
     * An explicit, long-running command. Never on save, never on keystroke,
     * always cancellable, never blocking the editor.
     */
    vscode.commands.registerCommand('omnisCode.crucible.scan', async () => {
      const root = vscode.workspace.workspaceFolders?.[0];
      if (!root) {
        void vscode.window.showInformationMessage('Open a folder to scan.');
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'CRUCIBLE scanning this repository (30–150s)',
          cancellable: true,
        },
        async (_p, token) => {
          output.appendLine(`$ crucible-scan ${root.uri.fsPath}`);
          output.show(true);
          const run = streamScan(root.uri.fsPath, (c) => output.append(c));
          token.onCancellationRequested(() => run.cancel());
          const code = await run.done;
          // crucible-scan exits 0 even on a bad argument, so the exit code is
          // reported but never treated as proof the scan succeeded.
          output.appendLine(`\nscan exited ${code ?? '—'}`);
          await loadCrucible(crucible);
        },
      );
    }),
  );
  void loadCrucible(crucible);

  /**
   * Live refresh. The receipts panel must reflect a new receipt without the
   * user reloading anything, so we watch the ledger file itself rather than
   * assuming our own commands are the only writer — a turn run in a terminal
   * outside the editor must move the panel too.
   */
  const watcher = watchLedger(() => void provider.refresh());
  context.subscriptions.push({ dispose: () => watcher.close() });

  /**
   * MAP THE SOUL — identity, alongside action.
   *
   * OMNIS CODE proves what an agent did; MTS proves what it is. Additive
   * module: the `mts` CLI is the sole authority on sealing and verification,
   * and nothing here computes a verdict of its own.
   */
  const souls = new SoulsProvider();
  const soulsTree = vscode.window.createTreeView('omnisCode.souls', {
    treeDataProvider: souls,
  });
  const wizard = new SoulWizard(context.extensionUri, output, () => void souls.refresh());

  context.subscriptions.push(
    soulsTree,
    vscode.commands.registerCommand('omnisCode.souls.refresh', () => souls.refresh()),
    vscode.commands.registerCommand('omnisCode.souls.author', () => wizard.open()),

    /**
     * Verify on demand and put the engine's real output on the glass. A failing
     * verification is shown, never summarised away.
     */
    vscode.commands.registerCommand('omnisCode.souls.verify', async () => {
      const picked = await vscode.window.showQuickPick(
        souls.readings.map((r) => r.soulId),
        { title: 'MAP THE SOUL — verify a soul', placeHolder: 'soul_id' },
      );
      if (!picked) {
        return;
      }
      const reading = await souls.verifyOne(picked);
      output.appendLine(`$ mts soul-verify ${picked} --json`);
      output.appendLine(
        reading.kind === 'verdict'
          ? reading.verdict.message
          : `no verdict — ${reading.detail}`,
      );
      output.appendLine('');
      output.show(true);
      await souls.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omnisCode.showMissingBinaries', () => {
      const missing = missingBinaries();
      output.appendLine('OMNIS CODE binary status');
      if (missing.length === 0) {
        output.appendLine('omnis-key, omnis-code, crucible-scan, mts, cairn: found.');
      } else {
        for (const m of missing) {
          output.appendLine(`${m.binary}: ${m.detail}`);
        }
      }
      output.appendLine('');
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('omnisCode.enginePath')) {
        void provider.refresh();
        void claims.refresh();
        void loadCrucible(crucible);
      }
      if (e.affectsConfiguration('omnisCode.mtsPath') || e.affectsConfiguration('omnisCode.soulsDir')) {
        void souls.refresh();
      }
    }),
  );

  reportMissing();
  const missing = missingBinaries();
  if (missing.some((m) => m.binary === 'omnis-key')) {
    output.appendLine(MISSING_OMNIS_KEY);
    output.appendLine('');
    output.show(true);
    void vscode.window.showWarningMessage(MISSING_OMNIS_KEY, 'Open Settings').then((choice) => {
      if (choice === 'Open Settings') {
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'omnisCode.enginePath',
        );
      }
    });
  } else if (missing.length > 0) {
    for (const m of missing) {
      output.appendLine(m.detail);
    }
    output.appendLine('');
  }

  void provider.refresh();
  void claims.refresh();
  void souls.refresh();
  return { provider, claims, souls, wizard };
}

function loadCrucible(crucible: CrucibleProvider): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  return crucible.loadLatest(root ? basename(root.uri.fsPath) : '');
}

function missingBinaries(): { binary: string; detail: string }[] {
  const cfg = vscode.workspace.getConfiguration('omnisCode');
  const out: { binary: string; detail: string }[] = [];
  if (!resolveEnginePath(cfg.get<string>('enginePath'))) {
    out.push({ binary: 'omnis-key', detail: MISSING_OMNIS_KEY });
  }
  if (!resolveAgentPath()) {
    out.push({ binary: 'omnis-code', detail: MISSING_OMNIS_CODE });
  }
  if (!resolveScannerPath()) {
    out.push({ binary: 'crucible-scan', detail: MISSING_CRUCIBLE });
  }
  if (!resolveMtsCommand(cfg.get<string>('mtsPath'))) {
    out.push({ binary: 'mts', detail: MISSING_MTS });
  }
  if (!resolveCairnScript(cfg.get<string>('cairnServerScript'))) {
    out.push({ binary: 'cairn', detail: MISSING_CAIRN });
  }
  return out;
}

function cairnUrl(): string {
  return (
    vscode.workspace.getConfiguration('omnisCode').get<string>('cairnUrl')?.trim() ||
    'http://127.0.0.1:4611'
  );
}

export function deactivate(): void {
  /* no-op */
}
