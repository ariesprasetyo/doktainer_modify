import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPushTag,
  parsePushEvent,
  resolveWebhookDeployRef,
} from "../../src/server/routes/webhooks";

const REPO = "http://172.21.50.120:8088/cku/syncstock.git";
const PUSHED = { repoCandidates: [REPO] };

function target(overrides: Partial<Parameters<typeof resolveWebhookDeployRef>[0]> = {}) {
  return {
    repoUrl: REPO,
    repoBranch: "main",
    repoTag: null,
    autoDeployOnPush: true,
    autoDeployTagPattern: null,
    ...overrides,
  };
}

test("tags are extracted from refs/tags and nothing else", () => {
  assert.equal(extractPushTag("refs/tags/v1.2.3"), "v1.2.3");
  assert.equal(extractPushTag("refs/heads/main"), "");
  assert.equal(extractPushTag(null), "");
});

test("a gitlab tag push is parsed as a tag, not a branch", () => {
  const result = parsePushEvent({
    provider: "gitlab",
    eventName: "Tag Push Hook",
    payload: {
      object_kind: "tag_push",
      ref: "refs/tags/v1.2.3",
      after: "a".repeat(40),
      project: { http_url_to_repo: REPO },
    },
  });

  assert.equal(result.ignored, null);
  assert.equal(result.tag, "v1.2.3");
  assert.equal(result.branch, "");
});

test("a github tag push arrives on the push event", () => {
  const result = parsePushEvent({
    provider: "github",
    eventName: "push",
    payload: {
      ref: "refs/tags/v2.0.0",
      after: "b".repeat(40),
      repository: { clone_url: REPO },
    },
  });

  assert.equal(result.ignored, null);
  assert.equal(result.tag, "v2.0.0");
});

test("a tag deletion is ignored and labelled as such", () => {
  const result = parsePushEvent({
    provider: "gitlab",
    eventName: "Tag Push Hook",
    payload: {
      object_kind: "tag_push",
      ref: "refs/tags/v1.2.3",
      after: "0".repeat(40),
      project: { http_url_to_repo: REPO },
    },
  });
  assert.equal(result.ignored, "tag deletion");
});

test("a matching tag push deploys the pushed tag", () => {
  const decision = resolveWebhookDeployRef(
    target({ autoDeployTagPattern: "v*" }),
    { ...PUSHED, branch: "", tag: "v1.2.3" },
  );
  assert.equal(decision.deploy, true);
  assert.equal(decision.ref, "v1.2.3");
});

test("a tag push is ignored without a pattern, so it stays opt-in", () => {
  const decision = resolveWebhookDeployRef(target(), {
    ...PUSHED,
    branch: "",
    tag: "v1.2.3",
  });
  assert.equal(decision.deploy, false);
  assert.equal(decision.reason, "tag does not match pattern");
});

test("a tag that misses the pattern does not deploy", () => {
  const decision = resolveWebhookDeployRef(
    target({ autoDeployTagPattern: "v*" }),
    { ...PUSHED, branch: "", tag: "nightly-42" },
  );
  assert.equal(decision.deploy, false);
});

test("a branch push still deploys as before", () => {
  const decision = resolveWebhookDeployRef(target(), {
    ...PUSHED,
    branch: "main",
    tag: "",
  });
  assert.equal(decision.deploy, true);
  assert.equal(decision.ref, undefined);
});

test("a pinned version is not moved by a branch push", () => {
  const decision = resolveWebhookDeployRef(target({ repoTag: "v1.1.0" }), {
    ...PUSHED,
    branch: "main",
    tag: "",
  });
  assert.equal(decision.deploy, false);
  assert.equal(decision.reason, "version is pinned to a tag");
});

test("a pinned container still accepts a matching tag push", () => {
  // Pinning stops branch drift; an explicit release tag is a deliberate move.
  const decision = resolveWebhookDeployRef(
    target({ repoTag: "v1.1.0", autoDeployTagPattern: "v*" }),
    { ...PUSHED, branch: "", tag: "v1.2.0" },
  );
  assert.equal(decision.deploy, true);
  assert.equal(decision.ref, "v1.2.0");
});

test("deploy on push disabled blocks branch pushes only", () => {
  const off = target({ autoDeployOnPush: false });
  assert.equal(
    resolveWebhookDeployRef(off, { ...PUSHED, branch: "main", tag: "" }).deploy,
    false,
  );
  assert.equal(
    resolveWebhookDeployRef(
      { ...off, autoDeployTagPattern: "v*" },
      { ...PUSHED, branch: "", tag: "v1.0.0" },
    ).deploy,
    true,
  );
});

test("a different repository never deploys", () => {
  const decision = resolveWebhookDeployRef(
    target({ repoUrl: "http://172.21.50.120:8088/cku/other.git" }),
    { ...PUSHED, branch: "main", tag: "" },
  );
  assert.equal(decision.deploy, false);
  assert.equal(decision.reason, "repository does not match");
});

test("a wrong branch never deploys", () => {
  const decision = resolveWebhookDeployRef(target({ repoBranch: "develop" }), {
    ...PUSHED,
    branch: "main",
    tag: "",
  });
  assert.equal(decision.deploy, false);
  assert.equal(decision.reason, "branch does not match");
});
