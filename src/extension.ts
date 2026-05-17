import * as vscode from 'vscode';
import { addSimulator } from './commands/addSimulator';
import { setFirmware } from './commands/setSimulator';
import { showSimMenu } from './commands/showSimMenu';
import { playTelemetryCommand, stopTelemetry } from './commands/playTelemetry';
import { createStatusBar, pinStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ethosSimManager.addSimulator', () => addSimulator(context)),
    vscode.commands.registerCommand('ethosSimManager.setSimulator', () => setFirmware()),
    vscode.commands.registerCommand('ethosSimManager.showSimMenu', () => showSimMenu()),
    vscode.commands.registerCommand('ethosSimManager.playTelemetry', () => playTelemetryCommand()),
    vscode.commands.registerCommand('ethosSimManager.stopTelemetry', () => stopTelemetry()),
    vscode.commands.registerCommand('ethosSimManager.pinStatusBar', (item) => pinStatusBar(item as Parameters<typeof pinStatusBar>[0])),
  );

  createStatusBar(context);
}

export function deactivate(): void {}
