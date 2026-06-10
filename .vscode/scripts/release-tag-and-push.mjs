import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

function runCapture(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// --- Version check ---
try {
  run("npm", ["run", "check-versions"]);
} catch {
  console.error("package-lock version mismatch detected, running npm run refresh-lock...");
  run("npm", ["run", "refresh-lock"]);

  try {
    run("npm", ["run", "check-versions"]);
  } catch {
    console.error("Version mismatch persists after refresh-lock.");
    process.exit(1);
  }
  console.error("Commit the package-lock.json changes before running this script again.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const pkgVersion = pkg.version;

// --- Clean working tree check ---
const porcelain = runCapture("git", ["status", "--porcelain"]);
if (porcelain) {
  console.error("Git working tree is not clean. Please commit or stash changes before running this script.");
  run("git", ["status", "--short"]);
  process.exit(1);
}

// --- Build tag ---
const tagInput = process.argv[2] || "release/<version>";
let tag;
if (!tagInput.trim() || tagInput === "release/<version>") {
  tag = `release/${pkgVersion}`;
} else {
  tag = tagInput;
}

if (!tag.trim()) {
  console.error("Tag cannot be empty");
  process.exit(1);
}

// --- Check tag existence ---
try {
  runCapture("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  console.error(`Tag "${tag}" already exists locally`);
  console.error(`to delete: git tag -d "${tag}" && git push --delete origin "${tag}"`);
  process.exit(1);
} catch {
  // tag does not exist — good
}

// --- Create and push ---
console.log(`Creating tag "${tag}" for version "${pkgVersion}"...`);
run("git", ["tag", tag]);
run("git", ["push", "origin", tag]);
console.log(`Pushed tag "${tag}" to origin`);
