import * as vscode from 'vscode';
import * as jsoncParser from 'jsonc-parser';
import { fetchStructuredData } from '../api';
import { applyFirmware } from './setSimulator';
import { DEFAULT_VERSION, getSimulatorFolder } from '../constants';

export async function addSimulator(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  let structured: Awaited<ReturnType<typeof fetchStructuredData>>;
  try {
    structured = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching Ethos firmware data…',
        cancellable: false,
      },
      () => fetchStructuredData(context),
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to fetch firmware data: ${(err as Error).message}`);
    return;
  }

  const protocols = Object.keys(structured).sort();
  if (protocols.length === 0) {
    vscode.window.showErrorMessage('No firmware data returned from API.');
    return;
  }

  const protocol = await vscode.window.showQuickPick(protocols, {
    placeHolder: 'Select protocol',
    title: 'Add Simulator (1/3)',
  });
  if (!protocol) { return; }

  const versions = Object.keys(structured[protocol]).sort();
  const version = await vscode.window.showQuickPick(versions, {
    placeHolder: 'Select version',
    title: 'Add Simulator (2/3)',
  });
  if (!version) { return; }

  const radios = structured[protocol][version];
  const radio = await vscode.window.showQuickPick(radios, {
    placeHolder: 'Select radio board',
    title: 'Add Simulator (3/3)',
  });
  if (!radio) { return; }

  const firmwareName = `${radio}_${protocol}`;
  const dirName = version === DEFAULT_VERSION ? firmwareName : `${firmwareName}@${version}`;

  const simulatorUri = vscode.Uri.joinPath(workspaceRoot, getSimulatorFolder());
  const targetUri = vscode.Uri.joinPath(simulatorUri, dirName);

  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(targetUri, 'models'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(targetUri, 'scripts'));
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create simulator directory: ${(err as Error).message}`);
    return;
  }

  await updateTasksFirmwareOptions(workspaceRoot, simulatorUri);
  await applyFirmware(dirName);
}

async function updateTasksFirmwareOptions(
  workspaceRoot: vscode.Uri,
  simulatorUri: vscode.Uri,
): Promise<void> {
  const tasksUri = vscode.Uri.joinPath(workspaceRoot, '.vscode', 'tasks.json');

  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(tasksUri);
    content = Buffer.from(bytes).toString('utf-8');
  } catch {
    return; // tasks.json not found – skip
  }

  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(simulatorUri);
  } catch {
    return;
  }

  const firmwareOptions = entries
    .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.'))
    .map(([name]) => name)
    .sort();

  const firmwareInput = {
    id: 'firmware',
    type: 'pickString',
    description: 'Select simulator firmware',
    options: firmwareOptions,
  };

  const modOpts: jsoncParser.ModificationOptions = {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  };

  const parsed = jsoncParser.parse(content) as { inputs?: Array<{ id?: string }> };
  const inputs = parsed.inputs;

  let edits: jsoncParser.Edit[];
  if (!inputs) {
    edits = jsoncParser.modify(content, ['inputs'], [firmwareInput], modOpts);
  } else {
    const idx = inputs.findIndex(i => i.id === 'firmware');
    if (idx !== -1) {
      edits = jsoncParser.modify(content, ['inputs', idx], firmwareInput, modOpts);
    } else {
      edits = jsoncParser.modify(content, ['inputs', inputs.length], firmwareInput, modOpts);
    }
  }

  const updated = jsoncParser.applyEdits(content, edits);
  await vscode.workspace.fs.writeFile(tasksUri, Buffer.from(updated, 'utf-8'));
}
