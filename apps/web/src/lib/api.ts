export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * True ONLY when `message` came from the server's response body (an intended,
     * user-facing message such as a validation error). False for a synthesized
     * technical fallback like `GET /path → 404` — which must NEVER be shown to the
     * user (hard rule: translate errors, never surface raw technical strings).
     */
    readonly userFacing: boolean = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Typed fetch wrapper. Paths are relative (`/api/...`) so the same build works
 * behind the Vite dev proxy today and same-origin in the desktop shell later.
 */
export async function apiGet<ResponseBody>(path: string): Promise<ResponseBody> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} → ${response.status}`);
  }
  return (await response.json()) as ResponseBody;
}

/** Mutating calls; surfaces the server's `message` so forms can show it. */
export async function apiSend<ResponseBody>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ResponseBody> {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const serverMessage = (payload as { message?: string } | null)?.message;
    // userFacing only when the server actually gave us a message — the fallback is
    // a raw route+status that the UI must not show.
    throw new ApiError(
      response.status,
      serverMessage ?? `${method} ${path} → ${response.status}`,
      serverMessage != null,
    );
  }
  return payload as ResponseBody;
}
