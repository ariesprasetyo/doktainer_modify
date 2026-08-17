/**
 * Decides when to poll a container and whether what came back is new.
 *
 * Kept free of Prisma and fetch so the two rules that actually matter can be
 * tested directly: a container is not polled more often than its interval, and
 * a commit already deployed is not deployed again.
 */

export const DEFAULT_POLL_INTERVAL_SECONDS = 120;
export const MIN_POLL_INTERVAL_SECONDS = 30;
export const MAX_POLL_INTERVAL_SECONDS = 86_400;

export function normalizePollInterval(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const seconds = Number(value);
  if (!Number.isInteger(seconds)) {
    throw new Error("Poll interval must be a whole number of seconds");
  }

  if (
    seconds < MIN_POLL_INTERVAL_SECONDS ||
    seconds > MAX_POLL_INTERVAL_SECONDS
  ) {
    throw new Error(
      `Poll interval must be between ${MIN_POLL_INTERVAL_SECONDS} seconds and ${MAX_POLL_INTERVAL_SECONDS} seconds`,
    );
  }

  return seconds;
}

export function resolvePollInterval(value: number | null | undefined): number {
  return value ?? DEFAULT_POLL_INTERVAL_SECONDS;
}

export interface PollCandidate {
  autoDeployOnPush: boolean;
  pollIntervalSeconds: number | null;
  lastPolledAt: Date | null;
}

/**
 * A container that has never been polled is due immediately, so enabling auto
 * deploy takes effect without waiting out a full interval first.
 */
export function isDueForPoll(candidate: PollCandidate, now: Date): boolean {
  if (!candidate.autoDeployOnPush) return false;
  if (!candidate.lastPolledAt) return true;

  const elapsed = (now.getTime() - candidate.lastPolledAt.getTime()) / 1000;
  return elapsed >= resolvePollInterval(candidate.pollIntervalSeconds);
}

export interface DeployDecision {
  deploy: boolean;
  reason:
    | "first-observation"
    | "new-commit"
    | "unchanged"
    | "no-commit-recorded";
}

/**
 * Whether a freshly read commit should trigger a deploy.
 *
 * The first observation deliberately does not deploy. On enabling auto deploy,
 * or on the first poll after an upgrade, nothing is recorded yet — and "newest
 * commit differs from nothing" would redeploy whatever is already running, on
 * every panel restart.
 */
export function decideDeploy(input: {
  latestCommitSha: string;
  lastPolledCommitSha: string | null;
  /** The commit the container is actually running, when known. */
  deployedCommitSha?: string | null;
}): DeployDecision {
  const latest = input.latestCommitSha.trim();
  if (!latest) return { deploy: false, reason: "no-commit-recorded" };

  const seen = input.lastPolledCommitSha?.trim();

  if (!seen) {
    // The running commit is a better baseline when it is known: a container
    // deployed from an older commit should catch up, rather than sit on it
    // until the next push.
    const deployed = input.deployedCommitSha?.trim();
    if (deployed && deployed !== latest) {
      return { deploy: true, reason: "new-commit" };
    }

    return { deploy: false, reason: "first-observation" };
  }

  return seen === latest
    ? { deploy: false, reason: "unchanged" }
    : { deploy: true, reason: "new-commit" };
}
