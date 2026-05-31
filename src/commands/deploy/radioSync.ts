/**
 * FAT32-safe radio sync primitives.
 *
 * All functions in this module are specifically written for writing to a
 * removable FAT32 volume over USB (the Ethos radio in mass-storage mode).
 * They must NOT share code with simulator.ts — FAT32 over USB requires:
 *   - chunked writes with periodic datasync
 *   - explicit inter-file settle delays
 *   - throttled deletes with fsync between each file
 *
 * Constants mirror deploy.py:
 *   THROTTLE_CHUNK      = 32 KiB   (read/write chunk size)
 *   THROTTLE_PAUSE_EVERY= 64 KiB   (datasync + sleep after this many bytes)
 *   THROTTLE_PAUSE_MS   = 100 ms
 *   COPY_SETTLE_MS      = 50 ms    (after file close)
 *   LUA_INTER_FILE_MS   = 20 ms    (between files in lua-copy mode)
 *   DELETE_PAUSE_MS     = 100 ms   (between file deletions)
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import type { EthosMeta } from './types';
import { expandGlob } from './utils';

const THROTTLE_CHUNK       = 32  * 1024; // 32 KiB
const THROTTLE_PAUSE_EVERY = 64  * 1024; // datasync + sleep every 64 KiB written
const THROTTLE_PAUSE_MS    = 100;        // ms to sleep after datasync
const COPY_SETTLE_MS       = 50;         // ms settle after file close
const LUA_INTER_FILE_MS    = 20;         // ms between files in lua-copy mode
const DELETE_PAUSE_MS      = 100;        // ms between file deletions

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// flushFs
// ---------------------------------------------------------------------------

/**
 * Best-effort equivalent of Python's os.sync() — flush all kernel disk
 * buffers.  On Unix runs the `sync` shell command; no-op on Windows.
 */
export async function flushFs(): Promise<void> {
    if (process.platform === 'win32') { return; }
    await new Promise<void>(resolve => exec('sync', () => resolve()));
}

// ---------------------------------------------------------------------------
// throttledCopyFile
// ---------------------------------------------------------------------------

/**
 * Copy a file using 32 KiB chunks with a datasync + 100 ms pause every
 * 64 KiB written, then a 50 ms settle after close.
 * Mirrors throttled_copyfile() in deploy.py.
 */
export async function throttledCopyFile(src: string, dst: string): Promise<void> {
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const srcFd = await fs.open(src, 'r');
    const dstFd = await fs.open(dst, 'w');
    try {
        let sincePause = 0;
        const buf = Buffer.allocUnsafe(THROTTLE_CHUNK);
        while (true) {
            const { bytesRead } = await srcFd.read(buf, 0, THROTTLE_CHUNK, null);
            if (bytesRead === 0) { break; }
            await dstFd.write(buf, 0, bytesRead);
            sincePause += bytesRead;
            if (sincePause >= THROTTLE_PAUSE_EVERY) {
                await dstFd.datasync();
                await sleep(THROTTLE_PAUSE_MS);
                sincePause = 0;
            }
        }
        await dstFd.datasync();
    } finally {
        await srcFd.close();
        await dstFd.close();
    }
    await sleep(COPY_SETTLE_MS);
}

// ---------------------------------------------------------------------------
// fileMd5
// ---------------------------------------------------------------------------

