import { z } from 'zod';

/**
 * The single source of truth for runtime configuration. Parsed once at boot;
 * the process refuses to start on invalid config (fail-fast). Tunables live
 * here — never as magic numbers at call sites.
 */
export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3500),
  /**
   * SECURITY: loopback only by default — the API can read the session status,
   * add searches and fire travels; it must never be reachable from the LAN.
   */
  HOST: z.string().min(1).default('127.0.0.1'),
  DB_PATH: z.string().min(1).default('./data/dev.db'),
  /**
   * When set, the server serves this directory as the web UI (loopback,
   * one origin — the desktop shell uses it). Unset in web dev: Vite serves.
   */
  STATIC_DIR: z.string().min(1).optional(),

  // --- GGG trade API ---
  POE_BASE_URL: z.string().url().default('https://www.pathofexile.com'),
  /** League used when a search is added by bare id without an explicit league. */
  DEFAULT_LEAGUE: z.string().min(1).default('Standard'),
  /** Hard deadline for every outbound GGG call (AbortController). */
  OUTBOUND_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  /**
   * UA used when the operator pastes cookies without one. When cf_clearance
   * is pasted, the operator should supply their real browser UA instead —
   * Cloudflare binds clearance to it.
   */
  FALLBACK_USER_AGENT: z
    .string()
    .min(1)
    .default(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    ),

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

  /** League list barely changes — cache window for GET /api/leagues. */
  LEAGUE_CACHE_TTL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  /** Stat dictionary is static game data — cache window for GET /api/stats. */
  STATS_CACHE_TTL_MS: z.coerce.number().int().min(3_600_000).default(86_400_000),

  // --- travel ---
  /** Minimum gap between whisper POSTs (separate GGG policy; travels are rare). */
  TRAVEL_MIN_SPACING_MS: z.coerce.number().int().min(0).default(2_000),
  /**
   * Queue entries older than this are dropped, not fired — hideout tokens
   * expire at ~300 s and a stale travel would just 4xx.
   */
  TRAVEL_TOKEN_MAX_AGE_MS: z.coerce.number().int().min(10_000).default(240_000),
  /**
   * Listings re-enter the live stream as "new" when the buyer returns to
   * hideout without purchasing (trade-site behavior) — remember this many
   * successfully-traveled listing ids so auto-travel never re-fires for them.
   */
  TRAVEL_DEDUPE_MAX_ENTRIES: z.coerce.number().int().min(10).default(500),

  // --- live WebSocket ---
  /** Tarpit guard: unauthenticated handshakes hang forever — always time out. */
  WS_HANDSHAKE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  /**
   * Reconnect ladder (comma-separated ms), advanced per consecutive failure,
   * reset on a successful connect. Fast first retry: GGG drops live sockets
   * periodically and every reconnect gap is missed listings; repeated
   * failures back off — aggressive retry loops burn the per-IP budget.
   */
  WS_RECONNECT_LADDER_MS: z
    .string()
    .regex(/^\d+(,\d+)*$/, 'comma-separated milliseconds, e.g. 1000,5000,20000,60000')
    .default('1000,5000,20000,60000')
    .transform((csv) => csv.split(',').map(Number)),
  /**
   * Cadence of the SINGLE shared background probe that checks whether GGG's
   * live ws backend is up — one probe answers for every poll-mode search.
   */
  WS_UPGRADE_PROBE_INTERVAL_MS: z.coerce.number().int().min(10_000).default(120_000),
  WS_KEEPALIVE_PING_MS: z.coerce.number().int().min(5_000).default(30_000),
  /**
   * A connection must survive this long to count as "stable". A drop after
   * that is a routine periodic GGG drop (one quick reconnect); a drop before
   * it means the backend is cooling off (demote straight to poll, no dark wait).
   */
  WS_STABLE_CONNECTION_MS: z.coerce.number().int().min(5_000).default(60_000),

  // --- in-app login capture (web mode, D-12) ---
  /** Real Chrome binary used for the login window. */
  CHROME_BINARY: z
    .string()
    .min(1)
    .default('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  /** Where the dedicated login Chrome profile lives. */
  LOGIN_PROFILE_DIR: z.string().min(1).default('./data'),

  // --- persistence hygiene ---
  /** Hit history is pruned to the newest N rows (bounded growth). */
  HITS_MAX_ROWS: z.coerce.number().int().min(100).default(10_000),

  // --- outbound safety guard (the runaway watchdog) ---
  /** Hard ceiling on ALL GGG HTTP requests per rolling minute. */
  GUARD_MAX_HTTP_PER_MINUTE: z.coerce.number().int().min(10).default(90),
  /** Hard ceiling on ws connection attempts per rolling minute (all searches). */
  GUARD_MAX_WS_CONNECTS_PER_MINUTE: z.coerce.number().int().min(2).default(12),
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
