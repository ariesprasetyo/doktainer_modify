-- Resource limits requested for a container. These are separate from the
-- existing cpuUsage/ramUsage columns, which record observed usage rather than
-- a ceiling.
--
-- Every column is nullable: null means "let Docker decide", which is not the
-- same as 0, a value Docker reads as explicitly unlimited.
ALTER TABLE "containers"
  ADD COLUMN "cpuShares" INTEGER,
  ADD COLUMN "cpuCores" TEXT,
  ADD COLUMN "memoryLimit" TEXT;
