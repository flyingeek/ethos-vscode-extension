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
    console.error('Ethos DevTools: failed to activate API:', err);
    return undefined;
  }
}

export type SensorInfo = { name: string; appId?: number };

export function normalizeSensors(raw: unknown): SensorInfo[] {
  if (!Array.isArray(raw) || raw.length === 0) { return []; }
  if (typeof raw[0] === 'string') {
    return (raw as string[]).map(name => ({ name }));
  }
  return (raw as { name: string; appId: number }[]).map(s => ({ name: s.name, appId: s.appId }));
}
