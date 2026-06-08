# ethosExt.radio Settings

Configuration for the radio USB/HID connection, deploy target detection, and serial console. All properties are nested under `ethosExt.radio` in your `settings.json`.

```json
"ethosExt.radio": {
    "vendorId": "0483",
    "productId": "5750",
    "retries": 10,
    "retryDelay": 1.0,
    "nameHint": "FrSky",
    "serialBaud": 115200,
    "storageTargetPriority": ["sdcard", "radio"]
}
```

## Properties

### `vendorId`
- **Type:** `string`
- **Default:** `"0483"`

USB vendor ID of the radio HID device, in hexadecimal without the `0x` prefix. The default matches FrSky/TBS radios running Ethos.

### `productId`
- **Type:** `string`
- **Default:** `"5750"`

USB product ID of the radio HID device, in hexadecimal without the `0x` prefix.

### `retries`
- **Type:** `number` (minimum: 1)
- **Default:** `10`

Number of HID open attempts before giving up. Increase this if your OS is slow to enumerate the HID device after a mode switch.

### `retryDelay`
- **Type:** `number` (minimum: 0.1)
- **Default:** `1.0`

Delay in seconds between HID open retries.

### `nameHint`
- **Type:** `string`
- **Default:** `"FrSky"`

Manufacturer name hint used for fuzzy serial port matching when VID/PID lookup is unavailable. The extension searches for a serial port whose manufacturer string contains this value (case-insensitive).

### `serialBaud`
- **Type:** `number` (minimum: 1200)
- **Default:** `115200`

Baud rate for the **Ethos: Radio Serial Console** command.

### `storageTargetPriority`
- **Type:** `string[]` — each item one of `"flash"`, `"sdcard"`, `"radio"`
- **Default:** `["sdcard", "radio"]`

Ethos storage types to probe as deploy targets, in priority order. A volume qualifies only if it has both a matching `*.cpuid` marker file and a `scripts/` subdirectory at its root.

The first type in the list whose volume is found becomes the deploy destination. Types not listed are ignored during deploy target detection (though all Ethos volumes are still found and unmounted during the deploy process).

**Example — prioritize radio over sdcard:**
```json
"ethosExt.radio": {
    "storageTargetPriority": ["radio", "sdcard"]
}
```
