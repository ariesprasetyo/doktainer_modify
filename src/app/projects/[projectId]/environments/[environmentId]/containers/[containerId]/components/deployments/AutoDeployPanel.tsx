"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { containers as containersApi } from "@/lib/api";
import PanelShell from "../overview/PanelShell";

interface AutoDeploySource {
  repoUrl: string | null;
  repoBranch: string | null;
  repoTag: string | null;
  autoDeployOnPush: boolean;
  autoDeployTagPattern: string | null;
}

interface AutoDeployPanelProps {
  containerId: string;
  source: AutoDeploySource;
  onUpdated: (source: AutoDeploySource) => void;
  onToast?: (toast: { title: string; description?: string; variant?: "success" | "error" }) => void;
}

/**
 * Auto deploy settings only get written when a container is created, so an
 * existing one had no way to opt in. This lets it be turned on afterwards
 * without recreating the container.
 */
export default function AutoDeployPanel({
  containerId,
  source,
  onUpdated,
  onToast,
}: AutoDeployPanelProps) {
  const [saving, setSaving] = useState(false);
  const [tagPattern, setTagPattern] = useState(source.autoDeployTagPattern ?? "");
  const [error, setError] = useState("");

  const save = async (patch: { autoDeployOnPush?: boolean; autoDeployTagPattern?: string }) => {
    setSaving(true);
    setError("");
    try {
      const response = await containersApi.updateAutoDeploy(containerId, patch);
      if (!response.success) {
        throw new Error("Failed to update auto deploy settings");
      }
      onUpdated({ ...source, ...response.data });
      onToast?.({ title: "Auto deploy settings updated", variant: "success" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update auto deploy settings";
      setError(message);
      onToast?.({ title: message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelShell title="Auto Deploy">
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          cursor: saving ? "default" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={source.autoDeployOnPush}
          disabled={saving}
          onChange={(event) => void save({ autoDeployOnPush: event.target.checked })}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong style={{ fontSize: 13 }}>Deploy on push</strong>
          <span
            style={{
              display: "block",
              fontSize: 12,
              color: "var(--text-muted)",
              marginTop: 2,
            }}
          >
            Rebuild automatically when the git provider reports a push to{" "}
            <strong>{source.repoBranch || "main"}</strong>. Requires a webhook
            configured on the provider with a matching secret.
          </span>
        </span>
      </label>

      <div style={{ marginTop: 14 }}>
        <label
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            display: "block",
            marginBottom: 5,
          }}
        >
          Deploy On Tag Pattern (Optional)
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            value={tagPattern}
            disabled={saving}
            onChange={(event) => setTagPattern(event.target.value)}
            placeholder="v*"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving || tagPattern === (source.autoDeployTagPattern ?? "")}
            onClick={() => void save({ autoDeployTagPattern: tagPattern })}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
          </button>
        </div>
        <span
          style={{
            display: "block",
            fontSize: 12,
            color: "var(--text-muted)",
            marginTop: 4,
          }}
        >
          Pushing a tag whose name matches deploys that tag, independently of
          the toggle above.
        </span>
      </div>

      {source.repoTag ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
          Version is currently pinned to tag <strong>{source.repoTag}</strong>{" "}
          — branch pushes will not move it. Change the pinned tag from the
          deploy form to move it or clear the pin.
        </p>
      ) : null}

      {error ? (
        <p style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 10 }}>
          {error}
        </p>
      ) : null}
    </PanelShell>
  );
}
