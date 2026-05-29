import * as vscode from 'vscode';

export interface EthosApi {
  isRunning: () => boolean;
  onDidChangeRunningState: vscode.Event<boolean>;
}

export async function getEthosApi(): Promise<EthosApi | undefined> {
  const extension = vscode.extensions.getExtension<EthosApi>('bsongis.ethos');
  if (!extension) {
    return undefined;
  }

  try {
    return await extension.activate();
  } catch (err) {
    console.error('Ethos: failed to activate API:', err);
    return undefined;
  }
}
