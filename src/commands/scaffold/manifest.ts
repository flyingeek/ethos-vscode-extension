import * as fs from 'fs/promises';
import * as path from 'path';
import type { ScaffoldManifest } from './types';

/**
 * Read and validate .scaffold.json from a template directory.
 * Returns undefined if the file does not exist (plain-copy fallback).
 */
export async function readManifest(templateDir: string): Promise<ScaffoldManifest | undefined> {
    const manifestPath = path.join(templateDir, '.scaffold.json');
    let raw: string;
    try {
        raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
        return undefined; // no manifest — plain copy
    }

    const manifest: ScaffoldManifest = JSON.parse(raw);

    if (manifest.version !== 1) {
        throw new Error(`.scaffold.json: unsupported version ${manifest.version} (expected 1)`);
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
        throw new Error('.scaffold.json: missing or invalid "name" field');
    }

    // Validate prompt IDs are unique
    if (manifest.prompts) {
        const ids = new Set<string>();
        for (const p of manifest.prompts) {
            if (!p.id || !p.type || !p.message) {
                throw new Error(`.scaffold.json: prompt missing required fields (id, type, message)`);
            }
            if (ids.has(p.id)) {
                throw new Error(`.scaffold.json: duplicate prompt id "${p.id}"`);
            }
            ids.add(p.id);
        }
    }

    return manifest;
}
