import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Injectable, Logger } from '@nestjs/common';
import { errorMessage } from '../util/error-message.js';

interface TierRange {
  tier: number;
  min: number;
  max: number;
}

interface TierDataFile {
  dataVersion?: string;
  /** statId → tier ranges, best (T1) first. */
  stats?: Record<string, TierRange[]>;
}

/**
 * Tier-2 (#38 B): per-stat tier/roll ranges decoded from the game bundles, loaded
 * from `data/tier-data.json`. That file is GENERATED on-machine by
 * scripts/build-tier-data.mjs (the CDN + .dat decode cannot run here, rules #2/#8)
 * and lives in the gitignored `data/` dir — a local artifact like the DB, NOT
 * committed — so it is ABSENT on a fresh checkout until generated, in which case
 * tiers are simply unavailable (graceful; the core check is unaffected). Ranges are
 * approximate (not base/ilvl-specific) — a first pass. Tests point TIER_DATA_PATH at
 * a fixture. (Packaging note: ship the generated file as an extraResource in Phase 5.)
 */
@Injectable()
export class TierDataService {
  private readonly logger = new Logger(TierDataService.name);
  private readonly byStatId = new Map<string, TierRange[]>();
  private dataVersion = 'none';

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const path =
        process.env['TIER_DATA_PATH'] ??
        fileURLToPath(new URL('../../data/tier-data.json', import.meta.url));
      if (!existsSync(path)) return;
      const raw = JSON.parse(readFileSync(path, 'utf8')) as TierDataFile;
      this.dataVersion = raw.dataVersion ?? 'unknown';
      for (const [statId, tiers] of Object.entries(raw.stats ?? {})) {
        if (Array.isArray(tiers)) this.byStatId.set(statId, tiers);
      }
      if (this.byStatId.size > 0) {
        this.logger.log(`tier data loaded: ${this.byStatId.size} stats (v${this.dataVersion})`);
      }
    } catch (error) {
      this.logger.warn(`tier data load failed: ${errorMessage(error)}`);
    }
  }

  /** The tier a roll falls into for a stat (best-first), or null when unknown. */
  tierForRoll(statId: string, roll: number | null): TierRange | null {
    if (roll === null) return null;
    const tiers = this.byStatId.get(statId);
    if (!tiers) return null;
    return tiers.find((range) => roll >= range.min && roll <= range.max) ?? null;
  }
}
