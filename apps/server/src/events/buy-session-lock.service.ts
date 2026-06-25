import { Injectable } from '@nestjs/common';

/**
 * Shared "a buy sequence is in progress" flag. `BuyAutomationService` holds it for
 * the WHOLE buy run — including the post-buy return-to-hideout sequence (until ~10s
 * after the Leave-Hideout click) — and `TravelService` reads it to suspend new
 * travels for EVERY search. While held, live hits still stream/display, but no new
 * travel (and hence no new buy) starts until the current process finishes.
 *
 * Lives in the global EventsModule so both sides share one instance without a
 * circular module import (BuyAutomationModule already imports TravelModule).
 */
@Injectable()
export class BuySessionLock {
  private active = false;

  begin(): void {
    this.active = true;
  }

  end(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }
}
