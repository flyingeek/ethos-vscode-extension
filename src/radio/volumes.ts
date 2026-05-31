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

import * as fs from 'fs/promises';
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
 * Scan all mounted volumes for Ethos radio drives.
 * macOS: reads /Volumes; Windows: iterates A–Z drive letters.
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
 * macOS: eject the parent BSD disk device via diskutil (best-effort).
 * Ejecting at the whole-disk level (e.g. /dev/disk4) fully removes the device
 * from IOKit before the HID mode switch — prevents the "disk not ejected
 * properly" alert.  Falls back to volume-path eject if BSD resolution fails.
 * Mirrors connect_macos.py MacOSRadioInterface.unmount_drives().
 */
async function unmountDrivesMac(drives: DriveMap): Promise<void> {
    const ejected = new Set<string>();
    for (const vol of Object.values(drives)) {
        if (!vol) { continue; }
        const bsdDisk = await resolveBsdDisk(vol);
        if (bsdDisk && !ejected.has(bsdDisk)) {
            ejected.add(bsdDisk);
            await execBestEffort(`diskutil eject /dev/${bsdDisk}`);
        } else if (!bsdDisk) {
            await execBestEffort(`diskutil eject "${vol}"`);
        }
    }
}

/**
 * Windows: dismount each drive letter via PowerShell WMI (best-effort).
 * Mirrors connect_windows.py WindowsRadioInterface.unmount_drives() which uses
 * FSCTL_LOCK_VOLUME + FSCTL_DISMOUNT_VOLUME. Fallback: mountvol /D.
 */
async function dismountDrivesWin(drives: DriveMap): Promise<void> {
    for (const vol of Object.values(drives)) {
        if (!vol) { continue; }
        const letter = vol.charAt(0).toUpperCase();
        await execBestEffort(
            `powershell -NoProfile -Command "(Get-WmiObject Win32_Volume -Filter \\"DriveLetter='${letter}:'\\" ).Dismount($false, $false)"`
        );
        await execBestEffort(`mountvol ${letter}:\\ /D`);
    }
}

/**
 * Cross-platform unmount of Ethos radio drives (best-effort).
 * Mirrors the polymorphic RadioInterfaceBase.start_usb_debug() / unmount_drives()
 * pattern from the Python scripts: the orchestrator calls this once before
 * startSerialMode() and once (on Windows) after the file copy before stopSerialMode().
 */
export async function unmountDrives(drives: DriveMap): Promise<void> {
    if (process.platform === 'darwin') {
        await unmountDrivesMac(drives);
    } else if (process.platform === 'win32') {
        await dismountDrivesWin(drives);
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
    if (process.platform !== 'darwin') { return; }
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
