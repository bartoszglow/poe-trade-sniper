// Swaps the better-sqlite3 native binary between Node and Electron ABIs.
// One copy lives on disk — the embedded-server (preview) run needs the
// Electron build, unit tests / `pnpm dev` need the Node build.
//   node scripts/sqlite-abi.mjs electron | node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const runtime = process.argv[2];
if (runtime !== 'electron' && runtime !== 'node') {
  console.error('usage: node scripts/sqlite-abi.mjs <electron|node>');
  process.exit(1);
}

const serverRequire = createRequire(join(import.meta.dirname, '../../server/package.json'));
const sqliteDir = dirname(serverRequire.resolve('better-sqlite3/package.json'));

const args = ['prebuild-install'];
if (runtime === 'electron') {
  const desktopRequire = createRequire(join(import.meta.dirname, '../package.json'));
  const electronVersion = desktopRequire('electron/package.json').version;
  args.push('--runtime', 'electron', '--target', electronVersion, '--arch', process.arch);
}
execFileSync('npx', args, { cwd: sqliteDir, stdio: 'inherit' });
console.warn(`better-sqlite3 rebuilt for ${runtime}`);
