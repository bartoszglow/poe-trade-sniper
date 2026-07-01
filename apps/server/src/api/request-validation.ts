import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Parse a request body/query against a zod schema; issues become one 400 message. */
export function parseOrBadRequest<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}
