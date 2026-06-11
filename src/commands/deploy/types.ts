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
    multiApp?: boolean;
    manifest?: string;
    stageSteps?: (string | DeployStep)[];
    steps?: (string | DeployStep)[];
}

export interface DeployTarget {
    destAppPath: string;
    destBase: string;
    deploy: () => Promise<void>;
    /** Called after post-deploy steps to unmount volumes and close HID. */
    finalize?: () => Promise<void>;
}
