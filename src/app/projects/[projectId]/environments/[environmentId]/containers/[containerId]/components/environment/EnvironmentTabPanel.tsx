"use client";

import { useEffect, useMemo, useState } from "react";
import { useTablePagination } from "@/lib/use-table-pagination";
import { canViewEnvironmentValues } from "@/lib/api";
import {
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  FileWarning,
  RotateCcw,
  Save,
  ShieldAlert,
} from "lucide-react";
import type {
  EnvironmentCheck,
  EnvironmentTabData,
} from "../../types/app-detail-types";
import PanelShell from "../overview/PanelShell";
import EnvironmentSummaryCard from "./EnvironmentSummaryCard";

interface EnvironmentTabPanelProps {
  environment: EnvironmentTabData;
  onSaveProjectEnv: (payload: {
    path: string;
    content: string;
    source: EditableEnvSource;
  }) => Promise<void>;
  /** Loads a different env_file of a compose stack into the editor. */
  onSelectComposeEnvPath?: (path: string) => void;
}

const checkClass: Record<EnvironmentCheck["status"], string> = {
  Ready: "badge-online",
  Missing: "badge-danger",
  Warning: "badge-warning",
};

type EditableEnvSource = "container" | "project" | "compose";
type EditorStatus = "idle" | "validated" | "saved";
type EditorNotice = {
  tone: "success" | "warning" | "error" | "info";
  message: string;
};

function getEditableSource(
  source: EnvironmentTabData["editor"]["source"],
): EditableEnvSource | null {
  return source === "container" || source === "project" || source === "compose"
    ? source
    : null;
}

function validateDotenvContent(content: string): EditorNotice {
  const keys = new Set<string>();
  const duplicateKeys = new Set<string>();
  const invalidLines: number[] = [];
  const invalidKeys: string[] = [];

  content.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      invalidLines.push(index + 1);
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      invalidKeys.push(key || `line ${index + 1}`);
      return;
    }

    if (keys.has(key)) duplicateKeys.add(key);
    keys.add(key);
  });

  if (invalidLines.length > 0) {
    return {
      tone: "error",
      message: `Invalid .env format on line ${invalidLines.slice(0, 4).join(", ")}. Each variable needs KEY=value.`,
    };
  }

  if (invalidKeys.length > 0) {
    return {
      tone: "error",
      message: `Invalid variable key: ${invalidKeys.slice(0, 4).join(", ")}.`,
    };
  }

  if (duplicateKeys.size > 0) {
    return {
      tone: "warning",
      message: `Format is valid, but duplicate keys were found: ${Array.from(duplicateKeys).slice(0, 4).join(", ")}.`,
    };
  }

  return {
    tone: "success",
    message: `Format is valid. ${keys.size} variable(s) are ready to save.`,
  };
}

