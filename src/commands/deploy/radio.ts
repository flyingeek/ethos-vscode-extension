/**
 * Radio deploy target.
 *
 * Full flow:
 *   1. Open HID → requestInformation() (log board) → pre-unmount
 *      already-mounted drives → stopSerialMode() → close HID.
 *   2. Wait up to 30 s for radio volume to mount (withProgress).
 *   3. Resolve destAppPath from the scripts/ dir on the mounted volume.
 *   4. deploy(): copy files (manifest / safe-full / lua-only / mirror) → flushFs
 *      → 2 s settle → unmount drives → startSerialMode() (→ serial mode) → close HID
 *      → tail serial output to channel until radio disconnected.
 *
 * target parameter:
 *   'radio'      → radioSafeFullCopy (or radioSyncFromManifest if manifest set)
 *   'radio-lua'  → radioLuaCopy (always; manifest is ignored for lua mode)
 *   'radio-fast' → radioMirrorCopy (incremental MD5-based; manifest ignored)
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { EthosMeta, DeployConfig, DeployTarget } from './types';
import { RadioInterface, getRadioConfig } from '../../radio/hid';
import { DriveMap, scanDrives, waitForVolumes, waitForDrivesGone, getScriptsDir, unmountDrives } from '../../radio/volumes';
import { findSerialPort, tailSerialToChannel } from '../../radio/serial';
import {
    flushFs,
    radioSafeFullCopy,
    radioLuaCopy,
    radioMirrorCopy,
    radioSyncFromManifest,
} from './radioSync';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export async function radioTarget(
    sourcePath: string,
    appname: string,
    projectManifest: EthosMeta | undefined,
    deployConfig: DeployConfig,
    workspaceRoot: string,
    channel: vscode.OutputChannel,
    target: string = 'radio'
): Promise<DeployTarget | undefined> {
    const isLuaMode    = target === 'radio-lua';
    const isFastMode   = target === 'radio-fast';
    const useManifest  = !isLuaMode && !isFastMode && !!projectManifest;

    // Resolve manifest paths (mirrors simulatorTarget)
    const manifestConfig    = deployConfig.manifest ?? '';
    const sourceManifestPath = manifestConfig
        ? (path.isAbsolute(manifestConfig) ? manifestConfig : path.join(workspaceRoot, manifestConfig))
        : '';

    // -----------------------------------------------------------------------
    // Step 1: Detect current radio mode, then normalise to USB mass-storage
    //
    //   startSerialMode() (0x68) = serial mode        (serial port appears)
    //   stopSerialMode()  (0x69) = USB mass-storage   (volumes appear)
    //
    //   State A — drives already mounted  → already in USB mass-storage
    //             skip HID toggle, proceed directly to Step 2
    //   State B — serial port present     → in serial mode
    //             stopSerialMode() to switch to USB mass-storage
    //   State C — neither                 → idle (normal = USB mass-storage)
    //             stopSerialMode() to switch to USB mass-storage
    // -----------------------------------------------------------------------
    channel.appendLine('[radio] Detecting radio mode…');

    const existingDrives = await scanDrives();
    const alreadyMounted = Object.keys(existingDrives).length > 0;

    if (alreadyMounted) {
        channel.appendLine('[radio] Radio already in USB mass-storage mode — skipping HID toggle.');
    } else {
        // Check for serial port (0 retries = instant scan)
        const radioConfig = getRadioConfig();
        const vidHex = radioConfig.vendorId.toString(16).padStart(4, '0');
        const pidHex = radioConfig.productId.toString(16).padStart(4, '0');
        const serialPort = await findSerialPort(radioConfig.nameHint, vidHex, pidHex);
        const inSerialMode = !!serialPort;

        if (inSerialMode) {
            channel.appendLine(`[radio] Radio in serial mode (${serialPort}) — switching to USB storage…`);
        }

        try {
            const radio = new RadioInterface({ retries: 3, retryDelayMs: 500 });
            try {
                const info = radio.requestInformation();
                if (info) {
                    channel.appendLine(`[radio] Board: ${info.board}, storage: ${info.defaultStorage}`);
                }
                if (!inSerialMode) {
                    // State C: unmount any stale drives before switching mode
                    const stale = await scanDrives();
                    if (Object.keys(stale).length > 0) {
                        await unmountDrives(stale, channel);
                    }
                }
                // stopSerialMode() (0x69) switches to USB mass-storage in both State B and C.
                radio.stopSerialMode();
            } finally {
                radio.close();
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Ethos Deploy: HID error — ${e}`);
            return undefined;
        }
    }

    // -----------------------------------------------------------------------
    // Step 2: Wait for radio volume to mount (or reuse already-mounted drives)
    // -----------------------------------------------------------------------
    let drives: DriveMap;
    if (alreadyMounted) {
        drives = existingDrives;
    } else {
        try {
            drives = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Ethos: Waiting for radio volume…', cancellable: false },
                () => waitForVolumes(30_000, 1_000)
            );
        } catch (e) {
            vscode.window.showErrorMessage(`Ethos Deploy: radio volume did not mount — ${e}`);
            return undefined;
        }
    }

    // -----------------------------------------------------------------------
    // Step 3: Resolve destination paths
    // -----------------------------------------------------------------------
    const scriptsDir = getScriptsDir(drives);
    if (!scriptsDir) {
        vscode.window.showErrorMessage('Ethos Deploy: could not find scripts directory on radio.');
        return undefined;
    }

    const destBase        = scriptsDir;
    const destAppPath     = path.join(destBase, appname);
    const destManifestPath = path.join(destAppPath, 'ethos_lua_manifest.json');

    await fs.mkdir(destAppPath, { recursive: true });

    // -----------------------------------------------------------------------
    // Steps 4–5: deploy function (copy + stopSerialMode)
    // -----------------------------------------------------------------------
    const deploy = async (): Promise<void> => {
        if (isLuaMode) {
            channel.appendLine('[radio] Lua-only copy…');
            const { copiedCount, deletedCount } = await radioLuaCopy(sourcePath, destAppPath, channel);
            channel.appendLine(`[radio] Lua copy done: ${copiedCount} copied, ${deletedCount} deleted.`);

        } else if (isFastMode) {
            channel.appendLine('[radio] Mirror copy (fast)…');
            const { copiedCount, deletedCount } = await radioMirrorCopy(sourcePath, destAppPath, channel);
            channel.appendLine(`[radio] Mirror copy done: ${copiedCount} copied, ${deletedCount} deleted.`);

        } else if (useManifest && sourceManifestPath) {
            channel.appendLine('[radio] Manifest sync…');
            const { copiedCount, deletedCount } = await radioSyncFromManifest(
                sourcePath, destAppPath, destManifestPath,
                projectManifest!, sourceManifestPath, channel
            );
            channel.appendLine(`[radio] Manifest sync done: ${copiedCount} copied, ${deletedCount} deleted.`);

        } else {
            channel.appendLine('[radio] Safe full copy…');
            await radioSafeFullCopy(sourcePath, destAppPath, channel);
            channel.appendLine('[radio] Safe full copy done.');
        }

        // Final filesystem flush + settle before switching HID mode back
        await flushFs();
        await sleep(2000);
    };

    const finalize = async (): Promise<void> => {
        channel.appendLine('[radio] Switching radio back to normal mode…');

        try {
            await unmountDrives(drives, channel);
            // Wait until all volume paths are fully gone before the HID mode
            // switch — prevents the macOS "disk not ejected properly" alert.
            await waitForDrivesGone(drives, 8000);
            const radio = new RadioInterface({ retries: 1, retryDelayMs: 0 });
            try {
                // startSerialMode() (0x68) switches to serial mode
                radio.startSerialMode();
            } finally {
                radio.close();
            }
            channel.appendLine('[radio] Radio returned to normal mode.');
            // Tail serial output — use a longer window (30 retries × 1 s) because
            // re-enumeration after a deploy unmount can take 15-20 s.
            const radioConfig = getRadioConfig();
            void tailSerialToChannel({ ...radioConfig, retries: 30 }, channel);
        } catch (e) {
            channel.appendLine(`[radio] Warning: could not switch radio back to normal mode: ${e}`);
        }
    };

    return { destAppPath, destBase, deploy, finalize };
}
