import prisma from "../lib/prisma";
import { decrypt } from "../lib/crypto";
import { auditLog } from "./audit.service";
import {
  createDeployment,
  getRollbackSnapshot,
  updateDeployment,
  type DeploymentSnapshot,
} from "./deployment.service";
import * as ssh from "./ssh.service";
import { waitForDockerHealth } from "./container-health.service";
import { resolveDeploymentStrategy } from "./deployment-strategy";
import { isValidCommitSha } from "./git-ref";
import { readStoredComposeEnvOverrides } from "./compose-env.service";
import { readStoredComposeServiceOverrides } from "./compose-override.service";
import {
  type ContainerResourceLimits,
  EMPTY_RESOURCE_LIMITS,
  resolveLimitsForRebuild,
  normalizeResourceLimits,
  resourceLimitsFromDocker,
} from "./container-resources";
import {
  acquireDeploymentLock,
  releaseDeploymentLock,
  startDeploymentLockHeartbeat,
} from "./deployment-lock.service";
import { sanitizeDeploymentError } from "./deployment-error.service";
import {
  formatDockerInspectMountBindings,
  type DockerInspectMount,
} from "./docker-inspect-format";

type RollbackRuntime = {
  image: string;
  ports: string;
  env: string;
  volumes: string;
  network: string;
  restartPolicy: string;
  entrypoint?: string;
  commandArgs?: string[];
  command: string;
  /** Carried across a rollback so the replacement keeps the same limits. */
  resources: ContainerResourceLimits;
};

type DockerInspectRuntime = {
  Config?: {
    Image?: string;
    Env?: string[];
    Entrypoint?: string[] | string | null;
    Cmd?: string[] | null;
  };
  HostConfig?: {
    RestartPolicy?: { Name?: string | null };
    PortBindings?: Record<
      string,
      Array<{ HostPort?: string }> | null
    >;
    NetworkMode?: string | null;
    /** Docker reports an unset limit as 0 for each of these. */
    CpuShares?: number;
    NanoCpus?: number;
    Memory?: number;
  };
  Mounts?: DockerInspectMount[];
};

type DockerPortBindings = NonNullable<
  NonNullable<DockerInspectRuntime["HostConfig"]>["PortBindings"]
>;

type RollbackServer = Parameters<typeof ssh.runContainer>[0];

type RollbackRuntimeDependencies = {
  runContainer: typeof ssh.runContainer;
  stopAndRemoveContainer: typeof stopAndRemoveContainer;
  dockerRename: typeof ssh.dockerRename;
  waitForDockerHealth: typeof waitForDockerHealth;
};

const rollbackRuntimeDependencies: RollbackRuntimeDependencies = {
  runContainer: ssh.runContainer,
  stopAndRemoveContainer,
  dockerRename: ssh.dockerRename,
  waitForDockerHealth,
};

function snapshotString(snapshot: DeploymentSnapshot, key: string, fallback = "") {
  const value = snapshot[key];
  return typeof value === "string" ? value : fallback;
}

export function normalizeRollbackPortMappings(value: unknown) {
  const entries = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = new Map<string, string>();

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    if (!entry.includes("->")) {
      normalized.set(entry, entry);
      continue;
    }

    const [publishedRaw, containerRaw] = entry.split("->", 2);
    const published = publishedRaw?.trim();
    const containerSpec = containerRaw?.trim();
    if (!published || !containerSpec) continue;

    const [containerPort, protocol = "tcp"] = containerSpec.split("/");
    const hostPort = published.match(/(?:^|:)(\d+)$/)?.[1];
    if (!hostPort || !/^\d+$/.test(containerPort ?? "")) continue;

    const hostIpMatch = published.match(
      /^((?:\d{1,3}\.){3}\d{1,3}):\d+$/,
    );
    const hostIp =
      hostIpMatch?.[1] && hostIpMatch[1] !== "0.0.0.0"
        ? `${hostIpMatch[1]}:`
        : "";
    const mapping = `${hostIp}${hostPort}:${containerPort}${
      protocol !== "tcp" ? `/${protocol}` : ""
    }`;
    normalized.set(`${hostPort}:${containerPort}/${protocol}`, mapping);
  }

  return [...normalized.values()].join(",");
}

function storedList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatPortBindings(bindings?: DockerPortBindings) {
  if (!bindings) return "";

  return Object.entries(bindings)
    .flatMap(([containerPortSpec, hostBindings]) => {
      if (!hostBindings?.length) return [];
      const [containerPort, protocol = "tcp"] = containerPortSpec.split("/");
      return hostBindings.flatMap((binding) => {
        const hostPort = binding.HostPort?.trim();
        if (!hostPort) return [];
        return `${hostPort}:${containerPort}${protocol !== "tcp" ? `/${protocol}` : ""}`;
      });
    })
    .join(",");
}

