/**
 * Cross-platform Ethos radio volume discovery and unmounting.
 *
 * Mirrors connect_macos.py _scan_drives_internal / get_scripts_dir,
 * connect_macos.py unmount_drives, and the equivalent Windows logic from
 * connect_windows.py.
 *
 * Volumes are identified by marker files in the root:
 *   flash.cpuid   →  flash storage
 *   sdcard.cpuid  →  sdcard storage
 *   radio.cpuid   →  radio storage
 *
 * A volume only qualifies as a deploy target if it also has a `scripts/`
 * subdirectory.
 */

import type * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';

/** The three possible Ethos storage keys, identified by *.cpuid marker files. */
export type DriveMap = Partial<Record<'flash' | 'sdcard' | 'radio', string>>;

const CPUID_KEYS: ReadonlyArray<'flash' | 'sdcard' | 'radio'> = ['flash', 'sdcard', 'radio'];

/** Check a single volume path for Ethos cpuid markers + scripts/ subdir. */
async function probeVolume(volPath: string): Promise<DriveMap> {
    const result: DriveMap = {};
    for (const key of CPUID_KEYS) {
        try {
            await fs.access(path.join(volPath, `${key}.cpuid`));
            await fs.access(path.join(volPath, 'scripts'));
            result[key] = volPath;
        } catch {
            // marker or scripts dir not present for this key
        }
    }
    return result;
}

/**
 * Linux: return candidate automount roots in priority order.
 * udisks2 mounts under /run/media/<user> (Arch, Fedora) or /media/<user>
 * (Ubuntu); older setups use /media directly.
 */
function linuxMountRoots(): string[] {
    const user = os.userInfo().username;
    return [
        `/run/media/${user}`,
        `/media/${user}`,
        '/media',
    ];
}

/**
 * Scan all mounted volumes for Ethos radio drives.
 * macOS: reads /Volumes; Windows: iterates A–Z drive letters;
 * Linux: checks udisks2 automount roots.
 */
export async function scanDrives(): Promise<DriveMap> {
    const drives: DriveMap = {};

    if (process.platform === 'darwin') {
        let entries: string[];
        try {
            entries = await fs.readdir('/Volumes');
        } catch {
            return drives;
        }
        for (const entry of entries) {
            const found = await probeVolume(path.join('/Volumes', entry));
            Object.assign(drives, found);
        }
    } else if (process.platform === 'win32') {
        for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
            const volPath = `${String.fromCharCode(c)}:\\`;
            try {
                await fs.access(volPath); // quick existence check
                const found = await probeVolume(volPath);
                Object.assign(drives, found);
            } catch {
                // drive letter not present
            }
        }
    } else if (process.platform === 'linux') {
        for (const root of linuxMountRoots()) {
            let entries: string[];
            try {
                entries = await fs.readdir(root);
            } catch {
                continue; // root doesn't exist on this distro
            }
            for (const entry of entries) {
                const found = await probeVolume(path.join(root, entry));
                Object.assign(drives, found);
            }
        }
    }

    return drives;
}

/**
 * Return the `scripts/` subdirectory of the best available drive.
 * Preference order: sdcard → radio → flash.
 * Returns undefined if no drive is in the map.
 */
export function getScriptsDir(drives: DriveMap): string | undefined {
    for (const key of ['sdcard', 'radio', 'flash'] as const) {
        const vol = drives[key];
        if (vol) { return path.join(vol, 'scripts'); }
    }
    return undefined;
}

/** Run a shell command, ignoring all errors (best-effort). */
function execBestEffort(cmd: string): Promise<void> {
    return new Promise(resolve => exec(cmd, () => resolve()));
}

/** Run a shell command and return stdout, or null on error. */
function execCapture(cmd: string): Promise<string | null> {
    return new Promise(resolve => exec(cmd, (_err, stdout) => resolve(stdout ?? null)));
}

/** Run a shell command; resolves true if the exit code is 0, false otherwise. */
function execCheck(cmd: string): Promise<boolean> {
    return new Promise(resolve => exec(cmd, (err) => resolve(!err)));
}

/**
 * Retry an unmount command until it exits 0 or timeoutMs elapses.
 * Returns true on success, false on timeout.
 */
async function unmountWithRetry(cmd: string, timeoutMs: number, retryDelayMs = 1000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const ok = await execCheck(cmd);
        if (ok) { return true; }
        const remaining = deadline - Date.now();
        if (remaining <= 0) { return false; }
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(retryDelayMs, remaining)));
    }
}

/**
 * Cross-platform: scan all mounted volumes for any Ethos *.cpuid marker,
 * regardless of whether they have a scripts/ subdirectory.
 * Returns all matching volume paths (e.g. FLASH, NO NAME, TWINXLITES).
 * macOS: reads /Volumes; Windows: iterates A–Z drive letters.
 */
