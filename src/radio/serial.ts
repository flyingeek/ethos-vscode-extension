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
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type { RadioConfig } from './hid';
import { stripVTControlCharacters } from 'node:util';

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
    _nameHint: string,
): Promise<string | undefined> {
    const vid = vidHex.toUpperCase();
    const pid = pidHex.toUpperCase();

    // Primary: PowerShell Win32_PnPEntity query (works on Windows 10/11, replaces
    // deprecated wmic). Queries by VID:PID and extracts the COM port number from
    // the device name (e.g. "USB Serial Device (COM4)").
    try {
        const { stdout } = await execFileAsync('powershell', [
            '-NoProfile', '-Command',
            `Get-WmiObject Win32_PnPEntity | Where-Object { $_.PNPDeviceID -like '*VID_${vid}*PID_${pid}*' } | Select-Object -ExpandProperty Name`,
        ], { timeout: 5000 });
        const match = stdout.match(/\bCOM\d+\b/);
        if (match) { return match[0]; }
    } catch { /* WMI may not be available in all environments */ }

    // Fallback: wmic (deprecated but still present on many systems)
    try {
        const { stdout } = await execFileAsync('wmic', [
            'path', 'Win32_PnPEntity',
            'where', `PNPDeviceID like '%VID_${vid}%PID_${pid}%'`,
            'get', 'Name',
        ], { timeout: 5000 });
        const match = stdout.match(/\bCOM\d+\b/);
        if (match) { return match[0]; }
    } catch { /* wmic not available */ }

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

    // Configure baud rate on Unix via stty (best-effort).
    // Windows: baud/parity/data/stop are set directly in the SerialPort constructor below;
    // running `mode` here would open and briefly hold the port, causing an access-denied
    // race when PowerShell tries to open it immediately after.
    if (process.platform === 'darwin' || process.platform === 'linux') {
        try {
            await execFileAsync('stty', ['-f', port, serialBaud.toString(), 'raw', 'cs8', '-cstopb', '-parenb'], { timeout: 3000 });
            // Add delay after stty to allow device to stabilize (race condition fix)
            await new Promise<void>(resolve => setTimeout(resolve, 200));
        } catch { /* stty may fail on some setups; proceed anyway */ }
    }

    const openTarget = process.platform === 'win32' && /^COM\d+$/i.test(port)
        ? `\\\\.\\${port}`
        : port;

    // Only log the UNC device path on non-Windows (Windows uses PowerShell which logs its own message)
    if (process.platform !== 'win32' && openTarget !== port) {
        channel.appendLine(`[serial] Opening device path ${openTarget}`);
    }

    let stopped = false;
    let fd: fs.ReadStream | undefined;
    let winProc: ReturnType<typeof spawn> | undefined;

    /**
     * Spawn a PowerShell process to open `comPort` and stream its output.
     * Returns the exit code when the process closes.
     * Attaches stdout/stderr to `channel` immediately so output is visible.
     */
    const spawnWinSerial = (comPort: string): Promise<number | null> => {
        return new Promise(resolve => {
            // PowerShell script notes:
            //  - $ProgressPreference suppresses the "Preparing modules" progress bar.
            //  - [Console]::WriteLine() writes directly to the process stdout byte stream,
            //    bypassing PowerShell's pipeline/CLIXML serialization (Write-Host would not).
            //  - Single open attempt only — retry logic (with re-discovery) lives in Node.js.
            //  - NewLine = "\r\n" so ReadLine() strips CRLF line endings cleanly.
            const psScript =
                `$ProgressPreference = 'SilentlyContinue'\n` +
                `$sp = New-Object System.IO.Ports.SerialPort('${comPort}', ${serialBaud}, 'None', 8, 'One')\n` +
                `$sp.ReadTimeout = 500\n` +
                `$sp.NewLine = \"\\r\\n\"\n` +
                `try {\n` +
                `  $sp.Open()\n` +
                `} catch [System.UnauthorizedAccessException] {\n` +
                `  [Console]::Error.WriteLine('ACCESS_DENIED'); exit 1\n` +
                `}\n` +
                `[Console]::WriteLine('[serial] Serial session started.')\n` +
                `try {\n` +
                `  while ($true) {\n` +
                `    try { [Console]::WriteLine($sp.ReadLine()) }\n` +
                `    catch [System.TimeoutException] {}\n` +
                `  }\n` +
                `} catch [System.IO.IOException] {\n` +
                `  [Console]::WriteLine('[serial] Radio disconnected.')\n` +
                `} finally {\n` +
                `  if ($sp -and $sp.IsOpen) { $sp.Close() }\n` +
                `}`;
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            const proc = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encoded,
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            winProc = proc;

            let buf = '';
            proc.stdout?.on('data', (chunk: Buffer) => {
                if (stopped) { proc.kill(); return; }
                buf += chunk.toString('utf8');
                const lines = buf.split(/\r?\n/);
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.trim()) { channel.appendLine(stripVTControlCharacters(line)); }
                }
            });

            proc.stderr?.on('data', (chunk: Buffer) => {
                // 'ACCESS_DENIED' is our internal sentinel — suppress it from the channel
                const msg = chunk.toString('utf8').trim();
                if (msg && msg !== 'ACCESS_DENIED' && !stopped) {
                    channel.appendLine(`[serial] ${msg}`);
                }
            });

            proc.on('close', resolve);
        });
    };

    const runTail = async () => {
        if (process.platform === 'win32') {
            // Windows: fs.createReadStream does not work for COM ports — Windows serial
            // drivers require FILE_FLAG_OVERLAPPED which Node's fs module never sets.
            // Use a PowerShell child process with System.IO.Ports.SerialPort instead.
            //
            // After startSerialMode() the radio re-enumerates: the old COM port (e.g. COM3)
            // disappears and a new one (e.g. COM4) appears. Discovery may find the stale
            // port first. The outer loop re-discovers if the open attempt fails quickly
            // (access denied = wrong / not-yet-available port), so we eventually land on
            // the right port without hammering the same stale one.
            const maxAttempts = 8;
            const retryDelayMs = 1000;
            let currentPort = port!;

            for (let attempt = 0; attempt < maxAttempts && !stopped; attempt++) {
                if (attempt > 0) {
                    await new Promise<void>(r => setTimeout(r, retryDelayMs));
                    // Re-discover: the port may have changed after re-enumeration
                    const discovered = await findSerialPort(nameHint, vidHex, pidHex);
                    if (discovered) { currentPort = discovered; }
                    channel.appendLine(`[serial] Retrying on ${currentPort}…`);
                } else {
                    channel.appendLine(`[serial] Opening ${currentPort} via PowerShell SerialPort…`);
                }

                const startMs = Date.now();
                const exitCode = await spawnWinSerial(currentPort);
                const elapsed = Date.now() - startMs;

                if (!stopped && exitCode !== 0 && elapsed < 4000) {
                    // Quick failure → access denied or port not yet ready, retry with re-discovery
                    channel.appendLine(`[serial] ${currentPort} not ready, re-discovering…`);
                    continue;
                }
                break;
            }

            if (!stopped) {
                channel.appendLine('[serial] Serial session ended.');
            }
            stopped = true;
        } else {
            // macOS / Linux: use fs.createReadStream (works for tty character devices)
            try {
                fd = fs.createReadStream(openTarget, { flags: 'r' });
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
                        channel.appendLine(stripVTControlCharacters(line));
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
        }
    };

    void runTail();

    return {
        stop() {
            stopped = true;
            fd?.destroy();
            winProc?.kill();
        },
    };
}
