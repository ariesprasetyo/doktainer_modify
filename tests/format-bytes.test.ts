import assert from "node:assert/strict";
import test from "node:test";

import { formatBytes } from "../src/lib/format-bytes";

test("bytes scale up to a readable unit", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(148_200_000), "141 MB");
  assert.equal(formatBytes(2 * 1024 ** 3), "2.0 GB");
});

test("a decimal is kept only where rounding would mislead", () => {
  // 1.4 GB must not read as 1 GB.
  assert.equal(formatBytes(1.4 * 1024 ** 3), "1.4 GB");
  assert.equal(formatBytes(15.7 * 1024 ** 2), "16 MB");
});

test("a suffix is appended for rates", () => {
  assert.equal(formatBytes(1024, "/s"), "1.0 KB/s");
});

test("a non-finite value reads as unknown rather than NaN", () => {
  assert.equal(formatBytes(Number.NaN), "—");
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), "—");
});

test("a negative value keeps its sign", () => {
  assert.equal(formatBytes(-2048), "-2.0 KB");
});
