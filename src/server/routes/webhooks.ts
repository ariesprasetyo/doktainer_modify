import crypto from "crypto";
import { FastifyInstance } from "fastify";
import prisma from "../lib/prisma";
import { decrypt } from "../lib/crypto";
import { auditLog } from "../services/audit.service";
import { createProcessJob } from "../services/process-job.service";
import { createDeployment } from "../services/deployment.service";
import { isVersionPinned, matchesTagPattern } from "../services/git-ref";
import { runInjectedContainerJob } from "./containers";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Unparsed request body, populated only for webhook routes so signature
     * verification can hash the exact bytes the provider signed.
     */
    rawBody?: Buffer;
  }
}

const WEBHOOK_PROVIDERS = ["github", "gitlab", "gitea"] as const;
type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

const PROVIDER_TO_DB = {
  github: "GITHUB",
  gitlab: "GITLAB",
  gitea: "GITEA",
} as const;

const EMPTY_SHA = /^0{40}$/;

function isWebhookProvider(value: string): value is WebhookProvider {
  return (WEBHOOK_PROVIDERS as readonly string[]).includes(value);
}

function getHeader(
  headers: Record<string, unknown>,
  name: string,
): string | null {
  const value = headers[name];
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim() || null;
  }
  return null;
}

function safeCompare(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  // timingSafeEqual throws on length mismatch, and digest lengths are fixed, so
  // comparing lengths first leaks nothing useful.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hmacSha256Hex(rawBody: Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Verify the provider proved knowledge of the shared secret.
 *
 * GitLab sends the secret verbatim in a header; GitHub and Gitea send an
 * HMAC-SHA256 over the raw request bytes, which is why the unparsed body has to
 * be preserved upstream.
 */
export function verifyWebhookSignature(input: {
  provider: WebhookProvider;
  secret: string;
  rawBody: Buffer | undefined;
  headers: Record<string, unknown>;
}): boolean {
  const { provider, secret, rawBody, headers } = input;
  if (!secret) return false;

  if (provider === "gitlab") {
    const token = getHeader(headers, "x-gitlab-token");
    return Boolean(token) && safeCompare(secret, token as string);
  }

  if (!rawBody?.length) return false;

  if (provider === "github") {
    const provided = getHeader(headers, "x-hub-signature-256");
    if (!provided) return false;
    return safeCompare(`sha256=${hmacSha256Hex(rawBody, secret)}`, provided);
  }

  const provided = getHeader(headers, "x-gitea-signature");
  if (!provided) return false;
  return safeCompare(hmacSha256Hex(rawBody, secret), provided);
}

/**
 * Reduce any clone URL form to "host[:port]/path" so the same repository
 * matches whether it was configured as https, http, or scp-style SSH.
 */
export function normalizeRepoIdentity(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  // scp-like SSH syntax (git@host:group/repo.git) is not a parseable URL.
  const scpMatch = /^[^/@]+@([^:/]+):(.+)$/.exec(raw);
  const candidate = scpMatch ? `ssh://${scpMatch[1]}/${scpMatch[2]}` : raw;

  let host = "";
  let pathname = "";

  try {
    const url = new URL(candidate);
    host = url.host.toLowerCase();
    pathname = url.pathname;
  } catch {
    const stripped = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const slash = stripped.indexOf("/");
    if (slash < 0) {
      return stripped.toLowerCase().replace(/\.git$/i, "");
    }
    host = stripped.slice(0, slash).toLowerCase();
    pathname = stripped.slice(slash);
  }

  const path = pathname
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

  if (host && path) return `${host}/${path}`;
  return host || path;
}

export function extractPushBranch(ref: string | null | undefined): string {
  const value = (ref ?? "").trim();
  const prefix = "refs/heads/";
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

export function extractPushTag(ref: string | null | undefined): string {
  const value = (ref ?? "").trim();
  const prefix = "refs/tags/";
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

type PushEvent = {
  ignored: string | null;
  repoCandidates: string[];
  /** Set for a branch push, empty for a tag push. */
  branch: string;
  /** Set for a tag push, empty for a branch push. */
  tag: string;
  commitSha: string | null;
};

type WebhookPayload = {
  object_kind?: unknown;
  ref?: unknown;
  after?: unknown;
  deleted?: unknown;
  checkout_sha?: unknown;
  project?: Record<string, unknown>;
  repository?: Record<string, unknown>;
};

function readString(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Normalise the three providers' push payloads into one shape, or explain why
 * the event should be ignored.
 */
export function parsePushEvent(input: {
  provider: WebhookProvider;
  eventName: string | null;
  payload: WebhookPayload;
}): PushEvent {
  const { provider, eventName, payload } = input;
  const ignored = (reason: string): PushEvent => ({
    ignored: reason,
    repoCandidates: [],
    branch: "",
    tag: "",
    commitSha: null,
  });

  // GitLab reports tag pushes as a separate object_kind; GitHub and Gitea reuse
  // the push event and only the ref distinguishes them.
  if (provider === "gitlab") {
    const kind = payload.object_kind;
    if (kind !== "push" && kind !== "tag_push") {
      return ignored(`unsupported gitlab event: ${String(kind ?? "unknown")}`);
    }
  } else if (eventName && eventName.toLowerCase() !== "push") {
    return ignored(`unsupported ${provider} event: ${eventName}`);
  }

  const ref = typeof payload.ref === "string" ? payload.ref : null;
  const branch = extractPushBranch(ref);
  const tag = extractPushTag(ref);
  if (!branch && !tag) {
    return ignored("push did not target a branch or tag");
  }

  const after = typeof payload.after === "string" ? payload.after : "";
  if (payload.deleted === true || (after && EMPTY_SHA.test(after))) {
    return ignored(tag ? "tag deletion" : "branch deletion");
  }

  const project = payload.project;
  const repository = payload.repository;
  const repoCandidates = [
    readString(project, "http_url_to_repo"),
    readString(project, "ssh_url_to_repo"),
    readString(project, "git_http_url"),
    readString(repository, "git_http_url"),
    readString(repository, "git_ssh_url"),
    readString(repository, "clone_url"),
    readString(repository, "ssh_url"),
  ].filter((value): value is string => Boolean(value));

  if (!repoCandidates.length) {
    return ignored("payload carried no repository url");
  }

  const commitSha =
    (typeof payload.checkout_sha === "string" ? payload.checkout_sha : null) ||
    (after && !EMPTY_SHA.test(after) ? after : null);

  return { ignored: null, repoCandidates, branch, tag, commitSha };
}

export function matchesPushedRepo(
  storedRepoUrl: string | null,
  repoCandidates: string[],
): boolean {
  const stored = normalizeRepoIdentity(storedRepoUrl);
  if (!stored) return false;
  return repoCandidates.some(
    (candidate) => normalizeRepoIdentity(candidate) === stored,
  );
}

export function matchesPushedBranch(
  storedBranch: string | null,
  pushedBranch: string,
): boolean {
  const stored = (storedBranch ?? "").trim() || "main";
  return stored.toLowerCase() === pushedBranch.toLowerCase();
}

type DeployTarget = {
  repoUrl: string | null;
  repoBranch: string | null;
  repoTag: string | null;
  autoDeployOnPush: boolean;
  autoDeployTagPattern: string | null;
};

/**
 * Decide whether a push should redeploy a container, and with which ref.
 *
 * A tag push deploys the pushed tag when it matches the container's pattern. A
 * branch push only deploys containers tracking that branch, and never one whose
 * version is pinned to a tag — pinned means pinned.
 */
export function resolveWebhookDeployRef(
  target: DeployTarget,
  push: Pick<PushEvent, "branch" | "tag" | "repoCandidates">,
): { deploy: boolean; ref?: string; reason: string } {
  if (!matchesPushedRepo(target.repoUrl, push.repoCandidates)) {
    return { deploy: false, reason: "repository does not match" };
  }

  if (push.tag) {
    if (!matchesTagPattern(push.tag, target.autoDeployTagPattern)) {
      return { deploy: false, reason: "tag does not match pattern" };
    }
    return { deploy: true, ref: push.tag, reason: "tag matched pattern" };
  }

  if (!target.autoDeployOnPush) {
    return { deploy: false, reason: "deploy on push is disabled" };
  }

  if (isVersionPinned(target)) {
    return { deploy: false, reason: "version is pinned to a tag" };
  }

  if (!matchesPushedBranch(target.repoBranch, push.branch)) {
    return { deploy: false, reason: "branch does not match" };
  }

  return { deploy: true, reason: "branch matched" };
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/:provider/:providerId", async (req, reply) => {
    const { provider: providerParam, providerId } = req.params as {
      provider: string;
      providerId: string;
    };

    if (!isWebhookProvider(providerParam)) {
      return reply
        .status(404)
        .send({ success: false, error: "Unknown webhook provider" });
    }

    // One opaque rejection for "no such provider" and "bad secret" alike, so the
    // endpoint cannot be used to enumerate provider ids.
    const rejectUnauthorized = () =>
      reply
        .status(403)
        .send({ success: false, error: "Webhook signature rejected" });

    const gitProvider = await prisma.userGitProvider.findFirst({
      where: {
        id: providerId,
        provider: PROVIDER_TO_DB[providerParam],
      },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        enabled: true,
        webhookSecretEnc: true,
        user: { select: { role: true, isActive: true } },
      },
    });

    if (!gitProvider?.enabled || !gitProvider.webhookSecretEnc) {
      return rejectUnauthorized();
    }

    let secret = "";
    try {
      secret = decrypt(gitProvider.webhookSecretEnc).trim();
    } catch {
      return rejectUnauthorized();
    }

    const verified = verifyWebhookSignature({
      provider: providerParam,
      secret,
      rawBody: req.rawBody,
      headers: req.headers as Record<string, unknown>,
    });
    if (!verified) {
      return rejectUnauthorized();
    }

    const eventName =
      getHeader(req.headers as Record<string, unknown>, "x-github-event") ??
      getHeader(req.headers as Record<string, unknown>, "x-gitea-event") ??
      getHeader(req.headers as Record<string, unknown>, "x-gitlab-event");

    const push = parsePushEvent({
      provider: providerParam,
      eventName,
      payload: (req.body ?? {}) as WebhookPayload,
    });

    // Answer 200 for events we deliberately skip; a 4xx would show up as a
    // failed delivery in the provider UI and invite pointless retries.
    if (push.ignored) {
      return reply.send({ success: true, ignored: true, reason: push.ignored });
    }

    // A branch push needs autoDeployOnPush; a tag push is gated by
    // autoDeployTagPattern instead, so neither flag can be filtered in SQL.
    const candidates = await prisma.containerDeploymentSource.findMany({
      where: {
        repoUrl: { not: null },
        container: { server: { organizationId: gitProvider.organizationId } },
        ...(push.tag
          ? { autoDeployTagPattern: { not: null } }
          : { autoDeployOnPush: true }),
      },
      select: {
        repoUrl: true,
        repoBranch: true,
        repoTag: true,
        autoDeployOnPush: true,
        autoDeployTagPattern: true,
        container: { select: { id: true, name: true, serverId: true } },
      },
    });

    const matched = candidates
      .map((candidate) => ({
        candidate,
        decision: resolveWebhookDeployRef(candidate, push),
      }))
      .filter((entry) => entry.decision.deploy);

    if (!matched.length) {
      return reply.send({
        success: true,
        matched: 0,
        ref: push.tag || push.branch,
        refKind: push.tag ? "tag" : "branch",
      });
    }

    // The injected rebuild re-enters the authenticated route, so a provider owner
    // who cannot write containers would fail deep inside the job with an opaque
    // 403. Check it up front and record the failure where the user will see it.
    const owner = gitProvider.user;
    if (!owner?.isActive || owner.role === "VIEWER") {
      const error = !owner?.isActive
        ? "Auto deploy skipped: the git provider owner account is inactive"
        : "Auto deploy skipped: the git provider owner has read-only (viewer) access";

      await Promise.all(
        matched.map((entry) =>
          createDeployment({
            containerId: entry.candidate.container.id,
            organizationId: gitProvider.organizationId,
            serverId: entry.candidate.container.serverId,
            userId: gitProvider.userId,
            status: "FAILED",
            trigger: "GIT_WEBHOOK",
            version: entry.decision.ref || push.branch || null,
            branch: push.branch || null,
            commitSha: push.commitSha,
            configSnapshot: {},
            error,
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        ),
      );

      return reply.status(202).send({
        success: false,
        matched: matched.length,
        dispatched: 0,
        error,
      });
    }

    const token = app.jwt.sign({ sub: gitProvider.userId, role: owner.role });
    const jobs: string[] = [];

    for (const entry of matched) {
      const { candidate, decision } = entry;
      const job = await createProcessJob({
        type: "container_webhook_deploy",
        userId: gitProvider.userId,
        organizationId: gitProvider.organizationId,
      });

      runInjectedContainerJob({
        app,
        job,
        method: "POST",
        url: `/api/v1/containers/${candidate.container.id}/rebuild`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-organization-id": gitProvider.organizationId,
        },
        // ref is only set for a tag push, where the pushed tag is the version to
        // build. The rebuild route revalidates it before it reaches git.
        payload: {
          trigger: "GIT_WEBHOOK",
          ...(decision.ref ? { ref: decision.ref } : {}),
        },
        redactSecret: token,
      });

      jobs.push(job.id);

      const refLabel = push.tag ? `tag ${push.tag}` : `branch ${push.branch}`;
      await auditLog({
        userId: gitProvider.userId,
        serverId: candidate.container.serverId,
        action: "CONTAINER_AUTO_DEPLOY",
        category: "CONTAINER",
        level: "INFO",
        message: `Push to ${refLabel} triggered auto deploy of "${candidate.container.name}"`,
      });
    }

    return reply.status(202).send({
      success: true,
      matched: matched.length,
      dispatched: jobs.length,
      ref: push.tag || push.branch,
      refKind: push.tag ? "tag" : "branch",
      commitSha: push.commitSha,
      jobIds: jobs,
    });
  });
}
