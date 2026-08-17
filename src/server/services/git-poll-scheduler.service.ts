import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma";
import { decrypt } from "../lib/crypto";
import { auditLog } from "./audit.service";
import { createProcessJob } from "./process-job.service";
import { runInjectedContainerJob } from "../routes/containers";
import {
  fetchLatestCommit,
  type PollableProvider,
} from "./git-latest-commit.service";
import { decideDeploy, isDueForPoll, resolvePollInterval } from "./git-poll.service";

/**
 * Auto deploy by polling.
 *
 * Replaces a webhook receiver that could never fire here: a self-hosted GitLab
 * refuses to deliver webhooks to a private-network URL, and the setting that
 * allows it is instance-admin only. Polling runs in the direction that already
 * works — the panel reads the provider, as it does to list repositories.
 *
 * The tick is frequent but the work is not: a container is only read when its
 * own interval has elapsed.
 */

const TICK_INTERVAL_MS = 15_000;
const POLLABLE_PROVIDERS: PollableProvider[] = ["GITHUB", "GITLAB", "GITEA"];

function isPollableProvider(value: string): value is PollableProvider {
  return (POLLABLE_PROVIDERS as string[]).includes(value);
}

/** The commit a container is currently running, from its newest good deploy. */
async function readDeployedCommitSha(containerId: string) {
  const deployment = await prisma.deployment.findFirst({
    where: { containerId, status: "SUCCESS", commitSha: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { commitSha: true },
  });

  return deployment?.commitSha ?? null;
}

async function recordPollResult(
  sourceId: string,
  patch: {
    lastPolledCommitSha?: string;
    lastPollError?: string | null;
  },
) {
  await prisma.containerDeploymentSource.update({
    where: { id: sourceId },
    data: { ...patch, lastPolledAt: new Date() },
  });
}

/**
 * Polls one container and, if the ref moved, triggers its rebuild.
 *
 * Returns whether a deploy was dispatched, so a caller can log meaningfully
 * without reading the database again.
 */
export async function pollContainer(
  app: FastifyInstance,
  containerId: string,
): Promise<{ dispatched: boolean; reason: string }> {
  const container = await prisma.container.findUnique({
    where: { id: containerId },
    select: {
      id: true,
      name: true,
      serverId: true,
      server: { select: { organizationId: true } },
      deploymentSource: {
        select: {
          id: true,
          repoUrl: true,
          repoBranch: true,
          autoDeployTagPattern: true,
          projectPath: true,
          accessTokenEnc: true,
          lastPolledCommitSha: true,
          gitProvider: {
            select: {
              id: true,
              provider: true,
              providerUrl: true,
              internalUrl: true,
              accessTokenEnc: true,
              userId: true,
              organizationId: true,
              user: { select: { id: true, role: true, isActive: true } },
            },
          },
        },
      },
    },
  });

  const source = container?.deploymentSource;
  if (!container || !source) {
    return { dispatched: false, reason: "no-deployment-source" };
  }

  const provider = source.gitProvider;
  if (!provider || !isPollableProvider(provider.provider)) {
    await recordPollResult(source.id, {
      lastPollError:
        "Auto deploy needs a connected GitHub, GitLab, or Gitea provider",
    });
    return { dispatched: false, reason: "provider-not-pollable" };
  }

  // The injected rebuild re-enters the authenticated route, so an owner who
  // cannot write containers would fail deep inside the job with an opaque 403.
  const owner = provider.user;
  if (!owner?.isActive || owner.role === "VIEWER") {
    const error = !owner?.isActive
      ? "Auto deploy skipped: the git provider owner account is inactive"
      : "Auto deploy skipped: the git provider owner has read-only (viewer) access";
    await recordPollResult(source.id, { lastPollError: error });
    return { dispatched: false, reason: "owner-cannot-deploy" };
  }

  const apiBaseUrl = provider.internalUrl?.trim() || provider.providerUrl?.trim();
  if (!apiBaseUrl) {
    await recordPollResult(source.id, {
      lastPollError: "The git provider has no URL recorded",
    });
    return { dispatched: false, reason: "provider-has-no-url" };
  }

  const encryptedToken = source.accessTokenEnc ?? provider.accessTokenEnc;

  let latest;
  try {
    latest = await fetchLatestCommit({
      provider: provider.provider,
      apiBaseUrl,
      projectPath: source.projectPath ?? "",
      accessToken: encryptedToken ? decrypt(encryptedToken) : undefined,
      branch: source.repoBranch,
      tagPattern: source.autoDeployTagPattern,
    });
  } catch (error) {
    // Recorded rather than thrown: a provider that stops answering would
    // otherwise be indistinguishable from a repository that never changes.
    await recordPollResult(source.id, {
      lastPollError:
        error instanceof Error ? error.message : "Failed to read the provider",
    });
    return { dispatched: false, reason: "provider-read-failed" };
  }

  const decision = decideDeploy({
    latestCommitSha: latest.commitSha,
    lastPolledCommitSha: source.lastPolledCommitSha,
    deployedCommitSha: await readDeployedCommitSha(container.id),
  });

  await recordPollResult(source.id, {
    lastPolledCommitSha: latest.commitSha,
    lastPollError: null,
  });

  if (!decision.deploy) {
    return { dispatched: false, reason: decision.reason };
  }

  const organizationId = container.server.organizationId;
  const job = await createProcessJob({
    type: "container_poll_deploy",
    userId: provider.userId,
    organizationId,
  });

  const token = app.jwt.sign({ sub: provider.userId, role: owner.role });

  runInjectedContainerJob({
    app,
    job,
    method: "POST",
    url: `/api/v1/containers/${container.id}/rebuild`,
    headers: {
      authorization: `Bearer ${token}`,
      "x-organization-id": organizationId,
    },
    // A tag is the version to build; a branch is already what rebuild defaults
    // to. The rebuild route revalidates the ref before it reaches git.
    payload: {
      trigger: "GIT_POLL",
      ...(latest.refKind === "tag" ? { ref: latest.ref } : {}),
    },
    redactSecret: token,
  });

  await auditLog({
    userId: provider.userId,
    serverId: container.serverId,
    action: "CONTAINER_AUTO_DEPLOY",
    category: "CONTAINER",
    level: "INFO",
    message: `Auto deploy for "${container.name}" triggered by ${latest.refKind} ${latest.ref} at ${latest.commitSha.slice(0, 12)}`,
  });

  return { dispatched: true, reason: decision.reason };
}

export async function runPollRound(
  app: FastifyInstance,
  now = new Date(),
): Promise<number> {
  const candidates = await prisma.containerDeploymentSource.findMany({
    where: { autoDeployOnPush: true, repoUrl: { not: null } },
    select: {
      containerId: true,
      autoDeployOnPush: true,
      pollIntervalSeconds: true,
      lastPolledAt: true,
    },
  });

  let dispatched = 0;

  // One at a time: a panel watching many repositories should not open a burst
  // of provider requests on the same tick.
  for (const candidate of candidates) {
    if (!isDueForPoll(candidate, now)) continue;

    try {
      const result = await pollContainer(app, candidate.containerId);
      if (result.dispatched) dispatched += 1;
    } catch (error) {
      app.log.error(
        { error, containerId: candidate.containerId },
        "auto deploy poll failed",
      );
    }
  }

  return dispatched;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startGitPollScheduler(app: FastifyInstance) {
  if (timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPollRound(app);
    } catch (error) {
      app.log.error({ error }, "auto deploy poll round failed");
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, TICK_INTERVAL_MS);
  timer.unref?.();
}

export function stopGitPollScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export { resolvePollInterval };
