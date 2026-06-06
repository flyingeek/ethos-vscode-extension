#!/usr/bin/env node
// Fetches the Electron version used by the current VS Code stable release and
// rebuilds node-hid against it. Run after `npm install` or whenever VS Code
// updates its Electron version (a few times a year).
//
// Usage: npm run rebuild-hid
//        node scripts/rebuild-hid.mjs

import https from 'https';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** Fetch a URL and return the body as a string. */
function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'rebuild-hid-script' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(fetch(res.headers.location));
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function getElectronVersion() {
    console.log('Fetching VS Code stable release info…');
    const updateInfo = JSON.parse(
        await fetch('https://update.code.visualstudio.com/api/update/darwin/stable/latest')
    );
    const commit = updateInfo.version;
    console.log(`VS Code stable commit: ${commit}`);

    const vscodePackage = JSON.parse(
        await fetch(`https://raw.githubusercontent.com/microsoft/vscode/${commit}/package.json`)
    );
    const raw = vscodePackage.devDependencies.electron;
    const version = raw.replace(/^\D+/, '');
    console.log(`Electron version: ${version}`);
    return version;
}

function resolveArch() {
    const arch = process.arch;
    if (arch === 'arm64') return 'arm64';
    if (arch === 'x64') return 'x64';
    throw new Error(`Unsupported arch: ${arch}. Run electron-rebuild manually.`);
}

async function main() {
    const electronVersion = await getElectronVersion();
    const arch = resolveArch();

    // Prefer the locally installed binary; fall back to npx.
    const rebuildBin = path.join(root, 'node_modules', '.bin', 'electron-rebuild');
    const useNpx = !existsSync(rebuildBin);
    const cmd = useNpx ? 'npx' : rebuildBin;
    const args = useNpx
        ? ['--yes', '@electron/rebuild', '--version', electronVersion, '--arch', arch, '--only', 'node-hid', '--force']
        : ['--version', electronVersion, '--arch', arch, '--only', 'node-hid', '--force'];

    console.log(`\nRebuilding node-hid for Electron ${electronVersion} (${arch})…`);
    const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    console.log('\nnode-hid rebuilt successfully.');
}

main().catch(err => {
    console.error('rebuild-hid failed:', err.message);
    process.exit(1);
});
