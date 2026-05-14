import * as fs from 'fs';
import * as readline from 'readline';

/**
 * Streaming CSV parser.
 *
 * The first value yielded is the deduplicated, trimmed headers array.
 * Subsequent values are data rows (string[]) aligned to those headers.
 *
 * Handles:
 * - Quoted fields (e.g. "ANGL")
 * - Trailing comma / empty last field (Ethos log format)
 * - Duplicate column names (EdgeTX has two "Hdg(°)" columns) — suffixed _2, _3, …
 */
export async function* parseCsv(filePath: string): AsyncGenerator<string[]> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] | null = null;
  let columnCount = 0;

  for await (const raw of rl) {
    const line = raw.trimEnd();
    if (line === '') { continue; }

    const fields = parseLine(line);

    if (headers === null) {
      headers = deduplicateHeaders(fields);
      // Remove trailing empty header produced by a trailing comma
      if (headers.length > 0 && headers[headers.length - 1].trim() === '') {
        headers = headers.slice(0, -1);
      }
      columnCount = headers.length;
      yield headers;
      continue;
    }

    // Trim trailing empty fields from data rows too
    let row = fields;
    while (row.length > 0 && row[row.length - 1].trim() === '') {
      row = row.slice(0, -1);
    }

    // Pad or truncate to match header count
    if (row.length < columnCount) {
      while (row.length < columnCount) { row.push(''); }
    } else if (row.length > columnCount) {
      row = row.slice(0, columnCount);
    }

    yield row;
  }
}

/**
 * Minimal CSV line parser — handles double-quoted fields (no escaped quotes support needed
 * for the target log formats).
 */
function parseLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      // Trailing comma produced an empty last field
      result.push('');
      break;
    }
    if (line[i] === '"') {
      // Quoted field
      const start = i + 1;
      const end = line.indexOf('"', start);
      if (end === -1) {
        result.push(line.slice(start));
        break;
      }
      result.push(line.slice(start, end));
      i = end + 1;
      if (line[i] === ',') { i++; }
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        result.push(line.slice(i));
        break;
      }
      result.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return result;
}

/** Appends _2, _3, … to repeated column names. */
function deduplicateHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map(h => {
    const trimmed = h.trim();
    const count = seen.get(trimmed) ?? 0;
    seen.set(trimmed, count + 1);
    return count === 0 ? trimmed : `${trimmed}_${count + 1}`;
  });
}
