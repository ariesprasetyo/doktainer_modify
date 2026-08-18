import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeleteImage,
  classifyImageProtection,
  isRetentionTag,
  isUntaggedImage,
  parseDockerCreatedAt,
  parseDockerImageList,
  parseInUseImageIds,
  shortImageId,
} from "../../src/server/services/docker-image-list";

/** Captured verbatim from `docker system df -v --format '{{json .Images}}'`. */
const IMAGES = JSON.stringify([
  {
    Containers: "1",
    CreatedAt: "2026-08-14 08:13:57 +0000 UTC",
    CreatedSince: "3 days ago",
    ID: "sha256:c064957046d0e260e212986c7c6b5012a95c1cd37d7c1fd69681483e460487f8",
    Repository: "doktainer/dev-php",
    SharedSize: "148.2MB",
    Size: "148MB",
    Tag: "build-4f11aa64aba7",
    UniqueSize: "2.238kB",
  },
  {
    Containers: "0",
    CreatedSince: "3 days ago",
    ID: "sha256:a38ea9e71e7d0000000000000000000000000000000000000000000000000000",
    Repository: "doktainer/dev-php",
    SharedSize: "148.2MB",
    Size: "148MB",
    Tag: "rollback-15df1282a097",
    UniqueSize: "13.93kB",
  },
  {
    Containers: "0",
    CreatedSince: "4 weeks ago",
    ID: "sha256:4a73073bd5570000000000000000000000000000000000000000000000000000",
    Repository: "nginx",
    SharedSize: "12.92MB",
    Size: "93.6MB",
    Tag: "alpine",
    UniqueSize: "80.64MB",
  },
]);

/** What `docker inspect --format '{{.Image}}'` prints for the running containers. */
const IN_USE = [
  "sha256:c064957046d0e260e212986c7c6b5012a95c1cd37d7c1fd69681483e460487f8",
  "sha256:4a73073bd5570000000000000000000000000000000000000000000000000000",
].join("\n");

test("images are read with the size that removing them would free", () => {
  // Docker's Size repeats the whole image for every tag sharing its layers, so
  // five build tags each read 148MB while the real cost is kilobytes.
  const entries = parseDockerImageList(IMAGES);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].sizeBytes, 148_000_000);
  assert.equal(entries[0].uniqueSizeBytes, 2_238);
  assert.equal(entries[2].uniqueSizeBytes, 80_640_000);
});

test("the id is shortened to what the CLI and a human use", () => {
  assert.equal(parseDockerImageList(IMAGES)[0].id, "c064957046d0");
});

test("an image a container uses is protected", () => {
  const entries = parseDockerImageList(IMAGES, parseInUseImageIds(IN_USE));
  assert.equal(entries[0].protectionReason, "in-use");
  assert.equal(entries[0].containers, 1);
});

test("in use comes from the containers, not Docker's Containers column", () => {
  // That column attributes a container to every image in its ancestry. On a
  // server running two containers it reported 1 against eight images, so six
  // unused layers looked protected and could never be cleaned up. The fixture's
  // first entry claims Containers:1 while nothing references it.
  const entries = parseDockerImageList(IMAGES, new Set<string>());

  assert.notEqual(entries[0].protectionReason, "in-use");
  assert.equal(entries[0].containers, 0);
});

test("only the referenced image is in use, not its ancestry", () => {
  const entries = parseDockerImageList(
    IMAGES,
    parseInUseImageIds("sha256:4a73073bd5570000000000000000000000000000000000000000000000000000"),
  );

  assert.equal(entries[2].protectionReason, "in-use");
  assert.notEqual(entries[0].protectionReason, "in-use");
  assert.notEqual(entries[1].protectionReason, "in-use");
});

test("an unused plain image is removable once nothing references it", () => {
  // The same nginx:alpine that was protected above, now unreferenced.
  const entries = parseDockerImageList(IMAGES, new Set<string>());
  assert.equal(entries[2].protectionReason, null);
});

