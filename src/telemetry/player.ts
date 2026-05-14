import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseCsv } from './csvParser';
import { buildColumnPlan, ColumnEntry } from './columnMapper';

const MAX_ROW_DELAY_MS = 5000;
const FALLBACK_DELAY_MS = 100;

/**
 * Counts data rows in a CSV file by scanning raw bytes for newline characters.
 * Subtracts 1 for the header row. Fast: no CSV parsing.
 */
export async function countDataRows(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0;
    fs.createReadStream(filePath)
      .on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === 0x0a) { count++; } // \n
        }
      })
      .on('end', () => resolve(Math.max(0, count - 1))) // subtract header row
      .on('error', reject);
  });
}

export interface PlayOptions {
  filePath: string;
  speed: number;
  loop: boolean;
  totalRows?: number;
  token: vscode.CancellationToken;
  onProgress?: (rowIndex: number, loopIteration: number, frameNames: string[], totalRows: number | undefined) => void;
}

/**
 * Parses a "Date,Time" pair from a CSV row into epoch milliseconds.
 * Date column: "YYYY-MM-DD", Time column: "HH:MM:SS.mmm"
 * Returns null if parsing fails.
 */
function parseRowTimestampMs(
  row: string[],
  dateColIndex: number,
  timeColIndex: number,
): number | null {
  const dateStr = row[dateColIndex]?.trim();
  const timeStr = row[timeColIndex]?.trim();
  if (!dateStr || !timeStr) { return null; }
  const d = new Date(`${dateStr}T${timeStr}`);
  const ms = d.getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Finds the column indices for Date and Time columns.
 * Returns [-1, -1] if not found.
 */
function findTimestampCols(headers: string[]): [number, number] {
  let dateIdx = -1;
  let timeIdx = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (h === 'date') { dateIdx = i; }
    if (h === 'time') { timeIdx = i; }
  }
  return [dateIdx, timeIdx];
}

/** Resolves to void after `ms` milliseconds, or immediately if cancelled. */
function delay(ms: number, token: vscode.CancellationToken): Promise<void> {
  if (ms <= 0 || token.isCancellationRequested) { return Promise.resolve(); }
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    const disposable = token.onCancellationRequested(() => {
      clearTimeout(timer);
      disposable.dispose();
      resolve();
    });
  });
}

/**
 * Plays back a single pass through the CSV file, injecting telemetry.
 * Returns the column plan (built on first call, passed in on subsequent loops).
 */
async function playPass(
  filePath: string,
  speed: number,
  token: vscode.CancellationToken,
  plan: ColumnEntry[] | null,
  loopIteration: number,
  totalRows: number | undefined,
  onProgress?: (rowIndex: number, loopIteration: number, frameNames: string[], totalRows: number | undefined) => void,
): Promise<{ plan: ColumnEntry[]; dateIdx: number; timeIdx: number }> {
  const gen = parseCsv(filePath);

  // First yield is always the headers
  const headersResult = await gen.next();
  if (headersResult.done || !headersResult.value) {
    throw new Error('CSV file is empty or has no header row.');
  }
  const headers: string[] = headersResult.value;

  // Resolve column plan (built once, reused across loops)
  let columnPlan = plan;
  let dateIdx: number;
  let timeIdx: number;

  if (columnPlan === null) {
    // First pass: query available frames and build the plan
    let availableFrames: string[];
    try {
      const result = await vscode.commands.executeCommand<string[]>('ethos.getSensors');
      availableFrames = Array.isArray(result) ? result : [];
    } catch {
      throw new Error('Could not reach the Ethos simulator. Make sure it is running (ethos.start).');
    }
    if (availableFrames.length === 0) {
      throw new Error('No telemetry frames available. Check sensors.json in your simulator root.');
    }
    columnPlan = buildColumnPlan(headers, availableFrames);
    if (columnPlan.length === 0) {
      throw new Error('No CSV columns matched any available telemetry frame. Check your sensors.json and CSV header.');
    }
    [dateIdx, timeIdx] = findTimestampCols(headers);
  } else {
    [dateIdx, timeIdx] = findTimestampCols(headers);
  }

  let prevMs: number | null = null;
  let rowIndex = 0;

  for await (const row of gen) {
    if (token.isCancellationRequested) { break; }

    // Calculate delay before injecting this row
    let waitMs = FALLBACK_DELAY_MS;
    if (dateIdx !== -1 && timeIdx !== -1) {
      const currentMs = parseRowTimestampMs(row, dateIdx, timeIdx);
      if (currentMs !== null) {
        if (prevMs !== null) {
          const delta = currentMs - prevMs;
          waitMs = Math.min(Math.max(0, delta / speed), MAX_ROW_DELAY_MS);
        } else {
          waitMs = 0; // First row: inject immediately
        }
        prevMs = currentMs;
      }
    }

    await delay(waitMs, token);
    if (token.isCancellationRequested) { break; }

    // Build injection payload
    const payload: Array<{ name: string; value: number }> = [];
    for (const entry of columnPlan) {
      const raw = row[entry.colIndex] ?? '';
      for (const frame of entry.frames) {
        const value = frame.parse(raw);
        if (value !== null) {
          payload.push({ name: frame.name, value });
        }
      }
    }

    if (payload.length > 0) {
      await vscode.commands.executeCommand('ethos.injectTelemetry', payload);
    }

    rowIndex++;
    onProgress?.(rowIndex, loopIteration, payload.map(p => p.name), totalRows);
  }

  return { plan: columnPlan, dateIdx, timeIdx };
}

/**
 * Main entry point: play back a CSV telemetry file into the Ethos simulator.
 */
export async function playTelemetry(options: PlayOptions): Promise<void> {
  const { filePath, speed, loop, totalRows, token, onProgress } = options;

  let plan: ColumnEntry[] | null = null;
  let iteration = 1;

  do {
    const result = await playPass(filePath, speed, token, plan, iteration, totalRows, onProgress);
    plan = result.plan;
    iteration++;
  } while (loop && !token.isCancellationRequested);
}
