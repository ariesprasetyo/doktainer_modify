-- Per-service compose settings (restart, command, mounts, cpu and memory
-- limits) that the panel writes to a generated override file on each deploy.
--
-- Kept as plain JSON rather than encrypted like composeEnvOverridesEnc: these
-- are resource settings, not credentials.
ALTER TABLE "container_deployment_sources"
  ADD COLUMN "composeServiceOverrides" JSONB;
