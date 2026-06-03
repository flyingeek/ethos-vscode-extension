/**
 * Post-deploy step: copy .vscode/sensors.json to the simulator's scripts folder
 * (one level above DEST_PATH), but only if sensors.json does not already exist there.
 *
 * Usage in ethosExt.deploy.steps:
 *   "docs/deploy-sensors.mjs"
 *
 * Environment variables provided by the deploy command:
 *   DEST_PATH   — absolute path to the deployed app folder
 *   SOURCE_PATH — absolute path to the source app folder
 *   WORKSPACE_ROOT — absolute path to the workspace root (optional; defaults to process.cwd())
 *   DEPLOY_TARGET — the deploy target (e.g. "simulator", "radio", etc.) (optional; The script will only run if DEPLOY_TARGET="simulator")
*/

import { copyFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { constants } from 'fs';

const deployTarget = process.env.DEPLOY_TARGET;
if (deployTarget !== 'simulator') {
    console.log(`deploy-sensors: skipping (target="${deployTarget}")`);
    process.exit(0);
}

const destPath = process.env.DEST_PATH;
if (!destPath) {
    console.error('deploy-sensors: DEST_PATH is not set.');
    process.exit(1);
}

// .vscode/sensors.json lives at the workspace root
const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
const srcSensors = join(workspaceRoot, '.vscode', 'sensors.json');

// Target: two levels above the app folder — <simulatorsFolder>/<board>_<protocol>@<release>/sensors.json
const destSensors = join(dirname(dirname(destPath)), 'sensors.json');

try {
    await access(destSensors, constants.F_OK);
    console.log(`deploy-sensors: ${destSensors} already exists, skipping.`);
    process.exit(0);
} catch {
    // File does not exist — proceed with copy
}

try {
    await copyFile(srcSensors, destSensors);
    console.log(`deploy-sensors: copied ${srcSensors} -> ${destSensors}`);
} catch (e) {
    console.error(`deploy-sensors: failed to copy sensors.json: ${e.message}`);
    process.exit(1);
}