function formatEntrypoint(value?: string[] | string | null) {
  if (typeof value === "string") return value.trim() || undefined;
  return value?.[0]?.trim() || undefined;
}

function snapshotRuntime(
  snapshot: DeploymentSnapshot,
  fallbackImage?: string | null,
): RollbackRuntime {
  const image = (snapshotString(snapshot, "image") || fallbackImage || "").trim();
  if (!image) throw new Error("Rollback artifact does not contain an image");

  return {
    image,
    ports: normalizeRollbackPortMappings(snapshot.ports),
    env: snapshotString(snapshot, "env"),
    volumes: snapshotString(snapshot, "volumes"),
    network: snapshotString(snapshot, "network", "bridge"),
    restartPolicy: snapshotString(snapshot, "restartPolicy", "unless-stopped"),
    entrypoint: snapshotString(snapshot, "entrypoint") || undefined,
    commandArgs: storedList(snapshot.commandArgs),
    command: snapshotString(snapshot, "command"),
    // Rolling back to a deployment restores the limits that deployment ran
    // with. A snapshot written before limits existed simply has none.
    resources: snapshotResourceLimits(snapshot),
  };
}

function snapshotResourceLimits(
  snapshot: DeploymentSnapshot,
): ContainerResourceLimits {
  try {
    return normalizeResourceLimits({
      cpuShares: snapshot.cpuShares,
      cpuCores: snapshot.cpuCores,
      memory: snapshot.memoryLimit,
    });
  } catch {
    // A snapshot holding a value Docker would reject must not block the
    // rollback; the replacement simply runs without that limit.
    return EMPTY_RESOURCE_LIMITS;
  }
}

type RollbackImageDependencies = {
  dockerInspect: typeof ssh.dockerInspect;
  dockerPullImage: typeof ssh.dockerPullImage;
};

const rollbackImageDependencies: RollbackImageDependencies = {
  dockerInspect: ssh.dockerInspect,
  dockerPullImage: ssh.dockerPullImage,
};

async function pullOrUseLocalImage(
  server: RollbackServer,
  image: string,
  dependencies: RollbackImageDependencies,
) {
  try {
    await dependencies.dockerPullImage(server, image);
    return image;
  } catch (pullError) {
    try {
      await dependencies.dockerInspect(server, image);
      return image;
    } catch {
      throw pullError;
    }
  }
}

/**
 * The exact image this deployment ran no longer exists on the server, so
 * there is no way to reproduce that build by reference alone.
 *
 * This used to be handled by silently falling back to the deployment's
 * stored image name. For a container built with a fixed, reused tag (every
 * deploy produces `myapp:latest`, not a distinct tag per build) that name
 * points at whatever the newest build happens to be — so the "rollback"
 * launched the current build under a different deployment id and reported
 * success. Raising this instead lets the caller either rebuild the exact
 * commit from source or fail honestly.
 */
export class RollbackImageUnavailableError extends Error {
  constructor(readonly attemptedReference: string) {
    super(
      `The image for this deployment (${attemptedReference}) is no longer available on the server`,
    );
    this.name = "RollbackImageUnavailableError";
  }
}

export async function resolveRollbackImageReference(
  input: {
    server: RollbackServer;
    image: string;
    imageDigest?: string | null;
  },
  dependencies: RollbackImageDependencies = rollbackImageDependencies,
) {
  const image = input.image.trim();
  const digest = input.imageDigest?.trim() ?? "";

  // Existing records store Docker's local image ID (`sha256:...`) in
  // imageDigest. It is not a registry manifest digest and must never be
  // appended to an image name as `image@sha256:...`.
  if (/^sha256:[a-f0-9]{64}$/i.test(digest)) {
    try {
      await dependencies.dockerInspect(input.server, digest);
      return digest;
    } catch {
      // The exact artifact is gone. The stored image name is not an
      // equivalent fallback when it is a mutable tag shared across every
      // build of this container, so this must not be treated as recoverable
      // here — the caller decides whether a rebuild is possible.
      throw new RollbackImageUnavailableError(digest);
    }
  }

  if (digest.includes("@sha256:")) {
    try {
      return await pullOrUseLocalImage(input.server, digest, dependencies);
    } catch {
      throw new RollbackImageUnavailableError(digest);
    }
  }

  // No digest was ever recorded for this deployment (older records, or a
  // manually-deployed container where the image reference itself — e.g.
  // "nginx:1.25" — is the meaningful, non-drifting identity). The image name
  // is the best information available and was the pre-existing behavior for
  // this case, so it is kept.
  return pullOrUseLocalImage(input.server, image, dependencies);
}

