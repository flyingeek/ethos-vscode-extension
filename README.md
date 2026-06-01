# Ethos VSCode Extension

This extension is a proposal for the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds those commands to VS Code:

- **Ethos: Play Telemetry CSV** — replay a CSV telemetry log (Ethos or EdgeTX format) into the running simulator and pin a telemetry status label in the Ethos extension
- **Ethos: Stop Telemetry** — stop the current telemetry playback and clear the pinned status label
- **Ethos: Set Telemetry Value** — pick a sensor frame by name and inject a single value into the running simulator
- **Ethos: Deploy to Simulator** — copy a Lua app folder from the workspace into the Ethos simulator's scripts directory, with optional manifest-driven selective copy and post-deploy steps
- **Ethos: Deploy to Radio** — deploy a Lua app folder to a connected radio (not yet implemented)
- **Ethos: Debug Connection** — collect a USB/HID/serial/volume diagnostic snapshot of a connected radio and display it in the **Ethos Debug Connection** output channel

The extension is only activated in workspaces where the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension is active. It requires `bsongis.ethos` to be installed.

> **Note:** This extension was previously named "Ethos Simulator Manager" and used the `ethos` prefix for settings and commands. It has been renamed to "Ethos VSCode Extension" as all the simulator management commands have been integrated in the `bsongis.ethos` extension.

## Configuration

| Setting | Type | Description |
|---|---|---|
| `ethosExt.telemetryCustomSpeed` | `number` | Optional custom replay speed multiplier for telemetry playback. If set, it will appear as an option in the speed picker during playback. |
| `ethosExt.deploy` | `object` | Configuration for **Ethos: Deploy to Simulator** and **Ethos: Deploy to Radio** (see below). |

## Telemetry Playback

**Ethos: Play Telemetry CSV** replays a flight log into the running Ethos simulator via the `ethos.injectTelemetry` API:

Telemetry frame discovery uses `sensors.json` from the simulator root.

1. Pick a CSV file from the workspace (or browse the file system).
2. Select a replay speed (`1×`, `2×`, `5×`, `10×`, or a custom value if configured via `ethosExt.telemetryCustomSpeed`).
3. Choose **Play once** or **Loop**.

Supported formats:

- **Ethos log** — columns such as `Altitude(m)`, `RxBatt(V)`, `ESC voltage(V)`, `RSSI 2.4G(dB)`, `GPS` (space-separated lat lon), …
- **EdgeTX log** — columns such as `Alt(m)`, `RxBt(V)`, `1RSS(dB)`, `RQly(%)`, `Curr(A)`, `GPS` (space-separated lat lon), …

Only frames listed in `sensors.json` (as returned by `ethos.getSensors`) are injected — extra CSV columns are silently ignored. The progress notification shows the current row, percentage, and the frame names sent on each tick. Playback can be cancelled via the notification's cancel button or the **Ethos: Stop Telemetry** command.

> **Note:** You can read more information in the [telemetry doc file](./docs/telemetry.md).

## Set Telemetry Value

**Ethos: Set Telemetry Value** lets you inject a single value into any sensor frame of the running Ethos simulator:

1. Pick a frame from the list returned by `ethos.getSensors` (e.g. `Altitude`, `VSpeed`, `RSSI`).
2. Enter the value in human-readable units (e.g. `150` for 150 m).

The simulator is updated immediately. The command requires the Ethos simulator to be running.

## Deploy

**Ethos: Deploy to Simulator** (`ethosExt.deploySimulator`) copies a Lua app folder from your workspace into the correct simulator scripts directory. **Ethos: Deploy to Radio** (`ethosExt.deployRadio`) is not yet implemented.

### Destination path

```
<ethos.simulatorsFolder>/<ethos.board>_<ethos.protocol>@<ethos.release>/scripts/<appname>
```

`<appname>` is:
- `manifest.folder` when `ethosExt.deploy.manifest` is set to a non-empty string
- `path.basename(ethosExt.deploy.app)` otherwise

### Configuration

Configure the command via `ethosExt.deploy` in your workspace settings:

```json
"ethosExt.deploy": {
    "app": "src/gps-qrcode",
    "manifest": "ethos_lua_manifest.json",
    "stageSteps": [],
    "steps": []
}
```

