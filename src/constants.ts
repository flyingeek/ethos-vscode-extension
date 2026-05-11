export const DEFAULT_VERSION = 'nightly26';

export function firmwareLabel(firmware: string, version: string | undefined): string {
  return version && version !== DEFAULT_VERSION ? `${firmware}@${version}` : firmware;
}
