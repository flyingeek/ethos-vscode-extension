# Ethos VSCode Extension

This extension is a proposal for the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds those commands to VS Code:

- **Ethos: Play Telemetry CSV** — replay a CSV telemetry log (Ethos or EdgeTX format) into the running simulator and pin a telemetry status label in the Ethos extension
- **Ethos: Stop Telemetry** — stop the current telemetry playback and clear the pinned status label
- **Ethos: Set Telemetry Value** — pick a sensor frame by name and inject a single value into the running simulator
- **Ethos: Deploy to Simulator** — copy a Lua app folder from the workspace into the Ethos simulator's scripts directory, with optional manifest-driven selective copy and post-deploy steps
- **Ethos: Deploy to Radio** — deploy a Lua app folder to a connected radio (not yet implemented)

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
    "steps": []
}
```

| Property | Type | Default | Description |
|---|---|---|---|
| `app` | `string` | — | **Required.** Workspace-relative path to the source app folder. |
| `manifest` | `string` | `""` | Workspace-relative path to the Ethos Lua manifest file. If set to a non-empty string, only files listed in the manifest are copied (manifest mode). If empty, all files are copied recursively. |
| `steps` | `string[]` | `[]` | Post-deploy commands run sequentially after the copy. See [Post-deploy steps](#post-deploy-steps). |

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

### Post-deploy steps

Each entry in `steps` is run after the copy completes. The extension substitutes two variables:

| Variable | Value |
|---|---|
| `${destPath}` | Absolute path to the destination app folder |
| `${sourcePath}` | Absolute path to the source app folder |

The paths are also passed as environment variables `DEST_PATH` and `SOURCE_PATH` to every step process.

**Shell commands** (default) — run via `exec()` with the workspace root as the working directory:

```json
"steps": [
    ".venv/bin/python scripts/post-deploy.py",
    "echo Done: ${destPath}"
]
```

**Node.js scripts** — any entry whose first token ends in `.js` or `.mjs` is run via `fork()`:

```json
"steps": [
    "scripts/post-deploy.mjs"
]
```

All stdout/stderr is streamed to the **Ethos Deploy** output channel. A non-zero exit code aborts the remaining steps and shows an error notification.

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
