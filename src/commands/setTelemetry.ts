import * as vscode from 'vscode';
import { getEthosApi, normalizeSensors, SensorInfo } from '../utils/ethosApi';

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
  interface SensorItem extends vscode.QuickPickItem { sensor?: SensorInfo; }

  let sensorItems: SensorItem[];
  try {
    const raw = await vscode.commands.executeCommand<unknown>('ethos.getSensors');
    const sensors = normalizeSensors(raw);

    const namedItems: SensorItem[] = [];
    const seenNames = new Set<string>();
    for (const s of sensors) {
      if (s.name !== '' && !seenNames.has(s.name)) {
        seenNames.add(s.name);
        namedItems.push({ label: s.name, sensor: s });
      }
    }
    namedItems.sort((a, b) => a.label.localeCompare(b.label));

    const unnamedItems: SensorItem[] = [];
    const seenAppIds = new Set<number>();
    for (const s of sensors) {
      if (s.name === '' && s.appId !== undefined && !seenAppIds.has(s.appId)) {
        seenAppIds.add(s.appId);
        unnamedItems.push({
          label: `appId: 0x${s.appId.toString(16).toUpperCase().padStart(4, '0')}`,
          sensor: s,
        });
      }
    }
    unnamedItems.sort((a, b) => (a.sensor!.appId ?? 0) - (b.sensor!.appId ?? 0));

    sensorItems = [...namedItems];
    if (unnamedItems.length > 0) {
      sensorItems.push({ label: 'Unnamed sensors', kind: vscode.QuickPickItemKind.Separator });
      sensorItems.push(...unnamedItems);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to retrieve sensors: ${err}`);
    return;
  }

  if (sensorItems.filter(i => i.kind !== vscode.QuickPickItemKind.Separator).length === 0) {
    vscode.window.showWarningMessage('No telemetry frames available. Check your Ethos sensors configuration.');
    return;
  }

  const pickedSensor = await vscode.window.showQuickPick(sensorItems, {
    placeHolder: 'Select a telemetry frame',
    title: 'Set Telemetry Value (1/2)',
  });
  if (!pickedSensor?.sensor) { return; }

  // ── 2. Value input ────────────────────────────────────────────────────────
  const inputValue = await vscode.window.showInputBox({
    prompt: `Enter value for "${pickedSensor.label}"`,
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
    const sensor = pickedSensor.sensor;
    const injectItem: { name?: string; appId?: number; value: number } = { value };
    if (sensor.name !== '') { injectItem.name = sensor.name; }
    if (sensor.appId !== undefined) { injectItem.appId = sensor.appId; }
    await vscode.commands.executeCommand('ethos.injectTelemetry', [injectItem], true);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to inject telemetry: ${err}`);
  }
}
