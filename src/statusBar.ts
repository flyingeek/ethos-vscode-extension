import * as vscode from 'vscode';
import { firmwareLabel } from './constants';

export function createStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'ethos.showSimMenu';
  item.tooltip = 'Ethos: Show Menu';

  function refresh(): void {
    const config = vscode.workspace.getConfiguration();
    const firmware = config.get<string>('ethos.firmware');
    const version = config.get<string>('ethos.version');
    if (firmware) {
      item.text = `$(radio-tower) ${firmwareLabel(firmware, version)}`;
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