test("container image ids are matched on their short form", () => {
  assert.equal(shortImageId("sha256:c064957046d0e260e21298"), "c064957046d0");
  assert.equal(shortImageId("C064957046D0"), "c064957046d0");
  assert.deepEqual(
    [...parseInUseImageIds(["", "not-an-id", "sha256:abcdef123456"].join("\n"))],
    ["abcdef123456"],
  );
});



test("an ordinary unused image is not protected", () => {
  assert.equal(parseDockerImageList(IMAGES)[2].protectionReason, null);
});

test("a retention tag stays protected even when nothing is in use", () => {
  assert.equal(parseDockerImageList(IMAGES)[1].protectionReason, "retention-tag");
});

test("only the panel's own tag shapes count as retention tags", () => {
  for (const tag of ["build-c43244208fda", "rollback-15df1282a097", "BUILD-abc1234"]) {
    assert.equal(isRetentionTag(tag), true, `missed ${tag}`);
  }
  for (const tag of ["latest", "alpine", "build", "build-", "buildx-1234567", "v1.0", "build-zzzz"]) {
    assert.equal(isRetentionTag(tag), false, `wrongly matched ${tag}`);
  }
});

test("in use beats a retention tag, since neither can be removed", () => {
  assert.equal(
    classifyImageProtection({ inUse: true, tag: "build-abc1234" }),
    "in-use",
  );
});

test("an in-use image cannot be deleted even when forced", () => {
  // Docker refuses regardless; forcing would only surface a worse error later.
  assert.equal(canDeleteImage("in-use", true).allowed, false);
  assert.match(canDeleteImage("in-use", true).error ?? "", /in use by a container/);
});

test("a retention tag needs an explicit override", () => {
  assert.equal(canDeleteImage("retention-tag", false).allowed, false);
  assert.match(
    canDeleteImage("retention-tag", false).error ?? "",
    /removes that rollback point/,
  );
  assert.equal(canDeleteImage("retention-tag", true).allowed, true);
});

test("an unprotected image needs no override", () => {
  assert.equal(canDeleteImage(null, false).allowed, true);
  assert.equal(canDeleteImage(null, false).error, null);
});

test("a dangling image is recognised", () => {
  assert.equal(isUntaggedImage({ repository: "<none>", tag: "<none>" }), true);
  assert.equal(isUntaggedImage({ repository: "nginx", tag: "alpine" }), false);
});

test("malformed output yields nothing rather than throwing", () => {
  assert.deepEqual(parseDockerImageList(""), []);
  assert.deepEqual(parseDockerImageList("not json"), []);
  assert.deepEqual(parseDockerImageList("{}"), []);
  assert.deepEqual(parseDockerImageList('[{"Repository":"x"}]'), []);
});

test("a missing size reads as unknown, not zero", () => {
  const entry = parseDockerImageList('[{"ID":"abc123def456","Repository":"x","Tag":"y"}]')[0];
  assert.equal(entry.sizeBytes, null);
  assert.equal(entry.uniqueSizeBytes, null);
  assert.equal(entry.containers, 0);
});

test("Docker's created timestamp becomes a real date", () => {
  // "2026-08-14 08:13:57 +0000 UTC" is not a format any engine must accept, so
  // the components are assembled rather than handed to Date as-is.
  assert.equal(
    parseDockerCreatedAt("2026-08-14 08:13:57 +0000 UTC"),
    "2026-08-14T08:13:57.000Z",
  );
});

test("a non-zero offset is honoured, not assumed to be UTC", () => {
  assert.equal(
    parseDockerCreatedAt("2026-08-14 15:13:57 +0700 WIB"),
    "2026-08-14T08:13:57.000Z",
  );
  assert.equal(
    parseDockerCreatedAt("2026-08-14 03:13:57 -0500 EST"),
    "2026-08-14T08:13:57.000Z",
  );
});

test("an unreadable timestamp yields null rather than an invalid date", () => {
  for (const value of ["", "3 days ago", "not a date", "2026-13-45 99:99:99 +0000"]) {
    assert.equal(parseDockerCreatedAt(value), null, `accepted ${value}`);
  }
});

test("the parsed date rides along with the image", () => {
  assert.equal(parseDockerImageList(IMAGES)[0].createdAt, "2026-08-14T08:13:57.000Z");
});
