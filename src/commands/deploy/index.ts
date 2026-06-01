import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
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

function isRadioTarget(target: string): boolean {
    return target === 'radio' || target === 'radio-lua' || target === 'radio-fast';
}

/** Normalize a step entry to a DeployStep object. */
function normalizeStep(step: string | DeployStep): DeployStep {
    if (typeof step === 'string') {
        return { script: step.trim() };
    }
    return { ...step, script: step.script.trim() };
}

/** Resolve VS Code-style variable substitutions in a string.
 * Supports ${workspaceFolder}, ${workspaceRoot}, and ${config:section.key}.
 * Unknown config values are substituted with an empty string.
 */
function resolveVariables(value: string, workspaceRoot: string): string {
    return value
        .replace(/\$\{workspaceFolder\}/g, workspaceRoot)
        .replace(/\$\{workspaceRoot\}/g, workspaceRoot)
        .replace(/\$\{config:([^}]+)\}/g, (_match, key: string) => {
            const dotIndex = key.indexOf('.');
            if (dotIndex === -1) {
                return vscode.workspace.getConfiguration().get<string>(key) ?? '';
            }
            const section = key.substring(0, dotIndex);
            const name = key.substring(dotIndex + 1);
            return vscode.workspace.getConfiguration(section).get<string>(name) ?? '';
        });
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
        const resolvedArgs = (normalized.args ?? []).map(a => resolveVariables(a, workspaceRoot));
        const resolvedEnvOverrides = normalized.env
            ? Object.fromEntries(Object.entries(normalized.env).map(([k, v]) => [k, resolveVariables(v, workspaceRoot)]))
            : undefined;
        const baseEnv = { ...process.env, DEST_PATH: destPath, SOURCE_PATH: sourcePath, WORKSPACE_ROOT: workspaceRoot, DEPLOY_TARGET: target };
        const env = resolvedEnvOverrides ? { ...baseEnv, ...resolvedEnvOverrides } : baseEnv;
        const script = normalized.script;

        // Detect .js / .mjs scripts (first token ends with .js or .mjs)
        const firstToken = script.split(/\s+/)[0];
        const isNode = /\.(m?js)$/i.test(firstToken);

        if (isNode) {
            const scriptPath = path.isAbsolute(firstToken)
                ? firstToken
                : path.join(workspaceRoot, firstToken);
            const child = fork(scriptPath, resolvedArgs, { cwd: workspaceRoot, env, silent: true });
            child.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.on('close', (code: number | null) => resolve(code ?? 1));
        } else {
            // Substitute ${destPath} and ${sourcePath} literals
            const cmd = [script, ...resolvedArgs].join(' ')
                .replace(/\$\{destPath\}/g, destPath)
                .replace(/\$\{sourcePath\}/g, sourcePath);
            const child = exec(cmd, { cwd: workspaceRoot, env });
            child.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
            child.on('close', (code: number | null) => resolve(code ?? 1));
        }
    });
}

async function runSteps(
    steps: (string | DeployStep)[],
    workspaceRoot: string,
    sourcePath: string,
    destPath: string,
    target: string,
    channel: vscode.OutputChannel
): Promise<number> {
    for (const step of steps) {
        const label = typeof step === 'string' ? step : JSON.stringify(step);
        channel.appendLine(`\n  > ${label}`);
        const code = await runStep(step, workspaceRoot, sourcePath, destPath, target, channel);
        if (code !== 0) {
            return code;
        }
    }

    return 0;
}

async function copyDirectory(sourceDir: string, destDir: string): Promise<void> {
    await fs.mkdir(destDir, { recursive: true });
    const entries = await fs.readdir(sourceDir, { recursive: true, encoding: 'utf8' });

    for (const rel of entries) {
        const sourceEntry = path.join(sourceDir, rel);
        const destEntry = path.join(destDir, rel);
        const stat = await fs.stat(sourceEntry);

        if (stat.isDirectory()) {
            await fs.mkdir(destEntry, { recursive: true });
            continue;
        }

        if (!stat.isFile()) {
            continue;
        }

        await fs.mkdir(path.dirname(destEntry), { recursive: true });
        await fs.copyFile(sourceEntry, destEntry);
    }
}

