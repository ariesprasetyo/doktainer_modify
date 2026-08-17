/**
 * Turns stored samples into the series the charts draw.
 *
 * Network and block IO are stored as Docker reports them — totals accumulated
 * since the container started — so they have to become per-second rates here.
 * A container restart sets those counters back to zero, which would otherwise
 * read as a large negative rate; the point is dropped instead, leaving a gap
 * that is honest about there being no measurable rate across the restart.
 */

export interface StoredMetricSample {
  recordedAt: Date;
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

export interface MetricHistoryPoint {
  /** Epoch milliseconds, so the client can format in the viewer's timezone. */
  at: number;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedBytes: number | null;
  pids: number;
  /** Bytes per second, derived from the gap to the previous sample. */
  networkRxRate: number | null;
  networkTxRate: number | null;
  blockReadRate: number | null;
  blockWriteRate: number | null;
}

export interface MetricHistoryRange {
  hours: number;
}

/** A gap this long means the samples are not adjacent enough to form a rate. */
const MAX_RATE_GAP_SECONDS = 300;

function rateBetween(
  previous: number | null,
  current: number | null,
  seconds: number,
): number | null {
  if (previous === null || current === null) return null;
  if (seconds <= 0 || seconds > MAX_RATE_GAP_SECONDS) return null;

  const delta = current - previous;
  // A counter that went backwards means the container restarted, not that
  // traffic was negative.
  if (delta < 0) return null;

  return delta / seconds;
}

export function buildMetricHistory(
  samples: StoredMetricSample[],
): MetricHistoryPoint[] {
  const points: MetricHistoryPoint[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = index > 0 ? samples[index - 1] : null;
    const seconds = previous
      ? (sample.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000
      : 0;

    points.push({
      at: sample.recordedAt.getTime(),
      cpuPercent: sample.cpuPercent,
      memoryPercent: sample.memoryPercent,
      memoryUsedBytes: sample.memoryUsedBytes,
      pids: sample.pids,
      networkRxRate: previous
        ? rateBetween(previous.networkRxBytes, sample.networkRxBytes, seconds)
        : null,
      networkTxRate: previous
        ? rateBetween(previous.networkTxBytes, sample.networkTxBytes, seconds)
        : null,
      blockReadRate: previous
        ? rateBetween(previous.blockReadBytes, sample.blockReadBytes, seconds)
        : null,
      blockWriteRate: previous
        ? rateBetween(previous.blockWriteBytes, sample.blockWriteBytes, seconds)
        : null,
    });
  }

  return points;
}

const ALLOWED_RANGE_HOURS = [1, 6, 24, 72, 168] as const;
export const DEFAULT_RANGE_HOURS = 24;

/**
 * Only a fixed set of windows is accepted, so a request cannot ask for a span
 * that would pull the whole table into memory.
 */
export function resolveRangeHours(value: unknown): number {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return DEFAULT_RANGE_HOURS;

  return (
    ALLOWED_RANGE_HOURS.find((allowed) => allowed === hours) ??
    DEFAULT_RANGE_HOURS
  );
}

/**
 * A week at 30s intervals is over 20k points, far more than a chart a few
 * hundred pixels wide can show. Thinning keeps the peaks: each bucket keeps
 * its highest CPU sample, because a spike is the whole reason to look.
 */
export function downsampleHistory(
  points: MetricHistoryPoint[],
  maxPoints: number,
): MetricHistoryPoint[] {
  if (points.length <= maxPoints || maxPoints < 1) return points;

  const bucketSize = Math.ceil(points.length / maxPoints);
  const result: MetricHistoryPoint[] = [];

  for (let start = 0; start < points.length; start += bucketSize) {
    const bucket = points.slice(start, start + bucketSize);
    let peak = bucket[0];
    for (const point of bucket) {
      if (point.cpuPercent > peak.cpuPercent) peak = point;
    }
    result.push(peak);
  }

  return result;
}