async function resolvePreviousRuntime(input: {
  container: {
    name: string;
    dockerId: string | null;
    image: string;
    ports: unknown;
    envVars: unknown;
    volumes: unknown;
    restartPolicy: string;
    cpuShares: number | null;
    cpuCores: string | null;
    memoryLimit: string | null;
    resourceLimitsManaged: boolean;
    server: RollbackServer;
  };
}): Promise<RollbackRuntime> {
  const storedLimits: ContainerResourceLimits = {
    cpuShares: input.container.cpuShares,
    cpuCores: input.container.cpuCores,
    memory: input.container.memoryLimit,
  };

  try {
    const inspect = (await ssh.dockerInspect(
      input.container.server,
      input.container.dockerId || input.container.name,
    )) as DockerInspectRuntime;

    return {
      image: inspect.Config?.Image?.trim() || input.container.image,
      ports: formatPortBindings(inspect.HostConfig?.PortBindings),
      env: (inspect.Config?.Env ?? []).filter(Boolean).join("\n"),
      volumes: formatDockerInspectMountBindings(inspect.Mounts),
      network: inspect.HostConfig?.NetworkMode?.trim() || "bridge",
      restartPolicy:
        inspect.HostConfig?.RestartPolicy?.Name?.trim() ||
        input.container.restartPolicy ||
        "unless-stopped",
      entrypoint: formatEntrypoint(inspect.Config?.Entrypoint),
      commandArgs: inspect.Config?.Cmd?.filter(
        (argument): argument is string => typeof argument === "string",
      ),
      command: "",
      resources: resolveLimitsForRebuild(
        storedLimits,
        resourceLimitsFromDocker({
          cpuShares: inspect.HostConfig?.CpuShares,
          nanoCpus: inspect.HostConfig?.NanoCpus,
          memoryBytes: inspect.HostConfig?.Memory,
        }),
        input.container.resourceLimitsManaged,
      ),
    };
  } catch {
    return {
      image: input.container.image,
      ports: storedList(input.container.ports).join(","),
      env: storedList(input.container.envVars).join("\n"),
      volumes: storedList(input.container.volumes).join(","),
      network: "bridge",
      restartPolicy: input.container.restartPolicy || "unless-stopped",
      command: "",
      resources: storedLimits,
    };
  }
}

async function stopAndRemoveContainer(
  server: Parameters<typeof ssh.dockerAction>[0],
  candidates: string[],
) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await ssh.dockerAction(server, candidate, "stop");
    } catch {
      // The runtime may already be stopped; removal below is still attempted.
    }

    try {
      await ssh.dockerAction(server, candidate, "rm");
      return;
    } catch (error) {
      if (!/not found|no such container/i.test(String(error))) throw error;
    }
  }
}

async function waitForRuntimeHealth(input: {
  server: RollbackServer;
  containerRef: string;
  runtime: RollbackRuntime;
  label: string;
  dependencies: RollbackRuntimeDependencies;
}) {
  const health = await input.dependencies.waitForDockerHealth({
    server: input.server,
    containerRef: input.containerRef,
  });
  if (!health.healthy) {
    throw new Error(`${input.label} runtime check failed: ${health.reason}`);
  }
}

function validateRuntimeBeforeMutation(input: {
  name: string;
  runtime: RollbackRuntime;
  ports: string;
}) {
  ssh.buildDockerRunCommand({
    name: input.name,
    image: input.runtime.image,
    ports: input.ports,
    env: input.runtime.env,
    volumes: input.runtime.volumes,
    network: input.runtime.network,
    restartPolicy: input.runtime.restartPolicy,
    entrypoint: input.runtime.entrypoint,
    commandArgs: input.runtime.commandArgs,
    command: input.runtime.command,
    resources: input.runtime.resources,
  });
}

export class RollbackRuntimeError extends Error {
  constructor(
    message: string,
    readonly recoveryDockerId: string | null,
    readonly recoveryMode: "UNCHANGED" | "RECREATED" | "FAILED",
    readonly recoveryError: string | null = null,
  ) {
    super(
      recoveryError
        ? `${message} Previous runtime recovery failed: ${recoveryError}`
        : message,
    );
    this.name = "RollbackRuntimeError";
  }
}

