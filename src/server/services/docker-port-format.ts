/**
 * Docker publishes a port on every address family it can, and `docker ps`
 * reports each one as its own entry. A container started with a single
 * `-p 80:8000` is therefore summarised as:
 *
 *   0.0.0.0:80->8000/tcp, [::]:80->8000/tcp
 *
 * The authoritative view disagrees — `HostConfig.PortBindings` holds one
 * entry, `{"8000/tcp":[{"HostIp":"","HostPort":"80"}]}` — so treating the
 * summary literally reports two published ports where one was published.
 */

/**
 * Addresses meaning "every interface". Two entries that differ only by which
 * of these they name are the same binding seen from each stack.
 */
const WILDCARD_BIND_ADDRESSES = new Set(["0.0.0.0", "::", "[::]"]);

/**
 * What actually distinguishes one published port from another. A binding to a
 * specific address is deliberate and stays distinct — 127.0.0.1:80 is not the
 * same as 0.0.0.0:80 — so only the wildcard forms are folded together.
 */
function portMappingIdentity(entry: string): string {
  const separator = entry.indexOf("->");
  if (separator < 0) {
    // Not a `docker ps` mapping (e.g. "80:8000" typed into the deploy form).
    // Nothing to normalise; identical strings still collapse.
    return entry;
  }

  const hostPart = entry.slice(0, separator).trim();
  const targetPart = entry.slice(separator + 2).trim();

  const lastColon = hostPart.lastIndexOf(":");
  if (lastColon < 0) return entry;

  const address = hostPart.slice(0, lastColon).trim();
  const hostPort = hostPart.slice(lastColon + 1).trim();
  const normalizedAddress = WILDCARD_BIND_ADDRESSES.has(address)
    ? "*"
    : address;

  return `${normalizedAddress}:${hostPort}->${targetPart}`;
}

/**
 * Collapse the per-address-family duplicates, keeping the first spelling of
 * each distinct binding so the displayed text stays what Docker reported.
 */
export function dedupePublishedPorts(entries: string[]): string[] {
  const seen = new Map<string, string>();

  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;

    const identity = portMappingIdentity(entry);
    if (!seen.has(identity)) {
      seen.set(identity, entry);
    }
  }

  return [...seen.values()];
}
