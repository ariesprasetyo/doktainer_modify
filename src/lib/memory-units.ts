/**
 * The memory fields are entered as a plain number of megabytes, with the unit
 * shown in the label instead of typed. Docker itself wants a unit suffix, so
 * the conversion happens at the edge rather than changing what the API means:
 * "512" in the API stays 512 bytes, as Docker reads it.
 */

const UNIT_MEGABYTES: Record<string, number> = {
  b: 1 / (1024 * 1024),
  k: 1 / 1024,
  m: 1,
  g: 1024,
};

/** "512m" -> "512", "2g" -> "2048", "" -> "". */
export function memoryToMegabytes(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";

  const match = text.match(/^(\d+(?:\.\d+)?)\s*([bkmg])?[b]?$/i);
  if (!match) return "";

  const megabytes = Number(match[1]) * UNIT_MEGABYTES[(match[2] ?? "b").toLowerCase()];

  // A value that is not a whole number of megabytes would be silently rounded
  // on the way back, so it is shown with its decimals intact.
  return String(Math.round(megabytes * 1000) / 1000);
}

/** "512" -> "512m", "" -> undefined so the field is simply omitted. */
export function megabytesToMemory(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;

  // Anything that is not a bare number is passed through untouched, so a user
  // who does type "2g" is not turned into the meaningless "2gm".
  if (!/^\d+(\.\d+)?$/.test(text)) return text;

  return `${text}m`;
}
