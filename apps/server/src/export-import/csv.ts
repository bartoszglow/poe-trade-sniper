/**
 * Serialize one cell. RFC-4180 quoting (comma/quote/newline → quoted, inner quotes
 * doubled) PLUS spreadsheet-formula-injection neutralization: a TEXT cell starting with
 * `= + - @` (or a tab/CR) is executed as a formula by Excel/Sheets/Numbers, and our
 * hits/activity exports carry untrusted seller/item/mod text from GGG — so we prefix such
 * text cells with a guard apostrophe. Numeric/boolean cells are left untouched (a negative
 * number must stay numeric).
 */
function escapeCell(value: unknown): string {
  let text: string;
  let isText = false;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'string') {
    text = value;
    isText = true;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  } else {
    text = JSON.stringify(value) ?? '';
    isText = true;
  }
  if (isText && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serialize records to RFC-4180 CSV with `columns` as the (ordered) header. CRLF line
 * endings + quoted cells make it open cleanly in Excel/Numbers/Sheets. No dependency —
 * our rows are flat and single-line, so a correct escaper is all we need.
 */
export function toCsv(
  records: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
): string {
  const header = columns.map(escapeCell).join(',');
  const lines = records.map((record) =>
    columns.map((column) => escapeCell(record[column])).join(','),
  );
  return [header, ...lines].join('\r\n');
}
