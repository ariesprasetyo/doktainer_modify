/**
 * Resolution and validation for the git ref a container deploys from.
 *
 * A container normally tracks a branch, which means its deployed code moves
 * whenever that branch moves. Pinning a tag freezes it, which is what makes
 * rolling back to an earlier version possible. Tag pushes can also deploy
 * themselves when the operator opts in with a pattern.
 */

const MAX_REF_LENGTH = 128;

/**
 * Accept the subset of git's ref naming rules that is also safe to hand to a
 * shell argument. Refs still get escaped at the call site; this keeps anything
 * exotic from reaching that point at all.
 */
export function isValidGitRefName(value: string | null | undefined): boolean {
  const ref = (value ?? "").trim();

  if (!ref || ref.length > MAX_REF_LENGTH) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(ref)) return false;
  if (ref.startsWith("-") || ref.startsWith("/") || ref.startsWith(".")) {
    return false;
  }
  if (ref.endsWith("/") || ref.endsWith(".") || ref.endsWith(".lock")) {
    return false;
  }
  if (ref.includes("..") || ref.includes("//")) return false;

  return true;
}

/**
 * Translate a tag glob into an anchored regular expression.
 *
 * Only `*` and `?` are treated as wildcards; every other character is matched
 * literally, so a pattern can never widen into arbitrary regex.
 */
export function tagPatternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("")
    .map((character) => {
      if (character === "*") return "[^/]*";
      if (character === "?") return "[^/]";
      return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");

  return new RegExp(`^${source}$`);
}

export function matchesTagPattern(
  tag: string,
  pattern: string | null | undefined,
): boolean {
  const trimmedPattern = (pattern ?? "").trim();
  const trimmedTag = tag.trim();

  if (!trimmedPattern || !trimmedTag) return false;
  if (!isValidGitRefName(trimmedTag)) return false;

  return tagPatternToRegExp(trimmedPattern).test(trimmedTag);
}

export type DeployRefSource = {
  repoBranch?: string | null;
  repoTag?: string | null;
};

export type ResolvedDeployRef = {
  ref: string | undefined;
  kind: "tag" | "branch" | "default";
};

/**
 * Decide which ref to check out.
 *
 * `refOverride` is only supplied by the tag-push flow, where the pushed tag is
 * the point of the deploy. A pinned `repoTag` wins over the branch, and an
 * invalid value is dropped rather than passed along.
 */
export function resolveDeployRef(
  source: DeployRefSource,
  refOverride?: string | null,
): ResolvedDeployRef {
  const override = (refOverride ?? "").trim();
  if (override && isValidGitRefName(override)) {
    return { ref: override, kind: "tag" };
  }

  const tag = (source.repoTag ?? "").trim();
  if (tag && isValidGitRefName(tag)) {
    return { ref: tag, kind: "tag" };
  }

  const branch = (source.repoBranch ?? "").trim();
  if (branch && isValidGitRefName(branch)) {
    return { ref: branch, kind: "branch" };
  }

  // No usable ref: let git clone the repository's default branch.
  return { ref: undefined, kind: "default" };
}

/** True when the container's version is frozen to a tag. */
export function isVersionPinned(source: DeployRefSource): boolean {
  const tag = (source.repoTag ?? "").trim();
  return Boolean(tag) && isValidGitRefName(tag);
}

/**
 * A commit hash, full or abbreviated. Checked out with `git checkout`, not
 * `git clone --branch`, so it is validated separately from a ref name — no
 * slashes, no dots, hex only.
 */
export function isValidCommitSha(value: string | null | undefined): boolean {
  const sha = (value ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(sha);
}