export async function replaceRuntimeForRollback<TResult = undefined>(
  input: {
    server: RollbackServer;
    containerName: string;
    currentContainerRefs: string[];
    temporaryName: string;
    strategy: ReturnType<typeof resolveDeploymentStrategy>;
    targetRuntime: RollbackRuntime;
    previousRuntime: RollbackRuntime;
    finalize?: (result: {
      dockerId: string;
      runtimeRef: string;
    }) => Promise<TResult>;
  },
  dependencies: RollbackRuntimeDependencies = rollbackRuntimeDependencies,
) {
  const targetName =
    input.strategy === "ATOMIC_RENAME"
      ? input.temporaryName
      : input.containerName;
  const targetPorts =
    input.strategy === "ATOMIC_RENAME" ? "" : input.targetRuntime.ports;

  // Both the target and recovery commands must be valid before the active
  // runtime is touched. This prevents a deterministic validation error from
  // causing avoidable downtime.
  validateRuntimeBeforeMutation({
    name: targetName,
    runtime: input.targetRuntime,
    ports: targetPorts,
  });
  validateRuntimeBeforeMutation({
    name: input.containerName,
    runtime: input.previousRuntime,
    ports: input.previousRuntime.ports,
  });

  let previousRuntimeTouched = false;
  let candidateRef: string | null = null;

  try {
    if (input.strategy === "RECREATE_WITH_RECOVERY") {
      previousRuntimeTouched = true;
      await dependencies.stopAndRemoveContainer(
        input.server,
        input.currentContainerRefs,
      );
    }

    const dockerId = await dependencies.runContainer(input.server, {
      name: targetName,
      image: input.targetRuntime.image,
      ports: targetPorts,
      env: input.targetRuntime.env,
      volumes: input.targetRuntime.volumes,
      network: input.targetRuntime.network,
      restartPolicy: input.targetRuntime.restartPolicy,
      entrypoint: input.targetRuntime.entrypoint,
      commandArgs: input.targetRuntime.commandArgs,
      command: input.targetRuntime.command,
      resources: input.targetRuntime.resources,
    });
    candidateRef = dockerId.trim() || targetName;

    await waitForRuntimeHealth({
      server: input.server,
      containerRef: candidateRef,
      runtime: input.targetRuntime,
      label: "Rollback",
      dependencies,
    });

    if (input.strategy === "ATOMIC_RENAME") {
      previousRuntimeTouched = true;
      await dependencies.stopAndRemoveContainer(
        input.server,
        input.currentContainerRefs,
      );
      await dependencies.dockerRename(
        input.server,
        input.temporaryName,
        input.containerName,
      );
    }

    const result = input.finalize
      ? await input.finalize({
          dockerId: dockerId.trim(),
          runtimeRef: candidateRef,
        })
      : (undefined as TResult);

    return { dockerId: dockerId.trim(), runtimeRef: candidateRef, result };
  } catch (error) {
    const message = sanitizeDeploymentError(error, {
      fallback: "Rollback runtime replacement failed",
    });

    if (!previousRuntimeTouched) {
      try {
        await dependencies.stopAndRemoveContainer(input.server, [
          candidateRef ?? "",
          input.temporaryName,
        ]);
        const previousRef =
          input.currentContainerRefs.find((value) => value.trim()) ??
          input.containerName;
        await waitForRuntimeHealth({
          server: input.server,
          containerRef: previousRef,
          runtime: input.previousRuntime,
          label: "Previous runtime",
          dependencies,
        });
        throw new RollbackRuntimeError(message, previousRef, "UNCHANGED");
      } catch (recoveryError) {
        if (recoveryError instanceof RollbackRuntimeError) throw recoveryError;
        throw new RollbackRuntimeError(
          message,
          null,
          "FAILED",
          recoveryError instanceof Error
            ? sanitizeDeploymentError(recoveryError, {
                fallback: "Previous runtime recovery failed",
              })
            : "Previous runtime recovery failed",
        );
      }
    }

    try {
      await dependencies.stopAndRemoveContainer(input.server, [
        candidateRef ?? "",
        input.temporaryName,
        input.containerName,
      ]);
      const recoveryDockerId = await dependencies.runContainer(input.server, {
        name: input.containerName,
        image: input.previousRuntime.image,
        ports: input.previousRuntime.ports,
        env: input.previousRuntime.env,
        volumes: input.previousRuntime.volumes,
        network: input.previousRuntime.network,
        restartPolicy: input.previousRuntime.restartPolicy,
        entrypoint: input.previousRuntime.entrypoint,
        commandArgs: input.previousRuntime.commandArgs,
        command: input.previousRuntime.command,
        resources: input.previousRuntime.resources,
      });
      const recoveryRef = recoveryDockerId.trim() || input.containerName;
      await waitForRuntimeHealth({
        server: input.server,
        containerRef: recoveryRef,
        runtime: input.previousRuntime,
        label: "Previous runtime",
        dependencies,
      });
      throw new RollbackRuntimeError(
        message,
        recoveryDockerId.trim(),
        "RECREATED",
      );
    } catch (recoveryError) {
      if (recoveryError instanceof RollbackRuntimeError) throw recoveryError;
      throw new RollbackRuntimeError(
        message,
        null,
        "FAILED",
        recoveryError instanceof Error
          ? sanitizeDeploymentError(recoveryError, {
              fallback: "Previous runtime recovery failed",
            })
          : "Previous runtime recovery failed",
      );
    }
  }
}

