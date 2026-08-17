-- Env files bind-mounted into a container at runtime.
--
-- A non-compose git build had no way to supply environment at all: the env
-- variables field was only rendered for manual deploys, and env files were
-- gated to compose. An app that reads a .env file from disk could not be
-- configured.
--
-- Mounted rather than written into the build context: a Dockerfile that copies
-- the tree would bake the file into an image layer, where anyone able to
-- inspect the image can read it. Encrypted for the same reason the compose env
-- files are.
ALTER TABLE "container_deployment_sources"
  ADD COLUMN "runtimeEnvFilesEnc" TEXT;
