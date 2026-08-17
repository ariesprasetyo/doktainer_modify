/**
 * Decide which past builds' images still deserve a protective tag.
 *
 * A git-deployed container reuses the same primary tag (usually `:latest`)
 * for every build, so a new build always displaces the previous one's only
 * name. On a Docker install backed by containerd's image store this was
 * observed to garbage-collect the now-untagged image within seconds — not on
 * a schedule, not from a manual prune, just as an automatic side effect of
 * the retag. Giving each build an additional, stable tag based on its commit
 * keeps it addressable after `:latest` moves on, which is what makes rolling
 * back to it instant instead of a rebuild. This module only decides which of
 * those extra tags have aged out; the tagging and removal themselves are SSH
 * operations.
 */

export const DEFAULT_KEPT_BUILDS_PER_CONTAINER = 5;

/**
 * How much build cache a server may keep.
 *
 * The cache is the largest thing Docker accumulates — on a server whose images
 * totalled 241 MB, the cache alone was 148 MB with no active entries — and
 * nothing cleaned it except a manual button. It is capped rather than emptied:
 * discarding it entirely makes the next build far slower, which is the exact
 * cost the cache exists to avoid.
 */
export const DEFAULT_BUILD_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Whether pruning is worth a round trip.
 *
 * Only what a prune could actually free counts, so a large cache that is all in
 * use is left alone.
 */
export function shouldPruneBuildCache(
  reclaimableBytes: number | null | undefined,
  limitBytes: number = DEFAULT_BUILD_CACHE_LIMIT_BYTES,
): boolean {
  if (typeof reclaimableBytes !== "number" || !Number.isFinite(reclaimableBytes)) {
    return false;
  }

  return reclaimableBytes > Math.max(limitBytes, 0);
}

/**
 * Given the commits of a container's successful past builds (newest first,
 * duplicates allowed — the same commit can be built more than once), return
 * the ones whose retention tag has fallen outside the kept window.
 */
export function selectCommitsToPrune(
  commitShasNewestFirst: ReadonlyArray<string | null | undefined>,
  keep: number = DEFAULT_KEPT_BUILDS_PER_CONTAINER,
): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const raw of commitShasNewestFirst) {
    const commitSha = raw?.trim();
    if (!commitSha || seen.has(commitSha)) continue;
    seen.add(commitSha);
    deduped.push(commitSha);
  }

  return deduped.slice(Math.max(keep, 0));
}
