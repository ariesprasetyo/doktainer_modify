import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPushBranch,
  matchesPushedBranch,
  matchesPushedRepo,
  normalizeRepoIdentity,
  parsePushEvent,
} from "../../src/server/routes/webhooks";

test("the same repository matches across url forms", () => {
  const expected = "172.21.50.120:8088/cku/syncstock";
  for (const value of [
    "http://172.21.50.120:8088/cku/syncstock.git",
    "http://172.21.50.120:8088/cku/syncstock",
    "https://172.21.50.120:8088/cku/syncstock.git",
    "http://172.21.50.120:8088/cku/syncstock/",
    "http://172.21.50.120:8088/CKU/SyncStock.git",
    "http://oauth2:token@172.21.50.120:8088/cku/syncstock.git",
  ]) {
    assert.equal(normalizeRepoIdentity(value), expected, value);
  }
});

test("an ssh url carries no http port, so it is a distinct identity", () => {
  // In scp syntax everything after the colon is the path, so an ssh clone url
  // for a host served on :8088 normalises without the port. Matching still works
  // because push payloads carry both the http and ssh forms, and only one
  // candidate has to line up with what was configured.
  assert.equal(
    normalizeRepoIdentity("git@172.21.50.120:cku/syncstock.git"),
    "172.21.50.120/cku/syncstock",
  );
  assert.equal(
    matchesPushedRepo("git@172.21.50.120:cku/syncstock.git", [
      "http://172.21.50.120:8088/cku/syncstock.git",
      "git@172.21.50.120:cku/syncstock.git",
    ]),
    true,
  );
});

test("scp-style ssh urls normalise to the same identity as https", () => {
  assert.equal(
    normalizeRepoIdentity("git@github.com:acme/widgets.git"),
    normalizeRepoIdentity("https://github.com/acme/widgets"),
  );
});

test("a different port or path is a different repository", () => {
  assert.notEqual(
    normalizeRepoIdentity("http://host:8088/a/b.git"),
    normalizeRepoIdentity("http://host:9000/a/b.git"),
  );
  assert.notEqual(
    normalizeRepoIdentity("http://host/a/b.git"),
    normalizeRepoIdentity("http://host/a/c.git"),
  );
});

test("blank and missing values normalise to empty and never match", () => {
  for (const value of ["", "   ", null, undefined]) {
    assert.equal(normalizeRepoIdentity(value), "");
  }
  assert.equal(matchesPushedRepo(null, ["http://host/a/b.git"]), false);
  assert.equal(matchesPushedRepo("", ["http://host/a/b.git"]), false);
  assert.equal(matchesPushedRepo("http://host/a/b.git", []), false);
});

test("a stored repo matches any equivalent candidate from the payload", () => {
  assert.equal(
    matchesPushedRepo("http://172.21.50.120:8088/cku/syncstock.git", [
      "git@172.21.50.120:cku/other.git",
      "http://172.21.50.120:8088/cku/syncstock.git",
    ]),
    true,
  );
  assert.equal(
    matchesPushedRepo("http://172.21.50.120:8088/cku/syncstock.git", [
      "http://172.21.50.120:8088/cku/other.git",
    ]),
    false,
  );
});

test("branch extraction ignores tags and non-branch refs", () => {
  assert.equal(extractPushBranch("refs/heads/main"), "main");
  assert.equal(extractPushBranch("refs/heads/feature/login"), "feature/login");
  assert.equal(extractPushBranch("refs/tags/v1.0.0"), "");
  assert.equal(extractPushBranch(""), "");
  assert.equal(extractPushBranch(null), "");
});

test("a null stored branch falls back to main", () => {
  assert.equal(matchesPushedBranch(null, "main"), true);
  assert.equal(matchesPushedBranch("", "main"), true);
  assert.equal(matchesPushedBranch(null, "develop"), false);
});

test("only the configured branch matches", () => {
  assert.equal(matchesPushedBranch("develop", "develop"), true);
  assert.equal(matchesPushedBranch("develop", "main"), false);
  assert.equal(matchesPushedBranch("Develop", "develop"), true);
});

test("a gitlab push payload yields repo candidates and a branch", () => {
  const result = parsePushEvent({
    provider: "gitlab",
    eventName: "Push Hook",
    payload: {
      object_kind: "push",
      ref: "refs/heads/main",
      after: "a".repeat(40),
      checkout_sha: "a".repeat(40),
      project: {
        http_url_to_repo: "http://172.21.50.120:8088/cku/syncstock.git",
        ssh_url_to_repo: "git@172.21.50.120:cku/syncstock.git",
      },
    },
  });

  assert.equal(result.ignored, null);
  assert.equal(result.branch, "main");
  assert.equal(result.commitSha, "a".repeat(40));
  assert.equal(
    matchesPushedRepo(
      "http://172.21.50.120:8088/cku/syncstock",
      result.repoCandidates,
    ),
    true,
  );
});

test("non-push events are ignored rather than treated as deploys", () => {
  const gitlab = parsePushEvent({
    provider: "gitlab",
    eventName: "Tag Push Hook",
    payload: { object_kind: "tag_push", ref: "refs/tags/v1" },
  });
  assert.ok(gitlab.ignored);

  const githubPing = parsePushEvent({
    provider: "github",
    eventName: "ping",
    payload: { ref: "refs/heads/main" },
  });
  assert.ok(githubPing.ignored);
});

test("branch deletions are ignored", () => {
  const gitlab = parsePushEvent({
    provider: "gitlab",
    eventName: "Push Hook",
    payload: {
      object_kind: "push",
      ref: "refs/heads/gone",
      after: "0".repeat(40),
      project: { http_url_to_repo: "http://host/a/b.git" },
    },
  });
  assert.equal(gitlab.ignored, "branch deletion");

  const github = parsePushEvent({
    provider: "github",
    eventName: "push",
    payload: {
      ref: "refs/heads/gone",
      deleted: true,
      repository: { clone_url: "https://github.com/a/b.git" },
    },
  });
  assert.equal(github.ignored, "branch deletion");
});

test("a tag push is ignored even when the event name says push", () => {
  const result = parsePushEvent({
    provider: "github",
    eventName: "push",
    payload: {
      ref: "refs/tags/v2.0.0",
      after: "b".repeat(40),
      repository: { clone_url: "https://github.com/a/b.git" },
    },
  });
  assert.equal(result.ignored, "push did not target a branch");
});

test("a payload with no repository url is ignored", () => {
  const result = parsePushEvent({
    provider: "github",
    eventName: "push",
    payload: { ref: "refs/heads/main", after: "c".repeat(40) },
  });
  assert.equal(result.ignored, "payload carried no repository url");
});