async function scanAllEthosVolumes(): Promise<string[]> {
    const result: string[] = [];

    async function probeAndAdd(volPath: string): Promise<void> {
        for (const key of CPUID_KEYS) {
            try {
                await fs.access(path.join(volPath, `${key}.cpuid`));
                result.push(volPath);
                return; // one marker is enough — don't add the same path twice
            } catch {
                // marker not present for this key
            }
        }
    }

    if (process.platform === 'darwin') {
        let entries: string[];
        try {
            entries = await fs.readdir('/Volumes');
        } catch {
            return result;
        }
        for (const entry of entries) {
            await probeAndAdd(path.join('/Volumes', entry));
        }
    } else if (process.platform === 'win32') {
        for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
            const volPath = `${String.fromCharCode(c)}:\\`;
            try {
                await fs.access(volPath);
                await probeAndAdd(volPath);
            } catch {
                // drive letter not present
            }
        }
    } else if (process.platform === 'linux') {
        for (const root of linuxMountRoots()) {
            let entries: string[];
            try {
                entries = await fs.readdir(root);
            } catch {
                continue; // root doesn't exist on this distro
            }
            for (const entry of entries) {
                await probeAndAdd(path.join(root, entry));
            }
        }
    }

    return result;
}

/**
 * Linux: resolve the parent block device for a mounted volume path by parsing
 * /proc/mounts.  e.g. /run/media/eric/TWINXLITES → "/dev/sdb" (stripping the
 * partition number suffix).  Returns null if resolution fails.
 */
async function resolveBlockDevice(volPath: string): Promise<string | null> {
    const out = await execCapture('cat /proc/mounts');
    if (!out) { return null; }
    for (const line of out.split('\n')) {
        const parts = line.split(' ');
        if (parts.length < 2) { continue; }
        // /proc/mounts encodes spaces as \040
        const mountPoint = parts[1].replace(/\\040/g, ' ');
        if (mountPoint === volPath) {
            // Strip trailing partition digit(s): /dev/sdb3 → /dev/sdb, /dev/sda1 → /dev/sda
            return parts[0].replace(/\d+$/, '');
        }
    }
    return null;
}

/**
 * Resolve the parent BSD disk identifier for a mounted volume path.
 * e.g. /Volumes/TWINXLITES → "disk4" (stripping any partition suffix like "s1").
 * Returns null if resolution fails.
 */
async function resolveBsdDisk(vol: string): Promise<string | null> {
    const out = await execCapture(`diskutil info "${vol}"`);
    if (!out) { return null; }
    // "Part of Whole" is the parent disk; fall back to "Device Identifier"
    const partOfWhole = out.match(/Part of Whole:\s+(disk\S+)/);
    if (partOfWhole) { return partOfWhole[1].trim(); }
    const deviceId = out.match(/Device Identifier:\s+(disk\S+)/);
    if (deviceId) {
        // Strip partition suffix (e.g. disk4s1 → disk4)
        return deviceId[1].replace(/s\d+$/, '').trim();
    }
    return null;
}

/**
 * macOS: unmount all Ethos volumes and eject their parent BSD disks.
 *
 * Phase 1 — unmount every Ethos LUN by path (with retry up to 30 s).
 *   Scans /Volumes for ALL volumes carrying a *.cpuid marker, not just those
 *   in `drives`.  This covers volumes without a scripts/ dir (e.g. FLASH and
 *   NO NAME on a TWINXLITES composite device) that would otherwise stay mounted
 *   and trigger a macOS "disk not ejected properly" alert.
 *
 * Phase 2 — eject unique parent BSD disks (best-effort, IOKit cleanup).
 *   BSD identifiers are resolved before phase 1 while volume paths are still
 *   accessible, then ejected after all volumes are unmounted.
 *
 * Mirrors connect_macos.py MacOSRadioInterface.unmount_drives().
 */
async function unmountDrivesMac(drives: DriveMap, channel?: vscode.OutputChannel): Promise<void> {
    // Resolve parent BSD disks before unmounting (volume paths still valid here).
    const bsdDisks = new Set<string>();
    for (const vol of Object.values(drives)) {
        if (!vol) { continue; }
        const bsdDisk = await resolveBsdDisk(vol);
        if (bsdDisk) { bsdDisks.add(bsdDisk); }
    }

    // Phase 1: unmount every Ethos volume (all LUNs, including those without scripts/).
    const allVols = await scanAllEthosVolumes();
    if (allVols.length > 0) {
        channel?.appendLine(`[radio] Ejecting drives, waiting for up to 30s…`);
        for (const vol of allVols) {
            await unmountWithRetry(`diskutil unmount force "${vol}"`, 30_000);
        }
    }

    // Phase 2: eject each unique parent BSD disk (best-effort, IOKit cleanup).
    for (const bsdDisk of bsdDisks) {
        await execBestEffort(`diskutil eject /dev/${bsdDisk}`);
    }
}

