import * as vscode from 'vscode';

export interface StatusBarPin {
  text: string;
  command?: string;
  tooltip?: string;
}

let statusBarItem: vscode.StatusBarItem | undefined;
let refreshStatusBar: (() => void) | undefined;
let statusBarPin: StatusBarPin | undefined;

export function createStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem = item;

  function refresh(): void {
    if (statusBarPin) { return; }

    const config = vscode.workspace.getConfiguration();

    const enabled = config.get<boolean>('ethos.statusBarEnable', true);
    if (!enabled) {
      item.hide();
      return;
    }

    const firmware = config.get<string>('ethos.firmware');
    const version = config.get<string>('ethos.version');
    const template = config.get<string>('ethos.statusBarText', '$(radio-tower) ${firmware}@${version}');
    const command = config.get<string>('ethos.statusBarCommand', 'ethos.showSimMenu');
    const tooltip = config.get<string>('ethos.statusBarTooltip', 'Ethos: Show Menu');

    item.command = command;
    item.tooltip = tooltip;

    if (firmware) {
      item.text = template
        .replace(/\$\{firmware\}/g, firmware)
        .replace(/\$\{version\}/g, version ?? '');
    } else {
      item.text = '$(radio-tower) Set firmware';
    }
    item.show();
  }

  refreshStatusBar = refresh;
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

function applyPin(item: vscode.StatusBarItem, pin: StatusBarPin): void {
  item.text = pin.text;
  if (pin.command !== undefined) { item.command = pin.command; }
  if (pin.tooltip !== undefined) { item.tooltip = pin.tooltip; }
  item.show();
}

export function pinStatusBar(pin: StatusBarPin | null | undefined): void {
  if (!statusBarItem) { return; }
  if (pin == null) {
    statusBarPin = undefined;
    refreshStatusBar?.();
  } else {
    statusBarPin = pin;
    applyPin(statusBarItem, pin);
  }
}

/**
 * Switches the status bar item between telemetry-playing state and the
 * normal firmware display.
 */
export function setPlayingState(playing: boolean): void {
  if (playing) {
    pinStatusBar({ text: '$(loading~spin) Telemetry playing', tooltip: 'Ethos: Stop telemetry playback', command: 'ethos.stopTelemetry' });
  } else {
    pinStatusBar(null);
  }
}
