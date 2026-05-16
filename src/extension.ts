import * as vscode from 'vscode';
import { addSimulator } from './commands/addSimulator';
import { setFirmware } from './commands/setSimulator';
import { showSimMenu } from './commands/showSimMenu';
import { playTelemetryCommand, stopTelemetry } from './commands/playTelemetry';
import { createStatusBar, pinStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ethos.addSimulator', () => addSimulator(context)),
    vscode.commands.registerCommand('ethos.setSimulator', () => setFirmware()),
    vscode.commands.registerCommand('ethos.showSimMenu', () => showSimMenu()),
    vscode.commands.registerCommand('ethos.playTelemetry', () => playTelemetryCommand()),
    vscode.commands.registerCommand('ethos.stopTelemetry', () => stopTelemetry()),
    vscode.commands.registerCommand('ethos.pinStatusBar', (item) => pinStatusBar(item)),
  );
  createStatusBar(context);
}

export function deactivate(): void {}
