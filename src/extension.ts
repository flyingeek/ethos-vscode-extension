import * as vscode from 'vscode';
import { playTelemetryCommand, stopTelemetry } from './commands/playTelemetry';
import { setTelemetryCommand } from './commands/setTelemetry';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ethosExt.playTelemetry', () => playTelemetryCommand()),
    vscode.commands.registerCommand('ethosExt.stopTelemetry', () => stopTelemetry()),
    vscode.commands.registerCommand('ethosExt.setTelemetry', () => setTelemetryCommand()),
  );
}

export function deactivate(): void {}
