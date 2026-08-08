export type ApplicationRole =
  | "SUPER_ADMIN"
  | "OPERATOR"
  | "DEVELOPER"
  | "VIEWER";

const SENSITIVE_DATA_ROLES = new Set<ApplicationRole>([
  "SUPER_ADMIN",
  "OPERATOR",
  "DEVELOPER",
]);

/** Unknown roles are intentionally treated as least-privileged. */
export function canViewServerConnectionForRole(
  role: string | null | undefined,
): boolean {
  return SENSITIVE_DATA_ROLES.has(role as ApplicationRole);
}

export function canViewEnvironmentValuesForRole(
  role: string | null | undefined,
): boolean {
  return SENSITIVE_DATA_ROLES.has(role as ApplicationRole);
}
