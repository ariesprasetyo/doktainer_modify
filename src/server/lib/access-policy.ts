const SENSITIVE_DATA_ROLES = new Set([
  "SUPER_ADMIN",
  "OPERATOR",
  "DEVELOPER",
]);

/** Unknown roles are intentionally treated as least-privileged. */
export function canViewSensitiveServerData(
  role: string | null | undefined,
): boolean {
  return Boolean(role && SENSITIVE_DATA_ROLES.has(role));
}
