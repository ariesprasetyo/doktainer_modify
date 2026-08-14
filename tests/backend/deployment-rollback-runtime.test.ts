import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRollbackPortMappings,
  replaceRuntimeForRollback,
  resolveRollbackImageReference,
  RollbackImageUnavailableError,
  RollbackRuntimeError,
} from "../../src/server/services/deployment-rollback.service";

type RollbackInput = Parameters<typeof replaceRuntimeForRollback>[0];
type RollbackDependencies = NonNullable<
  Parameters<typeof replaceRuntimeForRollback>[1]
>;

const server = {} as RollbackInput["server"];

test("normalizes Docker display port mappings for rollback", () => {
  assert.equal(
    normalizeRollbackPortMappings(
      "0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 127.0.0.1:8443->443/tcp",
    ),
    "8080:80,127.0.0.1:8443:443",
  );
  assert.equal(
    normalizeRollbackPortMappings(["8081:81", "9000->90/udp"]),
    "8081:81,9000:90/udp",
  );
});

test("uses a locally available Docker image ID without creating an invalid registry reference", async () => {
  const inspected: string[] = [];
  const pulled: string[] = [];

  const image = await resolveRollbackImageReference(
    {
      server,
      image: "example/app:latest",
      imageDigest: `sha256:${"a".repeat(64)}`,
    },
    {
      dockerInspect: async (_server, imageRef) => {
        inspected.push(imageRef);
        return {};
      },
      dockerPullImage: async (_server, imageRef) => {
        pulled.push(imageRef);
      },
    },
  );

  assert.equal(image, `sha256:${"a".repeat(64)}`);
  assert.deepEqual(inspected, [`sha256:${"a".repeat(64)}`]);
  assert.deepEqual(pulled, []);
});

