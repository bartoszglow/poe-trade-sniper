// Stamps a version across the two places the build reads it, so a release tag
// (`v0.1.0`) is the single source of truth — CI runs this before building so a
// stale committed version can never ship under the wrong tag.
//   node scripts/set-version.mjs 0.1.0   (or v0.1.0 — the leading v is stripped)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raw = process.argv[2];
if (!raw) {
  console.error('usage: node scripts/set-version.mjs <version>');
  process.exit(1);
}
const version = raw.replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`not a semver: ${version}`);
  process.exit(1);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// 1. The version the running app reports (in-app update check compares this).
const versionTs = join(repoRoot, 'apps/server/src/version.ts');
writeFileSync(
  versionTs,
  readFileSync(versionTs, 'utf8').replace(
    /export const APP_VERSION = '[^']*';/,
    `export const APP_VERSION = '${version}';`,
  ),
);

// 2. electron-builder reads this for installer naming and the release tag.
const desktopPkg = join(repoRoot, 'apps/desktop/package.json');
const pkg = JSON.parse(readFileSync(desktopPkg, 'utf8'));
pkg.version = version;
writeFileSync(desktopPkg, `${JSON.stringify(pkg, null, 2)}\n`);

console.warn(`version set to ${version}`);
