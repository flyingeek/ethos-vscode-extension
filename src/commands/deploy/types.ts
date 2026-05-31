export interface EthosMeta {
    manifestVersion: number;
    folder: string;
    files: string[];
}

export interface DeployConfig {
    app?: string;
    manifest?: string;
    steps?: string[];
}

export interface DeployTarget {
    destAppPath: string;
    destBase: string;
    deploy: () => Promise<void>;
}
