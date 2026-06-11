export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
