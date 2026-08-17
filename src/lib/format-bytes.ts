const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Byte counts for display.
 *
 * Extracted from the metric chart so the server disk breakdown formats the same
 * way rather than growing a second, subtly different version.
 *
 * One decimal is kept only below 10, where dropping it would round a real
 * measurement to something misleading — 1.4 GB should not read as 1 GB.
 */
export function formatBytes(value: number, suffix = ""): string {
  if (!Number.isFinite(value)) return "—";

  const sign = value < 0 ? "-" : "";
  let amount = Math.abs(value);
  let unit = 0;

  while (amount >= 1024 && unit < UNITS.length - 1) {
    amount /= 1024;
    unit += 1;
  }

  const rendered =
    amount >= 10 || unit === 0 ? Math.round(amount) : amount.toFixed(1);

  return `${sign}${rendered} ${UNITS[unit]}${suffix}`;
}
