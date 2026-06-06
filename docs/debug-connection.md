# Ethos: Radio Debug (`ethosExt.radioDebug`)

It shows a Quick Pick with the following options:

- **Show Debug Connection** collects a diagnostic snapshot of the radio USB/HID state and writes it to the **Ethos Debug Connection** output channel. It is useful for troubleshooting radio detection issues before attempting a deploy.
- **Switch to Serial Mode** sends a command to the radio over HID to switch it from Ethos Suite mode to Serial mode.
- **Switch to USB Storage** sends a command to the radio over HID to switch it from Serial mode to Ethos Suite mode (USB Mode).

The **Show Debug Connection** snapshot contains:

- **Platform** — OS, architecture, Node.js version
- **Volumes** — mounted radio partitions detected by `.cpuid` markers (`flash.cpuid`, `sdcard.cpuid`, `radio.cpuid`) under `/Volumes`, `/media`, `/mnt`
- **HID Devices** — all USB HID interfaces matching the FrSky/Ethos vendor ID (`0x0483`), with product ID, path, interface number, usage page
- **RadioInterface Probe** — attempts to open the HID control interface and query the board ID and default storage key (`sdcard` or `radio`)
- **macOS extras** — `system_profiler SPUSBDataType`, `ioreg -p IOUSB`, and `/dev/cu.*` / `/dev/tty.*` device nodes (macOS only)

## Native module — `node-hid`

>NOTE: **End users: nothing to do.** The platform-specific VSIX downloaded from the Marketplace already contains the pre-compiled binary for your OS and VS Code version, this section is only for developers who want to build and test the extension locally from source. If you just want to use the extension, you can skip this section.

This command relies on [`node-hid`](https://github.com/node-hid/node-hid), a native C++ addon. Because VS Code runs inside Electron (which has its own Node.js ABI), the binary must be compiled against the correct Electron version.

**Developers (local F5 testing only):** after `npm install`, run once:

```bash
npm run rebuild-hid
```

Run this from the workspace root in a VS Code integrated terminal. It fetches the current VS Code Electron version automatically and rebuilds `node-hid` against it. Redo it whenever VS Code updates its Electron version (a few times a year).

If the binary is missing or was compiled against the wrong ABI, the command shows a clear error message in the output channel instead of crashing the extension.

> **macOS note:** On macOS Catalina (10.15) and later, the first time the command opens a HID device VS Code may prompt for **Input Monitoring** permission. Click Allow — this is required to communicate with the radio over USB HID.
