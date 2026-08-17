import { parseDockerSizeToBytes } from "./docker-size";

/**
 * What Docker is using on a server, per category, read from
 * `docker system df --format '{{json .}}'`.
 *
 * `docker builder du` looks like a better source for the build cache row —
 * it reports a much larger reclaimable figure — but it is measuring something
 * else. Verified against a real server:
 *
 *   system df   -> Build Cache reclaimable: 0B
 *   builder du  -> Reclaimable: 148.2MB
 *   builder prune actually freed: 0B
 *
 * The cache records back layers of images that still exist, so a prune cannot
 * free them. `system df` predicted that exactly; `builder du` reports the whole
 * cache as reclaimable regardless. Using it would have the panel advertise
 * 148 MB of cleanable space that no prune can recover.
 */

export type DockerDiskCategory =
  | "Images"
  | "Containers"
  | "Local Volumes"
  | "Build Cache";

export interface DockerDiskUsageEntry {
  category: string;
  totalCount: number;
  activeCount: number;
  sizeBytes: number | null;
  /** What a prune could actually free, not the category's total size. */
  reclaimableBytes: number | null;
}

export const BUILD_CACHE_CATEGORY: DockerDiskCategory = "Build Cache";

function readCount(value: unknown): number {
  const count = Number(String(value ?? "").trim());
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}

/**
 * Reclaimable is written as "12.25MB (5%)". The percentage is derived from the
 * other two columns, so only the size is kept.
 */
export function parseReclaimable(value: unknown): number | null {
  if (typeof value !== "string") return null;
  return parseDockerSizeToBytes(value.replace(/\s*\([^)]*\)\s*$/, ""));
}

export function parseDockerDiskUsage(
  systemDfStdout: string,
): DockerDiskUsageEntry[] {
  return systemDfStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A login shell can print a banner, and one unreadable row must not
        // take the other categories with it.
        return [];
      }

      const category = String(parsed.Type ?? "").trim();
      if (!category) return [];

      return [
        {
          category,
          totalCount: readCount(parsed.TotalCount),
          activeCount: readCount(parsed.Active),
          sizeBytes: parseDockerSizeToBytes(String(parsed.Size ?? "")),
          reclaimableBytes: parseReclaimable(parsed.Reclaimable),
        },
      ];
    });
}

export function findDiskUsageEntry(
  entries: DockerDiskUsageEntry[],
  category: string,
): DockerDiskUsageEntry | null {
  return entries.find((entry) => entry.category === category) ?? null;
}