/**
 * When the exact historical image is gone, rebuild it from the source commit
 * instead of giving up outright — the content is reproducible even though the
 * old build artifact is not.
 *
 * Deliberately scoped to plain Dockerfile git deployments: that is the build
 * type this was found to actually break under (a mutable `:latest`-style tag
 * reused every build, on a Docker install whose containerd image store
 * garbage-collects the superseded, now-untagged image almost immediately).
 * Compose/Nixpacks/buildpacks share the same tag-reuse pattern and would
 * benefit from the same recovery, but extending it there means threading a
 * skip-run mode through builds this fix has not exercised — better done as
 * its own change once needed than guessed at here.
 */
type RebuildFromCommitDependencies = {
  deployContainerFromGitSource: typeof ssh.deployContainerFromGitSource;
};

const rebuildFromCommitDependencies: RebuildFromCommitDependencies = {
  deployContainerFromGitSource: ssh.deployContainerFromGitSource,
};

export async function rebuildImageFromCommitForRollback(
  input: {
    server: RollbackServer;
    container: {
      id: string;
      name: string;
      deploymentSource: {
        repoUrl: string | null;
        accessTokenEnc: string | null;
        buildType: string | null;
        buildPath: string | null;
        dockerfilePath: string | null;
        dockerContextPath: string | null;
        projectName: string | null;
      } | null;
    };
    commitSha: unknown;
    unavailableImage: string;
  },
  dependencies: RebuildFromCommitDependencies = rebuildFromCommitDependencies,
): Promise<{ image: string; commitSha: string }> {
  const source = input.container.deploymentSource;
  const commitSha = typeof input.commitSha === "string" ? input.commitSha.trim() : "";

  const cannotRecover = (reason: string) => {
    throw new Error(
      `The image for this deployment (${input.unavailableImage}) is no longer available on the server, and it cannot be rebuilt automatically: ${reason}.`,
    );
  };

  if (!source?.repoUrl) {
    return cannotRecover(
      "this container has no git source to rebuild from",
    );
  }
  if (source.buildType !== "DOCKERFILE") {
    return cannotRecover(
      `automatic rebuild is only supported for Dockerfile git deployments, not ${source.buildType ?? "this build type"}`,
    );
  }
  if (!isValidCommitSha(commitSha)) {
    return cannotRecover(
      "this deployment does not have a usable commit recorded to rebuild from",
    );
  }

  const accessToken = source.accessTokenEnc ? decrypt(source.accessTokenEnc) : undefined;
  const projectName = source.projectName?.trim() || input.container.name;
  const rollbackImageTag = `doktainer/${projectName}:rollback-${commitSha.slice(0, 12)}`
    .toLowerCase()
    .replace(/[^a-z0-9/:._-]/g, "-");

  const result = await dependencies.deployContainerFromGitSource(input.server, {
    projectName,
    repoUrl: source.repoUrl,
    accessToken,
    buildType: "DOCKERFILE",
    buildPath: source.buildPath ?? undefined,
    dockerfilePath: source.dockerfilePath ?? undefined,
    dockerContextPath: source.dockerContextPath ?? undefined,
    pinnedCommitSha: commitSha,
    imageTag: rollbackImageTag,
    skipRun: true,
  });

  if (!result.imageTag) {
    return cannotRecover("the rebuild did not produce a usable image");
  }

  return { image: result.imageTag, commitSha: result.commitSha };
}

/**
 * The container plus the deployment-source fields both rollback paths need.
 * Extracted so the compose path and the image path agree on the shape without
 * one silently missing a field the other selects.
 */
