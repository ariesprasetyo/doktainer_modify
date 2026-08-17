import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { decrypt, encrypt } from "../lib/crypto";

/**
 * Env files mounted into a container at runtime.
 *
 * An app that reads a `.env` file from disk cannot be configured by `-e` flags,
 * and env files were previously compose-only. The alternative — writing the file
 * into the build context — bakes it into an image layer whenever the Dockerfile
 * copies the tree, where anyone able to inspect the image can read it. Mounting
 * instead keeps the secret out of the image entirely, which is also how compose
 * treats `env_file`.
 *
 * The mount is read-only: this is configuration the container consumes, not
 * state it owns.
 */

export interface RuntimeEnvFile {
  /** Absolute path inside the container, e.g. /app/.env */
  containerPath: string;
  content: string;
}

/** Files live in their own directory so they never collide with the clone. */
export const RUNTIME_ENV_DIRECTORY = ".doktainer-env";

const MAX_FILES = 10;
const MAX_CONTENT_LENGTH = 500_000;

export function normalizeRuntimeEnvContainerPath(value: string): string {
  const path = value.trim();

  if (!path) {
    throw new Error("Env file container path cannot be empty");
  }

  if (!path.startsWith("/")) {
    throw new Error(
      `Env file container path must be absolute, for example /app/.env: ${value}`,
    );
  }

  // A colon would split the mount argument, and whitespace is rejected outright
  // by the mount validator further down.
  if (/[:\s]/.test(path)) {
    throw new Error(
      `Env file container path cannot contain a colon or whitespace: ${value}`,
    );
  }

  const normalized = pathPosix.normalize(path);

  if (normalized !== path.replace(/\/+$/, "") && normalized !== path) {
    throw new Error(`Env file container path must be normalized: ${value}`);
  }

  if (normalized === "/" || normalized.endsWith("/")) {
    throw new Error(`Env file container path must name a file: ${value}`);
  }

  return normalized;
}

export function normalizeRuntimeEnvFiles(value: unknown): RuntimeEnvFile[] {
  if (!Array.isArray(value)) return [];

  const byPath = new Map<string, RuntimeEnvFile>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;

    const record = entry as { containerPath?: unknown; content?: unknown };
    if (typeof record.containerPath !== "string") continue;
    if (typeof record.content !== "string") continue;
    if (!record.containerPath.trim()) continue;

    if (record.content.length > MAX_CONTENT_LENGTH) {
      throw new Error(
        `Env file ${record.containerPath} is larger than ${MAX_CONTENT_LENGTH} characters`,
      );
    }

    const containerPath = normalizeRuntimeEnvContainerPath(record.containerPath);
    // Last one wins rather than mounting the same target twice, which Docker
    // would reject.
    byPath.set(containerPath, { containerPath, content: record.content });
  }

  if (byPath.size > MAX_FILES) {
    throw new Error(`At most ${MAX_FILES} env files can be mounted`);
  }

  return [...byPath.values()];
}

/**
 * Where the file is written on the host.
 *
 * Two different container paths can share a basename, so the name is prefixed
 * with a digest of the full path: distinct targets always get distinct files,
 * and the same target always resolves to the same one across deploys.
 */
export function runtimeEnvHostFileName(containerPath: string): string {
  const digest = createHash("sha256")
    .update(containerPath)
    .digest("hex")
    .slice(0, 8);

  const base = pathPosix.basename(containerPath).replace(/[^A-Za-z0-9._-]/g, "");

  return `${digest}-${base || "env"}`;
}

export function runtimeEnvHostPath(
  deploymentPath: string,
  containerPath: string,
): string {
  return pathPosix.join(
    deploymentPath,
    RUNTIME_ENV_DIRECTORY,
    runtimeEnvHostFileName(containerPath),
  );
}

/**
 * Mount arguments for these files, in the same comma-separated form the deploy
 * already uses for volumes, so the existing mount validation applies to them.
 */
export function buildRuntimeEnvMounts(
  deploymentPath: string,
  files: RuntimeEnvFile[],
): string[] {
  return files.map(
    (file) =>
      `${runtimeEnvHostPath(deploymentPath, file.containerPath)}:${file.containerPath}:ro`,
  );
}

function mountSource(entry: string): string {
  return entry.split(":")[0]?.trim() ?? "";
}

/** A mount the panel put there, recognised by living in its own directory. */
function isRuntimeEnvMount(entry: string, deploymentPath: string): boolean {
  return mountSource(entry).startsWith(
    `${pathPosix.join(deploymentPath, RUNTIME_ENV_DIRECTORY)}/`,
  );
}

/**
 * Replaces the panel's env mounts with the current set.
 *
 * A rebuild reads its volumes back off the running container, so previous env
 * mounts are already in the list. Simply appending would either duplicate a
 * target, which Docker refuses, or — worse — keep the mount of a file that has
 * since been removed. The clone is fresh every deploy, so that file no longer
 * exists and Docker silently creates a *directory* at the mount source, leaving
 * the app to find a directory where its config used to be.
 *
 * Mounts under the panel's own env directory are therefore dropped first and
 * rebuilt from what is stored now, which makes removal work.
 */
export function applyRuntimeEnvMounts(
  volumes: string | undefined,
  deploymentPath: string,
  files: RuntimeEnvFile[],
): string | undefined {
  const kept = (volumes ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !isRuntimeEnvMount(entry, deploymentPath));

  const combined = [...kept, ...buildRuntimeEnvMounts(deploymentPath, files)];

  if (combined.length === 0) return volumes ? "" : volumes;
  return combined.join(",");
}

export function readStoredRuntimeEnvFiles(source: {
  runtimeEnvFilesEnc?: string | null;
}): RuntimeEnvFile[] {
  const encrypted = source.runtimeEnvFilesEnc?.trim();
  if (!encrypted) return [];

  try {
    return normalizeRuntimeEnvFiles(JSON.parse(decrypt(encrypted)));
  } catch {
    // Encrypted under a key that is no longer available, or no longer valid.
    // Returning nothing makes the container start without the file, which is a
    // visible failure rather than a silently wrong configuration.
    return [];
  }
}

export function buildRuntimeEnvFilesWrite(files: RuntimeEnvFile[]): {
  runtimeEnvFilesEnc: string | null;
} {
  return {
    runtimeEnvFilesEnc: files.length ? encrypt(JSON.stringify(files)) : null,
  };
}
