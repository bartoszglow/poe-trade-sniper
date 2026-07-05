import { z } from 'zod';
import type { MarketPriceSnapshot } from '@poe-sniper/shared';

const marketBaselineSchema = z.object({
  amountExalted: z.number(),
  sampleSize: z.number().int(),
  rawLowestExalted: z.number(),
  computedAt: z.string().min(1),
  listingsSeen: z.number().int(),
});

const marketPriceSnapshotSchema = z.object({
  baseline: marketBaselineSchema,
  divinePriceExalted: z.number().nullable(),
  nextCheckAt: z.string().nullable(),
});

/**
 * Contract-validate a persisted `searches.market_price` JSON at read time
 * (same posture as parseDealWatchState/review F11): malformed reads as null —
 * the row simply shows no market price — and never throws into the boot path.
 */
export function parseMarketPriceSnapshot(value: unknown): MarketPriceSnapshot | null {
  if (value === null || value === undefined) return null;
  const parsed = marketPriceSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
