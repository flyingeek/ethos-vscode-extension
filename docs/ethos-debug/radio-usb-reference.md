# Radio USB Reference (TWXLITES on macOS)

Observed with a FrSky TWXLITES on macOS Sequoia 26 beta (kernel 25.5.0, x64).

## HID Device (both modes)

| Field | Value |
|---|---|
| Vendor ID | `0x0483` (1155) — FrSky / STM32 |
| Product ID | `0x5750` (22352) |
| Interface | 0 |
| Usage page | `0xFF` (vendor-specific) |
| Usage | 1 |
| Board ID | 12 |
| Default storage | `radio` |

Product string changes by mode:
- **Serial mode**: `FrSky TWXLITES Serial Port`
- **USB mass storage mode**: `FrSky TWXLITES Interface`

## Volumes (USB mass storage mode only)

Three volumes mount simultaneously:

| Volume | cpuid marker | `scripts/` dir | Role |
|---|---|---|---|
| `/Volumes/FLASH` | `flash` | No | Flash partition |
| `/Volumes/NO NAME` | `sdcard` | No | SD card partition |
| `/Volumes/TWINXLITES` | `sdcard` + `radio` | **Yes** | Deploy target |

**Deploy target** = the volume that has both a `radio.cpuid` marker and a `scripts/` directory → `/Volumes/TWINXLITES/scripts/<appname>`.

This matches `defaultStorage: "radio"` from `requestInformation()` and the `get_scripts_dir()` logic in `connect_macos.py` (prefers `sdcard`/`radio` over `flash`, requires `scripts/` subdir).

## Serial device (serial mode only)

- `/dev/cu.usbmodem144202`
- `/dev/tty.usbmodem144202`

VID/PID match `ethos-devtools.radio.vendorId` (`"0483"`) and `ethos-devtools.radio.productId` (`"5750"`) VS Code settings.
Baud rate: `115200` — configurable via `ethos-devtools.radio.serialBaud`.

## USB Mode switching (HID protocol)

| Action | Byte sequence |
|---|---|
| Switch to serial (debug) mode | `[0x00, 0x81, 0x68]` |
| Switch to mass storage mode | `[0x00, 0x81, 0x69]` |
| Query board info | write `[0x00, 0x21, 0x06]` → read 256 bytes, byte[2] = board ID |

Board IDs using sdcard storage: `4, 5, 6, 11`. All others (including 12) use `radio` storage.

## Deploy-to-radio flow

1. Open HID device (VID `0x0483`, PID `0x5750`)
2. Send `startSerialMode()` → `[0x00, 0x81, 0x68]`
3. Close HID
4. Wait for volumes to mount (poll for `radio.cpuid` / `scripts/` under `/Volumes`)
5. Copy app files to `/Volumes/TWINXLITES/scripts/<appname>/`
6. Re-open HID device
7. Send `stopSerialMode()` → `[0x00, 0x81, 0x69]`
8. Close HID

The HID interface remains accessible while in mass storage mode (step 6 works without re-enumeration).

## macOS notes

- `system_profiler SPUSBDataType` returns no output on macOS Sequoia 26 beta — not reliable, use `ioreg` instead.
- First HID open may trigger an **Input Monitoring** privacy permission prompt (macOS Catalina+).
- Volumes unmount automatically when `stopSerialMode()` is sent; no explicit `diskutil unmount` needed from the deploy side (the radio handles it).
- On macOS there is no equivalent of `FSCTL_LOCK_VOLUME` (Windows only) — not needed for the sequential deploy workflow.
