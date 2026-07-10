import { ForbiddenException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * DNS-rebinding hardening: even on loopback, a malicious site can point its
 * own hostname at 127.0.0.1 and have the victim's browser call this API with
 * that Host. Only genuine local hostnames are served.
 */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

@Injectable()
export class HostGuardMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const hostHeader = request.headers.host ?? '';
    const hostname = hostHeader.replace(/:\d+$/, '').toLowerCase();
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      throw new ForbiddenException('this API serves localhost only');
    }
    // CSRF hardening (review 2026-07-10, SEC-1): a website the operator visits
    // can fire CORS-simple POSTs at loopback (guard/reset, searches, restart…) —
    // the browser attaches the site's Origin, so reject any non-loopback one.
    // 'null' (sandboxed iframe / file://) is rejected too: our own surfaces are
    // Vite (http://localhost:5180) or the server-served bundle, never file://.
    // Requests WITHOUT an Origin (curl, same-origin navigation) stay allowed —
    // they are not a cross-site browser vector.
    const origin = request.headers.origin;
    if (origin !== undefined) {
      let originHostname: string;
      try {
        // URL.hostname strips the brackets from IPv6 literals — allow bare ::1.
        originHostname = new URL(origin).hostname.toLowerCase();
      } catch {
        throw new ForbiddenException('this API serves localhost only');
      }
      if (!ALLOWED_HOSTNAMES.has(originHostname) && originHostname !== '::1') {
        throw new ForbiddenException('this API serves localhost only');
      }
    }
    next();
  }
}
