import * as vscode from 'vscode';
import { getEthosApi } from '../utils/ethosApi';

export async function setTelemetryCommand(): Promise<void> {
  const ethosApi = await getEthosApi();
  if (!ethosApi) {
    vscode.window.showWarningMessage('Ethos extension is not available.');
    return;
  }

  if (!ethosApi.isRunning()) {
    vscode.window.showWarningMessage('Start the Ethos simulator before setting telemetry.');
    return;
  }

  // ── 1. Frame picker ───────────────────────────────────────────────────────
  let frames: string[];
  try {
    const raw = await vscode.commands.executeCommand<string[]>('ethos.getSensors');
    frames = [...new Set(raw ?? [])].filter(f => f !== '').sort();
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to retrieve sensors: ${err}`);
    return;
  }

  if (frames.length === 0) {
    vscode.window.showWarningMessage('No telemetry frames available. Check your Ethos sensors configuration.');
    return;
  }

  const pickedFrame = await vscode.window.showQuickPick(frames, {
    placeHolder: 'Select a telemetry frame',
    title: 'Set Telemetry Value (1/2)',
  });
  if (!pickedFrame) { return; }

  // ── 2. Value input ────────────────────────────────────────────────────────
  const inputValue = await vscode.window.showInputBox({
    prompt: `Enter value for "${pickedFrame}"`,
    title: 'Set Telemetry Value (2/2)',
    validateInput(raw) {
      const n = parseFloat(raw);
      return isFinite(n) ? undefined : 'Enter a valid number';
    },
  });
  if (inputValue === undefined) { return; }

  // ── 3. Inject ─────────────────────────────────────────────────────────────
  const value = parseFloat(inputValue);
  try {
    await vscode.commands.executeCommand('ethos.injectTelemetry', [{ name: pickedFrame, value }], true);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to inject telemetry: ${err}`);
  }
}
