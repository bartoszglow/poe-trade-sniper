import { STACK_PRICED_CATEGORY_KEYWORDS } from '../price-check/query-builder.js';
import type { TradeDataService } from '../price-check/trade-data.service.js';

/**
 * The v1 stack-priced gate, shared by the deal-watch enable path (W3) and the
 * universal market-price loop (D-dw-14): stack-priced families have no per-unit
 * price handling, so any baseline over them would be silently garbage. Fails
 * OPEN by design — an unavailable dictionary or an unknown name never blocks
 * the caller; `onUnavailable` lets the caller log with its own context.
 */
export async function stackableCategoryFor(
  tradeData: TradeDataService,
  definition: unknown,
  onUnavailable: (candidate: string, error: unknown) => void,
): Promise<string | null> {
  for (const candidate of queryItemNames(definition)) {
    try {
      const category = await tradeData.categoryForItemName(candidate);
      if (category !== null && isStackPricedCategory(category)) return category;
    } catch (error) {
      onUnavailable(candidate, error);
      return null;
    }
  }
  return null;
}

/** True when a dictionary category names a stack-priced family (set shared with price-check). */
function isStackPricedCategory(category: string): boolean {
  const categoryLower = category.toLowerCase();
  return STACK_PRICED_CATEGORY_KEYWORDS.some((keyword) => categoryLower.includes(keyword));
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The query's top-level `name`/`type` fields as dictionary-lookup candidates.
 * Both fields appear either as a plain string or as an `{option, …}` envelope
 * (evidenced query shapes, api-notes + apps/web/src/lib/query-criteria.ts).
 */
function queryItemNames(definition: unknown): string[] {
  if (!isJsonRecord(definition)) return [];
  const candidates: string[] = [];
  for (const field of ['name', 'type'] as const) {
    const value = definition[field];
    if (typeof value === 'string') {
      candidates.push(value);
    } else if (isJsonRecord(value) && typeof value['option'] === 'string') {
      candidates.push(value['option']);
    }
  }
  return candidates;
}
