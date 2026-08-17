import { tagPatternToRegExp } from "./git-ref";

/**
 * Asks a provider what the newest commit on a ref is.
 *
 * This is the direction that works on a private network: the panel calls the
 * provider, rather than waiting to be called. A self-hosted GitLab refuses to
 * deliver webhooks to a private-network URL, and the setting that allows it is
 * instance-admin only, so the inbound direction was never available here.
 *
 * Read-only throughout — the same token scope already used to list repositories.
 */

export type PollableProvider = "GITHUB" | "GITLAB" | "GITEA";

export interface LatestCommitQuery {
  provider: PollableProvider;
  /** API base, e.g. https://gitlab.example.com. No trailing slash required. */
  apiBaseUrl: string;
  /** owner/name, as stored on the deployment source. */
  projectPath: string;
  accessToken?: string;
  branch?: string | null;
  /** When set, the newest tag matching this pattern is used instead of a branch. */
  tagPattern?: string | null;
}

export interface LatestCommitResult {
  commitSha: string;
  /** The branch polled, or the tag chosen when a pattern matched. */
  ref: string;
  refKind: "branch" | "tag";
}

const REQUEST_TIMEOUT_MS = 15_000;

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function authHeaders(
  provider: PollableProvider,
  accessToken?: string,
): Record<string, string> {
  const token = accessToken?.trim();
  const headers: Record<string, string> = { accept: "application/json" };
  if (!token) return headers;

  if (provider === "GITLAB") {
    headers["PRIVATE-TOKEN"] = token;
  } else {
    // GitHub and Gitea both accept a bearer token here.
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // The body often explains far better than the status alone.
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `Provider answered ${response.status}${body ? `: ${body}` : ""}`,
    );
  }

  return response.json();
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entry = value[0];
  return entry && typeof entry === "object"
    ? (entry as Record<string, unknown>)
    : null;
}

function readString(
  source: Record<string, unknown> | null,
  key: string,
): string {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function commitUrl(query: LatestCommitQuery, ref: string): string {
  const base = trimBase(query.apiBaseUrl);
  const encodedRef = encodeURIComponent(ref);

  if (query.provider === "GITLAB") {
    const project = encodeURIComponent(query.projectPath);
    return `${base}/api/v4/projects/${project}/repository/commits?ref_name=${encodedRef}&per_page=1`;
  }

  if (query.provider === "GITEA") {
    return `${base}/api/v1/repos/${query.projectPath}/commits?sha=${encodedRef}&limit=1`;
  }

  return `${base}/repos/${query.projectPath}/commits?sha=${encodedRef}&per_page=1`;
}

function tagsUrl(query: LatestCommitQuery): string {
  const base = trimBase(query.apiBaseUrl);

  if (query.provider === "GITLAB") {
    const project = encodeURIComponent(query.projectPath);
    return `${base}/api/v4/projects/${project}/repository/tags?per_page=100`;
  }

  if (query.provider === "GITEA") {
    return `${base}/api/v1/repos/${query.projectPath}/tags?limit=100`;
  }

  return `${base}/repos/${query.projectPath}/tags?per_page=100`;
}

/**
 * Providers spell the commit id differently, and GitHub nests the tag's commit.
 * Kept as one place so a new provider only has to be added here.
 */
export function readCommitSha(entry: Record<string, unknown> | null): string {
  const direct = readString(entry, "id") || readString(entry, "sha");
  if (direct) return direct;

  const commit = entry?.commit;
  if (commit && typeof commit === "object") {
    return (
      readString(commit as Record<string, unknown>, "id") ||
      readString(commit as Record<string, unknown>, "sha")
    );
  }

  return "";
}

export function readTagName(entry: Record<string, unknown> | null): string {
  return readString(entry, "name");
}

/**
 * Picks the tag to deploy from those a repository has.
 *
 * Providers return tags newest-first, which is the order relied on here: a
 * pattern like `v*` should follow the newest matching tag, and comparing
 * version strings ourselves would get `v1.10` versus `v1.9` wrong.
 */
export function selectTagFromList(
  entries: unknown,
  pattern: string,
): { ref: string; commitSha: string } | null {
  if (!Array.isArray(entries)) return null;

  const matcher = tagPatternToRegExp(pattern);

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = readTagName(entry);
    if (!name || !matcher.test(name)) continue;

    const commitSha = readCommitSha(entry);
    if (!commitSha) continue;

    return { ref: name, commitSha };
  }

  return null;
}

export async function fetchLatestCommit(
  query: LatestCommitQuery,
): Promise<LatestCommitResult> {
  if (!query.projectPath.trim()) {
    throw new Error("No repository path is recorded for this container");
  }

  const headers = authHeaders(query.provider, query.accessToken);
  const tagPattern = query.tagPattern?.trim();

  if (tagPattern) {
    const tags = await getJson(tagsUrl(query), headers);
    const selected = selectTagFromList(tags, tagPattern);

    if (!selected) {
      throw new Error(`No tag matching "${tagPattern}" exists yet`);
    }

    return { ...selected, refKind: "tag" };
  }

  const branch = query.branch?.trim() || "main";
  const commits = await getJson(commitUrl(query, branch), headers);
  const commitSha = readCommitSha(firstRecord(commits));

  if (!commitSha) {
    throw new Error(`Branch "${branch}" has no commits, or does not exist`);
  }

  return { commitSha, ref: branch, refKind: "branch" };
}
