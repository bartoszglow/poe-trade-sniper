/** Public PoE2 trade website origin — the human-facing site, not a secret. */
export const POE_TRADE_BASE_URL = 'https://www.pathofexile.com';

/**
 * The trade-site search PAGE url for a search — the same
 * `/trade2/search/<realm>/<league>/<searchId>` shape the server sends as the
 * whisper Referer, the resolve/live endpoints use, and `search-input` parses
 * back in. Single source of truth for that format (hard rule #2 — evidenced,
 * not guessed). `league` is url-encoded (leagues carry spaces, e.g. "Runes of
 * Aldur"); `searchId` is the trade-site slug.
 *
 * There is NO evidenced url that deep-links to a single listing (and listing
 * ids are ephemeral anyway), so linking is search-level only.
 */
export function tradeSearchPageUrl(
  realm: string,
  league: string,
  searchId: string,
  baseUrl: string = POE_TRADE_BASE_URL,
): string {
  return `${baseUrl}/trade2/search/${realm}/${encodeURIComponent(league)}/${searchId}`;
}