async function loadRollbackContainer(input: {
  containerId: string;
  organizationId: string;
}) {
  return prisma.container.findFirstOrThrow({
    where: {
      id: input.containerId,
      server: { organizationId: input.organizationId },
    },
    include: {
      server: true,
      deploymentSource: {
        select: {
          repoUrl: true,
          accessTokenEnc: true,
          buildType: true,
          buildPath: true,
          dockerfilePath: true,
          dockerContextPath: true,
          projectName: true,
          composeFilePath: true,
          deploymentPath: true,
          composeEnvOverrides: true,
          composeEnvOverridesEnc: true,
        },
      },
    },
  });
}

/**
 * Roll a compose deployment back by redeploying the whole stack at the
 * recorded commit.
 *
 * The image-swap path below cannot serve a compose stack: it stops one
 * container by name and starts a replacement with `docker run`, which for a
 * multi-service stack removes a single member and reintroduces it outside
 * compose's control, leaving the rest running against a container compose no
 * longer manages. `docker compose up -d --build` at the target commit
 * recreates every service together, which is what rolling a stack back means.
 *
 * There is no image to reuse here, so this always rebuilds — the compose file
 * at that commit defines the whole stack, and reconstructing it from source is
 * the only faithful way back.
 */
async function rollbackComposeStack(input: {
  server: RollbackServer;
  container: {
    id: string;
    name: string;
    deploymentSource: {
      repoUrl: string | null;
      accessTokenEnc: string | null;
      buildPath: string | null;
      composeFilePath: string | null;
      deploymentPath: string | null;
      projectName: string | null;
      composeEnvOverrides?: unknown;
      composeEnvOverridesEnc?: string | null;
      composeServiceOverrides?: unknown;
    } | null;
  };
  commitSha: unknown;
}): Promise<{ commitSha: string }> {
  const source = input.container.deploymentSource;
  const commitSha =
    typeof input.commitSha === "string" ? input.commitSha.trim() : "";

  if (!source?.repoUrl) {
    throw new Error(
      "This compose container has no git source, so there is nothing to roll back to",
    );
  }
  if (!isValidCommitSha(commitSha)) {
    throw new Error(
      "This deployment has no commit recorded, so the compose stack cannot be rebuilt at that point",
    );
  }

  const result = await ssh.deployContainerFromGitSource(input.server, {
    projectName: source.projectName?.trim() || input.container.name,
    repoUrl: source.repoUrl,
    accessToken: source.accessTokenEnc
      ? decrypt(source.accessTokenEnc)
      : undefined,
    buildType: "COMPOSE",
    buildPath: source.buildPath ?? undefined,
    composeFilePath: source.composeFilePath ?? undefined,
    composeEnvFiles: readStoredComposeEnvOverrides(source),
    composeServiceOverrides: readStoredComposeServiceOverrides(source),
    deploymentPath: source.deploymentPath ?? undefined,
    containerName: input.container.name,
    pinnedCommitSha: commitSha,
  });

  return { commitSha: result.commitSha };
}

/**
 * Orchestration around rollbackComposeStack: same lock, same deployment
 * record, same audit trail as the single-container path, so a compose
 * rollback appears in history exactly like any other.
 *
 * There is deliberately no recovery branch. `docker compose up -d` either
 * converges the stack or leaves the previous containers in place; there is no
 * half-applied state to undo the way there is when a container has been
 * removed to free its name and host port.
 */