/** Compute the MD5 hash of a file via streaming read. */
export async function fileMd5(filePath: string): Promise<string> {
    const hash = crypto.createHash('md5');
    const fd = await fs.open(filePath, 'r');
    try {
        const buf = Buffer.allocUnsafe(1024 * 1024); // 1 MiB chunks
        while (true) {
            const { bytesRead } = await fd.read(buf, 0, buf.length, null);
            if (bytesRead === 0) { break; }
            hash.update(buf.subarray(0, bytesRead));
        }
    } finally {
        await fd.close();
    }
    return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// needsCopy
// ---------------------------------------------------------------------------

/**
 * Decide whether src needs to be copied to dst.
 * Mirrors _needs_copy_with_md5() in deploy.py:
 *   - dst missing or size differs → true
 *   - same size + |mtime diff| ≤ tsSlackMs → false (fast path)
 *   - same size + mtime drifted → MD5 comparison
 */
export async function needsCopy(srcPath: string, dstPath: string, tsSlackMs = 2000): Promise<boolean> {
    let srcStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
        srcStat = await fs.stat(srcPath);
    } catch {
        return false; // source missing — nothing to copy
    }

    let dstStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
        dstStat = await fs.stat(dstPath);
    } catch {
        return true; // dest missing
    }

    if (srcStat.size !== dstStat.size) { return true; }

    // Fast path: same size + near-identical mtime → unchanged
    if (Math.abs(srcStat.mtimeMs - dstStat.mtimeMs) <= tsSlackMs) { return false; }

    // Fall back to MD5
    try {
        return (await fileMd5(srcPath)) !== (await fileMd5(dstPath));
    } catch {
        return true;
    }
}

// ---------------------------------------------------------------------------
// throttledRmtree
// ---------------------------------------------------------------------------

/**
 * Delete a directory tree using throttled per-file unlinking.
 * Mirrors throttled_rmtree() in deploy.py:
 *   DELETE_BATCH=1, DELETE_PAUSE_S=100ms, flushFs after each file.
 */
export async function throttledRmtree(root: string): Promise<void> {
    let allRels: string[];
    try {
        allRels = await fs.readdir(root, { recursive: true, encoding: 'utf8' });
    } catch {
        return; // root does not exist
    }

    const files: string[] = [];
    const dirPaths: string[] = [];
    for (const rel of allRels) {
        const full = path.join(root, rel);
        try {
            const stat = await fs.stat(full);
            if (stat.isFile()) { files.push(full); }
            else if (stat.isDirectory()) { dirPaths.push(full); }
        } catch { /* skip */ }
    }

    // Delete files with throttled pauses
    for (const file of files) {
        try { await fs.unlink(file); } catch { /* best-effort */ }
        await flushFs();
        await sleep(DELETE_PAUSE_MS);
    }

    // Remove directories deepest-first
    dirPaths.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
    for (const d of dirPaths) {
        try { await fs.rmdir(d); } catch { /* may be non-empty or already gone */ }
    }

    // Remove root itself
    try { await fs.rmdir(root); } catch { /* best-effort */ }
    await flushFs();
    await sleep(DELETE_PAUSE_MS);
}

// ---------------------------------------------------------------------------
// radioSafeFullCopy
// ---------------------------------------------------------------------------

/**
 * Safe full-copy for slow FAT32 targets.  Mirrors safe_full_copy() in deploy.py.
 *
 * Strategy:
 *   1. If dstDir exists and dstDir.old exists (leftover from a previous failed
 *      run): throttledRmtree(dstDir.old) + flushFs().
 *   2. Rename dstDir → dstDir.old (atomic on same FAT32 volume).  If rename
 *      fails (cross-device or locked): throttledRmtree(dstDir).
 *   3. flushFs() + 2 s settle.
 *   4. mkdir dstDir; walk srcDir and throttledCopyFile + flushFs per file.
 *   5. On success: throttledRmtree(dstDir.old).
 *
 * The rename-to-.old guarantees the previous version survives a partial copy.
 */
