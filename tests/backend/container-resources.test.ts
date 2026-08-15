import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResourceFlags,
  hasResourceLimits,
  memorySwapBytesForLimit,
  resolveLimitsForRebuild,
  normalizeCpuCores,
  normalizeCpuShares,
  normalizeMemory,
  normalizeResourceLimits,
  resourceLimitsFromDocker,
} from "../../src/server/services/container-resources";

test("an unset limit stays unset instead of becoming zero", () => {
  // 0 means "explicitly unlimited" to Docker, so an empty field must not turn
  // into a limit the user never asked for.
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(normalizeCpuShares(value), null);
    assert.equal(normalizeCpuCores(value), null);
    assert.equal(normalizeMemory(value), null);
  }

  assert.deepEqual(buildResourceFlags(normalizeResourceLimits({})), []);
  assert.equal(hasResourceLimits(normalizeResourceLimits({})), false);
});

test("valid limits become the docker flags that carry them", () => {
  assert.deepEqual(
    buildResourceFlags(
      normalizeResourceLimits({
        cpuShares: "512",
        cpuCores: "1.5",
        memory: "512m",
      }),
    ),
    ["--cpu-shares", "512", "--cpus", "1.5", "--memory", "512m"],
  );
});

test("only the limits that were set produce flags", () => {
  assert.deepEqual(
    buildResourceFlags(normalizeResourceLimits({ memory: "1g" })),
    ["--memory", "1g"],
  );
});

test("cpu shares outside Docker's accepted range are rejected", () => {
  assert.equal(normalizeCpuShares("2"), 2);
  assert.equal(normalizeCpuShares(262_144), 262_144);
  for (const value of ["1", "0", "262145", "-5", "1.5", "abc"]) {
    assert.throws(() => normalizeCpuShares(value), undefined, `accepted ${value}`);
  }
});

test("cpu cores accept fractions but reject nonsense", () => {
  assert.equal(normalizeCpuCores("0.5"), "0.5");
  assert.equal(normalizeCpuCores("2"), "2");
  assert.equal(normalizeCpuCores(1.25), "1.25");
  for (const value of ["0", "-1", "1.2345", "1e3", "abc", "1,5"]) {
    assert.throws(() => normalizeCpuCores(value), undefined, `accepted ${value}`);
  }
});

test("equivalent core values normalize to one stored form", () => {
  // Otherwise "1.50" and "1.5" compare as different on every save.
  assert.equal(normalizeCpuCores("1.50"), "1.5");
  assert.equal(normalizeCpuCores("2.000"), "2");
});

test("memory accepts the usual unit suffixes", () => {
  assert.equal(normalizeMemory("512m"), "512m");
  assert.equal(normalizeMemory("512M"), "512m");
  assert.equal(normalizeMemory("2g"), "2g");
  assert.equal(normalizeMemory("1GB"), "1g");
  assert.equal(normalizeMemory(" 256 m "), "256m");
});

test("memory below Docker's floor is rejected with a usable message", () => {
  // Docker's own error for this is obscure, and it only appears mid-deploy.
  assert.throws(() => normalizeMemory("1m"), /at least 6m/);
  assert.throws(() => normalizeMemory("1024"), /at least 6m/);
  assert.equal(normalizeMemory("6m"), "6m");
});

test("a malformed memory value is rejected", () => {
  for (const value of ["abc", "512x", "-512m", "512 mb extra", "m512"]) {
    assert.throws(() => normalizeMemory(value), undefined, `accepted ${value}`);
  }
});

test("shell metacharacters cannot survive validation", () => {
  // These reach a shell command, so a value that parses as a limit must never
  // also parse as shell syntax.
  for (const value of ["512m; rm -rf /", "$(id)", "1`id`", "1|2", "1 && id"]) {
    assert.throws(() => normalizeMemory(value), undefined, `memory accepted ${value}`);
    assert.throws(() => normalizeCpuCores(value), undefined, `cores accepted ${value}`);
    assert.throws(() => normalizeCpuShares(value), undefined, `shares accepted ${value}`);
  }
});

