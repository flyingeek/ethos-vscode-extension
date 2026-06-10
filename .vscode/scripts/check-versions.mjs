import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const pkgVersion = pkg.version;
const lockRootVersion = lock.version || "";
const lockPkgVersion = lock.packages?.[""]?.version || "";

if (pkgVersion !== lockRootVersion || pkgVersion !== lockPkgVersion) {
  console.error(
    `Version mismatch: package.json=${pkgVersion}, lock.version=${lockRootVersion}, lock.packages[""]=${lockPkgVersion}`
  );
  process.exit(1);
}
