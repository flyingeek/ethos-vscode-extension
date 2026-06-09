import * as vscode from 'vscode';
import * as path from 'path';
import { playTelemetry, countDataRows } from '../telemetry/player';
import { getEthosApi } from '../utils/ethosApi';

let activeCts: vscode.CancellationTokenSource | undefined;
let runningStateSubscription: vscode.Disposable | undefined;

const TELEMETRY_PIN = {
  text: '$(loading~spin) Telemetry playing',
  command: 'ethos-devtools.stopTelemetry',
  tooltip: 'Ethos DevTools: Stop telemetry playback',
} as const;

const DEFAULT_TELEMETRY_REPLAY_SPEEDS = [1, 2, 5, 10];

async function pinTelemetryStatus(playing: boolean): Promise<void> {
  try {
    await vscode.commands.executeCommand('ethos.pinStatusBar', playing ? TELEMETRY_PIN : undefined);
  } catch (err) {
    console.error('Ethos DevTools: pinStatusBar failed:', err);
  }
}

function clearRunningStateSubscription(): void {
  runningStateSubscription?.dispose();
  runningStateSubscription = undefined;
}

export function stopTelemetry(): void {
  activeCts?.cancel();
}

export async function playTelemetryCommand(context: vscode.ExtensionContext): Promise<void> {
  if (activeCts) {
    vscode.window.showWarningMessage('Telemetry playback is already running. Stop it first.');
    return;
  }

  const ethosApi = await getEthosApi();
  if (!ethosApi) {
    vscode.window.showWarningMessage('Ethos extension is not available.');
    return;
  }

  if (!ethosApi.isRunning()) {
    vscode.window.showWarningMessage('Start the Ethos simulator before playing telemetry.');
    return;
  }

  // ── 1. File picker ────────────────────────────────────────────────────────
  interface FileItem extends vscode.QuickPickItem { fsPath?: string; }
  const BROWSE_LABEL = '$(folder-opened) Browse file system…';

  const workspaceCsvFiles = await vscode.workspace.findFiles('**/*.csv', '**/node_modules/**');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

  // Validate previously saved CSV path
  let savedCsvPath: string | undefined;
  const savedCsvPathRaw = context.workspaceState.get<string>('telemetryCSVPath');
  if (savedCsvPathRaw) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(savedCsvPathRaw));
      savedCsvPath = savedCsvPathRaw;
    } catch {
      // File no longer exists, discard
      await context.workspaceState.update('telemetryCSVPath', undefined);
    }
  }

  // Build items for workspace CSV files
  const workspaceFileItems: FileItem[] = workspaceCsvFiles
    .map(uri => ({
      label: workspaceRoot
        ? path.relative(workspaceRoot.fsPath, uri.fsPath)
        : uri.fsPath,
      description: workspaceRoot ? undefined : uri.fsPath,
      fsPath: uri.fsPath,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const fileItems: FileItem[] = [];

  // If saved path is outside the workspace (browsed externally), prepend it
  const savedInWorkspace = savedCsvPath !== undefined &&
    workspaceCsvFiles.some(u => u.fsPath === savedCsvPath);
  if (savedCsvPath && !savedInWorkspace) {
    fileItems.push({
      label: path.basename(savedCsvPath),
      description: savedCsvPath,
      fsPath: savedCsvPath,
    });
    if (workspaceFileItems.length > 0) {
      fileItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
  }

  fileItems.push(...workspaceFileItems);
  fileItems.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: BROWSE_LABEL },
  );

  // Find the item to pre-select
  const activeFileItem = savedCsvPath
    ? fileItems.find(i => i.fsPath === savedCsvPath)
    : undefined;

  const pickedFile = await new Promise<FileItem | undefined>(resolve => {
    const qp = vscode.window.createQuickPick<FileItem>();
    qp.items = fileItems;
    qp.placeholder = 'Select a CSV telemetry file';
    qp.title = 'Play Telemetry (1/3)';
    if (activeFileItem) { qp.activeItems = [activeFileItem]; }
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.dispose(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
  if (!pickedFile) { return; }

  let filePath: string;
  if (pickedFile.label === BROWSE_LABEL) {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'CSV files': ['csv'] },
      title: 'Select CSV telemetry file',
    });
    if (!uris || uris.length === 0) { return; }
    filePath = uris[0].fsPath;
  } else {
    if (!pickedFile.fsPath) { return; }
    filePath = pickedFile.fsPath;
  }

  await context.workspaceState.update('telemetryCSVPath', filePath);

  // ── 2. Speed picker ───────────────────────────────────────────────────────
  interface SpeedItem extends vscode.QuickPickItem { multiplier: number; }
  const config = vscode.workspace.getConfiguration();
  const configuredSpeeds = config.get<number[]>('ethos-devtools.telemetryReplaySpeeds') ?? DEFAULT_TELEMETRY_REPLAY_SPEEDS;
  const savedSpeed = context.workspaceState.get<number>('telemetrySpeed') ?? 1;

  const replaySpeeds = configuredSpeeds.filter((speed, index, speeds) =>
    Number.isFinite(speed) && speed > 0 && speeds.indexOf(speed) === index,
  );
  const speedItems: SpeedItem[] = (replaySpeeds.length > 0 ? replaySpeeds : DEFAULT_TELEMETRY_REPLAY_SPEEDS)
    .map(multiplier => ({ label: `${multiplier}×`, multiplier }));

  const activeSpeedItem = speedItems.find(i => i.multiplier === savedSpeed) ?? speedItems[0];

  const pickedSpeed = await new Promise<SpeedItem | undefined>(resolve => {
    const qp = vscode.window.createQuickPick<SpeedItem>();
    qp.items = speedItems;
    qp.placeholder = 'Select replay speed';
    qp.title = 'Play Telemetry (2/3)';
    qp.activeItems = [activeSpeedItem];
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.dispose(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
  if (!pickedSpeed) { return; }
  const speed = pickedSpeed.multiplier;

  // ── 3. Loop picker ────────────────────────────────────────────────────────
  interface LoopItem extends vscode.QuickPickItem { value: boolean; }
  const savedLoop = context.workspaceState.get<boolean>('telemetryLoop') ?? false;

  const loopItems: LoopItem[] = [
    { label: 'Play once', value: false },
    { label: 'Loop', value: true },
  ];
  const activeLoopItem = loopItems.find(i => i.value === savedLoop) ?? loopItems[0];

  const pickedLoop = await new Promise<LoopItem | undefined>(resolve => {
    const qp = vscode.window.createQuickPick<LoopItem>();
    qp.items = loopItems;
    qp.placeholder = 'Play once or loop?';
    qp.title = 'Play Telemetry (3/3)';
    qp.activeItems = [activeLoopItem];
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.dispose(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
  if (!pickedLoop) { return; }
  const loop = pickedLoop.value;

  // Persist choices to workspace state
  await context.workspaceState.update('telemetrySpeed', speed);
  await context.workspaceState.update('telemetryLoop', loop);

  // ── 4. Play ───────────────────────────────────────────────────────────────
  activeCts = new vscode.CancellationTokenSource();
  const token = activeCts.token;
  clearRunningStateSubscription();
  runningStateSubscription = ethosApi.onDidChangeRunningState(running => {
    if (!running) {
      activeCts?.cancel();
    }
  });

  try {
    const totalRows = await countDataRows(filePath);

    if (token.isCancellationRequested || !ethosApi.isRunning()) {
      return;
    }

    await pinTelemetryStatus(true);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Telemetry: ${path.basename(filePath)}`,
        cancellable: true,
      },
      async (progress, progressToken) => {
        // Wire the notification's cancel button to our CTS
        progressToken.onCancellationRequested(() => activeCts?.cancel());

        await playTelemetry({
          filePath,
          speed,
          loop,
          totalRows,
          token,
          onProgress: (rowIndex, loopIteration, frameNames, total) => {
            const framesStr = frameNames.length > 0 ? frameNames.join(', ') : '—';
            const rowPart = total
              ? `Row ${rowIndex}/${total} (${Math.round((rowIndex / total) * 100)}%)`
              : `Row ${rowIndex}`;
            const msg = loop
              ? `${rowPart} — loop ${loopIteration} — ${framesStr}`
              : `${rowPart} — ${framesStr}`;
            progress.report({ message: msg });
          },
        });
      },
    );

    if (token.isCancellationRequested) {
      vscode.window.showInformationMessage('Telemetry playback stopped.');
    } else {
      vscode.window.showInformationMessage('Telemetry playback finished.');
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Telemetry error: ${(err as Error).message}`);
  } finally {
    activeCts.dispose();
    activeCts = undefined;
    clearRunningStateSubscription();
    await pinTelemetryStatus(false);
  }
}