test("throws instead of silently falling back when a historical local image ID was pruned", async () => {
  // example/app:stable is a fixed tag reused by every deploy of this
  // container, so it now points at whatever the newest build is — using it
  // here would silently "succeed" at running the wrong version. The caller
  // (deployment-rollback.service's rollbackContainerToDeployment) is
  // responsible for deciding what to do next: rebuild from the recorded
  // commit, or fail outright.
  const pulled: string[] = [];
  const digest = `sha256:${"b".repeat(64)}`;

  await assert.rejects(
    () =>
      resolveRollbackImageReference(
        {
          server,
          image: "example/app:stable",
          imageDigest: digest,
        },
        {
          dockerInspect: async () => {
            throw new Error("image not found");
          },
          dockerPullImage: async (_server, imageRef) => {
            pulled.push(imageRef);
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof RollbackImageUnavailableError);
      assert.equal(error.attemptedReference, digest);
      return true;
    },
  );

  assert.deepEqual(pulled, []);
});

test("still uses the stored image reference when no digest was ever recorded", async () => {
  // Older deployments (or a manually-deployed container where the image name
  // itself, e.g. "nginx:1.25", is the meaningful identity rather than a
  // mutable per-container tag) never captured a local image ID. There is
  // nothing to have gone missing, so the pre-existing tag-based behavior is
  // kept rather than treated as a failure.
  const pulled: string[] = [];

  const image = await resolveRollbackImageReference(
    {
      server,
      image: "nginx:1.25",
      imageDigest: null,
    },
    {
      dockerInspect: async () => {
        throw new Error("should not be called for the digest path");
      },
      dockerPullImage: async (_server, imageRef) => {
        pulled.push(imageRef);
      },
    },
  );

  assert.equal(image, "nginx:1.25");
  assert.deepEqual(pulled, ["nginx:1.25"]);
});

function runtime(overrides: Partial<RollbackInput["targetRuntime"]> = {}) {
  return {
    image: "example/app:target",
    ports: "",
    env: "APP_ENV=production",
    volumes: "/data:/data",
    network: "bridge",
    restartPolicy: "unless-stopped",
    command: "",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<RollbackDependencies> = {},
): RollbackDependencies {
  return {
    runContainer: async () => "new-container-id",
    stopAndRemoveContainer: async () => undefined,
    dockerRename: async () => undefined,
    waitForDockerHealth: async () => ({
      healthy: true,
      reason: "running",
      status: "healthy",
      attempts: 1,
      durationMs: 0,
    }),
    ...overrides,
  };
}

test("published-port rollback removes the active runtime before claiming its name and host port", async () => {
  const events: string[] = [];

  await replaceRuntimeForRollback(
    {
      server,
      containerName: "app",
      currentContainerRefs: ["old-container-id", "app"],
      temporaryName: "app-rollback",
      strategy: "RECREATE_WITH_RECOVERY",
      targetRuntime: runtime({ ports: "8080:80" }),
      previousRuntime: runtime({
        image: "example/app:previous",
        ports: "8080:80",
      }),
    },
    dependencies({
      stopAndRemoveContainer: async (_server, refs) => {
        events.push(`remove:${refs.join(",")}`);
      },
      runContainer: async (_server, options) => {
        events.push(`run:${options.name}:${options.ports}`);
        return "new-container-id";
      },
      waitForDockerHealth: async () => {
        events.push("runtime-check");
        return {
          healthy: true,
          reason: "running",
          status: "healthy",
          attempts: 1,
          durationMs: 0,
        };
      },
    }),
  );

  assert.deepEqual(events, [
    "remove:old-container-id,app",
    "run:app:8080:80",
    "runtime-check",
  ]);
});

test("failed published-port rollback recreates and verifies the previous runtime", async () => {
  const events: string[] = [];
  let runCount = 0;

  await assert.rejects(
    replaceRuntimeForRollback(
      {
        server,
        containerName: "app",
        currentContainerRefs: ["old-container-id", "app"],
        temporaryName: "app-rollback",
        strategy: "RECREATE_WITH_RECOVERY",
        targetRuntime: runtime({ ports: "8080:80" }),
        previousRuntime: runtime({
          image: "example/app:previous",
          ports: "8080:80",
        }),
      },
      dependencies({
        stopAndRemoveContainer: async (_server, refs) => {
          events.push(`remove:${refs.join(",")}`);
        },
        runContainer: async (_server, options) => {
          runCount += 1;
          events.push(`run:${options.image}`);
          return runCount === 1 ? "failed-target-id" : "recovered-container-id";
        },
        waitForDockerHealth: async ({ containerRef }) => {
          events.push(`runtime-check:${containerRef}`);
          if (containerRef === "failed-target-id") {
            return {
              healthy: false,
              reason: "not running",
              status: "not_running",
              attempts: 1,
              durationMs: 0,
            };
          }
          return {
            healthy: true,
            reason: "running",
            status: "healthy",
            attempts: 1,
            durationMs: 0,
          };
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof RollbackRuntimeError);
      assert.equal(error.recoveryMode, "RECREATED");
      assert.equal(error.recoveryDockerId, "recovered-container-id");
      return true;
    },
  );

  assert.deepEqual(events, [
    "remove:old-container-id,app",
    "run:example/app:target",
    "runtime-check:failed-target-id",
    "remove:failed-target-id,app-rollback,app",
    "run:example/app:previous",
    "runtime-check:recovered-container-id",
  ]);
});

test("failed atomic candidate leaves the active runtime in place", async () => {
  const removedRefs: string[][] = [];
  let runCount = 0;

  await assert.rejects(
    replaceRuntimeForRollback(
      {
        server,
        containerName: "app",
        currentContainerRefs: ["old-container-id", "app"],
        temporaryName: "app-rollback",
        strategy: "ATOMIC_RENAME",
        targetRuntime: runtime(),
        previousRuntime: runtime({ image: "example/app:previous" }),
      },
      dependencies({
        stopAndRemoveContainer: async (_server, refs) => {
          removedRefs.push(refs);
        },
        runContainer: async () => {
          runCount += 1;
          return "failed-target-id";
        },
        waitForDockerHealth: async ({ containerRef }) => {
          if (containerRef === "failed-target-id") {
            return {
              healthy: false,
              reason: "not running",
              status: "not_running",
              attempts: 1,
              durationMs: 0,
            };
          }
          return {
            healthy: true,
            reason: "running",
            status: "healthy",
            attempts: 1,
            durationMs: 0,
          };
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof RollbackRuntimeError);
      assert.equal(error.recoveryMode, "UNCHANGED");
      assert.equal(error.recoveryDockerId, "old-container-id");
      return true;
    },
  );

  assert.equal(runCount, 1);
  assert.deepEqual(removedRefs, [["failed-target-id", "app-rollback"]]);
});


