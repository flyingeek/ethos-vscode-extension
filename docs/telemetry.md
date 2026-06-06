# Telemetry in Ethos Simulator

## sensors.json

To have telemetry (Ethos version >= 26) in the simulator, you need to have a `sensors.json` in `ethos.root`. You can create this file manually, or you can use the Telemetry Webview to create it.

Only the sensors defined in sensors.json can be discovered in the simulator. The discovery works as on a real radio, you turn on receiver and then go to the Telemetry screen.

## All Sensor frames

Version 0.4 of the `bsongis.extension` injects in the simulator those frame names:

```json
[
  "RSSI",
  "RxBatt",
  "ADC2",
  "SWR",
  "VFR",
  "Rx VFR",
  "Air speed",
  "Altitude",
  "VSpeed",
  "Voltage",
  "Current",
  "RPM",
  "Consumption",
  "Temperature",
  "Current",
  "Voltage",
  "Cell 0",
  "Cell 1",
  "Latitude",
  "Longitude",
  "Altitude",
  "Speed",
  "Course",
  "Sats",
  "Current",
  "Voltage",
  "Temperature",
  ""
]
```

Here are the same frames organized by sensor:

```json
{
  "RSSI":    ["RSSI"],
  "RxBatt":  ["RxBatt"],
  "ADC2":    ["ADC2"],
  "SWR":     ["SWR"],
  "VFR":     ["VFR"],
  "Rx VFR":  ["Rx VFR"],
  "ASS-70":  ["Air speed"],
  "VariADV": ["Altitude", "VSpeed"],
  "ESC":     ["Voltage", "Current", "RPM", "Consumption", "Temperature"],
  "FAS":     ["Current", "Voltage"],
  "FLVS":    ["Cell 0", "Cell 1"],
  "GPS":     ["Latitude", "Longitude", "Altitude", "Speed", "Course", "Sats"],
  "XAct":    ["Current", "Voltage", "Temperature"],
  "Custom":  [""]
}
```

You might notice there are some duplicates, for example, Altitude is present in GPS and VariADV. If both these sensors are in your sensors.json file, then when you pass a frame such as:

```json
[
  { "name": "Altitude", "value": 150 }
]
```

both GPS Altitude and VariADV Altitude will be set. This is intentional, as this tool is for debug purpose. If this is a problem for you, use several sensors.json.

## CSV injection of telemetry data in ethos-vscode-extension

When the extension begins to play a csv file, first it requests the list of available frame names (those defined in sensors.json), then it parses the log file. Frame names are defined on the first row of the CSV, the extension then reads lines either in real time or with a speed multiplier. The extension sends to the `bsongis.extension` only the frame names defined both in the csv file and in the sensors.json. This reduces the bandwidth needed.

Example of a CSV file:

```csv
Date,Time,Altitude(m),RxBatt(V),Latitude,Longitude
2025-02-09,16:15:40.610,9,16.6,51.442148,11.576354
2025-02-09,16:15:41.030,9,16.6,51.442142,11.576357
2025-02-09,16:15:41.530,9,16.6,51.442142,11.576357
2025-02-09,16:15:42.030,9,16.6,51.442142,11.576357
2025-02-09,16:15:42.530,9,16.6,51.442142,11.576356
2025-02-09,16:15:43.030,9,16.6,51.442142,11.576356
```

As a convenience, we support Ethos log format, so this is a valid CSV too:

```csv
Date,Time,Altitude(m),RxBatt(V),GPS
2025-02-09,16:15:40.610,9,16.6,51.442148 11.576354
2025-02-09,16:15:41.030,9,16.6,51.442142 11.576357
2025-02-09,16:15:41.530,9,16.6,51.442142 11.576357
2025-02-09,16:15:42.030,9,16.6,51.442142 11.576357
2025-02-09,16:15:42.530,9,16.6,51.442142 11.576356
2025-02-09,16:15:43.030,9,16.6,51.442142 11.576356

```

CSV units are ignored, so you can have "Altitude(m)" or "Altitude(ft)", it will be the same. The only important thing is that the frame name (without unit) is defined in sensors.json.

This extension will try to convert known names, for example "GPS Altitude(m)" will be converted to "Altitude", but this is not guaranteed to work in all cases, so it's better to have a clean CSV file with frame names matching those in sensors.json.

## Custom sensor frames

You can set a name in the sensors.json for your custom sensors. Even if the name is not displayed in the Telemetry webview, you can use it in your CSV file and it will be accepted by the simulator.

If name is not set, you can not use it CSV playback, but you can still use the ethosExt.setTelemetry command or the ethos.injectTelemetry command.

```js
ethos.injectTelemetry([{"name": "My custom frame", "value": 42}, {"appId": 0x400, value: 42}]);
```

Note that when you create your DIY sensor in the radio, it must use a physId of 0x98 in the simulator.
