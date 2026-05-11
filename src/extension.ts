import * as vscode from 'vscode';
import { addSimulator } from './commands/addSimulator';
import { setFirmware } from './commands/setSimulator';
import { showSimMenu } from './commands/showSimMenu';
import { createStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ethos.addSimulator', () => addSimulator(context)),
    vscode.commands.registerCommand('ethos.setSimulator', () => setFirmware()),
    vscode.commands.registerCommand('ethos.showSimMenu', () => showSimMenu()),
  );
  createStatusBar(context);
}

export function deactivate(): void {}
