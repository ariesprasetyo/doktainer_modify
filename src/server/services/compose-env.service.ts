import { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "../lib/crypto";
import type { ComposeEnvFileOverride } from "./ssh.service";

/**
 * Storage for a compose deployment's env files.
 *
 * These hold the deployment's actual secrets — database passwords, API keys —
 * and were originally kept as plain JSON even though the git access token in
 * the same row was encrypted. They are now encrypted with the same key.
 *
 * Both the delete route and the rollback service need to read them, so the
 * encoding lives here rather than in whichever route happened to need it
 * first.
 */

export function parseComposeEnvOverrides(
  value: unknown,
): ComposeEnvFileOverride[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { path?: unknown }).path !== "string" ||
      typeof (entry as { content?: unknown }).content !== "string"
    ) {
      return [];
    }

    return [
      {
        path: (entry as { path: string }).path,
        content: (entry as { content: string }).content,
      },
    ];
  });
}

/**
 * Rows written before encryption existed still hold plain JSON in the legacy
 * column and are read from there until the next write moves them across. A
 * one-off SQL migration cannot do it, since only the application holds
 * ENCRYPTION_KEY.
 */
export function readStoredComposeEnvOverrides(source: {
  composeEnvOverridesEnc?: string | null;
  composeEnvOverrides?: unknown;
}): ComposeEnvFileOverride[] {
  const encrypted = source.composeEnvOverridesEnc?.trim();

  if (encrypted) {
    try {
      return parseComposeEnvOverrides(JSON.parse(decrypt(encrypted)));
    } catch {
      // Encrypted under a key that is no longer available. Returning nothing
      // makes the deploy fail on the missing env file, which is the honest
      // outcome — starting the stack without its configuration would be worse.
      return [];
    }
  }

  return parseComposeEnvOverrides(source.composeEnvOverrides);
}

/**
 * Write form: encrypted, with the legacy plaintext column cleared so a row
 * never keeps a readable copy once rewritten.
 */
export function buildComposeEnvOverridesWrite(
  files: ComposeEnvFileOverride[],
): {
  composeEnvOverridesEnc: string | null;
  composeEnvOverrides: typeof Prisma.DbNull;
} {
  return {
    composeEnvOverridesEnc: files.length
      ? encrypt(JSON.stringify(files))
      : null,
    composeEnvOverrides: Prisma.DbNull,
  };
}
