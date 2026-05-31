import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { EthosMeta, DeployConfig, DeployTarget } from './types';
import { resolvePath, expandGlob } from './utils';

/** Sync all files from srcDir into destDir: copy new/changed, delete stale. */
async function syncAll(srcDir: string, destDir: string, channel: vscode.OutputChannel): Promise<{ copiedCount: number; deletedCount: number }> {
    let copiedCount = 0;
    let deletedCount = 0;
    const srcEntries = await fs.readdir(srcDir, { recursive: true, encoding: 'utf8' });
    const srcSet = new Set<string>();

    for (const rel of srcEntries) {
        const src = path.join(srcDir, rel);
        const dest = path.join(destDir, rel);
        const stat = await fs.stat(src);
        if (stat.isFile()) {
            srcSet.add(rel);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.copyFile(src, dest);
            channel.appendLine(`  copied : ${rel}`);
            copiedCount++;
        }
    }

    // Delete files in dest that no longer exist in source
    try {
        const destEntries = await fs.readdir(destDir, { recursive: true, encoding: 'utf8' });
        for (const rel of destEntries) {
            if (srcSet.has(rel)) { continue; }
            const destFile = path.join(destDir, rel);
            try {
                const stat = await fs.stat(destFile);
                if (stat.isFile()) {
                    await fs.unlink(destFile);
                    channel.appendLine(`  deleted: ${rel}`);
                    deletedCount++;
                }
            } catch { /* already gone */ }
        }
    } catch { /* destDir did not exist yet, nothing to clean */ }

    return { copiedCount, deletedCount };
}

/** Sync files using a manifest: delete files listed in the old dest manifest, copy files
 *  listed in the new source manifest, then write the manifest itself to dest. */
async function syncFromManifest(
    sourcePath: string,
    destAppPath: string,
    destManifestPath: string,
    projectManifest: EthosMeta,
    sourceManifestPath: string,
    channel: vscode.OutputChannel
): Promise<{ copiedCount: number; deletedCount: number }> {
    // --- Delete files listed in existing destination manifest ---
    let deletedCount = 0;
    try {
        const destManifestRaw = await fs.readFile(destManifestPath, 'utf-8');
        const destMeta = JSON.parse(destManifestRaw) as EthosMeta;
        const folderPrefix = destMeta.folder + '/';
        for (const pattern of destMeta.files) {
            const rel = pattern.startsWith(folderPrefix) ? pattern.slice(folderPrefix.length) : pattern;
            const resolved = await expandGlob(rel, destAppPath);
            for (const f of resolved) {
                try {
                    await fs.unlink(path.join(destAppPath, f));
                    channel.appendLine(`  deleted: ${f}`);
                    deletedCount++;
                } catch { /* already gone */ }
            }
        }
    } catch {
        // No existing manifest — delete all files currently in destAppPath
        try {
            const destEntries = await fs.readdir(destAppPath, { recursive: true, encoding: 'utf8' });
            for (const rel of destEntries) {
                const destFile = path.join(destAppPath, rel);
                try {
                    const stat = await fs.stat(destFile);
                    if (stat.isFile()) {
                        await fs.unlink(destFile);
                        channel.appendLine(`  deleted: ${rel}`);
                        deletedCount++;
                    }
                } catch { /* already gone */ }
            }
        } catch { /* destAppPath did not exist yet, nothing to clean */ }
    }

    // --- Copy files listed in source manifest ---
    let copiedCount = 0;
    const folderPrefix = projectManifest.folder + '/';
    for (const pattern of projectManifest.files) {
        const rel = pattern.startsWith(folderPrefix) ? pattern.slice(folderPrefix.length) : pattern;
        const resolved = await expandGlob(rel, sourcePath);
        if (resolved.length === 0) {
            channel.appendLine(`  warning: no files matched pattern "${pattern}"`);
            continue;
        }
        for (const f of resolved) {
            const src = path.join(sourcePath, f);
            const dest = path.join(destAppPath, f);
            try {
                await fs.mkdir(path.dirname(dest), { recursive: true });
                await fs.copyFile(src, dest);
                channel.appendLine(`  copied: ${f}`);
                copiedCount++;
            } catch (e) {
                channel.appendLine(`  warning: could not copy "${f}": ${(e as Error).message}`);
            }
        }
    }

    // --- Copy manifest to destination ---
    await fs.copyFile(sourceManifestPath, destManifestPath);
    channel.appendLine(`  copied: ethos_lua_manifest.json`);

    return { copiedCount, deletedCount };
}

export async function simulatorTarget(
    sourcePath: string,
    appname: string,
    projectManifest: EthosMeta | undefined,
    deployConfig: DeployConfig,
    workspaceRoot: string,
    channel: vscode.OutputChannel
): Promise<DeployTarget | undefined> {
    const ethosConfig = vscode.workspace.getConfiguration('ethos');
    const simulatorsFolder = ethosConfig.get<string>('simulatorsFolder');
    const board = ethosConfig.get<string>('board');
    const protocol = ethosConfig.get<string>('protocol');
    const release = ethosConfig.get<string>('release');

    const missing: string[] = [];
    if (!simulatorsFolder) { missing.push('ethos.simulatorsFolder'); }
    if (!board)            { missing.push('ethos.board'); }
    if (!protocol)         { missing.push('ethos.protocol'); }
    if (!release)          { missing.push('ethos.release'); }
    if (missing.length > 0) {
        vscode.window.showErrorMessage(`Ethos Deploy: missing settings: ${missing.join(', ')}`);
        return undefined;
    }

    const destBase = resolvePath(simulatorsFolder!, workspaceRoot);
    const destAppPath = path.join(destBase, `${board}_${protocol}@${release}`, 'scripts', appname);

    const destManifestPath = path.join(destAppPath, 'ethos_lua_manifest.json');
    const sourceManifestPath = projectManifest
        ? (path.isAbsolute(deployConfig.manifest!) ? deployConfig.manifest! : path.join(workspaceRoot, deployConfig.manifest!))
        : '';

    const deploy = async (): Promise<void> => {
        await fs.mkdir(destAppPath, { recursive: true });

        const { copiedCount, deletedCount } = projectManifest
            ? await syncFromManifest(sourcePath, destAppPath, destManifestPath, projectManifest, sourceManifestPath, channel)
            : await syncAll(sourcePath, destAppPath, channel);

        channel.appendLine(`  --- ${copiedCount} file(s) copied, ${deletedCount} deleted ---`);
    };

    return { destAppPath, destBase, deploy };
}
