import * as vscode from 'vscode';

const DEFAULT_VERSION = 'nightly26';

export function createStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'ethos.setSimulator';
  item.tooltip = 'Ethos: Set Simulator';

  function refresh(): void {
    const config = vscode.workspace.getConfiguration();
    const firmware = config.get<string>('ethos.firmware');
    const version = config.get<string>('ethos.version');
    if (firmware) {
      const label =
        version && version !== DEFAULT_VERSION ? `${firmware}@${version}` : firmware;
      item.text = `$(radio-tower) ${label}`;
    } else {
      item.text = '$(radio-tower) Set firmware';
    }
    item.show();
  }

  refresh();

  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('ethos')) {
        refresh();
      }
    }),
  );
}
