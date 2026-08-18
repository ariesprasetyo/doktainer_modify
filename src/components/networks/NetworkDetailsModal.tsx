"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, X } from "lucide-react";
import {
  networks as networksApi,
  type NetworkDetails,
  type NetworkRecord,
} from "@/lib/api";
import { formatDateTime } from "./network-format";

/**
 * Everything Docker knows about one network: its settings, the containers
 * attached to it, and the raw inspect output.
 *
 * Lifted out of the networks page unchanged so the Docker manager panel shows
 * the same detail instead of a reduced copy.
 */
export default function NetworkDetailsModal({
  network,
  onClose,
}: {
  network: NetworkRecord;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<NetworkDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<
    "overview" | "containers" | "inspect"
  >("overview");

  useEffect(() => {
    networksApi
      .details(network.id)
      .then((res) => setDetail(res.data ?? null))
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Failed to load network details",
        );
      })
      .finally(() => setLoading(false));
  }, [network.id]);

  const tabs: Array<{
    id: "overview" | "containers" | "inspect";
    label: string;
  }> = [
    { id: "overview", label: "Overview" },
    { id: "containers", label: "Containers" },
    { id: "inspect", label: "Inspect" },
  ];

  const liveNetwork = detail?.detail;
  const containers = liveNetwork?.containers ?? [];
  const flagItems: Array<{ label: string; enabled: boolean }> = [
    { label: "Internal", enabled: Boolean(liveNetwork?.internal) },
    { label: "Attachable", enabled: Boolean(liveNetwork?.attachable) },
    { label: "Ingress", enabled: Boolean(liveNetwork?.ingress) },
  ];
  const summaryCards = [
    {
      label: "Driver",
      value: liveNetwork?.driver ?? network.driver,
      subvalue: `Scope: ${liveNetwork?.scope ?? network.scope}`,
    },
    {
      label: "Subnet",
      value: liveNetwork?.subnet ?? network.subnet ?? "-",
      subvalue: `Gateway: ${liveNetwork?.gateway ?? network.gateway ?? "-"}`,
    },
    {
      label: "Connected Containers",
      value: String(containers.length || network.containers),
      subvalue: liveNetwork?.internal ? "Internal network" : "External network",
    },
    {
      label: "Network ID",
      value: liveNetwork?.id?.slice(0, 12) ?? "-",
      subvalue: `Created: ${formatDateTime(liveNetwork?.created ?? null)}`,
    },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal-shell" style={{ maxWidth: 1040 }}>
        <button
          type="button"
          onClick={onClose}
          className="modal-close"
          aria-label="Close network detail modal"
        >
          <X size={22} />
        </button>
        <div
        className="modal animate-slide-in"
        style={{
          width: "100%",
          maxWidth: 1040,
          maxHeight: "90vh",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "18px 22px",
            paddingRight: 56,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3
                style={{
                  color: "var(--text-primary)",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                {network.name}
              </h3>
              <span
                style={{
                  background: "rgba(59,130,246,0.12)",
                  color: "#3b82f6",
                  border: "1px solid rgba(59,130,246,0.24)",
                  padding: "3px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {liveNetwork?.driver ?? network.driver}
              </span>
            </div>
            <p
              style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}
            >
              {detail?.server
                ? `${detail.server.name} (${detail.server.ip})`
                : network.server
                  ? `${network.server.name} (${network.server.ip})`
                  : "Unknown server"}
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "14px 22px",
            borderBottom: "1px solid var(--border)",
            background: "rgba(255,255,255,0.02)",
            flexWrap: "wrap",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="btn btn-ghost"
              style={{
                fontSize: 12,
                border:
                  activeTab === tab.id
                    ? "1px solid rgba(59,130,246,0.35)"
                    : "1px solid transparent",
                background:
                  activeTab === tab.id ? "rgba(59,130,246,0.12)" : undefined,
                color: activeTab === tab.id ? "#3b82f6" : undefined,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 22 }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: "center" }}>
              <Loader2
                size={28}
                className="animate-spin"
                style={{ color: "var(--accent)", margin: "0 auto 12px" }}
              />
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                Loading network details...
              </p>
            </div>
          ) : error ? (
            <div
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 10,
                padding: 16,
                color: "#ef4444",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : detail ? (
            <>
              {activeTab === "overview" && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 18 }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {summaryCards.map((card) => (
                      <div
                        key={card.label}
                        className="card"
                        style={{
                          padding: 16,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{ fontSize: 11, color: "var(--text-muted)" }}
                        >
                          {card.label}
                        </span>
                        <span
                          style={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: "var(--text-primary)",
                            wordBreak: "break-word",
                          }}
                        >
                          {card.value}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {card.subvalue}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: 16,
                    }}
                  >
                    <div className="card" style={{ padding: 16 }}>
                      <h4
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                          marginBottom: 12,
                        }}
                      >
                        Network Details
                      </h4>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                          fontSize: 13,
                        }}
                      >
                        {[
                          ["Name", liveNetwork?.name ?? network.name],
                          ["Scope", liveNetwork?.scope ?? network.scope],
                          ["Driver", liveNetwork?.driver ?? network.driver],
                          [
                            "Subnet",
                            liveNetwork?.subnet ?? network.subnet ?? "-",
                          ],
                          [
                            "Gateway",
                            liveNetwork?.gateway ?? network.gateway ?? "-",
                          ],
                          [
                            "IPv4",
                            liveNetwork?.enableIPv4 === null
                              ? "-"
                              : liveNetwork?.enableIPv4
                                ? "Enabled"
                                : "Disabled",
                          ],
                          [
                            "IPv6",
                            liveNetwork?.enableIPv6 === null
                              ? "-"
                              : liveNetwork?.enableIPv6
                                ? "Enabled"
                                : "Disabled",
                          ],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              paddingBottom: 8,
                              borderBottom: "1px solid rgba(255,255,255,0.05)",
                            }}
                          >
                            <span style={{ color: "var(--text-muted)" }}>
                              {label}
                            </span>
                            <span
                              style={{
                                color: "var(--text-primary)",
                                fontWeight: 600,
                                textAlign: "right",
                                wordBreak: "break-word",
                              }}
                            >
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="card" style={{ padding: 16 }}>
                      <h4
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                          marginBottom: 12,
                        }}
                      >
                        Flags & Metadata
                      </h4>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                        >
                          {flagItems.map(({ label, enabled }) => (
                            <span
                              key={label}
                              style={{
                                padding: "4px 9px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: enabled
                                  ? "rgba(16,185,129,0.12)"
                                  : "rgba(148,163,184,0.12)",
                                color: enabled
                                  ? "#10b981"
                                  : "var(--text-muted)",
                                border: enabled
                                  ? "1px solid rgba(16,185,129,0.24)"
                                  : "1px solid rgba(148,163,184,0.2)",
                              }}
                            >
                              {label}: {enabled ? "Yes" : "No"}
                            </span>
                          ))}
                        </div>

                        <div>
                          <p
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              marginBottom: 8,
                            }}
                          >
                            Labels
                          </p>
                          {Object.keys(liveNetwork?.labels ?? {}).length ===
                          0 ? (
                            <p
                              style={{
                                fontSize: 12,
                                color: "var(--text-secondary)",
                              }}
                            >
                              No labels found.
                            </p>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              {Object.entries(liveNetwork?.labels ?? {}).map(
                                ([key, value]) => (
                                  <div
                                    key={key}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: 12,
                                      fontSize: 12,
                                    }}
                                  >
                                    <span
                                      style={{ color: "var(--text-muted)" }}
                                    >
                                      {key}
                                    </span>
                                    <span
                                      style={{
                                        color: "var(--text-primary)",
                                        textAlign: "right",
                                      }}
                                    >
                                      {value}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </div>

                        <div>
                          <p
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              marginBottom: 8,
                            }}
                          >
                            Options
                          </p>
                          {Object.keys(liveNetwork?.options ?? {}).length ===
                          0 ? (
                            <p
                              style={{
                                fontSize: 12,
                                color: "var(--text-secondary)",
                              }}
                            >
                              No network options found.
                            </p>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              {Object.entries(liveNetwork?.options ?? {}).map(
                                ([key, value]) => (
                                  <div
                                    key={key}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: 12,
                                      fontSize: 12,
                                    }}
                                  >
                                    <span
                                      style={{ color: "var(--text-muted)" }}
                                    >
                                      {key}
                                    </span>
                                    <span
                                      style={{
                                        color: "var(--text-primary)",
                                        textAlign: "right",
                                      }}
                                    >
                                      {value}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "containers" && (
                <div className="card" style={{ overflow: "hidden" }}>
                  {containers.length === 0 ? (
                    <div style={{ padding: 28, textAlign: "center" }}>
                      <ArrowLeftRight
                        size={28}
                        style={{
                          color: "var(--text-muted)",
                          margin: "0 auto 10px",
                          opacity: 0.45,
                        }}
                      />
                      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                        No containers are attached to this network.
                      </p>
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Container ID</th>
                            <th>IPv4</th>
                            <th>IPv6</th>
                            <th>MAC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {containers.map((container) => (
                            <tr key={container.id}>
                              <td
                                style={{
                                  color: "var(--text-primary)",
                                  fontWeight: 600,
                                }}
                              >
                                {container.name}
                              </td>
                              <td
                                style={{
                                  fontSize: 11,
                                  fontFamily: "JetBrains Mono, monospace",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {container.id.slice(0, 12)}
                              </td>
                              <td
                                style={{
                                  fontSize: 11,
                                  fontFamily: "JetBrains Mono, monospace",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {container.ipv4Address ?? "-"}
                              </td>
                              <td
                                style={{
                                  fontSize: 11,
                                  fontFamily: "JetBrains Mono, monospace",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {container.ipv6Address ?? "-"}
                              </td>
                              <td
                                style={{
                                  fontSize: 11,
                                  fontFamily: "JetBrains Mono, monospace",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {container.macAddress ?? "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "inspect" && (
                <div
                  className="card"
                  style={{ padding: 0, overflow: "hidden" }}
                >
                  <pre
                    style={{
                      margin: 0,
                      padding: 18,
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: "var(--text-primary)",
                      maxHeight: "58vh",
                      overflow: "auto",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {JSON.stringify(detail.detail.raw, null, 2)}
                  </pre>
                </div>
              )}
            </>
          ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
