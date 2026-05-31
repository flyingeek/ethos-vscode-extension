/**
 * Ethos radio HID protocol layer.
 *
 * Mirrors the protocol constants and open strategy from connect_base.py.
 * Uses node-hid (https://github.com/node-hid/node-hid).
 *
 * NOTE: node-hid is a native addon.  The VSIX build must run
 *   npx @electron/rebuild -v <VS_CODE_ELECTRON_VERSION> -w node-hid
 * so the binary is compiled against the correct Electron ABI.
 */

// node-hid is an optional peer dependency; we import it lazily so that the
// extension still loads (and shows a friendly error) when the native binary
// has not been rebuilt for the current Electron version.
// eslint-disable-next-line @typescript-eslint/no-require-imports
let _hid: typeof import('node-hid') | null = null;
function getHid(): typeof import('node-hid') {
    if (!_hid) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            _hid = require('node-hid') as typeof import('node-hid');
        } catch (e) {
            throw new Error(
                `node-hid could not be loaded. ` +
                `The native module may need to be rebuilt for this version of VS Code.\n${e}`
            );
        }
    }
    return _hid;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RadioConfig {
    vendorId: number;       // default 0x0483
    productId: number;      // default 0x5750 (primary); 0x5740 also tried
    retries: number;        // default 10
    retryDelayMs: number;   // default 1000 ms  (serial_retry_delay * 1000)
    nameHint: string;       // default "FrSky"  (for fuzzy serial port matching)
    serialBaud: number;     // default 115200
}

const DEFAULT_RADIO_CONFIG: RadioConfig = {
    vendorId:    0x0483,
    productId:   0x5750,
    retries:     10,
    retryDelayMs: 1000,
    nameHint:    'FrSky',
    serialBaud:  115200,
};

/** Read ethosExt.radio settings and merge with defaults. */
export function getRadioConfig(): RadioConfig {
    const cfg = require('vscode').workspace
        .getConfiguration('ethosExt.radio') as {
            get<T>(key: string): T | undefined;
        };
    const parseHex = (v: string | undefined, fallback: number): number => {
        const n = parseInt(v ?? '', 16);
        return isNaN(n) ? fallback : n;
    };
    return {
        vendorId:     parseHex(cfg.get<string>('vendorId'),  DEFAULT_RADIO_CONFIG.vendorId),
        productId:    parseHex(cfg.get<string>('productId'), DEFAULT_RADIO_CONFIG.productId),
        retries:      cfg.get<number>('retries')    ?? DEFAULT_RADIO_CONFIG.retries,
        retryDelayMs: Math.round((cfg.get<number>('retryDelay') ?? 1.0) * 1000),
        nameHint:     cfg.get<string>('nameHint')   ?? DEFAULT_RADIO_CONFIG.nameHint,
        serialBaud:   cfg.get<number>('serialBaud') ?? DEFAULT_RADIO_CONFIG.serialBaud,
    };
}

// ---------------------------------------------------------------------------
// Protocol constants (from connect_base.py)
// ---------------------------------------------------------------------------
export const ETHOS_VENDOR_ID  = 0x0483;
export const ETHOS_PRODUCT_IDS = [0x5750, 0x5740] as const;

const ETHOS_SUITE_INFORMATION_REQUEST  = 0x21;
const ETHOS_SUITE_INFORMATION_RESPONSE = 0x22;
const ETHOS_SUITE_USB_MODE_REQUEST     = 0x81;
const ETHOS_SUITE_USB_MODE_START       = 0x68; // startSerialMode
const ETHOS_SUITE_USB_MODE_STOP        = 0x69; // stopSerialMode

