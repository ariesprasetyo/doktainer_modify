import assert from "node:assert/strict";
import test from "node:test";

import {
  findDiskUsageEntry,
  parseDockerDiskUsage,
  parseReclaimable,
} from "../../src/server/services/docker-disk-usage";
import { parseDockerSizeToBytes } from "../../src/server/services/docker-size";

/** Captured verbatim from `docker system df --format '{{json .}}'`. */
const SYSTEM_DF = [
  '{"Active":"2","Reclaimable":"12.25MB (5%)","Size":"241.3MB","TotalCount":"10","Type":"Images"}',
  '{"Active":"2","Reclaimable":"0B (0%)","Size":"86.02kB","TotalCount":"2","Type":"Containers"}',
  '{"Active":"0","Reclaimable":"0B","Size":"0B","TotalCount":"0","Type":"Local Volumes"}',
  '{"Active":"0","Reclaimable":"74.01kB","Size":"148.3MB","TotalCount":"23","Type":"Build Cache"}',
].join("\n");

test("every category is read from the real output", () => {
  const entries = parseDockerDiskUsage(SYSTEM_DF);

  assert.deepEqual(
    entries.map((entry) => entry.category),
    ["Images", "Containers", "Local Volumes", "Build Cache"],
  );

  const images = findDiskUsageEntry(entries, "Images");
  assert.equal(images?.totalCount, 10);
  assert.equal(images?.activeCount, 2);
  assert.equal(images?.sizeBytes, 241_300_000);
});

test("build cache reclaimable is what a prune can free, not the whole cache", () => {
  // `docker builder du` reports the entire cache as reclaimable — 148.2MB on a
  // server where system df said 0B and a prune then freed exactly 0B, because
  // those records back layers of images that still exist. Reporting builder du
  // would advertise cleanable space that no prune can recover.
  const cache = findDiskUsageEntry(parseDockerDiskUsage(SYSTEM_DF), "Build Cache");

  assert.equal(cache?.reclaimableBytes, 74_010);
  assert.equal(cache?.sizeBytes, 148_300_000);
});

test("every category reports its own reclaimable figure", () => {
  const entries = parseDockerDiskUsage(SYSTEM_DF);
  assert.equal(findDiskUsageEntry(entries, "Images")?.reclaimableBytes, 12_250_000);
  assert.equal(findDiskUsageEntry(entries, "Containers")?.reclaimableBytes, 0);
});

test("the percentage in a reclaimable value is discarded", () => {
  assert.equal(parseReclaimable("12.25MB (5%)"), 12_250_000);
  assert.equal(parseReclaimable("0B (0%)"), 0);
  assert.equal(parseReclaimable("148.3MB"), 148_300_000);
  assert.equal(parseReclaimable(undefined), null);
  assert.equal(parseReclaimable("not a size"), null);
});

test("one unreadable line does not lose the other categories", () => {
  // A login shell can print a banner before the output starts.
  const withNoise = ["Welcome to Ubuntu", SYSTEM_DF, "trailing notice"].join("\n");
  const entries = parseDockerDiskUsage(withNoise);

  assert.equal(entries.length, 4);
});

test("a row with no type is skipped", () => {
  assert.deepEqual(parseDockerDiskUsage('{"Size":"1MB"}'), []);
});

test("empty output yields nothing rather than throwing", () => {
  assert.deepEqual(parseDockerDiskUsage(""), []);
  assert.deepEqual(parseDockerDiskUsage("   \n  "), []);
});

test("a missing count reads as zero, not NaN", () => {
  const entry = parseDockerDiskUsage('{"Type":"Images"}')[0];
  assert.equal(entry.totalCount, 0);
  assert.equal(entry.activeCount, 0);
  assert.equal(entry.sizeBytes, null);
});

test("both size conventions Docker prints are honoured", () => {
  // docker stats reports MiB, docker system df reports MB.
  assert.equal(parseDockerSizeToBytes("148.3MB"), 148_300_000);
  assert.equal(parseDockerSizeToBytes("4.609MiB"), 4_832_887);
  assert.equal(parseDockerSizeToBytes("0B"), 0);
  assert.equal(parseDockerSizeToBytes("86.02kB"), 86_020);
});

test("a placeholder or malformed size reads as unknown", () => {
  for (const value of ["—", "n/a", "", "abc", "12 QB"]) {
    assert.equal(parseDockerSizeToBytes(value), null, `accepted ${value}`);
  }
});