export async function radioSafeFullCopy(
    srcDir: string,
    dstDir: string,
    channel: vscode.OutputChannel
): Promise<void> {
    const oldDir = dstDir + '.old';

    // Step 1: clean up leftover .old from a previous failed run
    try {
        await fs.access(oldDir);
        channel.appendLine('  [radio] removing leftover .old backup…');
        await throttledRmtree(oldDir);
        await flushFs();
    } catch { /* no .old exists */ }

    // Step 2: rename current dest to .old (or throttled-delete if rename fails)
    try {
        await fs.access(dstDir);
        try {
            await fs.rename(dstDir, oldDir);
        } catch {
            channel.appendLine('  [radio] rename to .old failed — falling back to throttled delete…');
            await throttledRmtree(dstDir);
        }
    } catch { /* dstDir does not exist — first deploy, nothing to rename */ }

    // Step 3: settle (mirrors flush_fs() + time.sleep(2) in safe_full_copy)
    await flushFs();
    await sleep(2000);

    // Step 4: copy all files from srcDir to dstDir
    await fs.mkdir(dstDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { recursive: true, encoding: 'utf8' });
    for (const rel of entries) {
        const src = path.join(srcDir, rel);
        const dst = path.join(dstDir, rel);
        try {
            if ((await fs.stat(src)).isFile()) {
                await throttledCopyFile(src, dst);
                await flushFs();
                channel.appendLine(`  copied : ${rel}`);
            }
        } catch (e) {
            channel.appendLine(`  error copying ${rel}: ${e}`);
        }
    }

    // Step 5: remove .old on success
    try {
        await fs.access(oldDir);
        await throttledRmtree(oldDir);
    } catch { /* no .old to clean */ }
}

// ---------------------------------------------------------------------------
// radioMirrorCopy  (wired to ethosExt.deployRadioFast)
// ---------------------------------------------------------------------------

/**
 * Incremental mirror copy with MD5-based change detection.
 * Mirrors mirror_copy() in deploy.py with DEPLOY_TO_RADIO=True.
 *
 * Used by the 'radio-fast' target (ethosExt.deployRadioFast command).
 */
export async function radioMirrorCopy(
    srcDir: string,
    dstDir: string,
    channel: vscode.OutputChannel,
    deleteStale = true
): Promise<{ copiedCount: number; deletedCount: number }> {
    await fs.mkdir(dstDir, { recursive: true });

    // Build src file map (relative path → absolute path)
    const srcRels = await fs.readdir(srcDir, { recursive: true, encoding: 'utf8' });
    const srcFiles = new Map<string, string>();
    for (const rel of srcRels) {
        const full = path.join(srcDir, rel);
        try {
            if ((await fs.stat(full)).isFile()) { srcFiles.set(rel, full); }
        } catch { /* skip */ }
    }

    // Verification pass: build toCopy list
    const toCopy: Array<{ rel: string; src: string; dst: string }> = [];
    for (const [rel, srcFull] of srcFiles) {
        const dstFull = path.join(dstDir, rel);
        if (await needsCopy(srcFull, dstFull)) {
            toCopy.push({ rel, src: srcFull, dst: dstFull });
        }
    }

    // Stale detection
    const dstRels = await fs.readdir(dstDir, { recursive: true, encoding: 'utf8' }).catch(() => [] as string[]);
    const stale: string[] = [];
    if (deleteStale) {
        for (const rel of dstRels) {
            if (srcFiles.has(rel)) { continue; }
            const full = path.join(dstDir, rel);
            try {
                if ((await fs.stat(full)).isFile()) { stale.push(full); }
            } catch { /* skip */ }
        }
    }

    if (toCopy.length === 0 && stale.length === 0) {
        channel.appendLine('  Fast deploy: nothing to update.');
        return { copiedCount: 0, deletedCount: 0 };
    }

    // Copy pass
    for (const { rel, src, dst } of toCopy) {
        await throttledCopyFile(src, dst);
        await flushFs();
        await sleep(50); // 50 ms inter-file settle (mirror_copy path)
        channel.appendLine(`  copied : ${rel}`);
    }

    // Stale deletion
    let deletedCount = 0;
    for (const full of stale) {
        try {
            await fs.unlink(full);
            await flushFs();
            await sleep(DELETE_PAUSE_MS);
            channel.appendLine(`  deleted: ${path.relative(dstDir, full)}`);
            deletedCount++;
        } catch { /* best-effort */ }
    }
    if (deletedCount > 0) {
        channel.appendLine(`  Removed ${deletedCount} stale file(s).`);
    }

    return { copiedCount: toCopy.length, deletedCount };
}

