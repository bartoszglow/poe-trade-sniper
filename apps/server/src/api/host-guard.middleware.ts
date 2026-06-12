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
    next();
  }
}
