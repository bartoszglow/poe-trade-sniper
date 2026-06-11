import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** Watched trade searches (mirrors `ManagedSearch` in @poe-sniper/shared). */
export const searches = sqliteTable('searches', {
  /** Trade-site search id (slug from the search URL). */
  id: text('id').primaryKey(),
  realm: text('realm').notNull(),
  league: text('league').notNull(),
  label: text('label').notNull(),
  autoTravel: integer('auto_travel', { mode: 'boolean' }).notNull().default(false),
  /** Raw trade query JSON — opaque payload owned by the trade-api adapter. */
  filters: text('filters', { mode: 'json' }).notNull(),
  addedAt: text('added_at').notNull(),
});

/** Detection history — enables later analytics ("what I bought / saved"). */
export const hits = sqliteTable('hits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  searchId: text('search_id')
    .notNull()
    .references(() => searches.id, { onDelete: 'cascade' }),
  listingId: text('listing_id').notNull(),
  itemName: text('item_name').notNull(),
  /** ListingPrice JSON or null when the listing carries no price. */
  price: text('price', { mode: 'json' }),
  seller: text('seller').notNull(),
  /** Normalized ItemDetail JSON. */
  item: text('item', { mode: 'json' }).notNull(),
  detectedAt: text('detected_at').notNull(),
});

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
