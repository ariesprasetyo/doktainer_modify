"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { servers as serversApi, type DockerDiskUsageEntry } from "@/lib/api";
import { formatBytes } from "@/lib/format-bytes";

/**
 * What Docker is using on a server, broken down by category.
 *
 * Separate from the host cpu/ram/disk panel on purpose: that measures the whole
 * machine, this measures only what Docker accumulated. The question it answers
 * is which of it can actually be cleaned — the reclaimable column is what a
 * prune would free, not the category's size, and those differ a lot. A build
 * cache can be the largest thing on disk while nothing at all is reclaimable,
 * because its records back layers of images that still exist.
 */

interface DockerDiskUsagePanelProps {
  serverId: string;
  serverName?: string;
}

const cellStyle: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  color: "var(--text-muted)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  fontSize: 10,
};

function totalSize(entries: DockerDiskUsageEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0);
}

function totalReclaimable(entries: DockerDiskUsageEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.reclaimableBytes ?? 0), 0);
}

export default function DockerDiskUsagePanel({
  serverId,
  serverName,
}: DockerDiskUsagePanelProps) {
  const [entries, setEntries] = useState<DockerDiskUsageEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The initial read chains off the promise rather than setting state as the
  // effect runs, and drops its result if the row is collapsed mid-flight.
  useEffect(() => {
    let cancelled = false;

    serversApi
      .diskUsage(serverId)
      .then((response) => {
        if (!cancelled) setEntries(response.data.entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to read Docker disk usage.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serverId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await serversApi.diskUsage(serverId);
      setEntries(response.data.entries);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to read Docker disk usage.",
      );
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  const reclaimable = entries ? totalReclaimable(entries) : 0;

  return (
    <section
      className="card"
      style={{ padding: 16, background: "var(--bg-card)" }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 14 }}>Docker Disk Usage</h3>
          <p
            style={{
              margin: "2px 0 0",
              color: "var(--text-muted)",
              fontSize: 11,
            }}
          >
            {serverName
              ? `Images and build cache stored on ${serverName}`
              : "Images and build cache stored on this server"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {entries ? (
            <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              {formatBytes(totalSize(entries))} total
              {reclaimable > 0
                ? ` · ${formatBytes(reclaimable)} reclaimable`
                : ""}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh Docker disk usage"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
        </div>
      </header>

      {error ? (
        <p style={{ margin: 0, color: "var(--accent-red)", fontSize: 12 }}>
          {error}
        </p>
      ) : !entries ? (
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
          {loading ? "Reading Docker disk usage…" : "No data."}
        </p>
      ) : entries.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
          Docker reported nothing on this server.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: "left" }}>Type</th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>Total</th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>
                  Active
                </th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>Size</th>
                <th style={{ ...headerCellStyle, textAlign: "right" }}>
                  Reclaimable
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.category}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td style={{ ...cellStyle, textAlign: "left" }}>
                    {entry.category}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {entry.totalCount}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {entry.activeCount}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {entry.sizeBytes === null
                      ? "—"
                      : formatBytes(entry.sizeBytes)}
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: "right",
                      color:
                        (entry.reclaimableBytes ?? 0) > 0
                          ? "var(--accent-yellow)"
                          : "var(--text-muted)",
                    }}
                  >
                    {entry.reclaimableBytes === null
                      ? "—"
                      : formatBytes(entry.reclaimableBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p
            style={{
              marginTop: 10,
              marginBottom: 0,
              color: "var(--text-muted)",
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            Reclaimable is what a prune would actually free, which can be far
            less than the size — build cache that backs layers of images still on
            disk counts toward the size but cannot be freed.
          </p>
        </div>
      )}
    </section>
  );
}
