import * as vscode from 'vscode';
import { playTelemetryCommand, stopTelemetry } from './commands/playTelemetry';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ethosExt.playTelemetry', () => playTelemetryCommand()),
    vscode.commands.registerCommand('ethosExt.stopTelemetry', () => stopTelemetry()),
  );
}

export function deactivate(): void {}
