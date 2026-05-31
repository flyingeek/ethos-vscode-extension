export interface EthosMeta {
    manifestVersion: number;
    folder: string;
    files: string[];
}

export interface DeployStep {
    script: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface DeployConfig {
    app?: string;
    manifest?: string;
    steps?: (string | DeployStep)[];
}

export interface DeployTarget {
    destAppPath: string;
    destBase: string;
    deploy: () => Promise<void>;
}
