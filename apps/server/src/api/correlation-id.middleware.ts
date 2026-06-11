import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns a correlation id to every inbound request (or adopts the caller's
 * `x-correlation-id`). Stored on `response.locals` and echoed in the response
 * header. Phase 1 engines reuse the same pattern so a single id threads
 * detection → fetch → travel through the logs.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const inboundId = request.header('x-correlation-id');
    const correlationId = inboundId && inboundId.length <= 64 ? inboundId : randomUUID();
    response.locals.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  }
}
