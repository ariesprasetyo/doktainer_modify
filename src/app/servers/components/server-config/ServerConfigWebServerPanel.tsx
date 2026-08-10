"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  WebStackComponentStatus,
  ServerConfigSnapshot,
  WebStackAction,
  WebStackComponentKey,
} from "@/lib/api";
import { UserBadge } from "@/app/servers/components/server-config/ServerConfigPrimitives";
import {
  getWebStackActionLabel,
  getWebStackActionStyle,
} from "@/app/servers/components/server-config-utils";

type WebServerServiceGroup =
  | "infrastructure"
  | "php-runtime"
  | "node-runtime"
  | "data-services";

interface ServerConfigWebServerPanelProps {
  snapshot: ServerConfigSnapshot;
  serviceGroup?: WebServerServiceGroup;
  hideComponentGroups?: boolean;
  isActionRunning: (actionKey: string) => boolean;
  getWebStackActionKey: (
    component: WebStackComponentKey,
    action: WebStackAction,
  ) => string;
  onRequestWebStackActionConfirm: (
    component: WebStackComponentKey,
    action: WebStackAction,
  ) => void;
}

export default function ServerConfigWebServerPanel({
  snapshot,
  serviceGroup,
  hideComponentGroups = false,
  isActionRunning,
  getWebStackActionKey,
  onRequestWebStackActionConfirm,
}: ServerConfigWebServerPanelProps) {
  const [activeGroup, setActiveGroup] = useState<
    "infrastructure" | "runtime-tools"
  >("infrastructure");
  const [activeIssueDetail, setActiveIssueDetail] = useState<{
    label: string;
    notes: string[];
  } | null>(null);

  const infrastructureComponents = snapshot.webServer.components.filter(
    (component) =>
      component.category === "web-server" || component.key === "certbot",
  );
  const runtimeToolComponents = snapshot.webServer.components.filter(
    (component) =>
      component.category !== "web-server" && component.key !== "certbot",
  );
  const groupComponentKeys: Record<
    WebServerServiceGroup,
    readonly WebStackComponentKey[]
  > = {
    infrastructure: ["nginx", "apache", "caddy", "certbot"],
    "php-runtime": ["php", "composer"],
    "node-runtime": ["nodejs", "pm2"],
    "data-services": ["mysql", "postgresql", "redis"],
  };

  const visibleComponents = serviceGroup
    ? snapshot.webServer.components.filter((component) =>
        groupComponentKeys[serviceGroup].includes(component.key),
      )
    : activeGroup === "infrastructure"
      ? infrastructureComponents
      : runtimeToolComponents;
  const renderComponentCard = (component: WebStackComponentStatus) => (
    <div key={component.key} className="card server-config-component-card">
      <div className="server-config-component-header">
        <div className="server-config-component-copy">
          <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>
            {component.label}
          </strong>
          <p className="server-config-component-description">
            {component.description}
          </p>
        </div>
        <UserBadge
          label={component.installed ? "Installed" : "Not Installed"}
          tone={component.installed ? "success" : "warning"}
        />
      </div>
      <hr className="server-config-component-divider" />

      {component.installed ? (
        <p className="server-config-component-metadata">
          {[
            component.version ? `Version ${component.version}` : null,
            component.serviceName ? `Service ${component.serviceName}` : null,
            component.active ? `Status ${component.active}` : null,
            component.enabled ? `Startup ${component.enabled}` : null,
          ]
            .filter(Boolean)
            .join(" / ")}
        </p>
      ) : null}

      {component.notes.length > 0 ? (
        <button
          type="button"
          className="server-config-component-issue-summary"
          onClick={() =>
            setActiveIssueDetail({
              label: component.label,
              notes: component.notes,
            })
          }
        >
          <span className="server-config-component-issue-copy">
            <AlertTriangle size={13} />
            <span>
              {component.notes.length === 1
                ? "1 issue detected"
                : `${component.notes.length} issues detected`}
            </span>
          </span>
          <span className="server-config-component-issue-action">Details</span>
        </button>
      ) : null}

      <div className="server-config-component-actions">
        {component.availableActions.length > 0 ? (
          component.availableActions.map((action) => {
            const actionStyle = getWebStackActionStyle(action);
            return (
              <button
                key={`${component.key}-${action}`}
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  onRequestWebStackActionConfirm(component.key, action)
                }
                disabled={isActionRunning(
                  getWebStackActionKey(component.key, action),
                )}
                style={{ whiteSpace: "nowrap", ...actionStyle }}
              >
                {isActionRunning(
                  getWebStackActionKey(component.key, action),
                ) ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : action === "remove" ? (
                  <Trash2 size={12} />
                ) : action === "install" ? (
                  <Plus size={12} />
                ) : (
                  <RefreshCw size={12} />
                )}
                {getWebStackActionLabel(action)}
              </button>
            );
          })
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Package management is unavailable for this SSH user on the current
            server.
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {activeIssueDetail && typeof document !== "undefined"
        ? createPortal(
            <div className="modal-overlay server-config-issue-overlay">
              <div className="modal-shell" style={{ maxWidth: 520 }}>
                <div className="modal server-config-issue-dialog">
                  <div className="server-config-issue-dialog-header">
                    <div>
                      <strong
                        style={{ color: "var(--text-primary)", fontSize: 15 }}
                      >
                        {activeIssueDetail.label} Issues
                      </strong>
                      <p
                        style={{
                          marginTop: 6,
                          color: "var(--text-muted)",
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        Service information returned by the current server
                        snapshot.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveIssueDetail(null)}
                      aria-label="Close issue details"
                      className="server-config-issue-close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="server-config-issue-list">
                    {activeIssueDetail.notes.map((note) => (
                      <div key={note} className="server-config-issue-note">
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* <div
        className="card"
        style={{ padding: "14px 16px", display: "grid", gap: 10 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>
              Web Server Readiness
            </strong>
            <p className="server-config-component-description">
              {snapshot.webServer.summary}
            </p>
          </div>
          <UserBadge
            label={snapshot.webServer.ready ? "Ready" : "Needs Setup"}
            tone={snapshot.webServer.ready ? "success" : "warning"}
          />
        </div>
        <p
          style={{
            margin: 0,
            color: "var(--text-muted)",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {snapshot.webServer.primaryWebServer ?? "No primary web server"}
          {" / "}
          {snapshot.webServer.packageManager ?? "No package manager"}
          {" / "}
          {readyCapabilityCount} of {totalCapabilityCount} capabilities ready
        </p>
        {snapshot.webServer.notes.length > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 8,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowReadinessNotes((current) => !current)}
              aria-expanded={showReadinessNotes}
              style={{
                justifySelf: "start",
                color: "#b45309",
                padding: "4px 0",
                border: 0,
                background: "transparent",
              }}
            >
              <AlertTriangle size={13} />
              {showReadinessNotes ? "Hide" : "Show"}{" "}
              {snapshot.webServer.notes.length} setup recommendation
              {snapshot.webServer.notes.length === 1 ? "" : "s"}
            </button>
            {showReadinessNotes ? (
              <div style={{ display: "grid", gap: 8 }}>
                {snapshot.webServer.notes.map((note) => (
                  <div
                    key={note}
                    style={{
                      padding: "9px 11px",
                      borderRadius: 7,
                      border: "1px solid rgba(245, 158, 11, 0.24)",
                      background: "rgba(245, 158, 11, 0.08)",
                      color: "#b45309",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div> */}

      {!hideComponentGroups ? (
      <div
        className="card"
        style={{
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
          <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>
            Components
          </strong>
          <span
            style={{
              color: "var(--text-muted)",
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            {activeGroup === "infrastructure"
              ? "Reverse proxy, site delivery, and HTTPS."
              : "Runtimes, databases, cache, and supporting tools."}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setActiveGroup("infrastructure")}
            aria-pressed={activeGroup === "infrastructure"}
            style={{
              borderColor:
                activeGroup === "infrastructure"
                  ? "rgba(59,130,246,0.35)"
                  : "var(--border)",
              background:
                activeGroup === "infrastructure"
                  ? "rgba(59,130,246,0.12)"
                  : "var(--bg-input)",
              color:
                activeGroup === "infrastructure"
                  ? "#3b82f6"
                  : "var(--text-secondary)",
            }}
          >
            Infrastructure ({infrastructureComponents.length})
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setActiveGroup("runtime-tools")}
            aria-pressed={activeGroup === "runtime-tools"}
            style={{
              borderColor:
                activeGroup === "runtime-tools"
                  ? "rgba(59,130,246,0.35)"
                  : "var(--border)",
              background:
                activeGroup === "runtime-tools"
                  ? "rgba(59,130,246,0.12)"
                  : "var(--bg-input)",
              color:
                activeGroup === "runtime-tools"
                  ? "#3b82f6"
                  : "var(--text-secondary)",
            }}
          >
            Runtime Tools ({runtimeToolComponents.length})
          </button>
        </div>
      </div>
      ) : null}

      <div className="server-config-component-grid">
        {visibleComponents.map((component) => renderComponentCard(component))}
      </div>
    </div>
  );
}
