/**
 * A name/value pair as rendered on the trade site (markup already cleaned).
 * `value` is null for value-less lines (e.g. "Corrupted").
 */
export interface ItemProperty {
  label: string;
  value: string | null;
}

/**
 * Normalized item detail produced by `normalizeItemDetail()` from the raw
 * trade-api fetch payload. Markup tags (`[tag|display]`) are stripped.
 * Nullable fields reflect payload reality — currency and gems carry no rarity,
 * many entries no base type.
 */
export interface ItemDetail {
  rarity: string | null;
  baseType: string | null;
  itemLevel: number | null;
  corrupted: boolean;
  properties: ItemProperty[];
  requirements: ItemProperty[];
  implicitMods: string[];
  explicitMods: string[];
  runeMods: string[];
  craftedMods: string[];
}

/** Price as listed (e.g. amount 5, currency 'divine'). */
export interface ListingPrice {
  amount: number;
  currency: string;
}

/**
 * A detected listing — the unit the engines emit and the hits feed renders.
 */
export interface Listing {
  /** Trade-site listing id (stable per listing). */
  listingId: string;
  searchId: string;
  itemName: string;
  price: ListingPrice | null;
  seller: string | null;
  /**
   * Short-lived (~300 s) `tok:hideout` JWT carried only by securable
   * (instant-buyout) listings — POSTing it to /api/trade2/whisper travels.
   */
  hideoutToken: string | null;
  item: ItemDetail | null;
  /** ISO-8601 timestamp of detection. */
  detectedAt: string;
}

/** A persisted detection (row in the `hits` table). */
export interface Hit extends Listing {
  /** Database row id. */
  id: number;
}
