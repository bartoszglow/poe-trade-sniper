import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { HostGuardMiddleware } from './host-guard.middleware.js';

function call(host: string | undefined, origin?: string): { threw: boolean; nexted: boolean } {
  const middleware = new HostGuardMiddleware();
  const next = vi.fn();
  try {
    middleware.use(
      { headers: { host, origin } } as unknown as Request,
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

  it('passes loopback Origins (our own web surfaces) through', () => {
    for (const origin of [
      'http://localhost:5180',
      'http://127.0.0.1:3500',
      'http://[::1]:3500',
      undefined, // curl / same-origin navigation — no Origin header at all
    ]) {
      expect(call('127.0.0.1:3500', origin).nexted).toBe(true);
    }
  });

  it('rejects cross-site Origins — the CSRF guard for side-effect POSTs (SEC-1)', () => {
    for (const origin of [
      'https://evil.example.com', // a website firing CORS-simple POSTs at loopback
      'null', // sandboxed iframe / file:// — never a legitimate surface of ours
      'not a url',
    ]) {
      expect(call('127.0.0.1:3500', origin).threw).toBe(true);
    }
  });
});