test("a newline cannot be smuggled into a value", () => {
  assert.throws(() => normalizeMemory("512m\nid"));
  assert.throws(() => normalizeCpuCores("1\nid"));
  assert.throws(() => normalizeCpuShares("2\nid"));
});

test("Docker's zero for an unset limit reads back as unset", () => {
  // Carrying the 0 forward would turn "never configured" into an explicit
  // unlimited on the next deploy.
  assert.deepEqual(
    resourceLimitsFromDocker({ cpuShares: 0, nanoCpus: 0, memoryBytes: 0 }),
    { cpuShares: null, cpuCores: null, memory: null },
  );
  assert.deepEqual(resourceLimitsFromDocker({}), {
    cpuShares: null,
    cpuCores: null,
    memory: null,
  });
});

test("limits set on a running container read back in the form they were given", () => {
  assert.deepEqual(
    resourceLimitsFromDocker({
      cpuShares: 512,
      nanoCpus: 1.5e9,
      memoryBytes: 512 * 1024 * 1024,
    }),
    { cpuShares: 512, cpuCores: "1.5", memory: "512m" },
  );
});

test("memory reads back in the largest unit that divides evenly", () => {
  assert.equal(
    resourceLimitsFromDocker({ memoryBytes: 2 * 1024 ** 3 }).memory,
    "2g",
  );
  assert.equal(
    resourceLimitsFromDocker({ memoryBytes: 1536 * 1024 ** 2 }).memory,
    "1536m",
  );
  assert.equal(
    resourceLimitsFromDocker({ memoryBytes: 100_000_000 }).memory,
    "100000000b",
  );
});

test("a value read back from Docker is accepted by validation again", () => {
  // Otherwise a rebuild would fail on the very limits the panel just applied.
  const live = resourceLimitsFromDocker({
    cpuShares: 512,
    nanoCpus: 2.5e9,
    memoryBytes: 768 * 1024 * 1024,
  });

  assert.deepEqual(
    normalizeResourceLimits({
      cpuShares: live.cpuShares,
      cpuCores: live.cpuCores,
      memory: live.memory,
    }),
    live,
  );
});

test("limits set outside the panel are kept rather than dropped", () => {
  // Until the panel owns them, the running container is the only record.
  assert.deepEqual(
    resolveLimitsForRebuild(
      { cpuShares: null, cpuCores: null, memory: null },
      { cpuShares: 512, cpuCores: "2", memory: "512m" },
      false,
    ),
    { cpuShares: 512, cpuCores: "2", memory: "512m" },
  );
});

test("a stored limit wins over what the container currently runs with", () => {
  assert.deepEqual(
    resolveLimitsForRebuild(
      { cpuShares: 1024, cpuCores: null, memory: "1g" },
      { cpuShares: 512, cpuCores: "2", memory: "512m" },
      false,
    ),
    { cpuShares: 1024, cpuCores: "2", memory: "1g" },
  );
});

test("a cleared limit is actually removed once the panel owns them", () => {
  // The regression this guards: reading the limit back off the still-running
  // container reapplies it on every rebuild, so it can never be removed.
  assert.deepEqual(
    resolveLimitsForRebuild(
      { cpuShares: null, cpuCores: null, memory: null },
      { cpuShares: 512, cpuCores: "0.75", memory: "256m" },
      true,
    ),
    { cpuShares: null, cpuCores: null, memory: null },
  );
});

test("clearing one limit leaves the others alone", () => {
  assert.deepEqual(
    resolveLimitsForRebuild(
      { cpuShares: null, cpuCores: null, memory: "1g" },
      { cpuShares: 512, cpuCores: "2", memory: "256m" },
      true,
    ),
    { cpuShares: null, cpuCores: null, memory: "1g" },
  );
});

test("a memory limit carries a swap limit matching Docker's own default", () => {
  // `docker update --memory` is refused without it, and Docker's run default
  // and compose's deploy limit both land on twice the memory.
  assert.equal(memorySwapBytesForLimit("512m"), String(1024 * 1024 * 1024));
  assert.equal(memorySwapBytesForLimit("1g"), String(2 * 1024 ** 3));
});

test("no memory limit means no swap limit", () => {
  assert.equal(memorySwapBytesForLimit(null), null);
});
