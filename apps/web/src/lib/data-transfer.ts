/**
 * Trigger a browser download of a GET endpoint. The server sets the filename via
 * `Content-Disposition`; we mirror it on the anchor as a same-origin hint. Works behind
 * the Vite dev proxy and same-origin in the desktop shell.
 */
export function downloadFile(path: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = path;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Read a user-picked file as text and JSON-parse it (for import). Throws on bad JSON. */
export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}
