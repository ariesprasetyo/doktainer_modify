-- Opt-in flag for redeploying a container when its git provider reports a push
-- to the configured branch. Defaults to false so existing containers keep their
-- manual-only behaviour.
ALTER TABLE "container_deployment_sources"
  ADD COLUMN "autoDeployOnPush" BOOLEAN NOT NULL DEFAULT false;
