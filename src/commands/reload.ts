import * as vscode from 'vscode';

interface ReloadAction {
    command?: string | string[];
    task?: string;
}

export async function reloadCommand(): Promise<void> {
    const action = vscode.workspace.getConfiguration('ethosExt').get<ReloadAction>('reload') ?? {};

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
        vscode.commands
            .executeCommand('workbench.action.tasks.runTask', action.task)
            .then(undefined, (err) => console.error(`Ethos: task '${action.task}' failed:`, err));
    }
}
