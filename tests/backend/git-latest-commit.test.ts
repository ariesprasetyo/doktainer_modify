import assert from "node:assert/strict";
import test from "node:test";

import {
  readCommitSha,
  readTagName,
  selectTagFromList,
} from "../../src/server/services/git-latest-commit.service";

test("each provider's spelling of the commit id is read", () => {
  // GitLab says id, GitHub and Gitea say sha.
  assert.equal(readCommitSha({ id: "abc123" }), "abc123");
  assert.equal(readCommitSha({ sha: "def456" }), "def456");
});

test("a tag's commit is read from the nested object", () => {
  // GitHub and Gitea nest it; reading only the top level would find nothing and
  // make every tag look unavailable.
  assert.equal(readCommitSha({ name: "v1.0", commit: { sha: "aaa" } }), "aaa");
  assert.equal(readCommitSha({ name: "v1.0", commit: { id: "bbb" } }), "bbb");
});

test("a missing or malformed entry yields empty, not a crash", () => {
  for (const entry of [null, {}, { id: 42 }, { commit: "nope" }]) {
    assert.equal(readCommitSha(entry as Record<string, unknown> | null), "");
  }
  assert.equal(readTagName(null), "");
});

test("the newest matching tag is chosen", () => {
  // Providers return tags newest-first, which is what this relies on.
  assert.deepEqual(
    selectTagFromList(
      [
        { name: "nightly", commit: { sha: "n" } },
        { name: "v2.0", commit: { sha: "two" } },
        { name: "v1.0", commit: { sha: "one" } },
      ],
      "v*",
    ),
    { ref: "v2.0", commitSha: "two" },
  );
});

test("version ordering is not second-guessed", () => {
  // Comparing the strings ourselves would rank v1.9 above v1.10.
  assert.equal(
    selectTagFromList(
      [
        { name: "v1.10", commit: { sha: "ten" } },
        { name: "v1.9", commit: { sha: "nine" } },
      ],
      "v*",
    )?.ref,
    "v1.10",
  );
});

test("a tag with no usable commit is skipped rather than deployed empty", () => {
  assert.deepEqual(
    selectTagFromList(
      [
        { name: "v3.0" },
        { name: "v2.0", commit: { sha: "two" } },
      ],
      "v*",
    ),
    { ref: "v2.0", commitSha: "two" },
  );
});

test("no matching tag yields null", () => {
  assert.equal(selectTagFromList([{ name: "beta", commit: { sha: "b" } }], "v*"), null);
  assert.equal(selectTagFromList([], "v*"), null);
  assert.equal(selectTagFromList(null, "v*"), null);
});

test("a pattern is matched literally apart from its wildcards", () => {
  // "v1.0" must not match "v1x0" through the dot being a regex any-char.
  assert.equal(
    selectTagFromList([{ name: "v1x0", commit: { sha: "x" } }], "v1.0"),
    null,
  );
  assert.equal(
    selectTagFromList([{ name: "v1.0", commit: { sha: "ok" } }], "v1.0")?.commitSha,
    "ok",
  );
});
