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
  /** Where the redacted GGG network log (JSONL) is written for sharing/debug. */
  LOG_DIR: z.string().min(1).default('./data/logs'),
  /** Rotate the network log file once it passes this size. */
  LOG_MAX_BYTES: z.coerce.number().int().min(1_000).default(5_000_000),
  /** Network entries kept in memory for the dev view's initial load. */
  NETWORK_LOG_RING_SIZE: z.coerce.number().int().min(1).default(500),
  /**
   * `owner/repo` whose GitHub Releases drive the in-app update check. Empty =
   * disabled (no remote yet); set once the repo exists to light up the banner.
   */
  GITHUB_RELEASES_REPO: z.string().default(''),
  /** Cache window for the GitHub release lookup (GitHub's unauthed limit is 60/h). */
  UPDATE_CHECK_TTL_MS: z.coerce.number().int().min(60_000).default(3_600_000),

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
   * A connection must survive this long to count as "stable" — the backoff
   * ladder resets only after a stable connection, so a connect→instant-drop
   * loop can't keep retrying at the fastest rung.
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

  // --- desktop: focus the game window after an auto-travel ---
  /**
   * When true, a successful AUTO travel brings the game window to the
   * foreground (macOS only) — it runs at a low frame rate in the background,
   * so focusing it the moment the character teleports restores full FPS.
   */
  GAME_FOCUS_ON_TRAVEL: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * macOS WINDOW TITLE of the game. PoE2 runs under Wine, where the process is
   * just "wine" — and there are TWO such processes (Steam + the game), so
   * matching by process name focuses the wrong one. We match the window title
   * instead. Charset-validated (no quotes) so it can be inlined into AppleScript.
   */
  GAME_WINDOW_TITLE: z
    .string()
    .regex(/^[A-Za-z0-9 ._-]+$/, 'letters, digits, space, . _ - only')
    .default('Path of Exile 2'),

  // --- buy automation (Phase 2; Electron-only, gated) — no magic numbers inline ---
  /** Capture-loop cadence while waiting for the trade window to appear. */
  BUY_CAPTURE_POLL_MS: z.coerce.number().int().min(20).default(100),
  /** Give up detecting the trade window after this long. */
  BUY_CAPTURE_TIMEOUT_MS: z.coerce.number().int().min(500).default(5_000),
  /** uiohook events within this window of a synthetic move are treated as ours, not the user's. */
  BUY_SYNTHETIC_INPUT_GRACE_MS: z.coerce.number().int().min(0).default(120),
  /** Wait after focusGameWindow before verifying focus actually landed (Wine can no-op). */
  BUY_FOCUS_VERIFY_MS: z.coerce.number().int().min(0).default(250),
  /** Wait this long for the trade window (merchant UI) to appear after travel —
   *  covers the teleport loading screen, which varies by the seller's hideout. */
  BUY_SHOP_TIMEOUT_MS: z.coerce.number().int().min(500).default(15_000),
  /** Once the shop is open, keep checking for the item this long before concluding
   *  it sold (items can take ~1s to render in). */
  BUY_ITEM_GRACE_MS: z.coerce.number().int().min(0).default(2_500),
  /** Hard wall-clock cap on a whole buy run — guarantees the single-flight lock
   *  resets even if a desktop port call (osascript/screencapture) hangs. */
  BUY_RUN_TIMEOUT_MS: z.coerce.number().int().min(100).default(25_000),
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
