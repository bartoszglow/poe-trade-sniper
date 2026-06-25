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

  it('rejects an off-contract purchaseMode (would silently corrupt the live query)', () => {
    const { service } = makeService();
    const body = { ...validEnvelope, searches: [{ ...validEntry, purchaseMode: 'garbage' }] };
    expect(() => service.importSearches(body, 'skip')).toThrow(BadRequestException);
  });

  it('rejects a non-poe2 realm', () => {
    const { service } = makeService();
    const body = { ...validEnvelope, searches: [{ ...validEntry, realm: 'pc' }] };
    expect(() => service.importSearches(body, 'skip')).toThrow(BadRequestException);
  });

  it('rejects non-object filters', () => {
    const { service } = makeService();
    const body = { ...validEnvelope, searches: [{ ...validEntry, filters: 'opaque-string' }] };
    expect(() => service.importSearches(body, 'skip')).toThrow(BadRequestException);
  });

  it('rejects a newer export version than this app supports', () => {
    const { service } = makeService();
    expect(() => service.importSearches({ ...validEnvelope, version: 999 }, 'skip')).toThrow(
      BadRequestException,
    );
  });
});
