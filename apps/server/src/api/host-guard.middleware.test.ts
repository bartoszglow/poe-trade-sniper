import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { HostGuardMiddleware } from './host-guard.middleware.js';

function call(host: string | undefined): { threw: boolean; nexted: boolean } {
  const middleware = new HostGuardMiddleware();
  const next = vi.fn();
  try {
    middleware.use(
      { headers: { host } } as unknown as Request,
      {} as Response,
      next as NextFunction,
    );
  } catch (error) {
    if (!(error instanceof ForbiddenException)) throw error;
    return { threw: true, nexted: false };
  }
  return { threw: false, nexted: next.mock.calls.length === 1 };
}

describe('HostGuardMiddleware', () => {
  it('passes genuine local hostnames through (any port)', () => {
    for (const host of ['localhost', '127.0.0.1', '127.0.0.1:3500', 'LocalHost:5180', '[::1]']) {
      expect(call(host).nexted).toBe(true);
    }
  });

  it('rejects a foreign Host — the DNS-rebinding guard for the whole API incl. export/import', () => {
    for (const host of ['evil.example.com', 'evil.example.com:3500', undefined, '']) {
      expect(call(host).threw).toBe(true);
    }
  });
});
