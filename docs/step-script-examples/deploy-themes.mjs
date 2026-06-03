/**
 * Post-deploy step: mirror theme-* directories from a sibling EFC-themes repo
 * into the simulator's scripts directory (one level above DEST_PATH).
 *
 * Usage in ethosExt.deploy.steps:
 *   "docs/deploy-themes.mjs"
 *
 * Environment variables provided by the deploy command:
 *   DEST_PATH        — absolute path to the deployed app folder
 *   WORKSPACE_ROOT   — absolute path to the workspace root (optional; defaults to process.cwd())
 *   ETHOS_VERSION    — firmware version string (optional); step is skipped when major < 26
 *
 * Arguments:
 *   argv[2]  — required: absolute or relative path to the source themes directory
 */

import { cp, mkdir, readdir, stat } from 'fs/promises';
import { join, dirname, resolve } from 'path';

const DEFAULT_VERSION = 'nightly26';

function shouldRun(version) {
    if (!version || version === DEFAULT_VERSION) return true;
    const major = parseInt(version.split('.')[0], 10);
    return !isNaN(major) && major >= 26;
}

function debug(msg) {
    console.log(`[THEMES DEBUG] ${msg}`);
}

const version = process.env.ETHOS_VERSION;
if (!shouldRun(version)) {
    console.log(`[THEMES] Skipping — ETHOS_VERSION='${version}' is < 26`);
    process.exit(0);
}

const destPath = process.env.DEST_PATH;
if (!destPath) {
    console.error('[THEMES] DEST_PATH is not set.');
    process.exit(1);
}

const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();

if (!process.argv[2]) {
    console.error('[THEMES] Usage: node deploy-themes.mjs <srcThemesDir>');
    process.exit(1);
}
const srcThemesDir = resolve(process.argv[2]);
// Destination: one level above DEST_PATH (the scripts/ directory)
const dstThemesDir = dirname(destPath);

debug(`Workspace root = ${workspaceRoot}`);
debug(`Source themes directory = ${srcThemesDir}`);
debug(`Destination themes directory = ${dstThemesDir}`);

// Verify source directory exists
try {
    const s = await stat(srcThemesDir);
    if (!s.isDirectory()) throw new Error('not a directory');
} catch {
    console.log(`[THEMES] Source themes directory not found: ${srcThemesDir}`);
    process.exit(0);
}

// Create destination directory if needed
try {
    await mkdir(dstThemesDir, { recursive: true });
} catch (e) {
    console.error(`[THEMES] Failed to create destination directory ${dstThemesDir}: ${e.message}`);
    process.exit(1);
}

// Discover all theme-*/ directories in source
let themeDirs = [];
try {
    const entries = await readdir(srcThemesDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('theme-')) {
            themeDirs.push(entry.name);
        }
    }
} catch (e) {
    console.error(`[THEMES] Error scanning source directory: ${e.message}`);
    process.exit(1);
}

if (themeDirs.length === 0) {
    console.log(`[THEMES] No theme-*/ directories found in ${srcThemesDir}`);
    process.exit(0);
}

// Sort for consistent output
themeDirs.sort();

// Copy each theme
let copiedCount = 0;
const failedThemes = [];

for (const themeName of themeDirs) {
    const src = join(srcThemesDir, themeName);
    const dst = join(dstThemesDir, themeName);
    debug(`Copying ${themeName}...`);
    try {
        await cp(src, dst, { recursive: true });
        copiedCount++;
        console.log(`[THEMES] ✓ ${themeName}`);
    } catch (e) {
        console.log(`[THEMES] ✗ ${themeName}: ${e.message}`);
        failedThemes.push(themeName);
    }
}

// Report results
const total = themeDirs.length;
console.log(`[THEMES] Deployed ${copiedCount}/${total} themes to ${dstThemesDir}`);

if (failedThemes.length > 0) {
    console.log(`[THEMES] Failed themes: ${failedThemes.join(', ')}`);
    if (copiedCount === 0) process.exit(1);
}
