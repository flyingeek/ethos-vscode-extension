# Ethos DevTools Extension

Ethos DevTools `flyingeek.ethos-devtools` is a VS Code extension that complements the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds those commands to VS Code:

- **Ethos DevTools: Play Telemetry CSV** — replay a CSV telemetry log (Ethos or EdgeTX format) into the running simulator and pin a telemetry status label in the Ethos extension
- **Ethos DevTools: Stop Telemetry** — stop the current telemetry playback and clear the pinned status label
- **Ethos DevTools: Set Telemetry Value** — pick a sensor frame by name and inject a single value into the running simulator
- **Ethos DevTools: Deploy to Simulator** — copy a Lua app folder from the workspace into the Ethos simulator's scripts directory, with optional manifest-driven selective copy and post-deploy steps
- **Ethos DevTools: Deploy to Radio** — deploy a Lua app folder to a connected radio. The radio can be connected in `Ethos Suite` or `Serial` mode.
- **Ethos DevTools: Radio Serial Console** - Tail the radio's serial console output into the **Ethos Deploy** output channel. The radio must be connected in `Serial` mode for this to work.
- **Ethos DevTools: Radio Debug** — useful tools for debugging a connected radio (see [Debug Connection](./docs/debug-connection.md)).
- **Ethos DevTools: Scaffold New Project** — scaffold a new Lua project from a GitHub template repository, with interactive prompts and template variable substitution (see [Project Scaffolding](./docs/scaffolding-project.md)).

The extension is only activated in workspaces where the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension is active. It requires `bsongis.ethos` to be installed.

> **Note:** This extension was previously named "Ethos Simulator Manager" and used the `ethos` prefix for settings and commands. It was then renamed to "Ethos VSCode Extension" as all the simulator management commands had been integrated in the `bsongis.ethos` extension.
>
> Finally before publication on the VS Code marketplace, the name was changed again to "Ethos DevTools" to better reflect the scope of the extension.
>
> The command and setting prefixes have been updated from `ethosExt.` to `ethos-devtools.` to reflect the new name.

## Installation

