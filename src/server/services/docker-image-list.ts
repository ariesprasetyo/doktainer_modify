import { parseDockerSizeToBytes } from "./docker-size";

/**
 * Images on a server, and whether each one is safe to delete.
 *
 * Read from `docker system df -v` rather than `docker images`: the latter
 * reports UniqueSize as "N/A", and unique size is the number that matters here.
 * Docker's Size column repeats the whole image for every tag that shares its
 * layers — five build tags of one project each read 148 MB while the real cost
 * per extra tag is a couple of kilobytes.
 *
 * Two things make an image protected. A container using it cannot have its
 * image removed at all, and the retention tags are what make an instant
 * rollback possible: they exist precisely because nothing else references them,
 * so anything that deletes unused images destroys the rollback history. That
 * takes an explicit override here rather than one careless click.
 */

export type ImageProtectionReason = "in-use" | "retention-tag" | null;

export interface DockerImageEntry {
  id: string;
  repository: string;
  tag: string;
  createdSince: string;
  sizeBytes: number | null;
  /** What removing this image would actually free. */
  uniqueSizeBytes: number | null;
  sharedSizeBytes: number | null;
  containers: number;
  protectionReason: ImageProtectionReason;
}

/** `build-<sha>` keeps a past build addressable; `rollback-<sha>` a rolled-back one. */
const RETENTION_TAG_PATTERN = /^(build|rollback)-[0-9a-f]{7,40}$/i;

const UNTAGGED = "<none>";

function readCount(value: unknown): number {
  const count = Number(String(value ?? "").trim());
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isRetentionTag(tag: string): boolean {
  return RETENTION_TAG_PATTERN.test(tag.trim());
}

export function classifyImageProtection(input: {
  containers: number;
  tag: string;
}): ImageProtectionReason {
  // Docker refuses to remove an image a container is using, so reporting it as
  // protected matches what would happen anyway.
  if (input.containers > 0) return "in-use";
  if (isRetentionTag(input.tag)) return "retention-tag";
  return null;
}

export function isUntaggedImage(entry: {
  repository: string;
  tag: string;
}): boolean {
  return entry.repository === UNTAGGED || entry.tag === UNTAGGED;
}

/**
 * Parses `docker system df -v --format '{{json .Images}}'`, which emits one JSON
 * array rather than a line per image.
 */
export function parseDockerImageList(stdout: string): DockerImageEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const record = raw as Record<string, unknown>;

    // Docker prints the full sha256:... here; the short form is what a user
    // recognises and what the CLI accepts.
    const id = readText(record.ID).replace(/^sha256:/, "").slice(0, 12);
    if (!id) return [];

    const tag = readText(record.Tag) || UNTAGGED;
    const containers = readCount(record.Containers);

    return [
      {
        id,
        repository: readText(record.Repository) || UNTAGGED,
        tag,
        createdSince: readText(record.CreatedSince),
        sizeBytes: parseDockerSizeToBytes(readText(record.Size)),
        uniqueSizeBytes: parseDockerSizeToBytes(readText(record.UniqueSize)),
        sharedSizeBytes: parseDockerSizeToBytes(readText(record.SharedSize)),
        containers,
        protectionReason: classifyImageProtection({ containers, tag }),
      },
    ];
  });
}

export function describeProtection(reason: ImageProtectionReason): string | null {
  if (reason === "in-use") return "A container is using this image";
  if (reason === "retention-tag")
    return "Keeps a past build addressable for an instant rollback";
  return null;
}

/**
 * Whether a deletion may go ahead. An in-use image is never removable, however
 * insistent the request: Docker would refuse, and forcing it would only produce
 * a confusing error deeper down.
 */
export function canDeleteImage(
  reason: ImageProtectionReason,
  force: boolean,
): { allowed: boolean; error: string | null } {
  if (reason === "in-use") {
    return {
      allowed: false,
      error:
        "This image is in use by a container. Remove or redeploy the container first.",
    };
  }

  if (reason === "retention-tag" && !force) {
    return {
      allowed: false,
      error:
        "This image keeps a past build available for rollback. Deleting it removes that rollback point.",
    };
  }

  return { allowed: true, error: null };
}
