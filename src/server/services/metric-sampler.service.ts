import prisma from "../lib/prisma";
import * as ssh from "./ssh.service";
import type { DockerContainerStatsEntry } from "./ssh.service";

/**
 * Periodic sampling of container usage.
 *
 * The metric cards used to draw a sparkline generated from the current value,
 * so the peaks they showed never happened. Answering "when did it spike" needs
 * readings kept over time, which is what this collects.
 *
 * Docker is asked once per server rather than once per container: the sampler
 * runs on a timer over every container on every server, and a round trip each
 * would not stay reasonable as that grows.
 */

export const SAMPLE_INTERVAL_MS = 30_000;
export const RETENTION_DAYS = 7;
/** Pruning a week of rows is cheap, and hourly keeps each delete small. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface MetricSampleRow {
  containerId: string;
  cpuPercent: number;
  memoryPercent: number;
  pids: number;
  memoryUsedBytes: number | null;
  memoryLimitBytes: number | null;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  blockReadBytes: number | null;
  blockWriteBytes: number | null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Matches Docker's per-container readings to the panel's container rows.
 *
 * Docker reports a name and a short id; a compose service is renamed often
 * enough that the id is the more reliable of the two, so it is tried first.
 */
export function matchSamplesToContainers(
  entries: DockerContainerStatsEntry[],
  containers: Array<{ id: string; name: string; dockerId: string | null }>,
): MetricSampleRow[] {
  const byDockerId = new Map<string, string>();
  const byName = new Map<string, string>();

  for (const container of containers) {
    const dockerId = container.dockerId?.trim();
    if (dockerId) byDockerId.set(dockerId, container.id);
    byName.set(container.name, container.id);
  }

  const rows: MetricSampleRow[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const shortId = entry.id.slice(0, 12);
    const containerId =
      (shortId && byDockerId.get(shortId)) ?? byName.get(entry.name);

    // A container Docker knows about but the panel does not is simply not ours.
    if (!containerId || seen.has(containerId)) continue;
    seen.add(containerId);

    rows.push({
      containerId,
      cpuPercent: entry.cpuPercent,
      memoryPercent: entry.memoryPercent,
      pids: entry.pids,
      memoryUsedBytes: toFiniteNumber(entry.memory.usedBytes),
      memoryLimitBytes: toFiniteNumber(entry.memory.limitBytes),
      networkRxBytes: toFiniteNumber(entry.network.readBytes),
      networkTxBytes: toFiniteNumber(entry.network.writeBytes),
      blockReadBytes: toFiniteNumber(entry.io.readBytes),
      blockWriteBytes: toFiniteNumber(entry.io.writeBytes),
    });
  }

  return rows;
}

async function sampleServer(server: {
  id: string;
}): Promise<number> {
  const containers = await prisma.container.findMany({
    where: { serverId: server.id, status: "RUNNING" },
    select: { id: true, name: true, dockerId: true },
  });

  if (containers.length === 0) return 0;

  const record = await prisma.server.findUnique({ where: { id: server.id } });
  if (!record) return 0;

  const entries = await ssh.dockerStatsAll(record);
  const rows = matchSamplesToContainers(entries, containers);
  if (rows.length === 0) return 0;

  await prisma.containerMetricSample.createMany({ data: rows });
  return rows.length;
}

export async function collectMetricSamples(
  log?: (message: string, error?: unknown) => void,
): Promise<number> {
  const servers = await prisma.server.findMany({ select: { id: true } });
  let written = 0;

  // Servers are walked one at a time: a panel managing several of them should
  // not open an SSH session to all of them at the same instant every 30s.
  for (const server of servers) {
    try {
      written += await sampleServer(server);
    } catch (error) {
      // An unreachable server must not stop the others from being sampled.
      log?.(`metric sampling failed for server ${server.id}`, error);
    }
  }

  return written;
}

export async function pruneMetricSamples(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.containerMetricSample.deleteMany({
    where: { recordedAt: { lt: cutoff } },
  });

  return result.count;
}

let sampleTimer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;
let sampling = false;

/**
 * A slow round must not stack on the next one, so an in-flight sample skips
 * the tick rather than queueing another SSH session behind it.
 */
export function startMetricSampler(logger?: {
  error: (payload: unknown, message: string) => void;
}) {
  if (sampleTimer) return;

  const log = (message: string, error?: unknown) =>
    logger?.error({ error }, message);

  const tick = async () => {
    if (sampling) return;
    sampling = true;
    try {
      await collectMetricSamples(log);
    } catch (error) {
      log("metric sampling round failed", error);
    } finally {
      sampling = false;
    }
  };

  sampleTimer = setInterval(tick, SAMPLE_INTERVAL_MS);
  sampleTimer.unref?.();

  pruneTimer = setInterval(() => {
    pruneMetricSamples(new Date()).catch((error) =>
      log("metric sample pruning failed", error),
    );
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();
}

export function stopMetricSampler() {
  if (sampleTimer) clearInterval(sampleTimer);
  if (pruneTimer) clearInterval(pruneTimer);
  sampleTimer = null;
  pruneTimer = null;
}
