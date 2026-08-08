import Link from "next/link";
import { ChevronRight, Layers3 } from "lucide-react";
import SensitiveConnectionValue from "@/components/SensitiveConnectionValue";
import { canViewServerConnection } from "@/lib/api";
import type { EnvironmentSummary } from "../../types/environment-container-types";

interface EnvironmentHeaderProps {
  projectId: string;
  summary: EnvironmentSummary;
}

export default function EnvironmentHeader({
  projectId,
  summary,
}: EnvironmentHeaderProps) {
  const isConnectionRedacted = !canViewServerConnection();
  return (
    <section className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontSize: 12,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        <Link
          href="/projects"
          style={{ color: "inherit", textDecoration: "none", flexShrink: 0 }}
        >
          Projects
        </Link>
        <ChevronRight size={14} style={{ flexShrink: 0 }} />
        <Link
          href={`/projects/${projectId}`}
          style={{ color: "inherit", textDecoration: "none", flexShrink: 0 }}
        >
          {summary.projectName}
        </Link>
        <ChevronRight size={14} style={{ flexShrink: 0 }} />
        <strong style={{ color: "var(--text-primary)", flexShrink: 0 }}>
          {summary.environmentName}
        </strong>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          padding: "16px 18px",
        }}
      >
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Layers3 size={24} style={{ color: "var(--accent-yellow)" }} />
            <h1
              style={{
                margin: 0,
                color: "var(--text-primary)",
                fontSize: 21,
                lineHeight: 1.2,
                fontWeight: 800,
                overflowWrap: "anywhere",
              }}
            >
              {summary.environmentName}
            </h1>
            <span
              className="ui-badge badge-online"
              style={{ minHeight: 20, padding: "3px 8px" }}
            >
              {summary.status}
            </span>
          </div>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 12,
              marginTop: 7,
              overflowWrap: "anywhere",
            }}
          >
            {summary.environmentKind} environment on {summary.serverName} (
            <SensitiveConnectionValue
              value={summary.serverIp}
              isRedacted={isConnectionRedacted}
            />)
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            Container inventory updated {summary.updatedAt}
          </p>
        </div>
      </div>

      {/* <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
          gap: 10,
          padding: "0 18px 16px",
        }}
      >
        {[
          { label: "Server", value: summary.serverName },
          { label: "Server IP", value: summary.serverIp },
          { label: "Environment", value: summary.environmentKind },
          { label: "Scope", value: "Containers" },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "8px 10px",
              minWidth: 0,
            }}
          >
            <p style={{ color: "var(--text-muted)", fontSize: 10 }}>
              {item.label}
            </p>
            <p
              style={{
                color: "var(--text-primary)",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--font--code)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div> */}
    </section>
  );
}