Install the extension from the VS Code marketplace: [flyingeek.ethos-devtools](https://marketplace.visualstudio.com/items?itemName=flyingeek.ethos-devtools)

The extension use native dependencies for the radio connection features, so we provide platform-specific VSIX files for Windows (x64), Linux (x64), and MacOS (arm64 and x64).
The Linux version has not been tested yet, feel free to raise an issue if you want to help testing it or if you encounter any problem.

For other platforms, there is an "universal" version without native dependencies, but the radio connection features will not work, you still can use the telemetry and deploy to simulator features.

VSIX files can also be downloaded from the releases page. To install a VSIX file, open the Extensions view in VS Code, click on the three-dot menu in the top-right corner, and select "Install from VSIX...". Then, select the downloaded VSIX file (or simply drag and drop it into the Extensions view).

## Configuration

| Setting | Type | Description |
| --- | --- | --- |
| `ethos-devtools.telemetryReplaySpeeds` | `number[]` | Replay speed multipliers shown during telemetry playback. Defaults to `[1, 2, 5, 10]`. |
| `ethos-devtools.deploy` | `object` | Configuration for **Ethos DevTools: Deploy to Simulator** and **Ethos DevTools: Deploy to Radio** (see below). |
| `ethos-devtools.reload` | `object` | Configuration for **Ethos DevTools: Reload Simulator**. Same syntax as ethos-menu.json, defaults to { "command": ["ethos.stop", "ethos-devtools.deploySimulator", "ethos.start"] }. The ethos-devtools.reload is available from the simulator's Display titlebar |
| `ethos-devtools.radio` | `object` | Configuration for radio connection and deploy target detection (see [radio settings](./docs/radio-settings.md)). |

For Deploy to work, the minimum settings to add is:

```json
"ethos-devtools.deploy": {
    "app": "appname",
}
```

## Telemetry Playback

**Ethos DevTools: Play Telemetry CSV** replays a flight log into the running Ethos simulator via the `ethos.injectTelemetry` API:

Telemetry frame discovery uses `sensors.json` from the simulator root.

1. Pick a CSV file from the workspace (or browse the file system).
2. Select a replay speed. The default options are `1×`, `2×`, `5×`, and `10×`, configurable via `ethos-devtools.telemetryReplaySpeeds`.
3. Choose **Play once** or **Loop**.

Supported formats:

- **Ethos log** — columns such as `Altitude(m)`, `RxBatt(V)`, `ESC voltage(V)`, `RSSI 2.4G(dB)`, `GPS` (space-separated lat lon), …
- **EdgeTX log** — columns such as `Alt(m)`, `RxBt(V)`, `1RSS(dB)`, `RQly(%)`, `Curr(A)`, `GPS` (space-separated lat lon), …

Only frames listed in `sensors.json` (as returned by `ethos.getSensors`) are injected — extra CSV columns are silently ignored. The progress notification shows the current row, percentage, and the frame names sent on each tick. Playback can be cancelled via the notification's cancel button or the **Ethos DevTools: Stop Telemetry** command.

> **Note:** You can read more information in the [telemetry doc file](./docs/telemetry.md).

## Set Telemetry Value

**Ethos DevTools: Set Telemetry Value** lets you inject a single value into any sensor frame of the running Ethos simulator:

1. Pick a frame from the list returned by `ethos.getSensors` (e.g. `Altitude`, `VSpeed`, `RSSI`).
2. Enter the value in human-readable units (e.g. `150` for 150 m).

The simulator is updated immediately. The command requires the Ethos simulator to be running.

## Deploy

- **Ethos DevTools: Deploy to Simulator** (`ethos-devtools.deploySimulator`) copies a Lua app folder from your workspace into the correct simulator scripts directory.
- **Ethos DevTools: Deploy to Radio** (`ethos-devtools.deployRadio`) copies a Lua app folder from your workspace to a connected radio.

### Destination path

#### Simulator

```text
<ethos.simulatorsFolder>/<ethos.board>_<ethos.protocol>@<ethos.release>/scripts/<appname>
```

#### Radio

```text
RADIO:/scripts/<appname>
```

`<appname>` is:

- `manifest.folder` when `ethos-devtools.deploy.manifest` is set to a non-empty string
- `path.basename(ethos-devtools.deploy.app)` otherwise

RADIO: is the first available storage key (`sdcard` or `radio`) containing a scripts folder on the connected radio. You may change the priority order of storage keys via `ethos-devtools.radio.storageTargetPriority`.

The radio is synced using different methosds:

- Lua mode `ethos-devtools.deployRadioLua`: only .lua files are copied, useful for quick iterations when project is quite big.
- Fast mode `ethos-devtools.deployRadioFast`: uses `rsync` like mode, the manifest is skipped.
- Manifest mode `ethos-devtools.deployRadio`: is like fast mode but the manifest is used to determine which files to copy and delete.
- Ultra Safe Mode `ethos-devtools.deployRadio`: extra steps ensure a safe deployment, this is the default mode when no manifest present.

All thoses modes (except manifest mode)were ported from rob thomson's deploy scripts.

### Deploy Configuration

Configure the command via `ethos-devtools.deploy` in your workspace settings:

```json
"ethos-devtools.deploy": {
    "app": "gps-qrcode",
    "manifest": "ethos_lua_manifest.json",
    "stageSteps": [],
    "steps": []
}
```

The full configuration schema is described in the [Deploy steps and manifest doc](./docs/deploy-steps-and-manifest.md).

## ethos-menu.json

To integrate with the Ethos extension's menu, add entries to your project's `ethos-menu.json` file:

```json
[
    {
        "label": "📊 Telemetry playback",
        "command": "ethos-devtools.playTelemetry"
    },
    {
        "label": "✏️ Set telemetry value",
        "command": "ethos-devtools.setTelemetry"
    },
    {
        "label": "🚀 Deploy to simulator",
        "command": "ethos-devtools.deploySimulator"
    },
    {
        "label": "📻 Deploy to radio",
        "command": "ethos-devtools.deployRadio"
    },
    {
        "label": "$(debug-start)Deploy & Launch SIM",
        "command": ["ethos.stop", "ethos.clearLogfile", "ethos-devtools.deploySimulator", "ethos.start"]
    },
]
```
