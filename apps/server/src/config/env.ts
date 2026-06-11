import { z } from 'zod';

/**
 * The single source of truth for runtime configuration. Parsed once at boot;
 * the process refuses to start on invalid config (fail-fast).
 *
 * Tunables (poll interval floor, fetch spacing, reconnect backoff, …) join
 * this schema in Phase 1 — never as magic numbers in code.
 */
export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3500),
  DB_PATH: z.string().min(1).default('./data/dev.db'),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Injection token for the validated config object. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
