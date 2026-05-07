import * as vscode from 'vscode';
import * as jsoncParser from 'jsonc-parser';

const DEFAULT_VERSION = 'nightly26';

interface SimMenuItem {
  label: string;
  command?: string;
  task?: string;
  description?: string;
  separator?: boolean;
}

async function buildTooltip(): Promise<vscode.MarkdownString | string> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    return 'Ethos: Set Simulator';
  }

  const menuUri = vscode.Uri.joinPath(workspaceRoot, '.vscode', 'sim-menu.json');
  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(menuUri);
    content = Buffer.from(bytes).toString('utf-8');
  } catch {
    return 'Ethos: Set Simulator';
  }

  let items: SimMenuItem[];
  try {
    items = jsoncParser.parse(content) as SimMenuItem[];
    if (!Array.isArray(items)) { return 'Ethos: Set Simulator'; }
  } catch {
    return 'Ethos: Set Simulator';
  }

  const lines: string[] = [];
  for (const item of items) {
    if (item.separator) {
      lines.push('---');
    } else if (item.command) {
      const uri = `command:${item.command}`;
      const text = item.description ? `${item.label} — ${item.description}` : item.label;
      lines.push(`[${text}](${uri})`);
    } else if (item.task) {
      const args = encodeURIComponent(JSON.stringify([item.task]));
      const uri = `command:workbench.action.tasks.runTask?${args}`;
      const text = item.description ? `${item.label} — ${item.description}` : item.label;
      lines.push(`[${text}](${uri})`);
    }
  }

  if (lines.length === 0) {
    return 'Ethos: Set Simulator';
  }

  const md = new vscode.MarkdownString(lines.join('\n\n'), true);
  md.isTrusted = true;
  return md;
}

export function createStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'ethos.setSimulator';
  item.tooltip = 'Ethos: Set Simulator';

  async function refresh(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration();
      const firmware = config.get<string>('ethos.firmware');
      const version = config.get<string>('ethos.version');
      if (firmware) {
        const label =
          version && version !== DEFAULT_VERSION ? `${firmware}@${version}` : firmware;
        item.text = `$(radio-tower) ${label}`;
      } else {
        item.text = '$(radio-tower) Set firmware';
      }
      item.tooltip = await buildTooltip();
      item.show();
    } catch (err) {
      console.error('Ethos status bar refresh failed:', err);
    }
  }

  refresh();

  const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/sim-menu.json');

  context.subscriptions.push(
    item,
    watcher,
    watcher.onDidChange(() => refresh()),
    watcher.onDidCreate(() => refresh()),
    watcher.onDidDelete(() => refresh()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('ethos')) {
        refresh();
      }
    }),
  );
}