export default function EnvironmentTabPanel({
  environment,
  onSaveProjectEnv,
  onSelectComposeEnvPath,
}: EnvironmentTabPanelProps) {
  const isViewer = !canViewEnvironmentValues();
  const isComposeEnv = environment.editor.source === "compose";
  const composeEnvPaths = environment.editor.composeEnvPaths;
  const [editorDraft, setEditorDraft] = useState(() => ({
    source: environment.editor.content,
    content: environment.editor.content,
    status: "idle" as EditorStatus,
  }));
  const [saving, setSaving] = useState(false);
  const [editorNotice, setEditorNotice] = useState<EditorNotice | null>(null);
  const editorContent = editorDraft.content;
  const editorStatus = editorDraft.status;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setEditorDraft((current) => {
        const isDirty =
          current.status === "saved"
            ? false
            : current.content !== current.source;

        if (isDirty) {
          return current;
        }

        if (
          current.source === environment.editor.content &&
          current.content === environment.editor.content
        ) {
          return current;
        }

        return {
          source: environment.editor.content,
          content: environment.editor.content,
          status: "idle",
        };
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    environment.editor.content,
    environment.editor.found,
    environment.editor.path,
    environment.editor.source,
  ]);

  const pagination = useTablePagination({
    items: environment.variables,
    pageSize: 6,
    resetKey: environment.variables.map((item) => item.id).join("|"),
  });
  const editorDirty =
    editorStatus === "saved" ? false : editorContent !== editorDraft.source;
  const editorLineCount = useMemo(
    () => editorContent.split("\n").filter((line) => line.trim()).length,
    [editorContent],
  );
  const editableSource = getEditableSource(environment.editor.source);
  const editorDisabled = isViewer || !environment.editor.found;
  const canSave =
    Boolean(environment.editor.found && environment.editor.path) &&
    editableSource !== null;

  async function handleSaveProjectEnv() {
    if (!environment.editor.path || !editableSource) {
      setEditorNotice({
        tone: "error",
        message:
          "Project .env path is not available. Open File Manager or redeploy the app before saving.",
      });
      return;
    }

    const validation = validateDotenvContent(editorContent);
    if (validation.tone === "error") {
      setEditorNotice(validation);
      return;
    }

    setSaving(true);
    setEditorNotice(validation);

    try {
      await onSaveProjectEnv({
        path: environment.editor.path,
        content: editorContent,
        source: editableSource,
      });
      setEditorDraft({
        source: editorContent,
        content: editorContent,
        status: "saved",
      });
      setEditorNotice({
        tone: "success",
        message:
          "Project .env saved. Restart or rebuild the app so the new values are applied.",
      });
    } catch (error) {
      setEditorNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to save .env file.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(190px, 100%), 1fr))",
          gap: 12,
        }}
      >
        {environment.summaries.map((summary) => (
          <EnvironmentSummaryCard key={summary.label} item={summary} />
        ))}
      </div> */}

      <PanelShell title="Project .env Editor">
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(min(620px, 100%), 1.35fr) minmax(min(320px, 100%), 0.65fr)",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div>
            {editorDisabled ? (
              <div
                style={{
                  minHeight: 480,
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--terminal-surface)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: "var(--terminal-body)",
                  textAlign: "center",
                  padding: 24,
                }}
              >
                <FileWarning
                  size={30}
                  style={{ color: "var(--accent-yellow)" }}
                />
                <strong>
                  {isViewer
                    ? "Environment variables are restricted"
                    : "Project .env file is unavailable"}
                </strong>
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    maxWidth: 560,
                  }}
                >
                  {isViewer
                    ? "Viewer accounts cannot access environment variable names or values."
                    : environment.editor.message ||
                    "No project .env file was found in the deployment or mounted project path."}
                </span>
              </div>
            ) : (
              <textarea
                value={editorContent}
                onChange={(event) => {
                  setEditorDraft({
                    source: environment.editor.content,
                    content: event.target.value,
                    status: "idle",
                  });
                  setEditorNotice(null);
                }}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 480,
                  resize: "vertical",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--terminal-surface)",
                  color: "var(--terminal-body)",
                  padding: 12,
                  fontFamily: "var(--font--code)",
                  fontSize: 12,
                  lineHeight: 1.6,
                  outline: "none",
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 10,
              }}
            >
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                {editorLineCount} variable line(s) -{" "}
                {editorDirty ? "Unsaved draft" : "Synced draft"}
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving || editorDisabled}
                  onClick={() => {
                    setEditorDraft({
                      source: editorDraft.source,
                      content: editorDraft.source,
                      status: "idle",
                    });
                    setEditorNotice({
                      tone: "info",
                      message:
                        "Editor content has been reset to the last loaded .env.",
                    });
                  }}
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving || editorDisabled}
                  onClick={() => {
                    const validation = validateDotenvContent(editorContent);
                    setEditorNotice(validation);
                    setEditorDraft({
                      source: environment.editor.content,
                      content: editorContent,
                      status: "validated",
                    });
                  }}
                >
                  <ClipboardCheck size={14} />
                  Validate
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canSave || saving}
                  onClick={() => void handleSaveProjectEnv()}
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  Save .env
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 7,
                background: "var(--bg-input)",
                padding: 12,
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                Editor Status
              </p>
              <p
                style={{
                  marginTop: 6,
                  color:
                    editorStatus === "saved"
                      ? "var(--accent-green)"
                      : editorStatus === "validated"
                        ? "var(--accent-blue)"
                        : editorDirty
                          ? "var(--accent-yellow)"
                          : "var(--text-muted)",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {editorStatus === "saved"
                  ? isComposeEnv
                    ? "Saved with the deployment, so a rebuild keeps it. Rebuild the stack to apply — a restart reuses the old values."
                    : "Project .env saved. Restart or rebuild the app to apply the changes."
                  : editorStatus === "validated"
                    ? "Draft format checked in the UI."
                      : editorDirty
                        ? "You have unsaved editor changes."
                        : environment.editor.found
                          ? environment.editor.source === "container"
                            ? "Editor is loaded from container filesystem .env."
                            : isComposeEnv
                              ? "Editor is loaded from an env_file declared by this compose stack."
                              : "Editor is loaded from project .env file."
                          : "Editor is disabled because no project .env file was found."}
              </p>
              <p
                style={{
                  marginTop: 8,
                  color: "var(--text-muted)",
                  fontSize: 11,
                  fontFamily: "var(--font--code)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {environment.editor.path ?? "No project .env path"}
              </p>

              {isComposeEnv && composeEnvPaths.length > 1 ? (
                <label
                  style={{
                    display: "block",
                    marginTop: 10,
                    color: "var(--text-muted)",
                    fontSize: 11,
                  }}
                >
                  {editorDirty
                    ? "env_file to edit — save or discard your changes first"
                    : "env_file to edit"}
                  <select
                    value={environment.editor.path ?? ""}
                    // Switching while dirty would keep the previous file's text
                    // in the editor and write it to the newly selected path.
                    disabled={!onSelectComposeEnvPath || editorDirty}
                    onChange={(event) =>
                      onSelectComposeEnvPath?.(event.target.value)
                    }
                    style={{
                      display: "block",
                      marginTop: 4,
                      width: "100%",
                      padding: "6px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--bg-input)",
                      color: "var(--text-primary)",
                      fontSize: 12,
                      fontFamily: "var(--font--code)",
                    }}
                  >
                    {composeEnvPaths.map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            {editorNotice ? (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background:
                    editorNotice.tone === "error"
                      ? "rgba(239,68,68,0.08)"
                      : editorNotice.tone === "success"
                        ? "rgba(34,197,94,0.08)"
                        : editorNotice.tone === "warning"
                          ? "rgba(245,158,11,0.1)"
                          : "var(--bg-input)",
                  color:
                    editorNotice.tone === "error"
                      ? "var(--text-danger)"
                      : editorNotice.tone === "success"
                        ? "var(--accent-green)"
                        : editorNotice.tone === "warning"
                          ? "var(--accent-yellow)"
                          : "var(--text-muted)",
                  padding: 11,
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                {editorNotice.message}
              </div>
            ) : null}

            {!environment.editor.found ? (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "rgba(245,158,11,0.1)",
                  color: "var(--accent-yellow)",
                  padding: 11,
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                {environment.editor.message ||
                  "No project .env file was found. The editor is read-only until a .env file exists in the deployment or mounted project path."}
              </div>
            ) : null}

            {environment.editor.validation.map((item) => (
              <div
                key={item.label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr)",
                  gap: 9,
                  alignItems: "start",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--bg-input)",
                  padding: 11,
                }}
              >
                <span
                  style={{
                    color:
                      item.status === "Ready"
                        ? "var(--accent-green)"
                        : "var(--accent-yellow)",
                    display: "inline-flex",
                    marginTop: 1,
                  }}
                >
                  {item.status === "Ready" ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <ShieldAlert size={15} />
                  )}
                </span>
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      color: "var(--text-primary)",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {item.label}
                  </p>
                  <p
                    style={{
                      marginTop: 4,
                      color: "var(--text-muted)",
                      fontSize: 11,
                      lineHeight: 1.45,
                    }}
                  >
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PanelShell>
    </section>
  );
}
