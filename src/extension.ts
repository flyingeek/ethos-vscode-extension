import * as vscode from 'vscode';
import { playTelemetryCommand, stopTelemetry } from './commands/playTelemetry';
import { setTelemetryCommand } from './commands/setTelemetry';
import { deployCommand } from './commands/deploy';
import { radioDebugCommand, radioSerialConsoleCommand } from './commands/radioDebug';
import { reloadCommand } from './commands/reload';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ethosExt.playTelemetry', () => playTelemetryCommand(context)),
    vscode.commands.registerCommand('ethosExt.stopTelemetry', () => stopTelemetry()),
    vscode.commands.registerCommand('ethosExt.setTelemetry', () => setTelemetryCommand()),
    vscode.commands.registerCommand('ethosExt.deploySimulator', () => deployCommand('simulator')),
    vscode.commands.registerCommand('ethosExt.deployRadio',     () => deployCommand('radio')),
    vscode.commands.registerCommand('ethosExt.deployRadioLua',  () => deployCommand('radio-lua')),
    vscode.commands.registerCommand('ethosExt.deployRadioFast', () => deployCommand('radio-fast')),
    vscode.commands.registerCommand('ethosExt.radioDebug',      () => radioDebugCommand()),
    vscode.commands.registerCommand('ethosExt.radioSerial',     () => radioSerialConsoleCommand()),
    vscode.commands.registerCommand('ethosExt.reload',           () => reloadCommand()),
  );
}

export function deactivate(): void {}
