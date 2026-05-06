import * as vscode from 'vscode';
import { addSimulator } from './commands/addSimulator';
import { setFirmware } from './commands/setFirmware';
import { createStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ethos.addSimulator', () => addSimulator(context)),
    vscode.commands.registerCommand('ethos.setSimulator', () => setFirmware()),
  );
  createStatusBar(context);
}

export function deactivate(): void {}
