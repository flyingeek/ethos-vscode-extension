import * as vscode from 'vscode';
import { DEFAULT_VERSION, getSimulatorFolder } from '../constants';

export async function setFirmware(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const simulatorFolder = getSimulatorFolder();
  const simulatorUri = vscode.Uri.joinPath(workspaceRoot, simulatorFolder);
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(simulatorUri);
  } catch {
    vscode.window.showErrorMessage(`Could not read ${simulatorFolder}/ directory.`);
    return;
  }

  const options = entries
    .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.'))
    .map(([name]) => name)
    .sort();

  if (options.length === 0) {
    vscode.window.showInformationMessage(
      'No simulator directories found. Run "Ethos: Add Simulator" first.',
    );
    return;
  }

  const config = vscode.workspace.getConfiguration();
  const currentFirmware = config.get<string>('ethos.firmware', '');
  const currentVersion = config.get<string>('ethos.version', DEFAULT_VERSION);
  const currentDirName =
    currentVersion !== DEFAULT_VERSION
      ? `${currentFirmware}@${currentVersion}`
      : currentFirmware;

  const ADD_SIMULATOR_LABEL = '$(add) Add Simulator';
  const items: vscode.QuickPickItem[] = [
    ...options.map(opt => ({
      label: opt,
      description: opt === currentDirName ? '(active)' : undefined,
    })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: ADD_SIMULATOR_LABEL },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select simulator firmware',
    title: 'Ethos: Set Simulator',
  });
  if (!picked) { return; }

  if (picked.label === ADD_SIMULATOR_LABEL) {
    vscode.commands.executeCommand('ethos.addSimulator').then(undefined, err =>
      console.error('Ethos: addSimulator failed:', err),
    );
    return;
  }

  await applyFirmware(picked.label);
}

export async function applyFirmware(dirName: string): Promise<void> {
  const atIdx = dirName.indexOf('@');
  const firmware = atIdx !== -1 ? dirName.slice(0, atIdx) : dirName;
  const version = atIdx !== -1 ? dirName.slice(atIdx + 1) : DEFAULT_VERSION;
  const root = `${getSimulatorFolder()}/${dirName}`;

  const config = vscode.workspace.getConfiguration();
  await config.update('ethos.firmware', firmware, vscode.ConfigurationTarget.Workspace);
  await config.update('ethos.version', version, vscode.ConfigurationTarget.Workspace);
  await config.update('ethos.root', root, vscode.ConfigurationTarget.Workspace);
}
