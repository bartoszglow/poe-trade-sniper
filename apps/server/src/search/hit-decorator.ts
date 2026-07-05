import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent, Listing } from '@poe-sniper/shared';

/**
 * What a decorator turns a detected listing into (plan 41, D-dw-5). Enrichment
 * happens at PERSISTENCE time: `hitColumns` land inside the same transaction as
 * the hit row, and the events replace the plain `hit` / `hit-updated`.
 */
export interface HitDecoration {
  /** Published for a NEW offer (instead of `hit`). Ignored when suppressed. */
  event: DomainEvent;
  /** Published for a re-served offer (instead of `hit-updated`). */
  updatedEvent: DomainEvent;
  /** Extra hit-row columns persisted with the hit (e.g. the `deal` JSON). */
  hitColumns: { deal: unknown } | null;
  /**
   * True → persist the hit but publish NOTHING (deal-watch sub-threshold
   * suppression: the listing passed the GGG cap but misses the live cutoff).
   */
  suppressAlert: boolean;
}

export interface HitDecorator {
  /**
   * Return null when the listing is not this decorator's concern. MUST be
   * synchronous and cheap — it runs inside the detection hot path
   * (SearchManager.recordHits), before the hits insert transaction.
   */
  decorate(listing: Listing): HitDecoration | null;
}

/**
 * Mutable registry the SearchManager consults before persisting/publishing a
 * hit. Self-registration keeps the dependency direction one-way (D-dw-5):
 * SearchModule provides the registry, feature modules (deal-watch) register
 * their decorator in `onModuleInit` — SearchManager never imports them, and a
 * new decorator is an appended entry, not an edit here (open/closed).
 */
@Injectable()
export class HitDecoratorRegistry {
  private readonly logger = new Logger(HitDecoratorRegistry.name);
  private readonly decorators: HitDecorator[] = [];

  register(decorator: HitDecorator): void {
    this.decorators.push(decorator);
  }

  /**
   * First decorator that claims the listing wins (registration order). A
   * throwing decorator must never kill hit persistence (review F21) — it is
   * logged and the listing falls through as an ordinary hit.
   */
  decorate(listing: Listing): HitDecoration | null {
    for (const decorator of this.decorators) {
      try {
        const decoration = decorator.decorate(listing);
        if (decoration) return decoration;
      } catch (error) {
        this.logger.warn(`hit decorator failed for ${listing.listingId}: ${String(error)}`);
      }
    }
    return null;
  }
}
