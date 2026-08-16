import assert from "node:assert/strict";
import test from "node:test";

import { megabytesToMemory, memoryToMegabytes } from "../src/lib/memory-units";

test("a stored value is shown as a plain number of megabytes", () => {
  assert.equal(memoryToMegabytes("512m"), "512");
  assert.equal(memoryToMegabytes("2g"), "2048");
  assert.equal(memoryToMegabytes("1536m"), "1536");
  assert.equal(memoryToMegabytes("512M"), "512");
});

test("an unset value stays unset in both directions", () => {
  assert.equal(memoryToMegabytes(""), "");
  assert.equal(memoryToMegabytes(null), "");
  assert.equal(memoryToMegabytes(undefined), "");
  assert.equal(megabytesToMemory(""), undefined);
  assert.equal(megabytesToMemory("   "), undefined);
});

test("a typed number becomes megabytes for Docker", () => {
  assert.equal(megabytesToMemory("512"), "512m");
  assert.equal(megabytesToMemory(" 256 "), "256m");
});

test("a value the user typed with a unit is left alone", () => {
  // Appending "m" here would produce the meaningless "2gm".
  assert.equal(megabytesToMemory("2g"), "2g");
  assert.equal(megabytesToMemory("512m"), "512m");
});

test("a value round-trips through the field unchanged", () => {
  for (const stored of ["512m", "2g", "128m"]) {
    assert.equal(megabytesToMemory(memoryToMegabytes(stored)), stored === "2g" ? "2048m" : stored);
  }
});

test("a byte value smaller than a megabyte keeps its decimals", () => {
  // Rounding it to 0 would turn a real limit into no limit at all.
  assert.equal(memoryToMegabytes("524288b"), "0.5");
});

test("an unparseable value yields empty rather than a wrong number", () => {
  assert.equal(memoryToMegabytes("abc"), "");
  assert.equal(memoryToMegabytes("512x"), "");
});
