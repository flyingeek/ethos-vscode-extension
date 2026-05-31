import * as vscode from 'vscode';
import type { EthosMeta, DeployConfig, DeployTarget } from './types';

export async function radioTarget(
    _sourcePath: string,
    _appname: string,
    _projectManifest: EthosMeta | undefined,
    _deployConfig: DeployConfig,
    _workspaceRoot: string,
    _channel: vscode.OutputChannel
): Promise<DeployTarget | undefined> {
    vscode.window.showInformationMessage('Ethos: Deploy to radio is not yet implemented.');
    return undefined;
}
