import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The server MUST stay cross-platform: native addons (Electron, nut.js,
 * uiohook-napi, OpenCV) live ONLY in apps/desktop, behind the platform ports.
 * Tree-shaking is explicitly NOT trusted to keep them out of the server bundle —
 * so assert the boundary here (plan §5 CI guard). A new native import anywhere
 * under apps/server/src fails this test.
 */
const FORBIDDEN_MODULES = [
  'electron',
  '@nut-tree-fork/nut-js',
  '@nut-tree/nut-js',
  'uiohook-napi',
  'opencv-wasm',
  '@techstark/opencv-js',
];

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    // Skip *.test.ts — tests may legitimately reference these names (this file does).
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('apps/server native-import boundary', () => {
  it('imports no native addon — the ports keep the server cross-platform', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      for (const moduleName of FORBIDDEN_MODULES) {
        // Match an import/require specifier: 'mod' or "mod/subpath".
        const specifier = new RegExp(`['"]${escapeRegExp(moduleName)}(['"]|/)`);
        if (specifier.test(text)) offenders.push(`${file.replace(SRC_DIR, '')} → ${moduleName}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
