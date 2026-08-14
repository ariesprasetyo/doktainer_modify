import assert from "node:assert/strict";
import test from "node:test";

import { rebuildImageFromCommitForRollback } from "../../src/server/services/deployment-rollback.service";

const server = {} as Parameters<typeof rebuildImageFromCommitForRollback>[0]["server"];

const GIT_SOURCE = {
  repoUrl: "http://172.21.50.120:8088/sauron/test.git",
  accessTokenEnc: null,
  buildType: "DOCKERFILE",
  buildPath: "/",
  dockerfilePath: "Dockerfile",
  dockerContextPath: "/",
  projectName: "dev-php",
};

const COMMIT_SHA = "f059a24bda5aa7ea3884716adcb9e6a5e292dc01";

function container(overrides: Partial<typeof GIT_SOURCE> | null = {}) {
  return {
    id: "container-1",
    name: "dev-php",
    deploymentSource: overrides === null ? null : { ...GIT_SOURCE, ...overrides },
  };
}

test("rebuilds the exact commit and returns a distinct image tag", async () => {
  const calls: unknown[] = [];

  const result = await rebuildImageFromCommitForRollback(
    {
      server,
      container: container(),
      commitSha: COMMIT_SHA,
      unavailableImage: "sha256:deadbeef",
    },
    {
      deployContainerFromGitSource: async (_server, opts) => {
        calls.push(opts);
        return {
          deploymentPath: "/opt/doktainer/deployments/dev-php",
          imageTag: opts.imageTag!,
          commitSha: COMMIT_SHA,
        };
      },
    },
  );

  assert.equal(result.commitSha, COMMIT_SHA);
  assert.ok(result.image.includes(COMMIT_SHA.slice(0, 12)));
  // Must not reuse whatever mutable tag lost the old build in the first
  // place — that would just recreate the same trap on the next rollback.
  assert.notEqual(result.image, "doktainer/dev-php:latest");

  assert.equal(calls.length, 1);
  const opts = calls[0] as Record<string, unknown>;
  assert.equal(opts.pinnedCommitSha, COMMIT_SHA);
  assert.equal(opts.skipRun, true);
  assert.equal(opts.buildType, "DOCKERFILE");
  assert.equal(opts.repoUrl, GIT_SOURCE.repoUrl);
});

test("refuses without ever contacting the server when there is no git source", async () => {
  let called = false;

  await assert.rejects(
    () =>
      rebuildImageFromCommitForRollback(
        {
          server,
          container: container(null),
          commitSha: COMMIT_SHA,
          unavailableImage: "sha256:deadbeef",
        },
        {
          deployContainerFromGitSource: async () => {
            called = true;
            throw new Error("should not be called");
          },
        },
      ),
    /no git source to rebuild from/,
  );

  assert.equal(called, false);
});

test("refuses for a non-Dockerfile build type", async () => {
  await assert.rejects(
    () =>
      rebuildImageFromCommitForRollback(
        {
          server,
          container: container({ buildType: "COMPOSE" }),
          commitSha: COMMIT_SHA,
          unavailableImage: "sha256:deadbeef",
        },
        {
          deployContainerFromGitSource: async () => {
            throw new Error("should not be called");
          },
        },
      ),
    /only supported for Dockerfile/,
  );
});

test("refuses when no commit was recorded to rebuild from", async () => {
  for (const commitSha of [null, undefined, "", "not-a-sha", "z".repeat(40)]) {
    await assert.rejects(
      () =>
        rebuildImageFromCommitForRollback(
          {
            server,
            container: container(),
            commitSha,
            unavailableImage: "sha256:deadbeef",
          },
          {
            deployContainerFromGitSource: async () => {
              throw new Error("should not be called");
            },
          },
        ),
      /no usable commit recorded|does not have a usable commit/,
      JSON.stringify(commitSha),
    );
  }
});

test("surfaces a build failure instead of swallowing it", async () => {
  await assert.rejects(
    () =>
      rebuildImageFromCommitForRollback(
        {
          server,
          container: container(),
          commitSha: COMMIT_SHA,
          unavailableImage: "sha256:deadbeef",
        },
        {
          deployContainerFromGitSource: async () => {
            throw new Error("Dockerfile not found: Dockerfile");
          },
        },
      ),
    /Dockerfile not found/,
  );
});
