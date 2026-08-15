import yaml from "js-yaml";
import {
  normalizeCpuCores,
  normalizeCpuShares,
  normalizeMemory,
} from "./container-resources";

/**
 * Per-service settings for a compose stack.
 *
 * A compose stack starts through `docker compose up`, so the `docker run`
 * flags used elsewhere have no equivalent. These settings are written to a
 * generated override file that is passed as a second `-f`, which leaves the
 * repository's own compose file untouched — editing that file directly would
 * be undone by the next deploy, since every deploy re-clones the repository.
 *
 * Compose merge rules decide what an override can do:
 *  - restart, command, cpu_shares and the deploy limits REPLACE the base value
 *  - volumes are APPENDED to the base list, so a mount declared in the
 *    repository cannot be removed here, only added to
 */

export interface ComposeServiceOverride {
  restart?: string | null;
  command?: string | null;
  volumes?: string[];
  cpuShares?: number | null;
  cpuCores?: string | null;
  memory?: string | null;
}

export type ComposeServiceOverrides = Record<string, ComposeServiceOverride>;

export const COMPOSE_OVERRIDE_FILENAME = "doktainer-override.yml";

const RESTART_POLICIES = new Set([
  "no",
  "always",
  "unless-stopped",
  "on-failure",
]);

/** Compose service names follow the same rules as a DNS label. */
const SERVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRestart(value: unknown): string | null {
  const text = readText(value);
  if (text === null) return null;

  const base = text.split(":")[0];
  if (!RESTART_POLICIES.has(base)) {
    throw new Error(
      `Restart policy must be one of: ${[...RESTART_POLICIES].join(", ")}`,
    );
  }

  // on-failure takes an optional retry count; anything else must be bare.
  if (text !== base && (base !== "on-failure" || !/^on-failure:\d+$/.test(text))) {
    throw new Error(`Invalid restart policy: ${value}`);
  }

  return text;
}

function normalizeVolumes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  for (const entry of value) {
    const text = readText(entry);
    if (!text) continue;

    if (/\r|\n/.test(text)) {
      throw new Error(`Volume mount contains a newline: ${text}`);
    }

    seen.add(text);
  }

  return [...seen];
}

export function normalizeComposeServiceOverride(
  value: unknown,
): ComposeServiceOverride {
  const source = (value ?? {}) as Record<string, unknown>;
  const command = readText(source.command);

  if (command && /\r|\n/.test(command)) {
    throw new Error("Command must be a single line");
  }

  return {
    restart: normalizeRestart(source.restart),
    command,
    volumes: normalizeVolumes(source.volumes),
    cpuShares: normalizeCpuShares(source.cpuShares),
    cpuCores: normalizeCpuCores(source.cpuCores),
    memory: normalizeMemory(source.memory),
  };
}

export function isEmptyComposeServiceOverride(
  override: ComposeServiceOverride,
): boolean {
  return (
    !override.restart &&
    !override.command &&
    !override.volumes?.length &&
    override.cpuShares === null &&
    override.cpuCores === null &&
    override.memory === null
  );
}

/**
 * Services with nothing set are dropped, so an override file is only written
 * when it would actually change something.
 */
export function normalizeComposeServiceOverrides(
  value: unknown,
): ComposeServiceOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: ComposeServiceOverrides = {};

  for (const [serviceName, raw] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const name = serviceName.trim();
    if (!name) continue;

    if (!SERVICE_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid compose service name: ${serviceName}`);
    }

    const override = normalizeComposeServiceOverride(raw);
    if (!isEmptyComposeServiceOverride(override)) {
      result[name] = override;
    }
  }

  return result;
}

/**
 * Reads what is stored on a deployment source. Unlike the env overrides these
 * hold no secrets, so they are kept as plain JSON.
 */
export function readStoredComposeServiceOverrides(source: {
  composeServiceOverrides?: unknown;
}): ComposeServiceOverrides {
  try {
    return normalizeComposeServiceOverrides(source.composeServiceOverrides);
  } catch {
    // A stored value that no longer validates must not block a deploy; the
    // stack simply runs with whatever its own compose file says.
    return {};
  }
}

type ComposeServiceYaml = {
  restart?: string;
  command?: string;
  volumes?: string[];
  cpu_shares?: number;
  deploy?: { resources: { limits: { cpus?: string; memory?: string } } };
};

/**
 * Returns null when nothing is set, so the caller can skip writing a file and
 * skip the extra `-f` rather than passing an empty document compose rejects.
 */
export function buildComposeOverrideYaml(
  overrides: ComposeServiceOverrides,
): string | null {
  const services: Record<string, ComposeServiceYaml> = {};

  for (const [serviceName, override] of Object.entries(overrides)) {
    if (isEmptyComposeServiceOverride(override)) continue;

    const service: ComposeServiceYaml = {};

    if (override.restart) service.restart = override.restart;
    if (override.command) service.command = override.command;
    if (override.volumes?.length) service.volumes = [...override.volumes];
    if (override.cpuShares !== null && override.cpuShares !== undefined) {
      service.cpu_shares = override.cpuShares;
    }

    // Compose v2 applies deploy.resources.limits outside swarm too, which is
    // the only place the spec has for a cpu or memory ceiling.
    const limits: { cpus?: string; memory?: string } = {};
    if (override.cpuCores) limits.cpus = override.cpuCores;
    if (override.memory) limits.memory = override.memory;
    if (Object.keys(limits).length > 0) {
      service.deploy = { resources: { limits } };
    }

    services[serviceName] = service;
  }

  if (Object.keys(services).length === 0) {
    return null;
  }

  const header = [
    "# Generated by Doktainer. Do not edit by hand.",
    "#",
    "# Written next to the repository's compose file on every deploy and",
    "# passed as an extra -f, so these settings survive a rebuild without",
    "# changing anything the repository tracks.",
    "",
  ].join("\n");

  // yaml.dump handles quoting, so a value cannot break out into YAML syntax.
  return `${header}${yaml.dump({ services }, { lineWidth: 120 })}`;
}

/**
 * Service names declared by a compose document, so the UI can offer the ones
 * that actually exist instead of asking the user to type a name.
 */
export function extractComposeServiceNames(composeContent: string): string[] {
  let parsed: unknown;
  try {
    parsed = yaml.load(composeContent);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];

  const services = (parsed as { services?: unknown }).services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    return [];
  }

  return Object.keys(services as Record<string, unknown>)
    .map((name) => name.trim())
    .filter((name) => SERVICE_NAME_PATTERN.test(name));
}
