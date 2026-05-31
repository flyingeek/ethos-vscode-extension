/**
 * ethosExt.radioDebug command.
 *
 * Quick pick with three actions:
 *   - Show Debug Connection  → diagnostic snapshot (Ethos Debug Connection channel)
 *   - Switch to Serial Mode  → HID startSerialMode + serial tail (Ethos Deploy channel)
 *   - Switch to USB Storage  → HID stopSerialMode (Ethos Deploy channel)
 *
 * Absorbs the logic from the former debugConnection.ts (Node.js port of
 * .vscode/scripts/debug_connection.py).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
    ETHOS_VENDOR_ID,
    enumerateEthosDevices,
    RadioInterface,
    getRadioConfig,
} from '../radio/hid';
import { scanDrives, unmountDrives } from '../radio/volumes';
import { tailSerialToChannel } from '../radio/serial';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Output channels
// ---------------------------------------------------------------------------

let deployChannel: vscode.OutputChannel | undefined;
let debugChannel: vscode.OutputChannel | undefined;

function getDeployChannel(): vscode.OutputChannel {
    if (!deployChannel) {
        deployChannel = vscode.window.createOutputChannel('Ethos Deploy');
    }
    return deployChannel;
}

function getDebugChannel(): vscode.OutputChannel {
    if (!debugChannel) {
        debugChannel = vscode.window.createOutputChannel('Ethos Debug Connection');
    }
    return debugChannel;
}

// ---------------------------------------------------------------------------
// Debug Connection helpers  (mirrors debug_connection.py)
// ---------------------------------------------------------------------------

function header(ch: vscode.OutputChannel, title: string): void {
    ch.appendLine('');
    ch.appendLine(`=== ${title} ===`);
}

function json(ch: vscode.OutputChannel, value: unknown): void {
    ch.appendLine(JSON.stringify(value, null, 2));
}

interface VolumeInfo {
    root: string;
    markers: string[];
    scripts: boolean;
}

function listVolumes(): VolumeInfo[] {
    const bases = ['/Volumes', '/media', '/mnt'];
    const result: VolumeInfo[] = [];

    for (const base of bases) {
        if (!fs.existsSync(base)) { continue; }
        let entries: string[];
        try { entries = fs.readdirSync(base).sort(); } catch { continue; }

        for (const entry of entries) {
            const root = path.join(base, entry);
            try {
                if (!fs.statSync(root).isDirectory()) { continue; }
            } catch { continue; }

            const markers: string[] = [];
            for (const key of ['flash', 'sdcard', 'radio']) {
                if (fs.existsSync(path.join(root, `${key}.cpuid`))) {
                    markers.push(key);
                }
            }
            const scripts = fs.existsSync(path.join(root, 'scripts')) &&
                            fs.statSync(path.join(root, 'scripts')).isDirectory();

            if (markers.length > 0 || scripts) {
                result.push({ root, markers, scripts });
            }
        }
    }
    return result;
}

function listHidDevices(ch: vscode.OutputChannel, vendorId: number): void {
    header(ch, 'HID Devices');
    try {
        const devices = enumerateEthosDevices(vendorId);
        if (devices.length === 0) {
            ch.appendLine(`No HID devices found for vendor 0x${vendorId.toString(16).toUpperCase().padStart(4, '0')}.`);
        } else {
            for (const d of devices) {
                json(ch, d);
            }
        }
    } catch (e) {
        ch.appendLine(`[error] ${e}`);
    }
}

function probeRadioInterface(ch: vscode.OutputChannel, config: ReturnType<typeof getRadioConfig>): void {
    header(ch, 'RadioInterface Probe');
    ch.appendLine(`Using VID=0x${config.vendorId.toString(16).padStart(4,'0')} PID=0x${config.productId.toString(16).padStart(4,'0')} retries=${config.retries} retryDelay=${config.retryDelayMs}ms`);
    let radio: RadioInterface | undefined;
    try {
        radio = new RadioInterface(config);
        ch.appendLine('HID open: OK');
        const info = radio.requestInformation();
        if (info) {
            json(ch, info);
        } else {
            ch.appendLine('requestInformation: no response');
        }
    } catch (e) {
        ch.appendLine(`[error] ${e}`);
    } finally {
        try { radio?.close(); } catch { /* ignore */ }
    }
}

async function runCommand(
    ch: vscode.OutputChannel,
    cmd: string,
    args: string[]
): Promise<void> {
    ch.appendLine(`$ ${cmd} ${args.join(' ')}`);
    try {
        const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10_000 });
        if (stdout.trim()) { ch.appendLine(stdout.trim()); }
        if (stderr.trim()) { ch.appendLine('[stderr]'); ch.appendLine(stderr.trim()); }
    } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        if (err.stdout?.trim()) { ch.appendLine(err.stdout.trim()); }
        if (err.stderr?.trim()) { ch.appendLine('[stderr]'); ch.appendLine(err.stderr.trim()); }
        if (!err.stdout && !err.stderr) { ch.appendLine(`[error] ${err.message ?? e}`); }
    }
}