async function stageSourceForDeploy(
    sourcePath: string,
    appname: string,
    channel: vscode.OutputChannel
): Promise<{ stageRoot: string; stagedSourcePath: string }> {
    const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ethos-deploy-'));
    const stagedSourcePath = path.join(stageRoot, appname);

    channel.appendLine(`[stage] Creating temp staging directory: ${stageRoot}`);
    await copyDirectory(sourcePath, stagedSourcePath);
    channel.appendLine(`[stage] Source staged at: ${stagedSourcePath}`);

    return { stageRoot, stagedSourcePath };
}

async function cleanupStaging(stageRoot: string | undefined, channel: vscode.OutputChannel): Promise<void> {
    if (!stageRoot) {
        return;
    }

    try {
        await fs.rm(stageRoot, { recursive: true, force: true });
        channel.appendLine(`[stage] Removed temp staging directory: ${stageRoot}`);
    } catch (error) {
        channel.appendLine(`[stage] Warning: could not remove temp staging directory "${stageRoot}": ${error}`);
    }
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
    const stageSteps = deployConfig.stageSteps ?? [];
    const steps = deployConfig.steps ?? [];
    const shouldStage = stageSteps.length > 0;

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
    let effectiveSourcePath = sourcePath;
    let stageRoot: string | undefined;
    let didDeploy = false;
    let result: DeployTarget | undefined;

    channel.show(true);
    channel.appendLine(`\n--- Ethos Deploy (${target}): ${new Date().toLocaleTimeString()} ---`);
    channel.appendLine(`  source  : ${sourcePath}`);
    if (useManifest) { channel.appendLine(`  manifest: ${path.relative(workspaceRoot, manifestPath)}`); }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Ethos: Deploying…', cancellable: false },
        async () => {
            let finalizeOnError: (() => Promise<void>) | undefined;

            try {
                if (shouldStage) {
                    channel.appendLine('[stage] Preparing staged source…');
                    const staged = await stageSourceForDeploy(sourcePath, appname, channel);
                    stageRoot = staged.stageRoot;
                    effectiveSourcePath = staged.stagedSourcePath;
                    channel.appendLine(`  stage   : ${effectiveSourcePath}`);

                    const stageCode = await runSteps(stageSteps, workspaceRoot, sourcePath, effectiveSourcePath, target, channel);
                    if (stageCode !== 0) {
                        channel.appendLine(`  step failed with exit code ${stageCode}, aborting before copy.`);
                        vscode.window.showErrorMessage(`Ethos Deploy: step failed (exit ${stageCode}). See "Ethos Deploy" output.`);
                        return;
                    }
                }

                if (isRadioTarget(target)) {
                    result = await radioTarget(effectiveSourcePath, appname, projectManifest, deployConfig, workspaceRoot, channel, target);
                } else {
                    result = await simulatorTarget(effectiveSourcePath, appname, projectManifest, deployConfig, workspaceRoot, channel);
                }
                if (!result) {
                    return;
                }

                const { destAppPath, destBase, deploy, finalize } = result;
                finalizeOnError = finalize;

                channel.appendLine(`  dest    : ${path.relative(destBase, destAppPath)}`);

                await deploy();

                const stepCode = await runSteps(steps, workspaceRoot, sourcePath, destAppPath, target, channel);
                if (stepCode !== 0) {
                    channel.appendLine(`  step failed with exit code ${stepCode}, aborting remaining steps.`);
                    vscode.window.showErrorMessage(`Ethos Deploy: step failed (exit ${stepCode}). See "Ethos Deploy" output.`);
                    await finalize?.();
                    return;
                }

                await finalize?.();
                didDeploy = true;
            } catch (error) {
                vscode.window.showErrorMessage(`Ethos Deploy: ${error}`);

                if (finalizeOnError) {
                    try {
                        await finalizeOnError();
                    } catch (finalizeError) {
                        channel.appendLine(`[radio] Warning: finalize after failure also failed: ${finalizeError}`);
                    }
                }
            } finally {
                await cleanupStaging(stageRoot, channel);
            }
        }
    );

    if (didDeploy && result) {
        vscode.window.showInformationMessage(`Ethos: Deployed to ${path.relative(result.destBase, result.destAppPath)}`);
    }
}
