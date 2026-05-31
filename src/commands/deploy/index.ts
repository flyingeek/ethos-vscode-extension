import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fork, exec } from 'child_process';
import type { EthosMeta, DeployConfig, DeployStep, DeployTarget } from './types';
import { simulatorTarget } from './simulator';
import { radioTarget } from './radio';

let deployOutputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!deployOutputChannel) {
        deployOutputChannel = vscode.window.createOutputChannel('Ethos Deploy');
    }
    return deployOutputChannel;
}

/** Normalize a step entry to a DeployStep object. */
function normalizeStep(step: string | DeployStep): DeployStep {
    if (typeof step === 'string') {
        return { script: step.trim() };
    }
    return { ...step, script: step.script.trim() };
}

/** Run a single post-deploy step. Returns exit code. */
function runStep(
    step: string | DeployStep,
    workspaceRoot: string,
    sourcePath: string,
    destPath: string,
    target: string,
    channel: vscode.OutputChannel
): Promise<number> {
    return new Promise((resolve) => {
        const normalized = normalizeStep(step);
        const baseEnv = { ...process.env, DEST_PATH: destPath, SOURCE_PATH: sourcePath, WORKSPACE_ROOT: workspaceRoot, DEPLOY_TARGET: target };
        const env = normalized.env ? { ...baseEnv, ...normalized.env } : baseEnv;
        const script = normalized.script;

        // Detect .js / .mjs scripts (first token ends with .js or .mjs)
        const firstToken = script.split(/\s+/)[0];
        const isNode = /\.(m?js)$/i.test(firstToken);

        if (isNode) {
            const scriptPath = path.isAbsolute(firstToken)
                ? firstToken
                : path.join(workspaceRoot, firstToken);
            const args = normalized.args ?? [];
            const child = fork(scriptPath, args, { cwd: workspaceRoot, env, silent: true });
            child.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.on('close', (code: number | null) => resolve(code ?? 1));
        } else {
            // Substitute ${destPath} and ${sourcePath} literals
            const args = normalized.args ?? [];
            const cmd = [script, ...args].join(' ')
                .replace(/\$\{destPath\}/g, destPath)
                .replace(/\$\{sourcePath\}/g, sourcePath);
            const child = exec(cmd, { cwd: workspaceRoot, env });
            child.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.on('close', (code: number | null) => resolve(code ?? 1));
        }
    });
}

export async function deployCommand(target: string = 'simulator'): Promise<void> {
    // --- Read ethosExt.deploy config ---
    const extConfig = vscode.workspace.getConfiguration('ethosExt');
    const deployConfig = extConfig.get<DeployConfig>('deploy') ?? {};

    const appRelative = deployConfig.app;
    if (!appRelative) {
        vscode.window.showErrorMessage('Ethos Deploy: ethosExt.deploy.app is not set.');
        return;
    }

    const manifestConfig = deployConfig.manifest ?? '';
    const useManifest = manifestConfig.trim() !== '';
    const steps = deployConfig.steps ?? [];

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Ethos Deploy: no workspace folder open.');
        return;
    }

    const sourcePath = path.join(workspaceRoot, appRelative);

    // --- Resolve appname ---
    let appname: string;
    let projectManifest: EthosMeta | undefined;

    let manifestPath = '';
    if (useManifest) {
        const manifestRelative = deployConfig.manifest!;
        manifestPath = path.isAbsolute(manifestRelative)
            ? manifestRelative
            : path.join(workspaceRoot, manifestRelative);

        let raw: string;
        try {
            raw = await fs.readFile(manifestPath, 'utf-8');
        } catch {
            vscode.window.showErrorMessage(`Ethos Deploy: cannot read manifest at ${manifestPath}`);
            return;
        }

        let parsed: EthosMeta;
        try {
            parsed = JSON.parse(raw) as EthosMeta;
        } catch {
            vscode.window.showErrorMessage(`Ethos Deploy: manifest is not valid JSON at ${manifestPath}`);
            return;
        }

        if (parsed.manifestVersion !== 1) {
            vscode.window.showErrorMessage(
                `Ethos Deploy: unsupported manifest version ${parsed.manifestVersion} (expected 1).`
            );
            return;
        }

        projectManifest = parsed;
        appname = parsed.folder;

        const sourceBasename = path.basename(appRelative);
        if (sourceBasename !== parsed.folder) {
            vscode.window.showErrorMessage(
                `Ethos Deploy: source folder "${sourceBasename}" does not match manifest.folder "${parsed.folder}". Rename the source folder or set the manifest setting to an empty string to disable manifest-mode.`
            );
            return;
        }
    } else {
        appname = path.basename(appRelative);
    }

    const channel = getOutputChannel();

    // --- Dispatch to target ---
    let result: DeployTarget | undefined;
    if (target === 'radio' || target === 'radio-lua' || target === 'radio-fast') {
        result = await radioTarget(sourcePath, appname, projectManifest, deployConfig, workspaceRoot, channel, target);
    } else {
        result = await simulatorTarget(sourcePath, appname, projectManifest, deployConfig, workspaceRoot, channel);
    }
    if (!result) { return; }

    const { destAppPath, destBase, deploy, finalize } = result;

    channel.show(true);
    channel.appendLine(`\n--- Ethos Deploy (${target}): ${new Date().toLocaleTimeString()} ---`);
    channel.appendLine(`  source  : ${sourcePath}`);
    channel.appendLine(`  dest    : ${path.relative(destBase, destAppPath)}`);
    if (useManifest) { channel.appendLine(`  manifest: ${path.relative(workspaceRoot, manifestPath)}`); }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Ethos: Deploying…', cancellable: false },
        async () => {
            await deploy();

            // --- Post-deploy steps (volume still mounted) ---
            for (const step of steps) {
                const label = typeof step === 'string' ? step : JSON.stringify(step);
                channel.appendLine(`\n  > ${label}`);
                const code = await runStep(step, workspaceRoot, sourcePath, destAppPath, target, channel);
                if (code !== 0) {
                    channel.appendLine(`  step failed with exit code ${code}, aborting remaining steps.`);
                    vscode.window.showErrorMessage(`Ethos Deploy: step failed (exit ${code}). See "Ethos Deploy" output.`);
                    await finalize?.();
                    return;
                }
            }

            // --- Unmount + close HID after steps have finished ---
            await finalize?.();
        }
    );

    vscode.window.showInformationMessage(`Ethos: Deployed to ${path.relative(destBase, destAppPath)}`);
}
