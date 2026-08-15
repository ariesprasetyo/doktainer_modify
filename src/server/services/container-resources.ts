/**
 * CPU and memory limits for a container.
 *
 * These values end up in a shell command and in generated compose YAML, so
 * they are validated to a narrow shape here rather than trusted from the
 * request. Docker would reject a malformed value too, but only after the
 * deploy is already underway, with an error the user cannot act on.
 *
 * An unset limit is null, meaning "let Docker decide" — deliberately distinct
 * from 0, which Docker reads as an explicit unlimited.
 */

export interface ContainerResourceLimits {
  /** Relative CPU weight under contention. Docker allows 2..262144. */
  cpuShares: number | null;
  /** Fractional CPU count, e.g. "1.5". Stored as text to avoid float drift. */
  cpuCores: string | null;
  /** Memory ceiling with a unit suffix, e.g. "512m". */
  memory: string | null;
}

export const EMPTY_RESOURCE_LIMITS: ContainerResourceLimits = {
  cpuShares: null,
  cpuCores: null,
  memory: null,
};

const MIN_CPU_SHARES = 2;
const MAX_CPU_SHARES = 262_144;
/** Docker refuses anything below 6 MB, with a confusing error. */
const MIN_MEMORY_BYTES = 6 * 1024 * 1024;
const MEMORY_UNIT_BYTES: Record<string, number> = {
  b: 1,
  k: 1024,
  m: 1024 * 1024,
  g: 1024 * 1024 * 1024,
};

function readOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeCpuShares(value: unknown): number | null {
  const text = readOptionalText(value);
  if (text === null) return null;

  if (!/^\d+$/.test(text)) {
    throw new Error("CPU shares must be a whole number");
  }

  const shares = Number(text);
  if (shares < MIN_CPU_SHARES || shares > MAX_CPU_SHARES) {
    throw new Error(
      `CPU shares must be between ${MIN_CPU_SHARES} and ${MAX_CPU_SHARES}`,
    );
  }

  return shares;
}

export function normalizeCpuCores(value: unknown): string | null {
  const text = readOptionalText(value);
  if (text === null) return null;

  if (!/^\d+(\.\d{1,3})?$/.test(text)) {
    throw new Error(
      "Number of CPU cores must be a positive number with at most 3 decimals, for example 1.5",
    );
  }

  const cores = Number(text);
  if (cores <= 0) {
    throw new Error("Number of CPU cores must be greater than 0");
  }

  // Docker's own ceiling is the host's core count, which is not known here;
  // this only rejects values that cannot be legitimate on any host.
  if (cores > 4096) {
    throw new Error("Number of CPU cores is unrealistically large");
  }

  // Trailing zeros would otherwise make "1.50" and "1.5" look like different
  // stored values on every comparison.
  return String(cores);
}

function parseMemory(text: string): { amount: number; unit: string; bytes: number } {
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([bkmg])?[b]?$/i);
  if (!match) {
    throw new Error(
      "Memory must be a number with an optional unit, for example 512m or 2g",
    );
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();

  return { amount, unit, bytes: amount * MEMORY_UNIT_BYTES[unit] };
}

/**
 * `docker update --memory` is refused on a container that has no swap limit
 * yet unless the swap limit is set in the same call. Docker's own default for
 * `docker run -m X` is twice X, and compose's `deploy.resources.limits.memory`
 * produces the same, so this matches both rather than inventing a third
 * meaning for the same field.
 */
export function memorySwapBytesForLimit(memory: string | null): string | null {
  if (!memory) return null;
  return String(parseMemory(memory).bytes * 2);
}

export function normalizeMemory(value: unknown): string | null {
  const text = readOptionalText(value);
  if (text === null) return null;

  const { amount, unit, bytes } = parseMemory(text);

  if (!Number.isFinite(bytes) || bytes < MIN_MEMORY_BYTES) {
    throw new Error("Memory must be at least 6m, which is Docker's minimum");
  }

  // Docker accepts a decimal amount but reports the rounded value back, so the
  // stored form is normalized to whole bytes in the given unit.
  return `${Math.round(amount)}${unit}`;
}

export function normalizeResourceLimits(input: {
  cpuShares?: unknown;
  cpuCores?: unknown;
  memory?: unknown;
}): ContainerResourceLimits {
  return {
    cpuShares: normalizeCpuShares(input.cpuShares),
    cpuCores: normalizeCpuCores(input.cpuCores),
    memory: normalizeMemory(input.memory),
  };
}

export function hasResourceLimits(limits: ContainerResourceLimits): boolean {
  return (
    limits.cpuShares !== null ||
    limits.cpuCores !== null ||
    limits.memory !== null
  );
}

function formatMemoryBytes(bytes: number): string {
  for (const unit of ["g", "m", "k"] as const) {
    const size = MEMORY_UNIT_BYTES[unit];
    if (bytes >= size && bytes % size === 0) {
      return `${bytes / size}${unit}`;
    }
  }

  return `${bytes}b`;
}

/**
 * Reads limits back off a container Docker is already running.
 *
 * Docker reports an unset limit as 0, which has to become null again here:
 * carrying the 0 forward would turn "never configured" into an explicit
 * unlimited on the next deploy.
 */
export function resourceLimitsFromDocker(source: {
  cpuShares?: number | null;
  nanoCpus?: number | null;
  memoryBytes?: number | null;
}): ContainerResourceLimits {
  const cpuShares =
    typeof source.cpuShares === "number" && source.cpuShares >= MIN_CPU_SHARES
      ? source.cpuShares
      : null;

  const nanoCpus =
    typeof source.nanoCpus === "number" && source.nanoCpus > 0
      ? source.nanoCpus
      : null;

  const memoryBytes =
    typeof source.memoryBytes === "number" &&
    source.memoryBytes >= MIN_MEMORY_BYTES
      ? source.memoryBytes
      : null;

  return {
    cpuShares,
    // Docker stores CPUs as nanoseconds of CPU time per second.
    cpuCores:
      nanoCpus === null ? null : String(Math.round(nanoCpus / 1e6) / 1000),
    memory: memoryBytes === null ? null : formatMemoryBytes(memoryBytes),
  };
}

/**
 * Decides which limits a rebuild should apply.
 *
 * Once the panel owns a container's limits the stored values are used exactly
 * as they are, empty ones included — otherwise a limit the user cleared would
 * be read back off the still-running container and reapplied forever, making
 * it impossible to remove.
 *
 * Until then the live values fill the gaps, so limits set outside the panel
 * are not silently dropped by the first rebuild.
 */
export function resolveLimitsForRebuild(
  stored: ContainerResourceLimits,
  live: ContainerResourceLimits,
  panelManaged: boolean,
): ContainerResourceLimits {
  if (panelManaged) return stored;

  return {
    cpuShares: stored.cpuShares ?? live.cpuShares,
    cpuCores: stored.cpuCores ?? live.cpuCores,
    memory: stored.memory ?? live.memory,
  };
}

/**
 * Flags for `docker run` and `docker update`, which spell these identically.
 */
export function buildResourceFlags(limits: ContainerResourceLimits): string[] {
  const flags: string[] = [];

  if (limits.cpuShares !== null) {
    flags.push("--cpu-shares", String(limits.cpuShares));
  }
  if (limits.cpuCores !== null) {
    flags.push("--cpus", limits.cpuCores);
  }
  if (limits.memory !== null) {
    flags.push("--memory", limits.memory);
  }

  return flags;
}
