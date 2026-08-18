"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import ConfirmActionDialog from "@/components/ConfirmActionDialog";
import AddNetworkModal from "@/components/networks/AddNetworkModal";
import NetworkDetailsModal from "@/components/networks/NetworkDetailsModal";
import { formatDateTime } from "@/components/networks/network-format";
import {
  networks as networksApi,
  type NetworkRecord,
  type Server,
} from "@/lib/api";

/**
 * One server's Docker networks, inside the Docker manager panel.
 *
 * Being scoped to a server already, this needs no server picker — which is the
 * main thing the standalone page spent its space on.
 *
 * Docker's three built-in networks cannot be removed, and a swarm-scoped one
 * only from a manager node. Both refusals live in the delete route, so nothing
 * here re-implements them; the checkbox is simply withheld for the built-ins,
 * which are the case a user would otherwise keep trying.
 */

type SortKey = "name" | "driver" | "scope" | "containers" | "created";
type SortDirection = "asc" | "desc";

const PREDEFINED = ["bridge", "host", "none"];

export function isPredefinedNetwork(name: string): boolean {
  return PREDEFINED.includes(name.trim().toLowerCase());
}

const DRIVER_COLORS: Record<string, string> = {
  bridge: "#3b82f6",
  overlay: "#8b5cf6",
  macvlan: "#f59e0b",
  host: "#10b981",
  none: "var(--text-muted)",
};

function compareNumbers(
  left: number,
  right: number,
  direction: SortDirection,
): number {
  return direction === "asc" ? left - right : right - left;
}

export function sortNetworks(
  items: NetworkRecord[],
  key: SortKey,
  direction: SortDirection,
): NetworkRecord[] {
  const factor = direction === "asc" ? 1 : -1;

  return [...items].sort((left, right) => {
    switch (key) {
      case "name":
        return left.name.localeCompare(right.name) * factor;
      case "driver":
        return left.driver.localeCompare(right.driver) * factor;
      case "scope":
        return left.scope.localeCompare(right.scope) * factor;
      case "containers":
        return compareNumbers(left.containers, right.containers, direction);
      case "created":
        return compareNumbers(
          Date.parse(left.createdAt) || 0,
          Date.parse(right.createdAt) || 0,
          direction,
        );
    }
  });
}

export function filterNetworks(
  items: NetworkRecord[],
  search: string,
  driver: string,
): NetworkRecord[] {
  const term = search.trim().toLowerCase();

  return items
    .filter((item) => driver === "all" || item.driver === driver)
    .filter((item) =>
      term
        ? `${item.name} ${item.driver} ${item.subnet ?? ""}`
            .toLowerCase()
            .includes(term)
        : true,
    );
}

