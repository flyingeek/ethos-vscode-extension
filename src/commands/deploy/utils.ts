import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export function resolvePath(p: string, workspaceRoot: string): string {
    const expanded = p.startsWith('~') ? os.homedir() + p.slice(1) : p;
    return path.isAbsolute(expanded) ? expanded : path.join(workspaceRoot, expanded);
}

/** Resolve glob pattern against a base directory (supports dir/* and dir/** globs).
 *  Returns workspace-relative paths (relative to base). */
export async function expandGlob(pattern: string, base: string): Promise<string[]> {
    // Normalise separators
    const normalised = pattern.replace(/\\/g, '/');

    if (!normalised.includes('*')) {
        // Literal path — just check it exists
        try {
            await fs.stat(path.join(base, normalised));
            return [normalised];
        } catch {
            return [];
        }
    }

    const recursive = normalised.includes('**');
    // Find the non-glob prefix dir
    const parts = normalised.split('/');
    const prefixParts: string[] = [];
    for (const part of parts) {
        if (part.includes('*')) { break; }
        prefixParts.push(part);
    }
    const searchDir = path.join(base, ...prefixParts);

    let entries: string[];
    try {
        entries = await fs.readdir(searchDir, { recursive, encoding: 'utf8' });
    } catch {
        return [];
    }

    const prefix = prefixParts.length ? prefixParts.join('/') + '/' : '';
    return entries
        .map(e => prefix + (e as string).replace(/\\/g, '/'))
        .filter(e => {
            // For non-recursive `dir/*`, exclude nested directories by checking no extra slash
            if (!recursive) {
                const rel = e.slice(prefix.length);
                return !rel.includes('/');
            }
            return true;
        });
}
