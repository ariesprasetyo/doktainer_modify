"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import ConfirmActionDialog from "@/components/ConfirmActionDialog";
import {
  servers as serversApi,
  type Server as ServerType,
  type ServerConfigSnapshot,
  type WebStackAction,
  type WebStackComponentKey,
} from "@/lib/api";
import {
  getWebStackActionDescription,
  getWebStackActionLabel,
  getWebStackActionTone,
  getWebStackComponentLabel,
} from "@/app/servers/components/server-config-utils";
import { UserBadge } from "@/app/servers/components/server-config/ServerConfigPrimitives";
import ServerConfigWebServerPanel from "@/app/servers/components/server-config/ServerConfigWebServerPanel";

const serviceGroups = [
  {
    id: "infrastructure",
    label: "Infrastructure",
    description: "Reverse proxy, website delivery, and HTTPS automation.",
    services: "Nginx, Apache, Caddy, and Certbot",
  },
  {
    id: "php-runtime",
    label: "PHP Runtime",
    description: "Runtime and dependency tooling for native PHP applications.",
    services: "PHP and Composer",
    optionalNote:
      "Optional — install only when PHP applications run directly on this server.",
  },
  {
    id: "node-runtime",
    label: "Node.js Runtime",
    description: "Runtime and process management for Node.js applications.",
    services: "Node.js and PM2",
    optionalNote:
      "Optional — needed only when Node.js applications run directly on this server, not in Docker.",
  },
  {
    id: "data-services",
    label: "Data Services",
    description: "Database and cache services used by web applications.",
    services: "MySQL, PostgreSQL, and Redis",
    optionalNote:
      "Optional — install only when this VPS will host the application together with its database or cache. For larger production workloads, prefer a dedicated or managed data service.",
  },
] as const;

export default function WebServerManagerModal({
  server,
  onClose,
  onActionComplete,
}: {
  server: ServerType;
  onClose: () => void;
  onActionComplete: (message: string, tone?: "success" | "error") => void;
}) {
  const [snapshot, setSnapshot] = useState<ServerConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<
    (typeof serviceGroups)[number]["id"]
  >("infrastructure");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    component: WebStackComponentKey;
    action: WebStackAction;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await serversApi.getConfig(server.id);
      setSnapshot(response.data);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not load live web server data.");
    } finally {
      setLoading(false);
    }
  }, [server.id]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(refreshTimer);
  }, [refresh]);

  const getActionKey = useCallback(
    (component: WebStackComponentKey, action: WebStackAction) =>
      `web-stack:${component}:${action}`,
    [],
  );
  const selectedGroupInfo = serviceGroups.find(
    (group) => group.id === selectedGroup,
  )!;

  const runAction = async () => {
    if (!pendingAction) return;

    const current = pendingAction;
    const actionKey = getActionKey(current.component, current.action);
    setPendingAction(null);
    setRunningAction(actionKey);
    setError(null);
    try {
      const response = await serversApi.manageWebStack(
        server.id,
        current.component,
        current.action,
      );
      setSnapshot((previous) =>
        previous ? { ...previous, webServer: response.data } : previous,
      );
      const message =
        response.message ||
        `${getWebStackActionLabel(current.action)} completed for ${getWebStackComponentLabel(current.component)}.`;
      onActionComplete(message);
      await refresh();
    } catch (caught: unknown) {
      const message =
        caught instanceof Error
          ? caught.message
          : `Failed to ${current.action} ${current.component}.`;
      setError(message);
      onActionComplete(message, "error");
    } finally {
      setRunningAction(null);
    }
  };

  const pendingLabel = pendingAction
    ? getWebStackComponentLabel(pendingAction.component)
    : "";

  return (
    <div className="modal-overlay">
      {pendingAction ? (
        <ConfirmActionDialog
          open
          title={`${getWebStackActionLabel(pendingAction.action)} ${pendingLabel}`}
          description={getWebStackActionDescription(pendingLabel, pendingAction.action)}
          confirmLabel={`${getWebStackActionLabel(pendingAction.action)} ${pendingLabel}`}
          tone={getWebStackActionTone(pendingAction.action)}
          note="Service actions are applied directly to this server and may briefly interrupt matching workloads."
          onClose={() => setPendingAction(null)}
          onConfirm={() => void runAction()}
        />
      ) : null}
      <div className="modal-shell" style={{ maxWidth: 920 }}>
        <button type="button" onClick={onClose} className="modal-close" aria-label="Close web server manager">
          <X size={22} />
        </button>
        <div className="modal animate-slide-in" style={{ maxWidth: 920, maxHeight: "90vh", padding: 24, display: "grid", gap: 18, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h3 style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 16 }}>Manage Web Server</h3>
                <UserBadge label={server.status} tone={server.status === "ONLINE" ? "success" : "neutral"} />
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>{server.name} • {server.ip}:{server.sshPort}</p>
              <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>Live service status refreshes when this modal opens or when you click Refresh.</p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
            </button>
          </div>

          <nav className="ui-tab-scroll no-scrollbar" style={{ width: "100%", borderRadius: 6, background: "var(--bg-card)", minWidth: 0, minHeight: 38, alignItems: "center", overflowY: "hidden", flex: "0 0 auto" }} aria-label="Web server service groups">
            {serviceGroups.map((group) => (
              <button type="button" key={group.id} onClick={() => setSelectedGroup(group.id)} className="btn btn-ghost" style={{ height: 28, minHeight: 28, padding: "5px 12px", borderRadius: 4, boxSizing: "border-box", borderColor: selectedGroup === group.id ? "rgba(59,130,246,0.5)" : "transparent", background: selectedGroup === group.id ? "rgba(59,130,246,0.16)" : "transparent", color: selectedGroup === group.id ? "var(--accent-blue)" : "var(--text-secondary)", flex: "0 0 auto", fontSize: 12 }}>
                {group.label}
              </button>
            ))}
          </nav>

          <div style={{ display: "grid", flex: "1 1 auto", gap: 16, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
            <div style={{ padding: "12px 14px", borderLeft: "3px solid #3b82f6", background: "rgba(59,130,246,0.08)", display: "grid", gap: 4 }}>
              <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>{selectedGroupInfo.label}</strong>
              <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{selectedGroupInfo.description}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Services: {selectedGroupInfo.services}</span>
              {"optionalNote" in selectedGroupInfo && selectedGroupInfo.optionalNote ? <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{selectedGroupInfo.optionalNote}</span> : null}
            </div>

            {error ? <div style={{ display: "flex", gap: 8, padding: 12, borderRadius: 8, color: "var(--text-danger)", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)", fontSize: 12 }}><AlertTriangle size={15} />{error}</div> : null}
            {loading && !snapshot ? <div style={{ padding: 44, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}><Loader2 size={22} className="animate-spin" style={{ margin: "0 auto 10px" }} />Loading web server status...</div> : null}
            {snapshot ? <ServerConfigWebServerPanel snapshot={snapshot} serviceGroup={selectedGroup} hideComponentGroups isActionRunning={(key) => runningAction === key} getWebStackActionKey={getActionKey} onRequestWebStackActionConfirm={(component, action) => setPendingAction({ component, action })} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
