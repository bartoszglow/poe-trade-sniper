/**
 * Tier-2 data generator (#38 B) — ON-MACHINE build step.
 *
 * Decodes per-stat tier/roll ranges from the game bundles and writes
 * `apps/server/data/tier-data.json` (consumed by TierDataService). This CANNOT run
 * in the repo's CI/agent sandbox — it fetches GGG's public patch CDN and decodes
 * binary `.dat` tables — so it is a deliberate manual step. Run it on a machine
 * with network access. Output goes to the gitignored `data/` dir (a local artifact
 * like the DB — not committed; ship it as an extraResource when packaging).
 *
 *   pnpm add -D pathofexile-dat        # in apps/server
 *   node scripts/build-tier-data.mjs   # writes data/tier-data.json (gitignored)
 *
 * Pipeline (to implement/validate on-machine — TODO(verify) each step against the
 * live bundles, hard rule #2):
 *   1. Resolve the current patch: fetch the patch-server version, then the bundle
 *      index from GGG's CDN (pathofexile-dat exposes the loader).
 *   2. Read the schema (pathofexile-dat ships the community `.dat` schema) and decode
 *      the relevant tables: Mods, Stats, StatDescriptions, and the base-item tables.
 *   3. For each Mod: read its stat hash(es) + the tier's [min,max] roll range, and
 *      map the stat hash → the TRADE stat id (`explicit.stat_...`) the matcher uses.
 *      This hash→trade-id mapping is the crux and needs validation against a few
 *      known items (the ranges are approximate until keyed by base + ilvl).
 *   4. Emit { dataVersion: <patch>, stats: { [tradeStatId]: [{tier,min,max}, …] } },
 *      best (T1) tier first, to data/tier-data.json.
 *   5. Bump DICTIONARY_SCHEMA_VERSION so every user rebuilds once real data ships.
 */
/* eslint-disable no-console -- a CLI build script: console output is its interface. */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUTPUT = fileURLToPath(new URL('../data/tier-data.json', import.meta.url));

async function main() {
  let dat;
  try {
    dat = await import('pathofexile-dat');
  } catch {
    console.error(
      'pathofexile-dat is not installed. Run `pnpm add -D pathofexile-dat` in apps/server,\n' +
        'then implement the decode pipeline described in this file and re-run.',
    );
    process.exitCode = 1;
    return;
  }

  // TODO(verify): implement steps 1–4 above using `dat`. Until then, emit a stub so
  // the loader path stays valid (an empty stats map = tiers simply unavailable).
  void dat;
  const output = { dataVersion: 'stub', stats: {} };
  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT} (stub — implement the decode to populate real tiers).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
