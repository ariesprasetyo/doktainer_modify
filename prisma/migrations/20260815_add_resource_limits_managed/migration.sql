-- Marks a container whose limits the panel owns.
--
-- Rebuild reads limits back off the running container so that limits set
-- outside the panel are not lost. Without this flag a limit the user cleared
-- looks identical to one that was never set, so the live value is carried
-- forward and the limit can never actually be removed.
--
-- Existing rows default to false: their limits, if any, keep coming from the
-- running container until the panel writes them.
ALTER TABLE "containers"
  ADD COLUMN "resourceLimitsManaged" BOOLEAN NOT NULL DEFAULT false;