/**
 * Linux: unmount all Ethos volumes via udisksctl and power-off parent block
 * devices.  Mirrors the two-phase macOS approach.
 *
 * Phase 1 — unmount every Ethos LUN by path (with retry up to 30 s).
 * Phase 2 — power-off unique parent block devices (best-effort, kernel cleanup).
 */
async function unmountDrivesLinux(drives: DriveMap, channel?: vscode.OutputChannel): Promise<void> {
    // Resolve parent block devices before unmounting (paths still valid here).
    const blockDevs = new Set<string>();
    for (const vol of Object.values(drives)) {
        if (!vol) { continue; }
        const dev = await resolveBlockDevice(vol);
        if (dev) { blockDevs.add(dev); }
    }

    // Phase 1: unmount every Ethos volume (all LUNs, including those without scripts/).
    const allVols = await scanAllEthosVolumes();
    if (allVols.length > 0) {
        channel?.appendLine(`[radio] Ejecting drives, waiting for up to 30s…`);
        for (const vol of allVols) {
            await unmountWithRetry(`udisksctl unmount --mount-path "${vol}"`, 30_000);
        }
    }

    // Phase 2: power-off each unique parent block device (best-effort).
    for (const dev of blockDevs) {
        await execBestEffort(`udisksctl power-off -b "${dev}"`);
    }
}

/**
 * Windows: dismount all Ethos drive letters via PowerShell WMI (best-effort).
 * Scans all drive letters for *.cpuid markers (not just those in `drives`) so
 * that volumes without a scripts/ dir (e.g. FLASH, NO NAME) are also dismounted.
 * Mirrors connect_windows.py WindowsRadioInterface.unmount_drives() which uses
 * FSCTL_LOCK_VOLUME + FSCTL_DISMOUNT_VOLUME. Fallback: mountvol /D.
 */
async function dismountDrivesWin(_drives: DriveMap): Promise<void> {
    const allVols = await scanAllEthosVolumes();
    for (const vol of allVols) {
        const letter = vol.charAt(0).toUpperCase();
        await execBestEffort(
            `powershell -NoProfile -Command "(Get-WmiObject Win32_Volume -Filter \\"DriveLetter='${letter}:'\\" ).Dismount($false, $false)"`
        );
        await execBestEffort(`mountvol ${letter}:\\ /D`);
    }
}

/**
 * Cross-platform unmount of Ethos radio drives.
 * On macOS, retries `diskutil eject` until success or 30 s timeout and logs
 * progress to `channel` if provided.
 * Mirrors the polymorphic RadioInterfaceBase.start_usb_debug() / unmount_drives()
 * pattern from the Python scripts: the orchestrator calls this once before
 * startSerialMode() and once (on Windows) after the file copy before stopSerialMode().
 */
export async function unmountDrives(drives: DriveMap, channel?: vscode.OutputChannel): Promise<void> {
    if (process.platform === 'darwin') {
        await unmountDrivesMac(drives, channel);
    } else if (process.platform === 'win32') {
        await dismountDrivesWin(drives);
    } else if (process.platform === 'linux') {
        await unmountDrivesLinux(drives, channel);
    }
}

/**
 * Poll until all volume paths in drives have disappeared from the filesystem,
 * or until timeoutMs elapses.  Never throws — resolves in both cases.
 * No-op on non-macOS platforms.
 */
export async function waitForDrivesGone(
    drives: DriveMap,
    timeoutMs: number,
    pollIntervalMs = 200
): Promise<void> {
    if (process.platform !== 'darwin' && process.platform !== 'linux') { return; }
    const paths = Object.values(drives).filter((v): v is string => !!v);
    if (paths.length === 0) { return; }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        let allGone = true;
        for (const vol of paths) {
            try {
                await fs.access(vol);
                allGone = false;
                break;
            } catch {
                // path gone — good
            }
        }
        if (allGone) { return; }
        const remaining = deadline - Date.now();
        if (remaining <= 0) { break; }
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    }
}

/**
 * Poll scanDrives() every pollIntervalMs until at least one drive is found
 * or timeoutMs elapses, then throw.
 */
export async function waitForVolumes(timeoutMs: number, pollIntervalMs: number): Promise<DriveMap> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const drives = await scanDrives();
        if (Object.keys(drives).length > 0) {
            return drives;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) { break; }
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    }
    throw new Error('Timed out waiting for radio volume to mount.');
}
