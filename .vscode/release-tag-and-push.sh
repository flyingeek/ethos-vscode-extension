#!/usr/bin/env bash

set -euo pipefail

pkg_version=$(node -p "require(\"./package.json\").version")
lock_root_version=$(node -p "const lock=require(\"./package-lock.json\"); lock.version || \"\"")
lock_pkg_version=$(node -p "const lock=require(\"./package-lock.json\"); (lock.packages && lock.packages[\"\"] && lock.packages[\"\"].version) || \"\"")

if [[ "$pkg_version" != "$lock_root_version" || "$pkg_version" != "$lock_pkg_version" ]]; then
  echo "package-lock version mismatch detected, running npm run refresh-lock..."
  npm run refresh-lock
  lock_root_version=$(node -p "const lock=require(\"./package-lock.json\"); lock.version || \"\"")
  lock_pkg_version=$(node -p "const lock=require(\"./package-lock.json\"); (lock.packages && lock.packages[\"\"] && lock.packages[\"\"].version) || \"\"")
  echo "Commit the package-lock.json changes before running this script again."
  exit 1
fi

if [[ "$pkg_version" != "$lock_root_version" || "$pkg_version" != "$lock_pkg_version" ]]; then
  echo "Version mismatch persists after refresh-lock. package.json=$pkg_version, package-lock(root)=$lock_root_version, package-lock(packages[\"\"])=$lock_pkg_version"
  exit 1
fi

tag_input="${1:-release/<version>}"
if [[ -z "${tag_input// }" || "$tag_input" == "release/<version>" ]]; then
  tag="release/$pkg_version"
else
  tag="$tag_input"
fi

if [[ -z "${tag// }" ]]; then
  echo "Tag cannot be empty"
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag \"$tag\" already exists locally"
  echo "to delete: git tag -d \"$tag\" && git push --delete origin \"$tag\""
  exit 1
fi

echo "Creating tag \"$tag\" for version \"$pkg_version\"..."
git tag "$tag"
git push origin "$tag"
echo "Pushed tag \"$tag\" to origin"
