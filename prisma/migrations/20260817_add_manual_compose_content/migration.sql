-- The compose file of a stack deployed by pasting it in.
--
-- A git-based stack gets its compose file from the clone on every deploy, but a
-- manual one was written to the server once and never recorded, so the panel
-- could neither redeploy it nor rebuild the directory if it was lost.
ALTER TABLE "container_deployment_sources"
  ADD COLUMN "composeContent" TEXT;
