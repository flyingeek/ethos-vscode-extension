# Ethos Simulator Manager

This extension is a proposal for the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds simulator management commands to VS Code:

- **Ethos: Add Simulator** — set up a simulator firmware in the `simulator/` directory
- **Ethos: Set Simulator** — switch the active simulator firmware via a quick pick
- **Ethos: Show Menu** — show the custom quick pick menu defined in `.vscode/sim-menu.json`
- **Ethos: Play Telemetry CSV** — replay a CSV telemetry log (Ethos or EdgeTX format) into the running simulator
- **Ethos: Stop Telemetry** — stop the current telemetry playback

The extension is only activated in workspaces where the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension is active. It requires `bsongis.ethos` to be installed.

Note: the simulator name comes from Rob's vscode-template; `simulators/` or a user-defined name may be more appropriate.

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `ethosSimManager.simulatorFolder` | `string` | `"simulator"` | Relative path to the simulator directory within the workspace |
| `ethosSimManager.telemetrySpeed` | `number` | `1` | Default replay speed multiplier (1 = real-time, 2 = double speed) |
| `ethosSimManager.telemetryLoop` | `boolean` | `false` | Whether telemetry playback loops back to the beginning when the file ends |

## Status Bar

The status bar item displays the active simulator firmware. Clicking it opens the **Ethos: Show Menu** quick pick (see below). If `.vscode/sim-menu.json` is absent, empty, or invalid, the click falls back to **Ethos: Set Simulator** directly.

`ethosSimManager.statusBarText` supports `${firmware}`, `${version}`, and `${versionSuffix}` placeholders. `${versionSuffix}` expands to `@<version>` only when the configured version is not `nightly26`; otherwise it expands to an empty string.

During telemetry playback the item switches to a spinning indicator (`Telemetry playing`). Clicking it while playing triggers **Ethos: Stop Telemetry**.

## Telemetry Playback

**Ethos: Play Telemetry CSV** replays a flight log into the running Ethos simulator via the `ethos.injectTelemetry` API:

Telemetry frame discovery uses `sensors.json` from the simulator root configured in `ethos.root`.

1. Pick a CSV file from the workspace (or browse the file system).
2. Select a replay speed (`1×`, `2×`, `5×`, `10×`).
3. Choose **Play once** or **Loop**.

Supported formats:

- **Ethos log** — columns such as `Altitude(m)`, `RxBatt(V)`, `ESC voltage(V)`, `RSSI 2.4G(dB)`, `GPS` (space-separated lat lon), …
- **EdgeTX log** — columns such as `Alt(m)`, `RxBt(V)`, `1RSS(dB)`, `RQly(%)`, `Curr(A)`, `GPS` (space-separated lat lon), …

Only frames listed in `sensors.json` (as returned by `ethos.getSensors`) are injected — extra CSV columns are silently ignored. The progress notification shows the current row, percentage, and the frame names sent on each tick. Playback can be cancelled via the notification's cancel button, the **Ethos: Stop Telemetry** command, or by clicking the status bar item.

## sim-menu.json

Create `.vscode/sim-menu.json` to define a custom quick pick shown when clicking the status bar. The placeholder shows the currently active simulator.

Each item supports the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `label` | `string` | Display text (supports VS Code icon syntax, e.g. `$(debug-start)`) |
| `description` | `string` | Optional secondary text shown next to the label |
| `command` | `string \| string[]` | VS Code command ID(s) to execute sequentially |
| `task` | `string` | VS Code task label to run (single task only) |
| `separator` | `boolean` | If `true`, renders a separator line |

> **Note on sequencing:** multiple `command` values are awaited in sequence. A `task` value is fire-and-forget (VS Code does not expose task completion); use a compound task with `"dependsOrder": "sequence"` in `tasks.json` if ordering matters.

```json
[
    {
        "label": "▶️ Start SIM",
        "command": "ethos.start"
    },
    {
        "label": "🛑 Stop SIM",
        "command": "ethos.stop"
    },
    {
        "label": "🆑 Clear Logfile",
        "command": ["ethos.clearLogfile", "ethosSimManager.showSimMenu"]
    },
    { "label": "", "separator": true },
    {
        "label": "🎛️ Open Controls",
        "command": "ethos.openControls"
    },
    {
        "label": "📡 Open Telemetry",
        "command": "ethos.openTelemetry"
    },
    {
        "label": "🖥️ Open Display",
        "command": "ethos.openDisplay"
    },
    {
        "label": "📊 Telemetry playback",
        "command": "ethosSimManager.playTelemetry"
    },
    { "label": "", "separator": true },
    {
        "label": "⚙️ Change SIM",
        "command": ["ethosSimManager.setSimulator", "ethosSimManager.showSimMenu"]
    }
]
```

> [!NOTE]
> If your project is using [rob's vscode template](https://github.com/FrSkyRC/ETHOS-Feedback-Community/tree/1.6/lua/vscode-project), you should replace, in the above example, the first entry by:

```json
[
    {
        "label": "$(debug-start)Deploy & Launch SIM",
        "task": "Deploy & Launch [SIM]"
    },
    {
        "label": "▶️ Start SIM",
        "task": "ethos.Start"
    },
]
```