// ---------------------------------------------------------------------------
// radioLuaCopy
// ---------------------------------------------------------------------------

/**
 * Lua-only copy for large projects.  Mirrors the fileext=='.lua' +
 * DEPLOY_TO_RADIO=True branch in deploy.py.
 *
 * Delete pass: remove all .lua/.luac files from dstDir (throttled, 100 ms).
 * Copy pass:   copy only .lua files from srcDir (throttled, 20 ms inter-file).
 * No MD5 check — always overwrites.
 */
export async function radioLuaCopy(
    srcDir: string,
    dstDir: string,
    channel: vscode.OutputChannel
): Promise<{ copiedCount: number; deletedCount: number }> {
    // Delete pass
    let deletedCount = 0;
    try {
        const dstRels = await fs.readdir(dstDir, { recursive: true, encoding: 'utf8' });
        for (const rel of dstRels) {
            if (!rel.endsWith('.lua') && !rel.endsWith('.luac')) { continue; }
            const full = path.join(dstDir, rel);
            try {
                if ((await fs.stat(full)).isFile()) {
                    await fs.unlink(full);
                    await flushFs();
                    await sleep(DELETE_PAUSE_MS);
                    channel.appendLine(`  deleted: ${rel}`);
                    deletedCount++;
                }
            } catch { /* best-effort */ }
        }
    } catch { /* dstDir may not exist yet */ }

    // Copy pass
    await fs.mkdir(dstDir, { recursive: true });
    let copiedCount = 0;
    const srcRels = await fs.readdir(srcDir, { recursive: true, encoding: 'utf8' });
    for (const rel of srcRels) {
        if (!rel.endsWith('.lua')) { continue; }
        const srcFull = path.join(srcDir, rel);
        const dstFull = path.join(dstDir, rel);
        try {
            if ((await fs.stat(srcFull)).isFile()) {
                await throttledCopyFile(srcFull, dstFull);
                await flushFs();
                await sleep(LUA_INTER_FILE_MS);
                channel.appendLine(`  copied : ${rel}`);
                copiedCount++;
            }
        } catch (e) {
            channel.appendLine(`  error copying ${rel}: ${e}`);
        }
    }

    return { copiedCount, deletedCount };
}

// ---------------------------------------------------------------------------
// radioSyncFromManifest
// ---------------------------------------------------------------------------

/**
 * Manifest-guided sync.  Same logic as simulator's syncFromManifest but uses
 * throttledCopyFile instead of fs.copyFile for each file.
 */
export async function radioSyncFromManifest(
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
            const destRels = await fs.readdir(destAppPath, { recursive: true, encoding: 'utf8' });
            for (const rel of destRels) {
                const destFile = path.join(destAppPath, rel);
                try {
                    if ((await fs.stat(destFile)).isFile()) {
                        await fs.unlink(destFile);
                        channel.appendLine(`  deleted: ${rel}`);
                        deletedCount++;
                    }
                } catch { /* already gone */ }
            }
        } catch { /* destAppPath did not exist yet */ }
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
            const dst = path.join(destAppPath, f);
            try {
                await throttledCopyFile(src, dst);
                await flushFs();
                channel.appendLine(`  copied : ${f}`);
                copiedCount++;
            } catch (e) {
                channel.appendLine(`  error copying ${f}: ${e}`);
            }
        }
    }

    // Copy the manifest itself to destination
    try {
        await throttledCopyFile(sourceManifestPath, destManifestPath);
        await flushFs();
        channel.appendLine('  copied : ethos_lua_manifest.json');
    } catch { /* best-effort */ }

    return { copiedCount, deletedCount };
}
