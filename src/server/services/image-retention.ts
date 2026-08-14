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
