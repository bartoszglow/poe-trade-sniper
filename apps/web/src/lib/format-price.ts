/**
 * Format a listing/estimate price amount for display. Trade prices can arrive as
 * long fractions (e.g. an aggregate exalted conversion → 736.9231); round by
 * magnitude and strip trailing zeros so "5.00" reads "5" and "736.9231" reads "737".
 */
export function formatPriceAmount(amount: number): string {
  if (!Number.isFinite(amount)) return String(amount);
  const magnitude = Math.abs(amount);
  const decimals = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  return Number(amount.toFixed(decimals)).toString();
}