async function rollbackComposeStackToDeployment(input: {
  container: Awaited<ReturnType<typeof loadRollbackContainer>>;
  target: NonNullable<Awaited<ReturnType<typeof getRollbackSnapshot>>>;
  organizationId: string;
  userId?: string;
}) {
  const { container, target } = input;
  const lock = await acquireDeploymentLock({ containerId: container.id });
  const lockHeartbeat = startDeploymentLockHeartbeat({
    containerId: container.id,
    token: lock.token,
  });

  const rollback = await createDeployment({
    containerId: container.id,
    organizationId: input.organizationId,
    serverId: container.serverId,
    userId: input.userId,
    status: "RUNNING",
    trigger: "ROLLBACK",
    version: target.version ?? null,
    configSnapshot: { ...target.snapshot, deploymentStrategy: "COMPOSE_UP" },
    startedAt: new Date(),
  }).catch(async (error) => {
    lockHeartbeat.stop();
    await releaseDeploymentLock({ containerId: container.id, token: lock.token });
    throw error;
  });

  try {
    const result = await rollbackComposeStack({
      server: container.server,
      container,
      commitSha: target.snapshot.commitSha,
    });

    lockHeartbeat.assertOwned();

    const updated = await prisma.container.update({
      where: { id: container.id },
      data: { status: "RUNNING" },
      include: { server: { select: { name: true, ip: true } } },
    });

    await updateDeployment(rollback.id, {
      status: "SUCCESS",
      completedAt: new Date(),
      commitSha: result.commitSha,
    });

    await auditLog({
      userId: input.userId,
      organizationId: input.organizationId,
      serverId: container.serverId,
      action: "CONTAINER_ROLLBACK",
      category: "CONTAINER",
      level: "SUCCESS",
      message: `Compose stack "${container.name}" rolled back to deployment ${target.id}`,
      meta: {
        deploymentId: rollback.id,
        targetDeploymentId: target.id,
        commitSha: result.commitSha,
      },
    });

    return {
      updated,
      deploymentId: rollback.id,
      targetDeploymentId: target.id,
    };
  } catch (error) {
    const message = sanitizeDeploymentError(error, {
      fallback: "Compose rollback failed",
    });

    await updateDeployment(rollback.id, {
      status: "FAILED",
      error: message,
      completedAt: new Date(),
    }).catch(() => undefined);

    await auditLog({
      userId: input.userId,
      organizationId: input.organizationId,
      serverId: container.serverId,
      action: "CONTAINER_ROLLBACK",
      category: "CONTAINER",
      level: "ERROR",
      message: `Compose rollback failed for "${container.name}": ${message}`,
      meta: { deploymentId: rollback.id, targetDeploymentId: target.id },
    }).catch(() => undefined);

    throw new Error(message);
  } finally {
    lockHeartbeat.stop();
    await releaseDeploymentLock({ containerId: container.id, token: lock.token });
  }
}

