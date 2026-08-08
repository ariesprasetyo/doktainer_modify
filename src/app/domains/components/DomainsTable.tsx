import TablePagination from "@/components/TablePagination";
import SensitiveConnectionValue from "@/components/SensitiveConnectionValue";
import { canViewServerConnection, Domain, SslCert } from "@/lib/api";
import {
  ExternalLink,
  Globe,
  Loader2,
  Pencil,
  Shield,
  Trash2,
} from "lucide-react";
import DiscoveryBadge from "./DiscoveryBadge";
import SSLBadge from "./SSLBadge";
import { formatDate, formatProxyLabel, sslStatusKey } from "./domain-utils";

function renderMetaBadge(
  label: string,
  styles: { color: string; background: string; border: string },
) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "1px 6px",
        borderRadius: 999,
        color: styles.color,
        background: styles.background,
        border: `1px solid ${styles.border}`,
      }}
    >
      {label}
    </span>
  );
}

type DomainsTablePagination = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  paginatedItems: Domain[];
  setCurrentPage: (page: number) => void;
};

interface DomainsTableProps {
  domains: Domain[];
  pagination: DomainsTablePagination;
  deleting: string | null;
  renewing: string | null;
  onEdit: (domain: Domain) => void;
  onDelete: (id: string, name: string) => void;
  onRenew: (cert: SslCert) => void;
}

export default function DomainsTable({
  domains,
  pagination,
  deleting,
  renewing,
  onEdit,
  onDelete,
  onRenew,
}: DomainsTableProps) {
  const isConnectionRedacted = !canViewServerConnection();
  if (domains.length === 0) {
    return null;
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Type</th>
              <th>Target / IP</th>
              <th>SSL Status</th>
              <th>SSL Expiry</th>
              <th>Proxy</th>
              <th>Server</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagination.paginatedItems.map((domain) => {
              const status = sslStatusKey(domain.sslCert);

              return (
                <tr key={domain.id}>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Globe
                        size={13}
                        style={{ color: "#3b82f6", flexShrink: 0 }}
                      />
                      <div>
                        <span
                          style={{
                            color: "var(--text-primary)",
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          {domain.name}
                        </span>
                        {!domain.isActive && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: "var(--text-muted)",
                              background: "var(--bg-input)",
                              padding: "1px 5px",
                              borderRadius: 4,
                            }}
                          >
                            inactive
                          </span>
                        )}
                        <div>
                          <DiscoveryBadge source={domain.discoverySource} />
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            marginTop: 6,
                          }}
                        >
                          {renderMetaBadge(
                            domain.configMode === "SHARED"
                              ? domain.isPrimary
                                ? "Shared Primary"
                                : "Shared"
                              : "Isolated",
                            domain.configMode === "SHARED"
                              ? {
                                  color: "#3b82f6",
                                  background: "rgba(59,130,246,0.12)",
                                  border: "rgba(59,130,246,0.28)",
                                }
                              : {
                                  color: "#64748b",
                                  background: "rgba(100,116,139,0.12)",
                                  border: "rgba(100,116,139,0.25)",
                                },
                          )}
                          {domain.reviewStatus === "NEEDS_REVIEW" &&
                            renderMetaBadge("Needs Review", {
                              color: "#f59e0b",
                              background: "rgba(245,158,11,0.12)",
                              border: "rgba(245,158,11,0.28)",
                            })}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        background: "rgba(6,182,212,0.1)",
                        color: "#06b6d4",
                        border: "1px solid rgba(6,182,212,0.25)",
                        padding: "2px 8px",
                        borderRadius: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {domain.type}
                    </span>
                  </td>
                  <td
                    style={{
                      fontSize: 12,
                      fontFamily: "JetBrains Mono, monospace",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <SensitiveConnectionValue
                      value={domain.value}
                      isRedacted={isConnectionRedacted}
                    />
                  </td>
                  <td>
                    <SSLBadge status={status} />
                  </td>
                  <td
                    style={{
                      fontSize: 11,
                      fontFamily: "JetBrains Mono, monospace",
                      color:
                        status === "expiring" ? "#f59e0b" : "var(--text-muted)",
                    }}
                  >
                    {formatDate(domain.sslCert?.expiresAt)}
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        background: "var(--bg-input)",
                        padding: "2px 8px",
                        borderRadius: 5,
                        border: "1px solid var(--border)",
                        textTransform: "capitalize",
                      }}
                    >
                      {formatProxyLabel(domain.proxy)}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {domain.server?.name ?? "—"}
                  </td>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 5,
                      }}
                    >
                      <a
                        href={`https://${domain.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost"
                        style={{ padding: "5px 8px" }}
                        title="Open domain"
                      >
                        <ExternalLink size={11} />
                      </a>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "5px 8px" }}
                        title="Edit domain"
                        onClick={() => onEdit(domain)}
                      >
                        <Pencil size={11} />
                      </button>
                      {domain.sslCert && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "5px 8px" }}
                          title="Renew SSL"
                          onClick={() => onRenew(domain.sslCert as SslCert)}
                          disabled={renewing === domain.sslCert.id}
                        >
                          {renewing === domain.sslCert.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Shield size={11} />
                          )}
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        style={{ padding: "5px 8px" }}
                        title="Delete"
                        onClick={() => onDelete(domain.id, domain.name)}
                        disabled={deleting === domain.id}
                      >
                        {deleting === domain.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Trash2 size={11} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TablePagination
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        itemLabel="domains"
        onPageChange={pagination.setCurrentPage}
      />
    </div>
  );
}
