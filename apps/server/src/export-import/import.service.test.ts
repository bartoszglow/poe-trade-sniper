import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SearchManager } from '../search/search-manager.js';
import { ImportService } from './import.service.js';

function makeService() {
  const importSearches = vi.fn(() => ({ imported: 1, skipped: 0, errors: [] }));
  const service = new ImportService({ importSearches } as unknown as SearchManager);
  return { service, importSearches };
}

const validEntry = {
  id: 's1',
  realm: 'poe2',
  league: 'Standard',
  label: 'My search',
  autoTravel: false,
  autoBuy: false,
  enabled: true,
  purchaseMode: null,
  filters: { query: {} },
  addedAt: '2026-06-25T00:00:00.000Z',
};
const validEnvelope = { kind: 'poe-sniper-searches', version: 1, searches: [validEntry] };

describe('ImportService', () => {
  it('accepts a valid envelope and forwards the entries + mode to the manager', () => {
    const { service, importSearches } = makeService();
    expect(service.importSearches(validEnvelope, 'skip').imported).toBe(1);
    expect(importSearches).toHaveBeenCalledWith([validEntry], 'skip');
  });

  it('rejects the wrong envelope kind', () => {
    const { service } = makeService();
    expect(() => service.importSearches({ ...validEnvelope, kind: 'nope' }, 'skip')).toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown top-level keys (strict) — a tampered file cannot smuggle a session', () => {
    const { service } = makeService();
    expect(() =>
      service.importSearches({ ...validEnvelope, session: 'secret-cookie' }, 'skip'),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-object body', () => {
    const { service } = makeService();
    expect(() => service.importSearches('not json', 'skip')).toThrow(BadRequestException);
  });
});
