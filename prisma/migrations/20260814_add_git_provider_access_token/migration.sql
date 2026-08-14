-- Personal/group access token used for authenticated provider API reads
-- (repository and branch listing). Stored encrypted, never returned to clients.
ALTER TABLE "user_git_providers" ADD COLUMN "accessTokenEnc" TEXT;
