"use client";

import type { Dispatch, SetStateAction } from "react";
import { Loader2, Power, RefreshCw } from "lucide-react";
import type { Server as ServerType, ServerConfigSnapshot } from "@/lib/api";
import { ConfigInfoRow } from "@/app/servers/components/server-config/ServerConfigPrimitives";

interface ServerConfigActionsPanelProps {
  server: ServerType;
  snapshot: ServerConfigSnapshot;
  snapshotLoadError?: string | null;
  resetConfirmation: string;
  setResetConfirmation: Dispatch<SetStateAction<string>>;
  confirmResetStep: boolean;
  setConfirmResetStep: Dispatch<SetStateAction<boolean>>;
  deleteConfirmed: boolean;
  isActionRunning: (actionKey: string) => boolean;
  getServerActionKey: (action: "reboot" | "restart-nginx") => string;
  onRequestServerActionConfirm: (action: "reboot" | "restart-nginx") => void;
  onReset: () => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
}

export default function ServerConfigActionsPanel({
  server,
  snapshot,
  snapshotLoadError,
  resetConfirmation,
  setResetConfirmation,
  confirmResetStep,
  setConfirmResetStep,
  deleteConfirmed,
  isActionRunning,
  getServerActionKey,
  onRequestServerActionConfirm,
  onReset,
  setError,
}: ServerConfigActionsPanelProps) {
  const dockerStatusUnavailable = Boolean(
    snapshotLoadError || snapshot.docker.probeFailed,
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
      }}
    >
      <div style={{ display: "grid", gap: 16 }}>
        {snapshotLoadError ? (
          <div
            className="card"
            style={{
              padding: 18,
              display: "grid",
              gap: 8,
              border: "1px solid rgba(245,158,11,0.24)",
              background: "rgba(245,158,11,0.08)",
            }}
            hidden={snapshotLoadError != null}
          >
            <strong style={{ color: "#f59e0b", fontSize: 14 }}>
              Recovery mode
            </strong>
            <p
              style={{
                color: "var(--text-primary)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Live runtime status could not be loaded, but host-level actions
              are still available so you can try rebooting the server,
              restarting the web server.
            </p>
            <p style={{ color: "#fbbf24", fontSize: 12 }}>
              {snapshotLoadError}
            </p>
          </div>
        ) : null}

        <div className="card" style={{ padding: 18, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Power size={15} style={{ color: "#10b981" }} />
            <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>
              Server Controls
            </strong>
          </div>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            Trigger common maintenance actions for the host and web stack.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn btn-sm"
              onClick={() => onRequestServerActionConfirm("restart-nginx")}
              disabled={isActionRunning(getServerActionKey("restart-nginx"))}
              style={{
                background: "rgba(16,185,129,0.12)",
                color: "#10b981",
                border: "1px solid rgba(16,185,129,0.22)",
              }}
            >
              {isActionRunning(getServerActionKey("restart-nginx")) ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Restart Nginx
            </button>
            <button
              className="btn btn-sm"
              onClick={() => onRequestServerActionConfirm("reboot")}
              disabled={isActionRunning(getServerActionKey("reboot"))}
              style={{
                background: "rgba(239,68,68,0.12)",
                color: "#ef4444",
                border: "1px solid rgba(239,68,68,0.22)",
              }}
            >
              {isActionRunning(getServerActionKey("reboot")) ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Power size={14} />
              )}
              Reboot Server
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Power size={15} style={{ color: "#ef4444" }} />
            <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>
              Reset Server
            </strong>
          </div>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            Type DELETE to unlock the final reset confirmation. This action
            interrupts SSH access and monitoring until the machine is back
            online.
          </p>
          <input
            className="input"
            placeholder="Type DELETE to confirm"
            value={resetConfirmation}
            onChange={(event) => {
              const nextValue = event.target.value;
              setResetConfirmation(nextValue);
              if (nextValue.trim() !== "DELETE") {
                setConfirmResetStep(false);
              }
            }}
            style={{ width: "100%" }}
          />
          {!confirmResetStep ? (
            <div>
              <button
                className="btn btn-sm"
                onClick={() => {
                  if (!deleteConfirmed) {
                    setError('Type "DELETE" before continuing.');
                    return;
                  }
                  setError("");
                  setConfirmResetStep(true);
                }}
                disabled={!deleteConfirmed}
                style={{
                  background: "rgba(239,68,68,0.12)",
                  color: "#ef4444",
                  border: "1px solid rgba(239,68,68,0.22)",
                }}
              >
                <Power size={14} /> Continue
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 12,
                borderRadius: 12,
                border: "1px solid rgba(239,68,68,0.22)",
                background: "rgba(239,68,68,0.06)",
                padding: 14,
              }}
            >
              <div
                style={{
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Final confirmation
              </div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                Resetting {server.name} will interrupt SSH access and monitoring
                until the machine boots again.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-sm"
                  onClick={() => setConfirmResetStep(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => void onReset()}
                  disabled={isActionRunning("server:reset") || !deleteConfirmed}
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    color: "#ef4444",
                    border: "1px solid rgba(239,68,68,0.22)",
                  }}
                >
                  {isActionRunning("server:reset") ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Power size={14} />
                  )}
                  Confirm Reset
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div
        className="card"
        style={{ padding: 18, display: "grid", gap: 10, alignContent: "start" }}
        hidden
      >
        <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>
          Quick Facts
        </strong>
        <ConfigInfoRow label="Server" value={server.name} />
        <ConfigInfoRow label="IP" value={server.ip} />
        <ConfigInfoRow label="SSH User" value={snapshot.serverUser} />
        <ConfigInfoRow
          label="Users"
          value={`${snapshot.users.length} accounts`}
        />
        <ConfigInfoRow
          label="Docker"
          value={
            dockerStatusUnavailable
              ? `Status unavailable${snapshot.docker.reason ? ` • ${snapshot.docker.reason}` : ""}`
              : snapshot.docker.installed
                ? snapshot.docker.available
                  ? `Installed • ${snapshot.docker.version ?? "ready"}`
                  : (snapshot.docker.reason ?? "Installed but unavailable")
                : "Not installed"
          }
        />
        <ConfigInfoRow
          label="Services"
          value={`${snapshot.services.length} tracked`}
        />
        <ConfigInfoRow
          label="Web Stack"
          value={snapshot.webServer.ready ? "Ready" : "Needs setup"}
        />
        <ConfigInfoRow
          label="Mounts"
          value={`${snapshot.diskMounts.length} detected`}
        />
      </div>
    </div>
  );
}
