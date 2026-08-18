import assert from "node:assert/strict";
import test from "node:test";

import {
  filterImages,
  formatImageDate,
  imageName,
  sortImages,
} from "../src/app/servers/components/ServerImagesPanel";
import type { DockerImageEntry } from "../src/lib/api";

function image(over: Partial<DockerImageEntry> = {}): DockerImageEntry {
  return {
    id: "aaaaaaaaaaaa",
    repository: "app",
    tag: "latest",
    createdSince: "1 day ago",
    createdAt: "2026-08-14T08:13:57.000Z",
    sizeBytes: 100,
    uniqueSizeBytes: 10,
    sharedSizeBytes: 90,
    containers: 0,
    protectionReason: null,
    ...over,
  };
}

test("a date renders as DD MMM YYYY HH:MM", () => {
  assert.match(
    formatImageDate("2026-08-14T08:13:57.000Z"),
    /^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/,
  );
});

test("a day and hour below ten keep their leading zero", () => {
  assert.match(formatImageDate("2026-03-05T04:07:00.000Z"), /^05 Mar 2026 \d{2}:\d{2}$/);
});

test("a missing or unusable date reads as unknown", () => {
  assert.equal(formatImageDate(null), "—");
  assert.equal(formatImageDate("not a date"), "—");
});

test("an untagged image is named plainly", () => {
  assert.equal(imageName(image({ repository: "<none>", tag: "<none>" })), "<untagged>");
  assert.equal(imageName(image()), "app:latest");
});

test("search matches the name and the id", () => {
  const items = [
    image({ id: "111111111111", repository: "web" }),
    image({ id: "222222222222", repository: "api" }),
  ];

  assert.equal(filterImages(items, "web", "all").length, 1);
  assert.equal(filterImages(items, "2222", "all")[0].id, "222222222222");
  assert.equal(filterImages(items, "  WEB  ", "all").length, 1);
  assert.equal(filterImages(items, "", "all").length, 2);
});

test("the status filter narrows to one kind", () => {
  const items = [
    image({ id: "1".repeat(12), protectionReason: "in-use" }),
    image({ id: "2".repeat(12), protectionReason: "retention-tag" }),
    image({ id: "3".repeat(12), protectionReason: null }),
  ];

  assert.equal(filterImages(items, "", "in-use").length, 1);
  assert.equal(filterImages(items, "", "retention-tag").length, 1);
  assert.equal(filterImages(items, "", "unused").length, 1);
  assert.equal(filterImages(items, "", "all").length, 3);
});

test("search and status narrow together", () => {
  const items = [
    image({ id: "1".repeat(12), repository: "web", protectionReason: "in-use" }),
    image({ id: "2".repeat(12), repository: "web", protectionReason: null }),
  ];

  assert.equal(filterImages(items, "web", "unused").length, 1);
  assert.equal(filterImages(items, "web", "unused")[0].protectionReason, null);
});

test("every column sorts both ways", () => {
  const items = [
    image({ id: "1".repeat(12), repository: "b", sizeBytes: 200, uniqueSizeBytes: 5, createdAt: "2026-01-01T00:00:00.000Z", protectionReason: null }),
    image({ id: "2".repeat(12), repository: "a", sizeBytes: 100, uniqueSizeBytes: 50, createdAt: "2026-06-01T00:00:00.000Z", protectionReason: "in-use" }),
  ];

  assert.equal(sortImages(items, "name", "asc")[0].repository, "a");
  assert.equal(sortImages(items, "name", "desc")[0].repository, "b");
  assert.equal(sortImages(items, "size", "desc")[0].sizeBytes, 200);
  assert.equal(sortImages(items, "size", "asc")[0].sizeBytes, 100);
  assert.equal(sortImages(items, "frees", "desc")[0].uniqueSizeBytes, 50);
  assert.equal(sortImages(items, "created", "desc")[0].createdAt, "2026-06-01T00:00:00.000Z");
  assert.equal(sortImages(items, "created", "asc")[0].createdAt, "2026-01-01T00:00:00.000Z");
});

test("status sorts by meaning, not by label text", () => {
  // Alphabetically "In use" sits between the other two labels; the intended
  // order is in-use, then rollback points, then unused.
  const items = [
    image({ id: "1".repeat(12), protectionReason: null }),
    image({ id: "2".repeat(12), protectionReason: "in-use" }),
    image({ id: "3".repeat(12), protectionReason: "retention-tag" }),
  ];

  assert.deepEqual(
    sortImages(items, "status", "asc").map((entry) => entry.protectionReason),
    ["in-use", "retention-tag", null],
  );
});

test("an unknown size sorts last whichever way the column points", () => {
  // Unknown is not smaller than known, and burying it keeps useful rows on top.
  const items = [
    image({ id: "1".repeat(12), uniqueSizeBytes: null }),
    image({ id: "2".repeat(12), uniqueSizeBytes: 10 }),
  ];

  assert.equal(sortImages(items, "frees", "desc")[0].uniqueSizeBytes, 10);
  assert.equal(sortImages(items, "frees", "asc")[0].uniqueSizeBytes, 10);
});

test("sorting leaves the original list alone", () => {
  const items = [
    image({ id: "1".repeat(12), sizeBytes: 1 }),
    image({ id: "2".repeat(12), sizeBytes: 2 }),
  ];
  sortImages(items, "size", "desc");

  assert.equal(items[0].sizeBytes, 1);
});
