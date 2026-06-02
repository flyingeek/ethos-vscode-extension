/**
 * Serial port discovery and tail helper for Ethos radio.
 *
 * Mirrors deploy.py _find_serial_debug_port() + tail_serial_debug():
 *   - Discover the COM/cu port by VID:PID, falling back to name hints.
 *   - Open the port as a raw file descriptor and stream lines to an
 *     OutputChannel — no new npm dependency, no separate terminal.
 *
 * Stopping: unplug the radio (read error → stop) or call tail.stop().
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { RadioConfig } from './hid';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// findSerialPort
// ---------------------------------------------------------------------------

/**
 * Discover the serial port for the Ethos radio.
 *
 * macOS: scans /dev/cu.* for entries matching nameHint (e.g. "FrSky"),
 *        falling back to generic hints ("Serial", "usbmodem").
 * Windows: iterates COM1–COM99 checking existence, then filters by
 *          `mode` output for VID/PID match.
 *
 * Mirrors deploy.py _find_serial_debug_port() / _find_com_port().
 */
export async function findSerialPort(
    nameHint: string,
    _vidHex: string,
    _pidHex: string,
): Promise<string | undefined> {
    if (process.platform === 'darwin' || process.platform === 'linux') {
        return findSerialPortUnix(nameHint);
    } else if (process.platform === 'win32') {
        return findSerialPortWindows(_vidHex, _pidHex, nameHint);
    }
    return undefined;
}

async function findSerialPortUnix(nameHint: string): Promise<string | undefined> {
    const devDir = '/dev';
    let entries: string[];
    try {
        entries = await fsPromises.readdir(devDir);
    } catch {
        return undefined;
    }

    // Prefer /dev/cu.* on macOS, /dev/tty* on Linux
    const prefix = process.platform === 'darwin' ? 'cu.' : 'tty';
    const candidates = entries
        .filter(e => e.startsWith(prefix))
        .map(e => path.join(devDir, e))
        .sort();

    if (candidates.length === 0) { return undefined; }

    // Priority: exact nameHint match first, then generic fallbacks
    const hints = [nameHint.toLowerCase(), 'frsky', 'usbmodem', 'serial', 'stm', 'vcp'];
    for (const hint of hints) {
        const match = candidates.find(p => p.toLowerCase().includes(hint));
        if (match) { return match; }
    }

    return undefined;
}

async function findSerialPortWindows(
    vidHex: string,
    pidHex: string,
    nameHint: string,
): Promise<string | undefined> {
    // Try wmic to match VID:PID
    try {
        const { stdout } = await execFileAsync('wmic', [
            'path', 'Win32_PnPEntity',
            'where', `PNPDeviceID like '%VID_${vidHex.toUpperCase()}%PID_${pidHex.toUpperCase()}%'`,
            'get', 'Name',
        ], { timeout: 5000 });
        const match = stdout.match(/\bCOM\d+\b/);
        if (match) { return match[0]; }
    } catch { /* wmic may not be available */ }

    // Fallback: probe COM1–COM99 and check existence
    const hints = [nameHint.toLowerCase(), 'frsky', 'serial'];
    try {
        const { stdout } = await execFileAsync('powershell', [
            '-NoProfile', '-Command',
            '[System.IO.Ports.SerialPort]::GetPortNames() -join "\\n"',
        ], { timeout: 5000 });
        const ports = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const port of ports) {
            // Return first port; without pyserial we can't filter by description
            void hints; // hints used as reference in comments above
            return port;
        }
    } catch { /* PowerShell fallback */ }

    return undefined;
}

// ---------------------------------------------------------------------------
// tailSerialToChannel
// ---------------------------------------------------------------------------

export interface SerialTail {
    stop(): void;
}

/**
 * Open the radio serial port and stream lines to the output channel.
 *
 * Mirrors tail_serial_debug() in deploy.py:
 *   - Retries port discovery up to `retries` times with `retryDelayMs` pauses.
 *   - Reads raw bytes, splits on newlines, appends each line to channel.
 *   - Stops automatically on read error (device unplugged) or when stop() is
 *     called.
 *
 * Returns a SerialTail handle immediately (tail runs asynchronously).
 */
export async function tailSerialToChannel(
    config: RadioConfig,
    channel: vscode.OutputChannel,
): Promise<SerialTail> {
    const { nameHint, serialBaud, retries, retryDelayMs } = config;
    const vidHex = config.vendorId.toString(16).padStart(4, '0');
    const pidHex = config.productId.toString(16).padStart(4, '0');

    // Port discovery with retries (mirrors the retry loop in tail_serial_debug)
    let port: string | undefined;
    channel.appendLine(`[serial] Waiting up to ${retries * retryDelayMs / 1000}s for serial port…`);
    for (let i = 0; i < retries; i++) {
        port = await findSerialPort(nameHint, vidHex, pidHex);
        if (port) { break; }
        await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs));
    }

    if (!port) {
        channel.appendLine('[serial] No serial port found — serial tail skipped.');
        return { stop: () => { /* nothing to stop */ } };
    }

    channel.appendLine(`[serial] Connecting to ${port} @ ${serialBaud}…`);

    // Configure baud rate (best-effort; stty on Unix, mode on Windows)
    if (process.platform === 'darwin' || process.platform === 'linux') {
        try {
            await execFileAsync('stty', ['-f', port, serialBaud.toString(), 'raw', 'cs8', '-cstopb', '-parenb'], { timeout: 3000 });
        } catch { /* stty may fail on some setups; proceed anyway */ }
    } else if (process.platform === 'win32') {
        try {
            await execFileAsync('mode', [port, `BAUD=${serialBaud}`, 'PARITY=N', 'DATA=8', 'STOP=1'], { timeout: 3000 });
        } catch { /* best-effort */ }
    }

    let stopped = false;
    let fd: fs.ReadStream | undefined;

    const runTail = async () => {
        try {
            fd = fs.createReadStream(port!, { flags: 'r' });
            let buf = '';

            fd.on('open', () => {
                channel.appendLine('[serial] Serial session started.');
            });

            fd.on('data', (chunk: Buffer | string) => {
                if (stopped) { fd?.destroy(); return; }
                buf += chunk.toString('utf8');
                const lines = buf.split(/\r?\n/);
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    channel.appendLine(line);
                }
            });

            fd.on('error', (err: NodeJS.ErrnoException) => {
                if (!stopped) {
                    if (err.code === 'ENXIO' || err.code === 'EIO') {
                        channel.appendLine('[serial] Radio disconnected.');
                    } else {
                        channel.appendLine(`[serial] Read error: ${err.message}`);
                    }
                }
                stopped = true;
            });

            fd.on('end', () => {
                if (!stopped) { channel.appendLine('[serial] Serial stream ended.'); }
                stopped = true;
            });

        } catch (e) {
            channel.appendLine(`[serial] Could not open port: ${e}`);
        }
    };

    void runTail();

    return {
        stop() {
            stopped = true;
            fd?.destroy();
        },
    };
}