const cell: React.CSSProperties = { padding: "8px", fontSize: 12 };
const headerCell: React.CSSProperties = {
  padding: "6px 8px",
  color: "var(--text-muted)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

interface ServerNetworksPanelProps {
  server: Server;
  onToast: (message: string, tone: "success" | "error" | "warning") => void;
}

export default function ServerNetworksPanel({
  server,
  onToast,
}: ServerNetworksPanelProps) {
  const [items, setItems] = useState<NetworkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [driver, setDriver] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("containers");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [detailFor, setDetailFor] = useState<NetworkRecord | null>(null);
  const [confirm, setConfirm] = useState<NetworkRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    networksApi
      .list(server.id)
      .then((response) => {
        if (!cancelled) setItems(response.data ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to read networks.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [server.id]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await networksApi.list(server.id);
      setItems(response.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read networks.");
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  /**
   * These are database records mirroring what Docker holds, so a network
   * created or removed outside the panel only appears after a sync.
   */
  const sync = useCallback(async () => {
    setSyncing(true);
    setError("");

    try {
      const response = await networksApi.sync({ serverId: server.id });
      const synced = response.meta?.summary?.[0]?.synced;
      setItems((response.data ?? []).filter((item) => item.serverId === server.id));
      onToast(
        synced === undefined
          ? "Networks synced from Docker"
          : `Synced ${synced} network${synced === 1 ? "" : "s"} from Docker`,
        "success",
      );
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : "Failed to sync networks",
        "error",
      );
    } finally {
      setSyncing(false);
    }
  }, [server.id, onToast]);

  const drivers = useMemo(
    () => [...new Set(items.map((item) => item.driver))].sort(),
    [items],
  );

  const visible = useMemo(
    () => sortNetworks(filterNetworks(items, search, driver), sortKey, sortDirection),
    [items, search, driver, sortKey, sortDirection],
  );

  const selectableVisible = useMemo(
    () =>
      visible
        .filter((item) => !isPredefinedNetwork(item.name))
        .map((item) => item.id),
    [visible],
  );

  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );

  const attachedCount = selectedItems.filter(
    (item) => item.containers > 0,
  ).length;

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return currentKey;
      }
      // Counts and dates open on the largest and newest; names on A first.
      setSortDirection(key === "containers" || key === "created" ? "desc" : "asc");
      return key;
    });
  }, []);

  const removeSelected = useCallback(
    async (targets: NetworkRecord[]) => {
      setBusy(true);
      const failures: string[] = [];

      // One request each: the delete route is where the built-in and
      // swarm-manager refusals live, and each needs its own answer.
      for (const target of targets) {
        try {
          await networksApi.delete(target.id);
        } catch (err) {
          failures.push(
            `${target.name}: ${err instanceof Error ? err.message : "failed"}`,
          );
        }
      }

      const removed = targets.length - failures.length;
      onToast(
        failures.length > 0
          ? `Removed ${removed}, kept ${failures.length} — ${failures[0]}`
          : `Removed ${removed} network${removed === 1 ? "" : "s"}`,
        failures.length > 0 ? "warning" : "success",
      );

      setSelected(new Set());
      setBusy(false);
      await reload();
    },
    [onToast, reload],
  );

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (
      sortDirection === "asc" ? (
        <ArrowUp size={10} />
      ) : (
        <ArrowDown size={10} />
      )
    ) : null;

  const headerButton = (key: SortKey, label: string, align: "left" | "right") => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: sortKey === key ? "var(--text-primary)" : "var(--text-muted)",
        font: "inherit",
        letterSpacing: "inherit",
        textTransform: "inherit",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        width: "100%",
      }}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sortIndicator(key)}
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <ConfirmActionDialog
        open={confirm !== null}
        title={`Remove ${confirm?.length ?? 0} network${(confirm?.length ?? 0) === 1 ? "" : "s"}?`}
        description={
          attachedCount > 0
            ? `${attachedCount} of these still has containers attached. Docker refuses to remove a network in use, so those will be kept and reported.`
            : "Removed from Docker on this server and from the panel's records."
        }
        confirmLabel="Remove networks"
        tone="danger"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const targets = confirm;
          setConfirm(null);
          if (targets) void removeSelected(targets);
        }}
      />

      {showAdd ? (
        <AddNetworkModal
          serverList={[server]}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            void reload();
          }}
        />
      ) : null}

      {detailFor ? (
        <NetworkDetailsModal
          network={detailFor}
          onClose={() => setDetailFor(null)}
        />
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <input
          className="input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, driver or subnet"
          style={{ flex: "1 1 180px", minWidth: 160, fontSize: 12 }}
          aria-label="Search networks"
        />
        <select
          className="input"
          value={driver}
          onChange={(event) => setDriver(event.target.value)}
          style={{ width: 130, fontSize: 12, cursor: "pointer" }}
          aria-label="Filter by driver"
        >
          <option value="all">All drivers</option>
          {drivers.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        {selected.size > 0 ? (
          <>
            <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              {selected.size} selected
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "4px 8px" }}
              disabled={busy}
              onClick={() => setConfirm(selectedItems)}
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}{" "}
              Remove
            </button>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {visible.length} of {items.length}
          </span>
        )}

        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: "4px 8px" }}
          onClick={() => setShowAdd(true)}
        >
          <Plus size={12} /> New
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: "4px 8px" }}
          onClick={() => void sync()}
          disabled={syncing}
          title="Read networks from Docker on this server"
        >
          {syncing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}{" "}
          Sync
        </button>
      </div>

      {error ? (
        <p style={{ margin: 0, color: "var(--accent-red)", fontSize: 12 }}>
          {error}
        </p>
      ) : null}

      <div style={{ overflowX: "auto", maxHeight: 340, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...headerCell, width: 30, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={
                    selectableVisible.length > 0 &&
                    selectableVisible.every((id) => selected.has(id))
                  }
                  ref={(node) => {
                    if (node) {
                      const chosen = selectableVisible.filter((id) =>
                        selected.has(id),
                      ).length;
                      node.indeterminate =
                        chosen > 0 && chosen < selectableVisible.length;
                    }
                  }}
                  disabled={selectableVisible.length === 0}
                  onChange={() =>
                    setSelected((current) =>
                      selectableVisible.every((id) => current.has(id))
                        ? new Set()
                        : new Set(selectableVisible),
                    )
                  }
                  aria-label="Select all removable networks shown"
                />
              </th>
              <th style={{ ...headerCell, textAlign: "left" }}>
                {headerButton("name", "Network", "left")}
              </th>
              <th style={{ ...headerCell, textAlign: "left" }}>
                {headerButton("driver", "Driver", "left")}
              </th>
              <th style={{ ...headerCell, textAlign: "left" }}>
                {headerButton("scope", "Scope", "left")}
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>
                {headerButton("containers", "Containers", "right")}
              </th>
              <th style={{ ...headerCell, textAlign: "left" }}>
                {headerButton("created", "Created", "left")}
              </th>
              <th style={{ ...headerCell, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...cell,
                    color: "var(--text-muted)",
                    textAlign: "center",
                    padding: 20,
                  }}
                >
                  {loading ? "Reading networks…" : "No networks match."}
                </td>
              </tr>
            ) : (
              visible.map((item) => {
                const builtIn = isPredefinedNetwork(item.name);
                const isSelected = selected.has(item.id);

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: isSelected ? "var(--bg-input)" : undefined,
                    }}
                  >
                    <td style={{ ...cell, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={builtIn}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${item.name}`}
                      />
                    </td>
                    <td
                      style={{
                        ...cell,
                        fontFamily: "var(--font--code)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {item.name}
                      {builtIn ? (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: "var(--text-muted)",
                          }}
                        >
                          built-in
                        </span>
                      ) : null}
                      {item.subnet ? (
                        <span
                          style={{
                            display: "block",
                            color: "var(--text-muted)",
                            fontSize: 11,
                          }}
                        >
                          {item.subnet}
                        </span>
                      ) : null}
                    </td>
                    <td style={cell}>
                      <span
                        style={{
                          color: DRIVER_COLORS[item.driver] ?? "var(--text-primary)",
                        }}
                      >
                        {item.driver}
                      </span>
                    </td>
                    <td style={{ ...cell, color: "var(--text-muted)" }}>
                      {item.scope}
                    </td>
                    <td
                      style={{
                        ...cell,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color:
                          item.containers > 0
                            ? "var(--accent-green)"
                            : "var(--text-muted)",
                      }}
                    >
                      {item.containers}
                    </td>
                    <td
                      style={{
                        ...cell,
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: "2px 6px", fontSize: 11 }}
                        onClick={() => setDetailFor(item)}
                        aria-label={`Inspect ${item.name}`}
                      >
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="server-config-component-description">
        These mirror what Docker holds, so a network made outside the panel shows
        up after a Sync. Docker&apos;s three built-in networks cannot be removed,
        and a swarm-scoped one only from a manager node.
      </p>
    </div>
  );
}
