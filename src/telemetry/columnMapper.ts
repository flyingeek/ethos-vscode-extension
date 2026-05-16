/**
 * Maps CSV column names to Ethos telemetry frame names.
 *
 * Ethos frame names (from ethos.getSensors / sensors.json):
 *   RSSI, RxBatt, ADC2, SWR, VFR, Rx VFR, Air speed,
 *   Altitude, VSpeed, Voltage, Current, RPM, Consumption, Temperature,
 *   Cell 0…N, Latitude, Longitude, Speed, Course, Sats
 */

export interface FrameEntry {
  name: string;
  parse: (value: string) => number | null;
}

export interface ColumnEntry {
  colIndex: number;
  frames: FrameEntry[];
}

// ---------------------------------------------------------------------------
// Unit stripping
// ---------------------------------------------------------------------------

/**
 * Strips a trailing `(unit)` suffix from a column name.
 * e.g. "Altitude(m)" → "Altitude", "RxBatt(V)" → "RxBatt"
 */
export function stripUnit(name: string): string {
  return name.replace(/\([^)]*\)$/, '').trim();
}

// ---------------------------------------------------------------------------
// EdgeTX → Ethos alias table  (applied after unit-stripping)
// ---------------------------------------------------------------------------

const EDGETX_ALIAS: Record<string, string> = {
  'Alt':   'Altitude',
  'RxBt':  'RxBatt',
  'VSpd':  'VSpeed',
  'GSpd':  'Speed',
  'Hdg':   'Course',
  '1RSS':  'RSSI',
  'RQly':  'VFR',
  'Curr':  'Current',
  // 2RSS is intentionally omitted → will be skipped
};

// ---------------------------------------------------------------------------
// Ethos log → frame alias table  (applied after unit-stripping)
// ---------------------------------------------------------------------------

const ETHOS_ALIAS: Record<string, string> = {
  'RSSI 2.4G':     'RSSI',
  'RSSI 900M':     'RSSI',    // secondary — dedup logic keeps only the first
  'VFR 2.4G':      'VFR',
  'VFR 900M':      'VFR',     // secondary
  'ESC voltage':   'Voltage',
  'ESC current':   'Current',
  'ESC RPM':       'RPM',
  'ESC Consumption': 'Consumption',
  'ESC consumption': 'Consumption', // lowercase variant in Ethos logs
  'ESC temp':      'Temperature',
  'GPS alt':       'Altitude',
  'GPS speed':     'Speed',
  'GPS course':    'Course',
  'GPS Satellites': 'Sats',
  'VFAS':          'Voltage',
  'LiPo1':         'Cell 0',
  'LiPo2':         'Cell 1',
  'LiPo3':         'Cell 2',
  'LiPo4':         'Cell 3',
  'LiPo5':         'Cell 4',
  'LiPo6':         'Cell 5',
  'LiPo7':         'Cell 6',
  'LiPo8':         'Cell 7',
  // RAW ESC consump is a raw wire value, not a human-readable frame
};

/** Column names to skip entirely (no frame mapping). */
const SKIP_COLUMNS = new Set(['2RSS', 'RAW ESC consump']);

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** EdgeTX-specific column names (after unit-strip). */
const EDGETX_MARKERS = new Set(['1RSS', '2RSS', 'RQly', 'RSNR', 'RxBt', 'TQly']);

export type CsvFormat = 'ethos' | 'edgetx';

export function detectFormat(headers: string[]): CsvFormat {
  for (const h of headers) {
    if (EDGETX_MARKERS.has(stripUnit(h))) {
      return 'edgetx';
    }
  }
  return 'ethos';
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a raw CSV column name to an Ethos frame name (or null if it
 * cannot be mapped or should be skipped).
 *
 * Steps:
 * 1. Strip unit suffix
 * 2. Skip known-skip columns
 * 3. Apply EdgeTX alias if format is edgetx
 * 4. Return the result if it is in availableFrames, else null
 */
function normalise(
  raw: string,
  format: CsvFormat,
  availableFrames: Set<string>,
): string | null {
  const stripped = stripUnit(raw);
  if (SKIP_COLUMNS.has(stripped)) { return null; }
  const aliasTable = format === 'edgetx' ? EDGETX_ALIAS : ETHOS_ALIAS;
  const aliased = aliasTable[stripped] ?? stripped;
  return availableFrames.has(aliased) ? aliased : null;
}

// ---------------------------------------------------------------------------
// Numeric parsing helpers
// ---------------------------------------------------------------------------

function parseFloat_(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function parseFirstToken(v: string): number | null {
  return parseFloat_(v.split(' ')[0] ?? '');
}

function parseSecondToken(v: string): number | null {
  return parseFloat_(v.split(' ')[1] ?? '');
}

// ---------------------------------------------------------------------------
// Column plan builder
// ---------------------------------------------------------------------------

/**
 * Builds the list of column→frame mappings to use when replaying rows.
 *
 * @param headers       Raw header row from the CSV (already deduplicated).
 * @param availableFrames  Frame names returned by ethos.getSensors.
 * @returns ColumnEntry[] — only columns that map to at least one available frame.
 */
export function buildColumnPlan(
  headers: string[],
  availableFrames: string[],
): ColumnEntry[] {
  const frameSet = new Set(availableFrames);
  const format = detectFormat(headers);
  const plan: ColumnEntry[] = [];

  // Track which alias-target frame names we have already mapped (e.g. first 1RSS wins).
  const mappedFrames = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    const stripped = stripUnit(raw);

    // ── GPS column: split into Latitude + Longitude ──────────────────────
    if (stripped === 'GPS') {
      const frames: FrameEntry[] = [];
      if (frameSet.has('Latitude') && !mappedFrames.has('Latitude')) {
        frames.push({ name: 'Latitude', parse: parseFirstToken });
        mappedFrames.add('Latitude');
      }
      if (frameSet.has('Longitude') && !mappedFrames.has('Longitude')) {
        frames.push({ name: 'Longitude', parse: parseSecondToken });
        mappedFrames.add('Longitude');
      }
      if (frames.length > 0) {
        plan.push({ colIndex: i, frames });
      }
      continue;
    }

    const frameName = normalise(raw, format, frameSet);
    if (frameName === null) { continue; }
    if (mappedFrames.has(frameName)) { continue; } // dedup (e.g. two 1RSS cols)

    mappedFrames.add(frameName);
    plan.push({ colIndex: i, frames: [{ name: frameName, parse: parseFloat_ }] });
  }

  return plan;
}
