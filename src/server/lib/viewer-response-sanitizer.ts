import type { FastifyRequest } from "fastify";
import { canViewSensitiveServerData } from "./access-policy";

const SERVER_CONNECTION_FIELDS = new Set([
  "ip",
  "sshPort",
  "username",
  "authType",
  "sshKeyEnc",
  "passwordEnc",
]);

const CONTAINER_ENVIRONMENT_FIELDS = new Set(["envVars"]);

/**
 * Removes SSH connection details from JSON API responses for read-only users.
 *
 * This is deliberately performed at the response boundary so a newly added
 * endpoint cannot accidentally expose a nested `server.ip` to a viewer.
 */
export function sanitizeViewerResponsePayload(
  request: FastifyRequest,
  payload: unknown,
): unknown {
  if (canViewSensitiveServerData(request.userRole) || typeof payload !== "string") {
    return payload;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return payload;
  }

  const isServersEndpoint = request.url.startsWith("/api/v1/servers");

  const sanitize = (
    value: unknown,
    isServer: boolean,
    isContainerInspect = false,
  ): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item, isServer, isContainerInspect));
    }
    if (!value || typeof value !== "object") return value;

    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).flatMap(([key, child]) => {
        // serverIp is the flattened representation used by environment and
        // terminal payloads; it is always an SSH server connection address.
        if (key === "serverIp") return [];
        // These values can contain credentials and application configuration.
        // Preserve the shape expected by read-only UI while returning no
        // environment variable names or values.
        if (CONTAINER_ENVIRONMENT_FIELDS.has(key)) return [[key, []]];
        if (isContainerInspect && key === "Env") return [];

        const childIsServer =
          isServer || key === "server" || key === "targetServer";
        if (childIsServer && SERVER_CONNECTION_FIELDS.has(key)) return [];

        return [
          [
            key,
            sanitize(child, childIsServer, isContainerInspect || key === "inspect"),
          ],
        ];
      }),
    );
  };

  // /servers returns server records directly under `data`, rather than under
  // a `server` property as the other APIs do.
  const sanitized = sanitize(parsed, false) as Record<string, unknown>;
  if (isServersEndpoint && "data" in sanitized) {
    sanitized.data = sanitize(sanitized.data, true);
  }

  return JSON.stringify(sanitized);
}
