import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BUILD_CACHE_LIMIT_BYTES,
  DEFAULT_KEPT_BUILDS_PER_CONTAINER,
  selectCommitsToPrune,
  shouldPruneBuildCache,
} from "../../src/server/services/image-retention";
import { buildRetentionImageTag } from "../../src/server/services/ssh-services/docker-containers";
import { buildBuilderPruneCommand } from "../../src/server/services/ssh-services/docker-engine";

test("keeps the default number of newest builds and prunes the rest", () => {
  const commits = ["c7", "c6", "c5", "c4", "c3", "c2", "c1"];
  assert.equal(DEFAULT_KEPT_BUILDS_PER_CONTAINER, 5);
  assert.deepEqual(selectCommitsToPrune(commits), ["c2", "c1"]);
});

test("nothing is pruned while at or under the kept window", () => {
  assert.deepEqual(selectCommitsToPrune(["c3", "c2", "c1"]), []);
  assert.deepEqual(selectCommitsToPrune(["c5", "c4", "c3", "c2", "c1"]), []);
  assert.deepEqual(selectCommitsToPrune([]), []);
});

test("the same commit built more than once only occupies one slot", () => {
  // Re-running an already-deployed commit (a repeated rebuild with no new
  // code) must not let it count twice and push out a genuinely different one.
  const commits = ["c1", "c2", "c1", "c3", "c1", "c4", "c5", "c6"];
  assert.deepEqual(selectCommitsToPrune(commits), ["c6"]);
});

test("null, undefined, and blank entries are ignored rather than pruned", () => {
  const commits = ["c5", null, "c4", undefined, "", "  ", "c3", "c2", "c1"];
  assert.deepEqual(selectCommitsToPrune(commits), []);
});

test("a custom keep count is honoured", () => {
  const commits = ["c5", "c4", "c3", "c2", "c1"];
  assert.deepEqual(selectCommitsToPrune(commits, 2), ["c3", "c2", "c1"]);
  assert.deepEqual(selectCommitsToPrune(commits, 0), commits);
  assert.deepEqual(selectCommitsToPrune(commits, 100), []);
});

test("order is preserved for the surviving oldest-of-the-kept commits", () => {
  const commits = ["c8", "c7", "c6", "c5", "c4", "c3", "c2", "c1"];
  // Newest 5 (c8..c4) kept; c3, c2, c1 pruned, oldest last.
  assert.deepEqual(selectCommitsToPrune(commits), ["c3", "c2", "c1"]);
});

test("the retention tag is a short, stable name distinct from :latest", () => {
  assert.equal(
    buildRetentionImageTag("dev-php", "15df1282a0975e7fb96e7dfbf3152249f5ba0089"),
    "doktainer/dev-php:build-15df1282a097",
  );
});

test("the retention tag is case- and whitespace-normalised", () => {
  assert.equal(
    buildRetentionImageTag("dev-php", "  F059A24BDA5A  "),
    "doktainer/dev-php:build-f059a24bda5a",
  );
});

test("a cache under the limit is left alone", () => {
  // Pruning a cache that is doing its job just makes the next build slower.
  assert.equal(shouldPruneBuildCache(148_300_000), false);
  assert.equal(shouldPruneBuildCache(DEFAULT_BUILD_CACHE_LIMIT_BYTES), false);
});

test("a cache over the limit is pruned", () => {
  assert.equal(
    shouldPruneBuildCache(DEFAULT_BUILD_CACHE_LIMIT_BYTES + 1),
    true,
  );
  assert.equal(shouldPruneBuildCache(5_000_000_000), true);
});

test("only reclaimable space counts", () => {
  // A cache that is large but entirely in use cannot be freed by pruning.
  assert.equal(shouldPruneBuildCache(0), false);
  assert.equal(shouldPruneBuildCache(null), false);
  assert.equal(shouldPruneBuildCache(undefined), false);
  assert.equal(shouldPruneBuildCache(Number.NaN), false);
});

test("the limit is configurable", () => {
  assert.equal(shouldPruneBuildCache(100, 50), true);
  assert.equal(shouldPruneBuildCache(100, 500), false);
});

test("the prune command uses whichever flag the docker version accepts", () => {
  // --keep-storage was removed in Docker 29 in favour of --reserved-space, so a
  // command hardcoding either one fails on half the versions in the wild.
  assert.equal(
    buildBuilderPruneCommand("--reserved-space", 2_147_483_648),
    "docker builder prune -f --reserved-space 2147483648",
  );
  assert.equal(
    buildBuilderPruneCommand("--keep-storage", 2_147_483_648),
    "docker builder prune -f --keep-storage 2147483648",
  );
});

test("a fractional or negative reserve becomes a whole non-negative byte count", () => {
  assert.match(buildBuilderPruneCommand("--reserved-space", 1.9), / 1$/);
  assert.match(buildBuilderPruneCommand("--reserved-space", -5), / 0$/);
});
