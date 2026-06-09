import * as vscode from 'vscode';
import { playTelemetryCommand, stopTelemetry } from './commands/playTelemetry';
import { setTelemetryCommand } from './commands/setTelemetry';
import { deployCommand } from './commands/deploy';
import { radioDebugCommand, radioSerialConsoleCommand } from './commands/radioDebug';
import { reloadCommand } from './commands/reload';
import { openManifestDoc, registerManifestDocProvider } from './commands/openManifestDoc'

export function activate(context: vscode.ExtensionContext): void {
  registerManifestDocProvider(context)

  context.subscriptions.push(
    vscode.commands.registerCommand('ethos-devtools.playTelemetry', () => playTelemetryCommand(context)),
    vscode.commands.registerCommand('ethos-devtools.stopTelemetry', () => stopTelemetry()),
    vscode.commands.registerCommand('ethos-devtools.setTelemetry', () => setTelemetryCommand()),
    vscode.commands.registerCommand('ethos-devtools.deploySimulator', () => deployCommand('simulator')),
    vscode.commands.registerCommand('ethos-devtools.deployRadio',     () => deployCommand('radio')),
    vscode.commands.registerCommand('ethos-devtools.deployRadioLua',  () => deployCommand('radio-lua')),
    vscode.commands.registerCommand('ethos-devtools.deployRadioFast', () => deployCommand('radio-fast')),
    vscode.commands.registerCommand('ethos-devtools.radioDebug',      () => radioDebugCommand()),
    vscode.commands.registerCommand('ethos-devtools.radioSerial',     () => radioSerialConsoleCommand()),
    vscode.commands.registerCommand('ethos-devtools.reload',           () => reloadCommand()),
    vscode.commands.registerCommand('ethos-devtools.openManifestDoc', () => openManifestDoc()),
  );
}

export function deactivate(): void {}
