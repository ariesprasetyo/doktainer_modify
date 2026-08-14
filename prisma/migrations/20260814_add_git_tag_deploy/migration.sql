-- repoTag pins the checked-out ref to a tag so a deployed version stops moving
-- with its branch, which is what makes rolling back to an earlier tag possible.
-- autoDeployTagPattern opts a container into deploying tag pushes whose name
-- matches the glob. Both are nullable; leaving them empty keeps branch-only
-- behaviour.
ALTER TABLE "container_deployment_sources"
  ADD COLUMN "repoTag" TEXT,
  ADD COLUMN "autoDeployTagPattern" TEXT;