function listDevNodes(ch: vscode.OutputChannel): void {
    header(ch, 'Device Nodes');
    for (const pattern of ['/dev/cu.', '/dev/tty.']) {
        const dir = '/dev';
        const prefix = path.basename(pattern.replace('.', ''));
        ch.appendLine(`/dev/${prefix}.*`);
        try {
            const matched = fs.readdirSync(dir)
                .filter(f => f.startsWith(prefix + '.'))
                .map(f => path.join(dir, f))
                .sort();
            for (const m of matched) { ch.appendLine(m); }
        } catch { /* /dev not available on this OS */ }
    }
}

async function showDebugConnection(): Promise<void> {
    const ch = getDebugChannel();
    ch.clear();
    ch.show(true);

    const radioConfig = getRadioConfig();

    header(ch, 'Platform');
    json(ch, {
        system:  os.platform(),
        release: os.release(),
        arch:    os.arch(),
        node:    process.version,
    });

    header(ch, 'Volumes');
    const volumes = listVolumes();
    if (volumes.length === 0) {
        ch.appendLine('No candidate mounted radio volumes found.');
    } else {
        for (const v of volumes) { json(ch, v); }
    }

    listHidDevices(ch, radioConfig.vendorId);
    probeRadioInterface(ch, radioConfig);

    if (os.platform() === 'darwin') {
        header(ch, 'macOS USB Snapshot');
        await runCommand(ch, 'system_profiler', ['SPUSBDataType']);

        header(ch, 'macOS IORegistry Snapshot');
        await runCommand(ch, 'ioreg', ['-p', 'IOUSB', '-l', '-w', '0']);

        listDevNodes(ch);
    }

    ch.appendLine('');
    ch.appendLine('=== Done ===');
}

// ---------------------------------------------------------------------------
// Switch helpers
// ---------------------------------------------------------------------------

/**
 * Switch radio to serial (USB debug) mode.
 * Mirrors connect_base.py start_usb_debug() + unmount_drives().
 * After switching, tails the serial output to the Ethos Deploy channel.
 */
export async function switchToSerial(channel: vscode.OutputChannel): Promise<void> {
    channel.show(true);
    channel.appendLine('\n[radio] Switching to serial mode…');
    try {
        const radio = new RadioInterface({ retries: 3, retryDelayMs: 500 });
        try {
            const existing = await scanDrives();
            if (Object.keys(existing).length > 0) {
                channel.appendLine('[radio] Unmounting existing drives…');
                await unmountDrives(existing);
            }
            radio.startSerialMode();
        } finally {
            radio.close();
        }
        channel.appendLine('[radio] Radio switched to serial mode.');
    } catch (e) {
        channel.appendLine(`[radio] Error switching to serial: ${e}`);
        vscode.window.showErrorMessage(`Ethos: could not switch to serial mode — ${e}`);
        return;
    }

    const config = getRadioConfig();
    await tailSerialToChannel(config, channel);
}

/**
 * Switch radio back to USB mass-storage mode.
 * Mirrors connect_base.py stop_usb_debug().
 */
export async function switchToUsb(channel: vscode.OutputChannel): Promise<void> {
    channel.show(true);
    channel.appendLine('\n[radio] Switching to USB storage mode…');
    try {
        const radio = new RadioInterface({ retries: 3, retryDelayMs: 500 });
        try {
            radio.stopSerialMode();
        } finally {
            radio.close();
        }
        channel.appendLine('[radio] Radio switched to USB storage mode.');
    } catch (e) {
        channel.appendLine(`[radio] Error switching to USB: ${e}`);
        vscode.window.showErrorMessage(`Ethos: could not switch to USB storage mode — ${e}`);
    }
}

// ---------------------------------------------------------------------------
// Quick pick command
// ---------------------------------------------------------------------------

export async function radioDebugCommand(): Promise<void> {
    const items: vscode.QuickPickItem[] = [
        {
            label: '$(search) Show Debug Connection',
            description: 'Collect USB/HID/serial/volume diagnostic snapshot',
        },
        {
            label: '$(plug) Switch to Serial Mode',
            description: 'Switch radio to serial (USB debug) and tail output',
        },
        {
            label: '$(database) Switch to USB Storage',
            description: 'Switch radio back to mass-storage mode',
        },
    ];

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Ethos: Radio Debug — choose an action',
    });
    if (!picked) { return; }

    if (picked.label.includes('Debug Connection')) {
        await showDebugConnection();
    } else if (picked.label.includes('Serial Mode')) {
        await switchToSerial(getDeployChannel());
    } else if (picked.label.includes('USB Storage')) {
        await switchToUsb(getDeployChannel());
    }
}
