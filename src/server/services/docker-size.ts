/**
 * Docker's human-readable sizes, back into bytes.
 *
 * Extracted from the SSH layer so anything reading Docker output shares one
 * parser, and so it can be tested without an SSH connection.
 *
 * Docker mixes both conventions in its own output — `docker stats` reports MiB
 * (1024-based) while `docker system df` reports MB (1000-based) — so the suffix
 * decides the base rather than one assumption covering both.
 *
 * Anything that is not a size, including the placeholders Docker prints for
 * missing values, falls through the pattern and returns null.
 */
export function parseDockerSizeToBytes(value: string): number | null {
  const match = value
    .trim()
    .match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgtpe]?i?b)$/i);
  if (!match) return null;

  const unit = match[2].toUpperCase();
  const base = unit.includes("IB") ? 1024 : 1000;
  const powers: Record<string, number> = {
    B: 0,
    KB: 1,
    MB: 2,
    GB: 3,
    TB: 4,
    PB: 5,
    KIB: 1,
    MIB: 2,
    GIB: 3,
    TIB: 4,
    PIB: 5,
  };

  return Math.round(Number(match[1]) * Math.pow(base, powers[unit] ?? 0));
}
