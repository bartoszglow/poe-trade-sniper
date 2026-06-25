/** RFC-4180 cell: quote when it contains a comma, quote or newline; double inner quotes. */
function escapeCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else text = JSON.stringify(value) ?? '';
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
