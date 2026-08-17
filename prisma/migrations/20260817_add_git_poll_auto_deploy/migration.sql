-- Auto deploy by asking the provider for new commits instead of waiting to be
-- told about them.
--
-- The webhook receiver it replaces needed the panel to be reachable from the
-- provider, which a self-hosted GitLab on a private network refuses to do: its
-- SSRF guard rejects private-network webhook URLs and the setting to allow that
-- is instance-admin only. Polling runs in the direction that already works.
ALTER TYPE "DeploymentTrigger" ADD VALUE IF NOT EXISTS 'GIT_POLL';

ALTER TABLE "container_deployment_sources"
  ADD COLUMN "pollIntervalSeconds" INTEGER,
  -- The commit auto deploy last acted on. Without it a restart would redeploy
  -- whatever is already running, since the newest commit always differs from
  -- nothing.
  ADD COLUMN "lastPolledCommitSha" TEXT,
  ADD COLUMN "lastPolledAt" TIMESTAMP(3),
  -- A provider that stops answering would otherwise be indistinguishable from
  -- a repository that never changes.
  ADD COLUMN "lastPollError" TEXT;
