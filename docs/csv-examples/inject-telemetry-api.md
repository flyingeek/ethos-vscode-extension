# Ethos Simulator — `getSensors` & `injectTelemetry` API

These two VS Code commands allow an external extension to **read available telemetry frame names** and **push live values** into the Ethos simulator.

## Prerequisites

- The `bsongis.ethos` extension must be installed and **running** (i.e. `ethos.start` must have been invoked).
- The Ethos simulator must have sensors configured with active frames.

---

## `ethos.getSensors`

Returns the flat list of all active frame names across all configured sensors.

### Signature

```typescript
vscode.commands.executeCommand('ethos.getSensors'): Promise<string[]>
```

### Returns

A `string[]` of frame names, e.g.:

```json
["RSSI", "RxBatt", "Altitude", "VSpeed", "Latitude", "Longitude", "Speed", "..."]
```

> **Note:** The same frame name (e.g. `"Altitude"`) may appear multiple times if multiple sensors define it.

### Example

```typescript
const frames = await vscode.commands.executeCommand<string[]>('ethos.getSensors');
if (frames?.includes('Altitude')) {
  // safe to inject Altitude
}
```

---

## `ethos.injectTelemetry`

Updates the `value` of one or more frames by name. All sensors whose frame matches the given name will be updated.

### Signature

```typescript
vscode.commands.executeCommand(
  'ethos.injectTelemetry',
  arr: Array<{ name: string; value: number }>
): Promise<void>
```

### Parameters

| Field   | Type     | Description                                       |
|---------|----------|---------------------------------------------------|
| `name`  | `string` | Frame name (must match exactly, case-sensitive)   |
| `value` | `number` | New value in **human units** (e.g. meters, volts) |

> The extension stores the value as-is in `frame.value`. The multiplier/offset are applied later at injection time via `getValueToInject()`. **Always pass human-readable units.**

### Example

```typescript
await vscode.commands.executeCommand('ethos.injectTelemetry', [
  { name: 'Altitude', value: 150 },     // 150 m
  { name: 'VSpeed',   value: 2.5 },     // 2.5 m/s
  { name: 'Latitude', value: 48.8584 }, // degrees
]);
```

---

## Available Frame Names

| Sensor  | Frame names                                                        |
|---------|--------------------------------------------------------------------|
| RSSI    | `RSSI`                                                             |
| RxBatt  | `RxBatt`                                                           |
| ADC2    | `ADC2`                                                             |
| SWR     | `SWR`                                                              |
| VFR     | `VFR`                                                              |
| Rx VFR  | `Rx VFR`                                                           |
| ASS-70  | `Air speed`                                                        |
| VariADV | `Altitude`, `VSpeed`                                               |
| ESC     | `Voltage`, `Current`, `RPM`, `Consumption`, `Temperature`          |
| FAS     | `Current`, `Voltage`                                               |
| FLVS    | `Cell 0`, `Cell 1`, … `Cell N-1`                                   |
| GPS     | `Latitude`, `Longitude`, `Altitude`, `Speed`, `Course`, `Sats`     |
| XAct    | `Current`, `Voltage`, `Temperature`                                |
| Custom  | *(empty string)*                                                   |

---

## Important Behaviors

- **No sensor filtering:** `injectTelemetry` matches only on `frame.name`. If two sensors share the same frame name (e.g. `Altitude` in both VariADV and GPS), **both are updated**.
- **Silently ignored:** If the simulator is not running or `arr` is not an array, the call is a no-op.
- **Units:** Always pass values in human units. The multiplier (e.g. ×100 for GPS Altitude) is applied internally when the frame is serialized to the hardware protocol.
