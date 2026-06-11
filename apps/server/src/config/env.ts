import { z } from 'zod';

/**
 * The single source of truth for runtime configuration. Parsed once at boot;
 * the process refuses to start on invalid config (fail-fast). Tunables live
 * here — never as magic numbers at call sites.
 */
export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3500),
  DB_PATH: z.string().min(1).default('./data/dev.db'),

  // --- GGG trade API ---
  POE_BASE_URL: z.string().url().default('https://www.pathofexile.com'),
  /** League used when a search is added by bare id without an explicit league. */
  DEFAULT_LEAGUE: z.string().min(1).default('Standard'),
  /** Hard deadline for every outbound GGG call (AbortController). */
  OUTBOUND_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),

  // --- detection tunables ---
  /**
   * Scheduler tick — one search POST per tick, round-robin across searches.
   * Floor 6000: the search budget is shared per IP and lockouts stack.
   */
  POLL_INTERVAL_MS: z.coerce.number().int().min(6_000).default(12_000),
  /** Spacing between /fetch calls (observed policy ~12 req / 6 s). */
  FETCH_SPACING_MS: z.coerce.number().int().min(100).default(600),
  /** /api/trade2/fetch accepts at most 10 ids per call. */
  FETCH_BATCH_SIZE: z.coerce.number().int().min(1).max(10).default(10),
  /** A broad search can turn over 100+ ids per poll — fetch only the newest N. */
  MAX_FRESH_IDS_PER_TICK: z.coerce.number().int().min(1).default(20),
  /** Bounded-growth cap for per-search seen-id sets. */
  SEEN_IDS_CAP: z.coerce.number().int().min(100).default(5_000),

  // --- live WebSocket ---
  /** Tarpit guard: unauthenticated handshakes hang forever — always time out. */
  WS_HANDSHAKE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  WS_RECONNECT_BASE_MS: z.coerce.number().int().min(1000).default(5_000),
  WS_RECONNECT_MAX_MS: z.coerce.number().int().min(5_000).default(120_000),
  WS_KEEPALIVE_PING_MS: z.coerce.number().int().min(5_000).default(30_000),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Injection token for the validated config object. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
