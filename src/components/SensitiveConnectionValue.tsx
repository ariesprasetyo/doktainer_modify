interface SensitiveConnectionValueProps {
  value?: string | null;
  isRedacted: boolean;
}

/** Keeps connection fields discoverable without exposing their values to viewers. */
export default function SensitiveConnectionValue({
  value,
  isRedacted,
}: SensitiveConnectionValueProps) {
  if (!isRedacted) {
    return <>{value || "—"}</>;
  }

  return (
    <span
      aria-label="Connection address hidden for viewer"
      title="Connection address hidden"
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 4,
        padding: "2px 7px",
        background: "var(--bg-input)",
        border: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontSize: 10,
        letterSpacing: "0.08em",
        userSelect: "none",
      }}
    >
      ••••••••••••
    </span>
  );
}
