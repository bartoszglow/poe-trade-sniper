import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PermissionGateService } from '../permissions/permission-gate.service.js';
import type { TravelService } from '../travel/travel.service.js';
import type { BuyAutomationService } from './buy-automation.service.js';
import { BuyController } from './buy.controller.js';

function makeController(canControl = true) {
  const gate = {
    canControl: vi.fn().mockReturnValue(canControl),
  } as unknown as PermissionGateService;
  const travelService = {
    enqueue: vi.fn().mockReturnValue({ position: 0 }),
    retryTravel: vi.fn().mockResolvedValue({ found: true }),
  } as unknown as TravelService;
  const buyAutomation = {
    requestManualBuy: vi.fn(),
    clearManualBuy: vi.fn(),
  } as unknown as BuyAutomationService;
  return {
    controller: new BuyController(gate, travelService, buyAutomation),
    gate,
    travelService,
    buyAutomation,
  };
}

const RETRY_BODY = { searchId: 's1', listingId: 'l1', offerKey: 'Voices Bob 5 divine sig' };

describe('BuyController.buyRetry (aged-hit Buy via re-resolve)', () => {
  it('marks buy-on-arrival BEFORE re-resolving, then travels via retryTravel', async () => {
    const { controller, buyAutomation, travelService } = makeController();

    const result = await controller.buyRetry(RETRY_BODY);

    expect(buyAutomation.requestManualBuy).toHaveBeenCalledWith('l1');
    expect(travelService.retryTravel).toHaveBeenCalledWith('s1', 'l1', RETRY_BODY.offerKey);
    // Order matters: the travel-success handler must already see the intent, so
    // the mark must be invoked before the re-resolve enqueues the travel.
    const markOrder = (buyAutomation.requestManualBuy as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const retryOrder = (travelService.retryTravel as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(markOrder).toBeLessThan(retryOrder!);
    expect(result).toEqual({ found: true });
    // A live travel is queued — the intent must NOT be evicted (it fires on arrival).
    expect(buyAutomation.clearManualBuy).not.toHaveBeenCalled();
  });

  it('evicts the buy intent when nothing will travel (offer gone → found:false), so a later Travel-only cannot inherit it (CORR-1)', async () => {
    const { controller, buyAutomation, travelService } = makeController();
    (travelService.retryTravel as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ found: false });
    expect(await controller.buyRetry(RETRY_BODY)).toEqual({ found: false });
    expect(buyAutomation.clearManualBuy).toHaveBeenCalledWith('l1');
  });

  it('rejects with Forbidden when the control permission is absent (UI gating is not authoritative)', async () => {
    const { controller, buyAutomation, travelService } = makeController(false);
    await expect(controller.buyRetry(RETRY_BODY)).rejects.toBeInstanceOf(HttpException);
    // Never marks an intent nor travels when denied.
    expect(buyAutomation.requestManualBuy).not.toHaveBeenCalled();
    expect(travelService.retryTravel).not.toHaveBeenCalled();
  });

  it('rejects a malformed body before touching any service', async () => {
    const { controller, buyAutomation, travelService } = makeController();
    await expect(controller.buyRetry({ searchId: 's1' })).rejects.toBeInstanceOf(HttpException);
    expect(buyAutomation.requestManualBuy).not.toHaveBeenCalled();
    expect(travelService.retryTravel).not.toHaveBeenCalled();
  });
});
