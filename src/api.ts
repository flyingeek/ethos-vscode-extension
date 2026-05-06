import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'https://ethos.studio1247.com/api/releases';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface StructuredData {
  [protocol: string]: {
    [version: string]: string[];
  };
}

interface Firmware {
  board: string;
  protocol: string;
}

interface Release {
  tag?: string;
  name?: string;
  firmwares?: Firmware[];
}

interface ApiResponse {
  releases: Release[];
}

export async function fetchStructuredData(context: vscode.ExtensionContext): Promise<StructuredData> {
  const cacheDir = context.globalStorageUri.fsPath;
  const cacheFile = path.join(cacheDir, 'ethos_cache.json');

  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < CACHE_TTL_MS) {
      const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as ApiResponse;
      return buildStructuredData(raw);
    }
  }

  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as ApiResponse;

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf-8');

  return buildStructuredData(data);
}

function buildStructuredData(data: ApiResponse): StructuredData {
  const raw: Record<string, Record<string, Set<string>>> = {};

  for (const release of data.releases ?? []) {
    const version = release.tag ?? release.name;
    for (const fw of release.firmwares ?? []) {
      const { board: radio, protocol } = fw;
      if (version && radio && protocol) {
        (raw[protocol] ??= {})[version] ??= new Set();
        raw[protocol][version].add(radio);
      }
    }
  }

  const result: StructuredData = {};
  for (const protocol of Object.keys(raw).sort()) {
    result[protocol] = {};
    for (const version of Object.keys(raw[protocol]).sort()) {
      result[protocol][version] = [...raw[protocol][version]].sort();
    }
  }

  return result;
}
