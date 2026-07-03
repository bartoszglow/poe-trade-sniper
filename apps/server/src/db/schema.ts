import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/** Watched trade searches (mirrors `ManagedSearch` in @poe-sniper/shared). */
export const searches = sqliteTable('searches', {
  /** Trade-site search id (slug from the search URL). */
  id: text('id').primaryKey(),
  realm: text('realm').notNull(),
  league: text('league').notNull(),
  label: text('label').notNull(),
  autoTravel: integer('auto_travel', { mode: 'boolean' }).notNull().default(false),
  /** When true, a successful auto-travel triggers Buy automation (requires autoTravel + macOS control permission). */
  autoBuy: integer('auto_buy', { mode: 'boolean' }).notNull().default(false),
  /** Paused searches stay listed but run no detection engine. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** PurchaseMode override or null = keep the resolved query's status.option. */
  purchaseMode: text('purchase_mode'),
  /** Raw trade query JSON — opaque payload owned by the trade-api adapter. */
  filters: text('filters', { mode: 'json' }).notNull(),
  addedAt: text('added_at').notNull(),
  /** User-defined display + poll-rotation order (drag-and-drop). Null = unordered;
   *  sorted last by addedAt. Two scopes (#33): top-level index when room_id is null,
   *  within-room index otherwise. Drives both the list order and the poll rotation. */
  position: integer('position'),
  /** Room membership (#33). No FK — foreign_keys is OFF in this app; room deletion
   *  re-homes or removes members explicitly in code, inside one transaction. */
  roomId: text('room_id'),
  /** ISO-8601 archive time (#35); null = active. Archived searches run no
   *  detection, leave the layout/rooms (membership kept for restore) and sort
   *  into the greyed bottom section. */
  archivedAt: text('archived_at'),
});

/** Named groups of searches on the Searches view (#33). One level deep. */
export const rooms = sqliteTable('rooms', {
  /** Room id (uuid). */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Collapsed in the UI — persisted so the view survives restarts. */
  collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
  /** Top-level order, same single sequence as ungrouped searches' position. */
  position: integer('position'),
  addedAt: text('added_at').notNull(),
});

/** Detection history — enables later analytics ("what I bought / saved"). */
export const hits = sqliteTable(
  'hits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchId: text('search_id')
      .notNull()
      .references(() => searches.id, { onDelete: 'cascade' }),
    listingId: text('listing_id').notNull(),
    itemName: text('item_name').notNull(),
    /** ListingPrice JSON or null when the listing carries no price. */
    price: text('price', { mode: 'json' }),
    seller: text('seller').notNull(),
    /** Normalized ItemDetail JSON (null when the payload had no item object). */
    item: text('item', { mode: 'json' }),
    detectedAt: text('detected_at').notNull(),
  },
  (table) => [
    // Covers listHits' per-search filter + time-range and the boot GROUP BY aggregate
    // (the name-substring filter is a leading-wildcard LIKE — non-sargable, no index).
    index('hits_search_id_detected_at').on(table.searchId, table.detectedAt),
  ],
);

/**
 * Recent price checks (#37/#17): a durable, capped "recent lookups" log so the
 * Price Checks view survives a restart. Not audit history — pruned to a rolling
 * cap. No search FK: a price check has no search context of its own.
 */
export const priceCheckHistory = sqliteTable(
  'price_check_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Full PriceCheckResult JSON — re-rendered by the shared PriceCheckResultView. */
    result: text('result', { mode: 'json' }).notNull(),
    checkedAt: text('checked_at').notNull(),
  },
  (table) => [index('price_check_history_checked_at').on(table.checkedAt)],
);

/**
 * Activity log — one travel→buy→return sequence the app performed (the operator
 * "Activity" timeline). The item is SNAPSHOTTED here (not a hits FK) so the record
 * survives hit-pruning and search deletion. Never stores the session/hideout token.
 */
export const activity = sqliteTable(
  'activity',
  {
    /** Activity id (uuid). */
    id: text('id').primaryKey(),
    searchId: text('search_id'),
    listingId: text('listing_id'),
    /** 'manual' | 'auto'. */
    source: text('source').notNull(),
    itemName: text('item_name').notNull(),
    /** ListingPrice JSON or null. */
    price: text('price', { mode: 'json' }),
    seller: text('seller'),
    /** Normalized ItemDetail JSON snapshot or null. */
    item: text('item', { mode: 'json' }),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    /** ActivityOutcome. */
    outcome: text('outcome').notNull(),
    /** true/false once the return ran, else null. */
    returnedHome: integer('returned_home', { mode: 'boolean' }),
    /** ActivityStep[] JSON. */
    steps: text('steps', { mode: 'json' }).notNull(),
  },
  (table) => [index('activity_started_at').on(table.startedAt)],
);

/**
 * Single-table key/value state: session blob, settings.
 * SECURITY: the session value is a credential — never log it, never expose it
 * through the API.
 */
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});
