# Ethos VSCode Extension

This extension is a proposal for the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds those commands to VS Code:

- **Ethos: Play Telemetry CSV** — replay a CSV telemetry log (Ethos or EdgeTX format) into the running simulator and pin a telemetry status label in the Ethos extension
- **Ethos: Stop Telemetry** — stop the current telemetry playback and clear the pinned status label
- **Ethos: Set Telemetry Value** — pick a sensor frame by name and inject a single value into the running simulator

The extension is only activated in workspaces where the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension is active. It requires `bsongis.ethos` to be installed.

> **Note:** This extension was previously named "Ethos Simulator Manager" and used the `ethos` prefix for settings and commands. It has been renamed to "Ethos VSCode Extension" as all the simulator management commands have been integrated in the `bsongis.ethos` extension.

## Configuration

| Setting | Type | Description |
|---|---|---|
| `ethosExt.telemetryCustomSpeed` | `number` | Optional custom replay speed multiplier for telemetry playback. If set, it will appear as an option in the speed picker during playback. |

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
    }
]
```
