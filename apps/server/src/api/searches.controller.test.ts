import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import type { DealWatchService } from '../deal-watch/deal-watch.service.js';
import type { SearchManager } from '../search/search-manager.js';
import { SearchesController } from './searches.controller.js';

function runtimeInfo(id: string): SearchRuntimeInfo {
  return {
    id,
    realm: 'poe2',
    league: 'Standard',
    label: 'row',
    autoTravel: false,
    autoBuy: false,
    enabled: true,
    purchaseMode: null,
    filters: {},
    addedAt: '2026-07-05T00:00:00Z',
    roomId: null,
    archivedAt: null,
    dealWatch: null,
    engine: null,
    status: 'active',
    statusDetail: null,
    hitCount: 0,
    lastHitAt: null,
    marketPrice: null,
  };
}

function makeController() {
  const searchManager = {
    add: vi.fn().mockResolvedValue(runtimeInfo('Fresh1234')),
    editSearch: vi.fn().mockResolvedValue(runtimeInfo('NewId9999')),
    update: vi.fn().mockReturnValue(runtimeInfo('same1234')),
  } as unknown as SearchManager;
  const dealWatch = {
    applyConfig: vi.fn().mockResolvedValue(runtimeInfo('NewId9999')),
    manualRefresh: vi.fn(),
  } as unknown as DealWatchService;
  return { controller: new SearchesController(searchManager, dealWatch), searchManager, dealWatch };
}

describe('SearchesController — add with deal config (D-dw-16)', () => {
  it('a plain add never touches the deal service', async () => {
    const { controller, searchManager, dealWatch } = makeController();
    const info = await controller.add({ input: 'Fresh1234' });
    expect(searchManager.add).toHaveBeenCalledOnce();
    expect(dealWatch.applyConfig).not.toHaveBeenCalled();
    expect(info.id).toBe('Fresh1234');
  });

  it('add with dealWatch enables deal mode on the NEW id in the same request', async () => {
    const { controller, dealWatch } = makeController();
    (dealWatch.applyConfig as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      runtimeInfo('Fresh1234'),
    );
    await controller.add({
      input: 'Fresh1234',
      dealWatch: { mode: 'absolute', thresholdValue: 5, unit: 'divine' },
    });
    expect(dealWatch.applyConfig).toHaveBeenCalledWith('Fresh1234', {
      mode: 'absolute',
      thresholdValue: 5,
      unit: 'divine',
      baselineSampleSize: 10, // schema default (D-dw-15)
      refreshIntervalMs: null, // schema default (D-dw-20)
    });
  });

  it('a refused deal enable surfaces its coded 409 AFTER the search was created', async () => {
    const { controller, searchManager, dealWatch } = makeController();
    (dealWatch.applyConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new HttpException({ code: 'deal-unsupported-item' }, 409),
    );
    await expect(
      controller.add({
        input: 'Fresh1234',
        dealWatch: { mode: 'percent', thresholdValue: 30 },
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'deal-unsupported-item' } });
    // Known D-dw-16 behavior: the row exists, only the deal part was declined.
    expect(searchManager.add).toHaveBeenCalledOnce();
  });
});

describe('SearchesController — deal-watch routes', () => {
  it('a combined PATCH {input, dealWatch} applies BOTH — deal config against the NEW id (F28)', async () => {
    const { controller, searchManager, dealWatch } = makeController();
    await controller.update('old12345', {
      input: 'NewId9999',
      dealWatch: { mode: 'percent', thresholdValue: 30 },
    });
    expect(searchManager.editSearch).toHaveBeenCalledWith('old12345', 'NewId9999', {
      label: undefined,
    });
    // The deal config lands on the RE-POINTED id, not the stale one.
    expect(dealWatch.applyConfig).toHaveBeenCalledWith('NewId9999', {
      mode: 'percent',
      thresholdValue: 30,
      unit: 'exalted', // schema default (D-dw-11)
      baselineSampleSize: 10, // schema default (D-dw-15)
      refreshIntervalMs: null, // schema default (D-dw-20)
    });
  });

  it('an input-only PATCH never touches the deal service', async () => {
    const { controller, dealWatch } = makeController();
    await controller.update('old12345', { input: 'NewId9999' });
    expect(dealWatch.applyConfig).not.toHaveBeenCalled();
  });

  it('validates baselineSampleSize into 3..20 (D-dw-15)', async () => {
    const { controller, dealWatch } = makeController();
    await expect(
      controller.update('old12345', {
        dealWatch: { mode: 'percent', thresholdValue: 30, baselineSampleSize: 2 },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.update('old12345', {
        dealWatch: { mode: 'percent', thresholdValue: 30, baselineSampleSize: 21 },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(dealWatch.applyConfig).not.toHaveBeenCalled();

    await controller.update('old12345', {
      dealWatch: { mode: 'percent', thresholdValue: 30, baselineSampleSize: 5 },
    });
    expect(dealWatch.applyConfig).toHaveBeenCalledWith(
      'old12345',
      expect.objectContaining({ baselineSampleSize: 5 }),
    );
  });

  it('deal-refresh maps cooldown to 429 and declined states to 409 with codes (F22)', async () => {
    const { controller, dealWatch } = makeController();
    (dealWatch.manualRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      kind: 'cooldown',
      retryInMs: 41_000,
    });
    await expect(controller.dealRefresh('abc12345')).rejects.toMatchObject({
      status: 429,
      response: { code: 'deal-refresh-cooldown', retryInMs: 41_000 },
    });

    (dealWatch.manualRefresh as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      kind: 'declined',
      code: 'paused',
    });
    const declined = controller.dealRefresh('abc12345');
    await expect(declined).rejects.toBeInstanceOf(HttpException);
    await expect(declined).rejects.toMatchObject({
      status: 409,
      response: { code: 'deal-refresh-paused' },
    });
  });
});
