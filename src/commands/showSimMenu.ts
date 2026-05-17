import * as vscode from 'vscode';
import { firmwareLabel } from '../constants';

interface SimMenuItem {
  label: string;
  command?: string | string[];
  task?: string;
  description?: string;
  separator?: boolean;
}

function fallback(): void {
  vscode.commands.executeCommand('ethosSimManager.setSimulator');
}

export async function showSimMenu(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    return;
  }

  const menuUri = vscode.Uri.joinPath(workspaceRoot, '.vscode', 'sim-menu.json');
  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(menuUri);
    content = Buffer.from(bytes).toString('utf-8');
  } catch {
    fallback();
    return;
  }

  let items: SimMenuItem[];
  try {
    items = JSON.parse(content) as SimMenuItem[];
    if (!Array.isArray(items)) { fallback(); return; }
  } catch {
    fallback();
    return;
  }

  const pickItems: vscode.QuickPickItem[] = [];
  const actionItems: (SimMenuItem | null)[] = [];

  for (const item of items) {
    if (item.separator) {
      pickItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
      actionItems.push(null);
    } else {
      pickItems.push({ label: item.label, description: item.description });
      actionItems.push(item);
    }
  }

  if (pickItems.length === 0) {
    fallback();
    return;
  }

  const config = vscode.workspace.getConfiguration();
  const firmware = config.get<string>('ethosSimManager.firmware');
  const version = config.get<string>('ethosSimManager.version');
  const activeName = firmware ? firmwareLabel(firmware, version) : undefined;
  const placeHolder = activeName ? `Active: ${activeName}` : 'Select action';

  const picked = await vscode.window.showQuickPick(pickItems, {
    placeHolder,
    title: 'Ethos',
  });
  if (!picked) { return; }

  const idx = pickItems.indexOf(picked);
  const action = idx !== -1 ? actionItems[idx] : null;
  if (!action) { return; }

  if (action.command) {
    const commands = Array.isArray(action.command) ? action.command : [action.command];
    for (const cmd of commands) {
      try {
        await vscode.commands.executeCommand(cmd);
      } catch (err) {
        console.error(`Ethos: command '${cmd}' failed:`, err);
      }
    }
  } else if (action.task) {
    vscode.commands.executeCommand('workbench.action.tasks.runTask', action.task).then(undefined, err =>
      console.error(`Ethos: task '${action.task}' failed:`, err),
    );
  }
}
