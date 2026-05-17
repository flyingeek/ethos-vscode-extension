import * as vscode from 'vscode';
import * as path from 'path';
import { playTelemetry, countDataRows } from '../telemetry/player';
import { setPlayingState } from '../statusBar';

let activeCts: vscode.CancellationTokenSource | undefined;

export function stopTelemetry(): void {
  activeCts?.cancel();
}

export async function playTelemetryCommand(): Promise<void> {
  if (activeCts) {
    vscode.window.showWarningMessage('Telemetry playback is already running. Stop it first.');
    return;
  }

  // ── 1. File picker ────────────────────────────────────────────────────────
  const BROWSE_LABEL = '$(folder-opened) Browse file system…';

  const workspaceCsvFiles = await vscode.workspace.findFiles('**/*.csv', '**/node_modules/**');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

  const fileItems: vscode.QuickPickItem[] = workspaceCsvFiles
    .map(uri => ({
      label: workspaceRoot
        ? path.relative(workspaceRoot.fsPath, uri.fsPath)
        : uri.fsPath,
      description: workspaceRoot ? undefined : uri.fsPath,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  fileItems.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: BROWSE_LABEL },
  );

  const pickedFile = await vscode.window.showQuickPick(fileItems, {
    placeHolder: 'Select a CSV telemetry file',
    title: 'Play Telemetry (1/3)',
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
    const uri = workspaceCsvFiles.find(u => {
      const rel = workspaceRoot
        ? path.relative(workspaceRoot.fsPath, u.fsPath)
        : u.fsPath;
      return rel === pickedFile.label || u.fsPath === pickedFile.label;
    });
    if (!uri) { return; }
    filePath = uri.fsPath;
  }

  // ── 2. Speed picker ───────────────────────────────────────────────────────
  const config = vscode.workspace.getConfiguration();
  const savedSpeed = config.get<number>('ethosSimManager.telemetrySpeed', 1);
  const savedLoop = config.get<boolean>('ethosSimManager.telemetryLoop', false);

  const SPEED_OPTIONS = ['1×', '2×', '5×', '10×'];
  const speedLabel = `${savedSpeed}×`;
  const defaultSpeedLabel = SPEED_OPTIONS.includes(speedLabel) ? speedLabel : '1×';

  const pickedSpeed = await vscode.window.showQuickPick(
    SPEED_OPTIONS.map(s => ({
      label: s,
      description: s === defaultSpeedLabel ? '(saved)' : undefined,
    })),
    {
      placeHolder: 'Select replay speed',
      title: 'Play Telemetry (2/3)',
    },
  );
  if (!pickedSpeed) { return; }
  const speed = parseFloat(pickedSpeed.label.replace('×', ''));

  // ── 3. Loop picker ────────────────────────────────────────────────────────
  const LOOP_OPTIONS = [
    { label: 'Play once', value: false },
    { label: 'Loop', value: true },
  ];
  const pickedLoop = await vscode.window.showQuickPick(
    LOOP_OPTIONS.map(o => ({
      label: o.label,
      description: o.value === savedLoop ? '(saved)' : undefined,
    })),
    {
      placeHolder: 'Play once or loop?',
      title: 'Play Telemetry (3/3)',
    },
  );
  if (!pickedLoop) { return; }
  const loop = pickedLoop.label === 'Loop';

  // Persist choices
  await config.update('ethosSimManager.telemetrySpeed', speed, vscode.ConfigurationTarget.Workspace);
  await config.update('ethosSimManager.telemetryLoop', loop, vscode.ConfigurationTarget.Workspace);

  // ── 4. Play ───────────────────────────────────────────────────────────────
  activeCts = new vscode.CancellationTokenSource();
  const token = activeCts.token;
  setPlayingState(true);

  const totalRows = await countDataRows(filePath);

  try {
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
    setPlayingState(false);
  }
}