// Boards that use sdcard storage (from connect_base.py request_information)
const SDCARD_BOARDS = new Set([4, 5, 6, 11]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface HidDeviceInfo {
    vendorId: number;
    productId: number;
    path: string;
    productString: string;
    manufacturerString: string;
    serialNumber: string;
    interfaceNumber: number;
    usagePage: number;
    usage: number;
}

export interface RadioInformation {
    board: number;
    defaultStorage: 'sdcard' | 'radio';
}

// ---------------------------------------------------------------------------
// Enumerate helpers
// ---------------------------------------------------------------------------

/** Return all HID devices matching the Ethos vendor ID (or a custom VID from config). */
export function enumerateEthosDevices(vendorId: number = ETHOS_VENDOR_ID): HidDeviceInfo[] {
    const hid = getHid();
    const all = hid.devices();
    return all
        .filter(d => d.vendorId === vendorId)
        .map(d => ({
            vendorId:           d.vendorId ?? 0,
            productId:          d.productId ?? 0,
            path:               d.path ?? '',
            productString:      d.product ?? '',
            manufacturerString: d.manufacturer ?? '',
            serialNumber:       d.serialNumber ?? '',
            interfaceNumber:    d.interface ?? -1,
            usagePage:          d.usagePage ?? 0,
            usage:              d.usage ?? 0,
        }));
}

// ---------------------------------------------------------------------------
// Open strategy (mirrors connect_base.py _open_ethos_hid_device)
// ---------------------------------------------------------------------------

function openEthosDevice(): import('node-hid').HID {
    const hid = getHid();

    // Strategy 1: direct VID/PID for known product IDs
    for (const pid of ETHOS_PRODUCT_IDS) {
        try {
            return new hid.HID(ETHOS_VENDOR_ID, pid);
        } catch {
            // try next
        }
    }

    // Strategy 2: enumerate and open by exact path
    const candidates = getEthosCandidates();
    for (const dev of candidates) {
        if (!dev.path) { continue; }
        try {
            return new hid.HID(dev.path);
        } catch {
            // try next
        }
    }

    // Strategy 3: last-chance open by any enumerated PID
    for (const dev of candidates) {
        if (!dev.productId) { continue; }
        try {
            return new hid.HID(ETHOS_VENDOR_ID, dev.productId);
        } catch {
            // try next
        }
    }

    const summary = summarizeEthosCandidates();
    throw new Error(`No Ethos compatible HID device found (${summary})`);
}

function getEthosCandidates(): import('node-hid').Device[] {
    try {
        return getHid().devices().filter(d => {
            if (d.vendorId !== ETHOS_VENDOR_ID) { return false; }
            const pid = d.productId ?? 0;
            if ((ETHOS_PRODUCT_IDS as readonly number[]).includes(pid)) { return true; }
            const up = d.usagePage ?? 0;
            const iface = d.interface ?? -1;
            return [0xFF00, 0x0001, 0x000C].includes(up) || [0, 1].includes(iface);
        });
    } catch {
        return [];
    }
}

function summarizeEthosCandidates(): string {
    try {
        const all = getHid().devices().filter(d => d.vendorId === ETHOS_VENDOR_ID);
        if (all.length === 0) { return 'vendor 0x0483 not present'; }
        const pids = [...new Set(all.map(d => d.productId).filter((p): p is number => p != null))].sort();
        if (pids.length === 0) { return `vendor present (${all.length} interfaces), pid unknown`; }
        return `vendor present (${all.length} interfaces), pids=${pids.map(p => `0x${p.toString(16).toUpperCase().padStart(4, '0')}`).join(',')}`;
    } catch {
        return 'unable to enumerate HID devices';
    }
}

// ---------------------------------------------------------------------------
// RadioInterface
// ---------------------------------------------------------------------------

export class RadioInterface {
    private device: import('node-hid').HID;

    constructor(config: Partial<RadioConfig> = {}) {
        const { retries, retryDelayMs: retryDelay } = { ...DEFAULT_RADIO_CONFIG, ...config };
        let lastError: unknown;
        let opened: import('node-hid').HID | undefined;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                opened = openEthosDevice();
                break;
            } catch (e) {
                lastError = e;
                if (attempt < retries) {
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelay);
                }
            }
        }
        if (!opened) {
            throw lastError;
        }
        this.device = opened;
        void retries; // consumed above
    }

    close(): void {
        try { this.device.close(); } catch { /* ignore */ }
    }

    /** Query board id and default storage key. */
    requestInformation(): RadioInformation | null {
        this.device.write([0x00, ETHOS_SUITE_INFORMATION_REQUEST, 6]);
        const result = this.device.readTimeout(200);
        if (result && result.length >= 3) {
            const board = result[2];
            return {
                board,
                defaultStorage: SDCARD_BOARDS.has(board) ? 'sdcard' : 'radio',
            };
        }
        return null;
    }

    /** Switch radio into serial mode. */
    startSerialMode(): void {
        this.device.write([0x00, ETHOS_SUITE_USB_MODE_REQUEST, ETHOS_SUITE_USB_MODE_START]);
    }

    /** Switch radio back to USB mass-storage mode. */
    stopSerialMode(): void {
        this.device.write([0x00, ETHOS_SUITE_USB_MODE_REQUEST, ETHOS_SUITE_USB_MODE_STOP]);
    }
}