| Property | Type | Default | Description |
|---|---|---|---|
| `app` | `string` | — | **Required.** Workspace-relative path to the source app folder. |
| `manifest` | `string` | `""` | Workspace-relative path to the Ethos Lua manifest file. If set to a non-empty string, only files listed in the manifest are copied (manifest mode). If empty, all files are copied recursively. |
| `stageSteps` | `(string \| object)[]` | `[]` | Pre-copy deploy steps. When present, the source app is first copied to a temporary staging folder, these steps run against the staged app, and then the staged output is deployed. See [Deploy steps](#deploy-steps). |
| `steps` | `(string \| object)[]` | `[]` | Post-copy deploy steps that run sequentially after files are copied to the final target folder. See [Deploy steps](#deploy-steps). |

The command also reads the following settings from the `bsongis.ethos` extension:

| Setting | Description |
|---|---|
| `ethos.simulatorsFolder` | Root folder containing simulator installations. Supports `~`. |
| `ethos.board` | Board identifier (e.g. `x18rs`). |
| `ethos.protocol` | Protocol identifier (e.g. `ACCESS`). |
| `ethos.release` | Ethos release identifier (e.g. `1.7.2`). |

### Manifest mode

Manifest mode activates when `ethosExt.deploy.manifest` is set to a non-empty string. It uses an [`ethos_lua_manifest.json`](./ethos_lua_manifest.json) file:

```json
{
    "manifestVersion": 1,
    "folder": "gps-qrcode",
    "files": [
        "gps-qrcode/main.lua",
        "gps-qrcode/gps-qrcode.png",
        "gps-qrcode/i18n/*",
        "gps-qrcode/lib/*"
    ]
}
```

- Only files matching the `files` patterns are copied. Glob patterns (`dir/*`, `dir/**/*`) are supported.
- The `manifest.folder` prefix is stripped from each pattern to derive the path relative to `app`.
- The manifest itself is copied to the destination so subsequent deploys can clean up stale files.
- If an existing manifest is found in the destination, all files it listed are deleted before copying.
- Errors: the command aborts if the manifest is unreadable or `manifestVersion` is not `1`.

### Deploy steps

Each entry in `stageSteps` or `steps` is either a **string** or an **object**. A non-zero exit code aborts remaining steps and shows an error notification. All stdout/stderr is streamed to the **Ethos Deploy** output channel.

Timing depends on the step list:

| Step list | When it runs | `DEST_PATH` |
|---|---|---|
| `stageSteps` | Before any simulator or radio copy | Temporary staged app folder |
| `steps` | After files are copied to the final target | Final simulator or radio app folder |

The following environment variables are set for every step process:

| Variable | Value |
|---|---|
| `DEST_PATH` | Absolute path to the staged app folder for `stageSteps`, or the final deployed app folder for `steps` |
| `SOURCE_PATH` | Absolute path to the source app folder |
| `WORKSPACE_ROOT` | Absolute path to the workspace root |
| `DEPLOY_TARGET` | `"simulator"`, `"radio"`, `"radio-lua"`, or `"radio-fast"` |

#### Variable substitution

The following variables are expanded at step execution time:

| Variable | Expands to | Where |
|---|---|---|
| `${pythonInterpreterPath}` | The resolved Python interpreter path from the Python extension, or `python.defaultInterpreterPath` or `python` if the Python extension is not available or fails to resolve. it. | `script` (exec) |
| `${destPath}` | Absolute path to the destination app folder | `script` (exec), `args` |
| `${sourcePath}` | Absolute path to the source app folder | `script` (exec), `args` |
| `${workspaceFolder}` | Absolute path to the workspace root | `args`, `env` values |
| `${workspaceRoot}` | Same as `${workspaceFolder}` (deprecated alias) | `args`, `env` values |
| `${config:section.key}` | Value of a VS Code setting (e.g. `${config:python.defaultInterpreterPath}`) | `args`, `env` values |

Unknown `${config:…}` keys resolve to an empty string.

#### String step

A plain string is either a `.js`/`.mjs` path (run via `fork()`) or a shell command (run via `exec()`). Detection is based on the first token ending in `.js` or `.mjs`.

```json
"stageSteps": [
    "docs/deploy-themes.mjs",
    ".venv/bin/python scripts/post-deploy.py",
    "echo Done: ${destPath}"
]
```

#### Object step

An object step gives you full control over the script, arguments, and extra environment variables:

```json
"steps": [
    {
        "script": "docs/deploy-themes.mjs",
        "args": ["/path/to/EFC-themes/lua/themes"],
        "env": { "ETHOS_VERSION": "26.0" }
    }
]
```

| Property | Type | Description |
|---|---|---|
| `script` | `string` | **Required.** A `.js`/`.mjs` path or a shell command. |
| `args` | `string[]` | Extra arguments. Passed to `fork()` for Node scripts; appended to the command string for exec. Supports [variable substitution](#variable-substitution). |
| `env` | `object` | Extra environment variables merged on top of the base env for this step only. Values support [variable substitution](#variable-substitution). |

#### Bundled post-deploy scripts

| Script | Description |
|---|---|
| [`docs/deploy-sensors.mjs`](./docs/deploy-sensors.mjs) | Copies `.vscode/sensors.json` to the simulator root (skipped if already present, skipped on radio target). |
| [`docs/deploy-themes.mjs`](./docs/deploy-themes.mjs) | Mirrors `theme-*` directories from a sibling `EFC-themes` repo into the simulator's `scripts/` directory. Skipped when `ETHOS_VERSION` major < 26. The source directory can be overridden via `args[0]` or the `ETHOS_THEMES_DIR` env var. |

## Debug Connection

**Ethos: Debug Connection** (`ethosExt.debugConnection`) collects a diagnostic snapshot of the radio USB/HID state and writes it to the **Ethos Debug Connection** output channel. It is useful for troubleshooting radio detection issues before attempting a deploy.

The snapshot contains:

- **Platform** — OS, architecture, Node.js version
- **Volumes** — mounted radio partitions detected by `.cpuid` markers (`flash.cpuid`, `sdcard.cpuid`, `radio.cpuid`) under `/Volumes`, `/media`, `/mnt`
- **HID Devices** — all USB HID interfaces matching the FrSky/Ethos vendor ID (`0x0483`), with product ID, path, interface number, usage page
- **RadioInterface Probe** — attempts to open the HID control interface and query the board ID and default storage key (`sdcard` or `radio`)
- **macOS extras** — `system_profiler SPUSBDataType`, `ioreg -p IOUSB`, and `/dev/cu.*` / `/dev/tty.*` device nodes (macOS only)

### Native module — `node-hid`

This command relies on [`node-hid`](https://github.com/node-hid/node-hid), a native C++ addon. Because VS Code runs inside Electron (which has its own Node.js ABI), the binary must be compiled against the correct Electron version.

**End users:** nothing to do. The platform-specific VSIX downloaded from the Marketplace already contains the pre-compiled binary for your OS and VS Code version.

**Developers (local F5 testing only):** after `npm install`, run once:

```bash
npx electron-rebuild -w node-hid
```

Run this from the workspace root in a VS Code integrated terminal. `electron-rebuild` detects the VS Code Electron version automatically from the running process. Redo it whenever VS Code updates its Electron version (a few times a year).

If the binary is missing or was compiled against the wrong ABI, the command shows a clear error message in the output channel instead of crashing the extension.

> **macOS note:** On macOS Catalina (10.15) and later, the first time the command opens a HID device VS Code may prompt for **Input Monitoring** permission. Click Allow — this is required to communicate with the radio over USB HID.

## ethos-menu.json

To integrate with the Ethos extension's menu, add entries to your project's `ethos-menu.json` file:

```json
[
    {
        "label": "📊 Telemetry playback",
        "command": "ethosExt.playTelemetry"
    },
    {
        "label": "✏️ Set telemetry value",
        "command": "ethosExt.setTelemetry"
    },
    {
        "label": "🚀 Deploy to simulator",
        "command": "ethosExt.deploySimulator"
    },
    {
        "label": "📻 Deploy to radio",
        "command": "ethosExt.deployRadio"
    },
    {
        "label": "$(debug-start)Deploy & Launch SIM",
        "command": ["ethos.stop", "ethos.clearLogfile", "ethosExt.deploySimulator", "ethos.start"]
    },
]
```
