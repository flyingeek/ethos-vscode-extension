# Ethos Simulator Manager

This extension is a proposal for the [bsongis.ethos](https://marketplace.visualstudio.com/items?itemName=bsongis.ethos) extension.

It adds simulator management commands to VS Code:

- **Ethos: Add Simulator** — set up a simulator firmware in the `simulator/` directory
- **Ethos: Set Simulator** — switch the active simulator firmware via a quick pick
- **Ethos: Show Menu** — show the custom quick pick menu defined in `.vscode/sim-menu.json`

The extension is only activated in workspaces containing a `simulator/` directory.

Note: the simulator name comes from Rob's vscode-template; `simulators/` or a user-defined name may be more appropriate.

## Status Bar

The status bar item displays the active simulator firmware. Clicking it opens the **Ethos: Show Menu** quick pick (see below). If `.vscode/sim-menu.json` is absent, empty, or invalid, the click falls back to **Ethos: Set Simulator** directly.

## sim-menu.json

Create `.vscode/sim-menu.json` to define a custom quick pick shown when clicking the status bar. The placeholder shows the currently active simulator.

Each item supports the following fields:

| Field | Type | Description |
|---|---|---|
| `label` | `string` | Display text (supports VS Code icon syntax, e.g. `$(debug-start)`) |
| `description` | `string` | Optional secondary text shown next to the label |
| `command` | `string \| string[]` | VS Code command ID(s) to execute sequentially |
| `task` | `string` | VS Code task label to run (single task only) |
| `separator` | `boolean` | If `true`, renders a separator line |

> **Note on sequencing:** multiple `command` values are awaited in sequence. A `task` value is fire-and-forget (VS Code does not expose task completion); use a compound task with `"dependsOrder": "sequence"` in `tasks.json` if ordering matters.

```json
[
    {
        "label": "$(debug-start)Deploy & Launch SIM",
        "task": "Deploy [SIM Files] + Launch SIM"
    },
    {
        "label": "▶️ Start SIM",
        "task": "ethos.Start"
    },
    {
        "label": "🛑 Stop SIM",
        "task": "ethos.Stop"
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
    { "label": "", "separator": true },
    {
        "label": "⚙️ Change Simulator Firmware",
        "command": ["ethos.setSimulator", "ethos.showSimMenu"]
    }
]
```
