/**
 * Narrow an unknown thrown value to a message string — the single idiom used
 * across the server's catch blocks (DUP-2: was duplicated 7×).
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
