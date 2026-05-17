import * as vscode from 'vscode';

export const DEFAULT_VERSION = 'nightly26';
export const DEFAULT_SIMULATOR_FOLDER = 'simulator';

export function firmwareLabel(firmware: string, version: string | undefined): string {
  return version && version !== DEFAULT_VERSION ? `${firmware}@${version}` : firmware;
}

export function getSimulatorFolder(): string {
  const folder = vscode.workspace.getConfiguration().get<string>(
    'ethosSimManager.simulatorFolder',
    DEFAULT_SIMULATOR_FOLDER,
  );
  return folder.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SIMULATOR_FOLDER;
}
