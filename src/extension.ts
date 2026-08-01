import * as vscode from 'vscode';
import { ReceiptsProvider } from './receiptsView';
import { jcodeHome, resolveEnginePath, verifyChain } from './engine';
import { unsafeRemedy } from './protocol';

/** Exposed so in-host tests can inspect what the panel actually renders. */
export interface OmnisCodeApi {
  provider: ReceiptsProvider;
}

export function activate(context: vscode.ExtensionContext): OmnisCodeApi {
  const provider = new ReceiptsProvider();
  const view = vscode.window.createTreeView('omnisCode.receipts', {
    treeDataProvider: provider,
  });
  const output = vscode.window.createOutputChannel('OMNIS CODE');

  context.subscriptions.push(
    view,
    output,

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

  void provider.refresh();
  return { provider };
}

export function deactivate(): void {
  /* no-op */
}
