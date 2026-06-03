# Ethos VSCode Extension

This extension is a proposal for the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds those commands to VS Code:

- **Ethos: Play Telemetry CSV** — replay a CSV telemetry log (Ethos or EdgeTX format) into the running simulator and pin a telemetry status label in the Ethos extension
- **Ethos: Stop Telemetry** — stop the current telemetry playback and clear the pinned status label
- **Ethos: Set Telemetry Value** — pick a sensor frame by name and inject a single value into the running simulator
- **Ethos: Deploy to Simulator** — copy a Lua app folder from the workspace into the Ethos simulator's scripts directory, with optional manifest-driven selective copy and post-deploy steps
- **Ethos: Deploy to Radio** — deploy a Lua app folder to a connected radio. The radio can be connected in `Ethos Suite` or `Serial` mode.
- **Ethos: Radio Serial Console** - Tail the radio's serial console output into the **Ethos Deploy** output channel. The radio must be connected in `Serial` mode for this to work.
- **Ethos: Radio Debug** — useful tools for debugging a connected radio (see [Debug Connection](./docs/debug-connection.md)).

The extension is only activated in workspaces where the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension is active. It requires `bsongis.ethos` to be installed.

> **Note:** This extension was previously named "Ethos Simulator Manager" and used the `ethos` prefix for settings and commands. It has been renamed to "Ethos VSCode Extension" as all the simulator management commands have been integrated in the `bsongis.ethos` extension.

## Installation

Download the latest VSIX for your platform from the [Releases](https://github.com/flyingeek/ethos-vscode-extension/releases) page and install it via the Extensions panel in VS Code (drag and drop the VSIX file in the panel).

## Configuration

| Setting | Type | Description |
|---|---|---|
| `ethosExt.telemetryCustomSpeed` | `number` | Optional custom replay speed multiplier for telemetry playback. If set, it will appear as an option in the speed picker during playback. |
| `ethosExt.deploy` | `object` | Configuration for **Ethos: Deploy to Simulator** and **Ethos: Deploy to Radio** (see below). |

For Deploy to work, the minimum settings to add is:

```json
"ethosExt.deploy": {
    "app": "appname",
}
```

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

- **Ethos: Deploy to Simulator** (`ethosExt.deploySimulator`) copies a Lua app folder from your workspace into the correct simulator scripts directory.
- **Ethos: Deploy to Radio** (`ethosExt.deployRadio`) copies a Lua app folder from your workspace to a connected radio.

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

- `manifest.folder` when `ethosExt.deploy.manifest` is set to a non-empty string
- `path.basename(ethosExt.deploy.app)` otherwise

RADIO: is the first available storage key (`sdcard` or `radio`) containing a scripts folder on the connected radio.

### Deploy Configuration

Configure the command via `ethosExt.deploy` in your workspace settings:

```json
"ethosExt.deploy": {
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
