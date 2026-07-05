import { z } from 'zod';
import type { DealWatchState } from '@poe-sniper/shared';

const dealBaselineSchema = z.object({
  amountExalted: z.number(),
  sampleSize: z.number().int(),
  rawLowestExalted: z.number(),
  computedAt: z.string().min(1),
  listingsSeen: z.number().int(),
});

/** Mirrors DealWatchStatusCode — a new code must be added here too (compile-checked below). */
const dealWatchStatusSchema = z.enum([
  'active',
  'paused',
  'pending-derive',
  'insufficient-data',
  'baseline-stale',
  'derive-failed',
  'derive-conflict',
  'derived-expired',
  'unsupported-item',
  'capped',
  'restore-pending',
  'restore-failed',
]);

const dealWatchStateSchema = z.object({
  watchId: z.string().min(1),
  mode: z.enum(['percent', 'absolute']),
  thresholdValue: z.number().positive(),
  unit: z.enum(['exalted', 'divine']),
  definition: z.record(z.string(), z.unknown()),
  originalSearchId: z.string().min(1),
  originalPriceFilter: z.unknown(),
  baseline: dealBaselineSchema.nullable(),
  capBaseline: dealBaselineSchema.nullable(),
  capExalted: z.number().nullable(),
  derivedCreatedAt: z.string().nullable(),
  status: dealWatchStatusSchema,
  nextRefreshAt: z.string().nullable(),
  /** Absent in pre-divine-display persisted states — defaults to unknown. */
  divinePriceExalted: z.number().nullable().default(null),
});

// Compile-time drift guard: the schema's status values must BE DealWatchStatusCode.
type SchemaStatus = z.infer<typeof dealWatchStatusSchema>;
const _statusDriftCheck: DealWatchState['status'] extends SchemaStatus ? true : never = true;
void _statusDriftCheck;

/**
 * Contract-validate a persisted `searches.deal_watch` JSON at read time
 * (review F11): a malformed value (hand-edited DB, cross-version drift) reads
 * as null — the row degrades to an ordinary search — and NEVER throws into the
 * boot path. The caller logs; this stays pure.
 */
export function parseDealWatchState(value: unknown): DealWatchState | null {
  if (value === null || value === undefined) return null;
  const parsed = dealWatchStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