export async function rollbackContainerToDeployment(input: {
  containerId: string;
  deploymentId: string;
  organizationId: string;
  userId?: string;
}) {
  const container = await loadRollbackContainer({
    containerId: input.containerId,
    organizationId: input.organizationId,
  }).catch(() => null);
  if (!container) throw new Error("Container not found");

  const target = await getRollbackSnapshot(input);
  if (!target) {
    throw new Error("Only a successful deployment in this container can be rolled back");
  }
  if (target.serverId !== container.serverId) {
    throw new Error("Rollback target belongs to a different server");
  }

  const runningDeployment = await prisma.deployment.findFirst({
    where: {
      containerId: container.id,
      organizationId: input.organizationId,
      status: "RUNNING",
    },
    select: { id: true },
  });
  if (runningDeployment) {
    throw new Error("Another deployment operation is already running for this container");
  }

  // A compose stack is rolled back as a stack, not by swapping one image, so
  // it takes a separate path before any single-container runtime is resolved.
  const isComposeStack =
    container.deploymentSource?.buildType === "COMPOSE";

  if (isComposeStack) {
    return rollbackComposeStackToDeployment({
      container,
      target,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  const runtime = snapshotRuntime(target.snapshot, target.image);
  const strategy = resolveDeploymentStrategy(runtime.ports);
  const lock = await acquireDeploymentLock({ containerId: container.id });
  const lockHeartbeat = startDeploymentLockHeartbeat({
    containerId: container.id,
    token: lock.token,
  });
  const rollback = await createDeployment({
    containerId: container.id,
    organizationId: input.organizationId,
    serverId: container.serverId,
    userId: input.userId,
    status: "RUNNING",
    trigger: "ROLLBACK",
    version: target.version ?? runtime.image,
    image: runtime.image,
    imageDigest: target.imageDigest,
    configSnapshot: { ...target.snapshot, deploymentStrategy: strategy },
    startedAt: new Date(),
  }).catch(async (error) => {
    lockHeartbeat.stop();
    await releaseDeploymentLock({ containerId: container.id, token: lock.token });
    throw error;
  });

  const previousRuntime = await resolvePreviousRuntime({
    container,
  });

  try {
    let image: string;
    let rebuiltFromCommit: string | null = null;

    try {
      image = await resolveRollbackImageReference({
        server: container.server,
        image: runtime.image,
        imageDigest: target.imageDigest,
      });
    } catch (error) {
      if (!(error instanceof RollbackImageUnavailableError)) throw error;

      const rebuilt = await rebuildImageFromCommitForRollback({
        server: container.server,
        container,
        commitSha: target.snapshot.commitSha,
        unavailableImage: error.attemptedReference,
      });
      image = rebuilt.image;
      rebuiltFromCommit = rebuilt.commitSha;

      await auditLog({
        userId: input.userId,
        organizationId: input.organizationId,
        serverId: container.serverId,
        action: "CONTAINER_ROLLBACK_REBUILT",
        category: "CONTAINER",
        level: "INFO",
        message: `Container "${container.name}" rollback target image was gone; rebuilt from commit ${rebuilt.commitSha.slice(0, 12)} instead`,
        meta: {
          deploymentId: rollback.id,
          targetDeploymentId: target.id,
          commitSha: rebuilt.commitSha,
        },
      });
    }
    runtime.image = image;

    const atomicName = `${container.name}-rollback-${rollback.id.slice(-8)}`.slice(0, 128);
    const replacement = await replaceRuntimeForRollback({
      server: container.server,
      containerName: container.name,
      currentContainerRefs: [container.dockerId ?? "", container.name],
      temporaryName: atomicName,
      strategy,
      targetRuntime: runtime,
      previousRuntime,
      finalize: async ({ dockerId }) => {
        lockHeartbeat.assertOwned();

        // target.imageDigest points at the artifact that was just proven
        // gone when a rebuild happened; recording it again on this new
        // deployment would repeat the exact same trap for a future rollback
        // targeting this one. Capture what the rebuilt image actually is.
        let imageDigest = target.imageDigest;
        if (rebuiltFromCommit) {
          try {
            const inspect = (await ssh.dockerInspect(
              container.server,
              dockerId || container.name,
            )) as { Image?: string };
            imageDigest =
              typeof inspect.Image === "string" && inspect.Image.trim()
                ? inspect.Image.trim()
                : null;
          } catch {
            imageDigest = null;
          }
        }

        const updated = await prisma.container.update({
          where: { id: container.id },
          data: {
            image,
            status: "RUNNING",
            dockerId: dockerId.trim().slice(0, 12) || null,
          },
          include: { server: { select: { name: true, ip: true } } },
        });

        await updateDeployment(rollback.id, {
          status: "SUCCESS",
          completedAt: new Date(),
          image,
          imageDigest,
          ...(rebuiltFromCommit ? { commitSha: rebuiltFromCommit } : {}),
        });
        await auditLog({
          userId: input.userId,
          organizationId: input.organizationId,
          serverId: container.serverId,
          action: "CONTAINER_ROLLBACK",
          category: "CONTAINER",
          level: "SUCCESS",
          message: `Container "${container.name}" rolled back to deployment ${target.id}`,
          meta: { deploymentId: rollback.id, targetDeploymentId: target.id, image },
        });

        return updated;
      },
    });

    return {
      updated: replacement.result,
      deploymentId: rollback.id,
      targetDeploymentId: target.id,
    };
  } catch (error) {
    const message = sanitizeDeploymentError(error, {
      fallback: "Rollback failed",
    });
    const runtimeError =
      error instanceof RollbackRuntimeError ? error : null;
    if (runtimeError?.recoveryMode !== "FAILED") {
      await prisma.container.update({
        where: { id: container.id },
        data: {
          status: "RUNNING",
          image: previousRuntime.image,
          dockerId:
            runtimeError?.recoveryDockerId?.trim().slice(0, 12) ||
            container.dockerId,
        },
      });
      await auditLog({
        userId: input.userId,
        organizationId: input.organizationId,
        serverId: container.serverId,
        action: "CONTAINER_ROLLBACK_RECOVERY",
        category: "CONTAINER",
        level: "WARNING",
        message: `Previous runtime for container "${container.name}" was recovered after rollback failure`,
        meta: {
          deploymentId: rollback.id,
          recovery:
            runtimeError?.recoveryMode === "UNCHANGED"
              ? "UNCHANGED_HEALTHY"
              : "RECREATED_HEALTHY",
        },
      });
    } else {
      await prisma.container.update({
        where: { id: container.id },
        data: { status: "ERROR" },
      });
      await auditLog({
        userId: input.userId,
        organizationId: input.organizationId,
        serverId: container.serverId,
        action: "CONTAINER_ROLLBACK_RECOVERY",
        category: "CONTAINER",
        level: "ERROR",
        message: `Previous runtime recovery failed for container "${container.name}"`,
        meta: { deploymentId: rollback.id, recovery: "FAILED" },
      }).catch(() => undefined);
    }

    await updateDeployment(rollback.id, {
      status: "FAILED",
      error: message,
      completedAt: new Date(),
    }).catch(() => undefined);
    throw new Error(message);
  } finally {
    lockHeartbeat.stop();
    await releaseDeploymentLock({ containerId: container.id, token: lock.token });
  }
}

