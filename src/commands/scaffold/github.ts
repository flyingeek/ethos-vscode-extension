import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ParsedRepo {
    url: string;
    branch?: string;
}

/**
 * Parse various GitHub repo formats into a clone URL + optional branch.
 *   owner/repo
 *   owner/repo#branch
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo#branch
 */
export function parseRepoUrl(input: string): ParsedRepo {
    let raw = input.trim();
    let branch: string | undefined;

    // Extract #branch suffix
    const hashIdx = raw.indexOf('#');
    if (hashIdx !== -1) {
        branch = raw.slice(hashIdx + 1);
        raw = raw.slice(0, hashIdx);
    }

    // Shorthand: owner/repo (no protocol, no dots except maybe in owner/repo)
    if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
        raw = `https://github.com/${raw}`;
    }

    // Ensure .git suffix
    if (!raw.endsWith('.git')) {
        raw += '.git';
    }

    return { url: raw, branch };
}

/** Clone a GitHub repository (shallow) into outputDir. */
export async function cloneTemplate(repoInput: string, outputDir: string): Promise<void> {
    const { url, branch } = parseRepoUrl(repoInput);
    const args = ['clone', '--depth', '1'];
    if (branch) {
        args.push('--branch', branch);
    }
    args.push(url, outputDir);

    await new Promise<void>((resolve, reject) => {
        execFile('git', args, { timeout: 60_000 }, (err, _stdout, stderr) => {
            if (err) {
                const msg = stderr?.trim() || err.message;
                reject(new Error(`git clone failed: ${msg}`));
            } else {
                resolve();
            }
        });
    });

    // Remove .git directory — we don't want VCS history in the scaffold output
    const gitDir = path.join(outputDir, '.git');
    await fs.rm(gitDir, { recursive: true, force: true });
}
