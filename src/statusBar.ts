import * as vscode from 'vscode';
import { firmwareLabel } from './constants';

let statusBarItem: vscode.StatusBarItem | undefined;

export function createStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem = item;
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

/**
 * Switches the status bar item between telemetry-playing state and the
 * normal firmware display.
 */
export function setPlayingState(playing: boolean): void {
  if (!statusBarItem) { return; }
  if (playing) {
    statusBarItem.text = '$(loading~spin) Telemetry playing';
    statusBarItem.tooltip = 'Ethos: Stop telemetry playback';
    statusBarItem.command = 'ethos.stopTelemetry';
  } else {
    statusBarItem.tooltip = 'Ethos: Show Menu';
    statusBarItem.command = 'ethos.showSimMenu';
    // Restore firmware label
    const config = vscode.workspace.getConfiguration();
    const firmware = config.get<string>('ethos.firmware');
    const version = config.get<string>('ethos.version');
    statusBarItem.text = firmware
      ? `$(radio-tower) ${firmwareLabel(firmware, version)}`
      : '$(radio-tower) Set firmware';
  }
}
