-- Time series of container usage, sampled on a timer so a spike can be traced
-- back to when it happened. Before this the panel drew a sparkline generated
-- from the current value, which showed peaks that never occurred.
--
-- Network and block IO are stored as Docker reports them: totals accumulated
-- since the container started. Rates are derived when the series is read, so
-- a container restart resetting the counters stays visible as a reset rather
-- than being recorded as negative traffic.
CREATE TABLE "container_metric_samples" (
  "id" TEXT NOT NULL,
  "containerId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cpuPercent" DOUBLE PRECISION NOT NULL,
  "memoryPercent" DOUBLE PRECISION NOT NULL,
  "pids" INTEGER NOT NULL,
  "memoryUsedBytes" DOUBLE PRECISION,
  "memoryLimitBytes" DOUBLE PRECISION,
  "networkRxBytes" DOUBLE PRECISION,
  "networkTxBytes" DOUBLE PRECISION,
  "blockReadBytes" DOUBLE PRECISION,
  "blockWriteBytes" DOUBLE PRECISION,
  CONSTRAINT "container_metric_samples_pkey" PRIMARY KEY ("id")
);

-- Every read is "this container, this time range", and pruning walks the same
-- order.
CREATE INDEX "container_metric_samples_containerId_recordedAt_idx"
  ON "container_metric_samples"("containerId", "recordedAt");

ALTER TABLE "container_metric_samples"
  ADD CONSTRAINT "container_metric_samples_containerId_fkey"
  FOREIGN KEY ("containerId") REFERENCES "containers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
