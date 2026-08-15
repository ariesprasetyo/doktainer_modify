-- Compose env files carry database passwords, API keys, and similar secrets,
-- but were stored as plain JSON while the git access token in the same row was
-- encrypted. Add an encrypted column alongside the existing one.
--
-- Existing rows are intentionally left untouched: the values can only be
-- encrypted with the application's ENCRYPTION_KEY, which SQL has no access to.
-- The application reads the legacy column when the encrypted one is empty, and
-- clears it as each row is rewritten.
ALTER TABLE "container_deployment_sources"
  ADD COLUMN "composeEnvOverridesEnc" TEXT;
