import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetricHistory,
  downsampleHistory,
  resolveRangeHours,
  type MetricHistoryPoint,
  type StoredMetricSample,
} from "../../src/server/services/metric-history.service";
import { matchSamplesToContainers } from "../../src/server/services/metric-sampler.service";
import type { DockerContainerStatsEntry } from "../../src/server/services/ssh.service";

const BASE = new Date("2026-08-17T10:00:00.000Z").getTime();

function sample(
  offsetSeconds: number,
  overrides: Partial<StoredMetricSample> = {},
): StoredMetricSample {
  return {
    recordedAt: new Date(BASE + offsetSeconds * 1000),
    cpuPercent: 10,
    memoryPercent: 20,
    pids: 5,
    memoryUsedBytes: 1000,
    memoryLimitBytes: 5000,
    networkRxBytes: 0,
    networkTxBytes: 0,
    blockReadBytes: 0,
    blockWriteBytes: 0,
    ...overrides,
  };
}

test("cumulative counters become a per-second rate", () => {
  const points = buildMetricHistory([
    sample(0, { networkRxBytes: 1_000 }),
    sample(30, { networkRxBytes: 4_000 }),
  ]);

  assert.equal(points[1].networkRxRate, 100);
});

test("the first point has no rate because there is nothing to compare to", () => {
  const points = buildMetricHistory([sample(0, { networkRxBytes: 1_000 })]);
  assert.equal(points[0].networkRxRate, null);
});

test("a container restart is a gap, not negative traffic", () => {
  // Docker resets the counters to zero, which subtracted from the previous
  // total would draw a large downward spike that never happened.
  const points = buildMetricHistory([
    sample(0, { networkRxBytes: 900_000 }),
    sample(30, { networkRxBytes: 120 }),
  ]);

  assert.equal(points[1].networkRxRate, null);
});

test("samples too far apart do not produce a rate", () => {
  // The panel could have been down; averaging across that gap invents a number.
  const points = buildMetricHistory([
    sample(0, { networkRxBytes: 0 }),
    sample(3600, { networkRxBytes: 3_600_000 }),
  ]);

  assert.equal(points[1].networkRxRate, null);
});

test("a missing counter yields no rate rather than zero", () => {
  const points = buildMetricHistory([
    sample(0, { networkRxBytes: null }),
    sample(30, { networkRxBytes: 4_000 }),
  ]);

  assert.equal(points[1].networkRxRate, null);
});

test("gauges are passed through untouched", () => {
  const points = buildMetricHistory([
    sample(0, { cpuPercent: 42.5, memoryPercent: 63.25, pids: 17 }),
  ]);

  assert.equal(points[0].cpuPercent, 42.5);
  assert.equal(points[0].memoryPercent, 63.25);
  assert.equal(points[0].pids, 17);
  assert.equal(points[0].at, BASE);
});

test("only known ranges are accepted", () => {
  assert.equal(resolveRangeHours(1), 1);
  assert.equal(resolveRangeHours(168), 168);
  for (const value of [0, -5, 99999, "abc", null, undefined, 7.5]) {
    assert.equal(resolveRangeHours(value), 24, `accepted ${value}`);
  }
});

function point(at: number, cpuPercent: number): MetricHistoryPoint {
  return {
    at,
    cpuPercent,
    memoryPercent: 0,
    memoryUsedBytes: null,
    pids: 0,
    networkRxRate: null,
    networkTxRate: null,
    blockReadRate: null,
    blockWriteRate: null,
  };
}

test("thinning keeps the peak of each bucket", () => {
  // Averaging would flatten the spike that is the reason to look at the chart.
  const points = [
    point(1, 5),
    point(2, 91),
    point(3, 4),
    point(4, 6),
    point(5, 7),
    point(6, 8),
  ];

  const thinned = downsampleHistory(points, 3);
  assert.equal(thinned.length, 3);
  assert.ok(thinned.some((entry) => entry.cpuPercent === 91));
});

test("a series already small enough is left alone", () => {
  const points = [point(1, 5), point(2, 6)];
  assert.equal(downsampleHistory(points, 10), points);
});

function statsEntry(
  overrides: Partial<DockerContainerStatsEntry> = {},
): DockerContainerStatsEntry {
  return {
    id: "abc123def456",
    name: "app",
    cpuPercent: 1,
    memoryPercent: 2,
    pids: 3,
    memory: { raw: "", usedBytes: 100, limitBytes: 200 },
    network: { raw: "", readBytes: 10, writeBytes: 20 },
    io: { raw: "", readBytes: 30, writeBytes: 40 },
    ...overrides,
  } as DockerContainerStatsEntry;
}

test("a reading is matched to its container by docker id", () => {
  const rows = matchSamplesToContainers(
    [statsEntry({ id: "abc123def456", name: "renamed-since" })],
    [{ id: "c1", name: "app", dockerId: "abc123def456" }],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].containerId, "c1");
  assert.equal(rows[0].memoryUsedBytes, 100);
});

test("a reading falls back to the name when the id is unknown", () => {
  const rows = matchSamplesToContainers(
    [statsEntry({ id: "999999999999", name: "app" })],
    [{ id: "c1", name: "app", dockerId: null }],
  );

  assert.equal(rows[0]?.containerId, "c1");
});

test("a container Docker knows but the panel does not is skipped", () => {
  assert.deepEqual(
    matchSamplesToContainers(
      [statsEntry({ id: "other", name: "not-ours" })],
      [{ id: "c1", name: "app", dockerId: "abc123def456" }],
    ),
    [],
  );
});

test("two readings cannot both claim the same container", () => {
  // Otherwise one tick would write two samples with the same timestamp.
  const rows = matchSamplesToContainers(
    [
      statsEntry({ id: "abc123def456", name: "app" }),
      statsEntry({ id: "abc123def456", name: "app" }),
    ],
    [{ id: "c1", name: "app", dockerId: "abc123def456" }],
  );

  assert.equal(rows.length, 1);
});
