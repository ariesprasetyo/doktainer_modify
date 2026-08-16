"use client";

import { useCallback, useEffect, useState } from "react";
import { megabytesToMemory, memoryToMegabytes } from "@/lib/memory-units";
import {
  containers as containersApi,
  type ComposeServiceOverride,
  type ContainerComposeServices,
} from "@/lib/api";

/**
 * Limits and run options for a deployed container.
 *
 * The two halves are genuinely different mechanisms, not two views of one:
 *  - a single container is changed in place with `docker update`, which Docker
 *    allows for cpu, memory and the restart policy without a recreate
 *  - a compose stack cannot take those flags at all, so its settings are
 *    stored and written to a generated override file on the next rebuild
 *
 * Mounts and command are only offered for compose. Docker cannot change either
 * on a running container, so showing them for a single container would promise
 * something the Apply button could not deliver.
 */

interface ResourceLimitsPanelProps {
  containerId: string;
  isComposeStack: boolean;
  current: {
    cpuShares?: number | null;
    cpuCores?: string | null;
    memoryLimit?: string | null;
    restartPolicy: string;
  };
}

type Notice = { tone: "success" | "error" | "info"; message: string };

const RESTART_OPTIONS = [
  { value: "unless-stopped", label: "Unless Stopped" },
  { value: "always", label: "Always" },
  { value: "on-failure", label: "On Failure" },
  { value: "no", label: "No" },
];

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--bg-card)",
  padding: 16,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  color: "var(--text-muted)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const hintStyle: React.CSSProperties = {
  marginTop: 8,
  color: "var(--text-muted)",
  fontSize: 11,
  lineHeight: 1.5,
};

function noticeColor(tone: Notice["tone"]) {
  if (tone === "error") return "var(--accent-red)";
  if (tone === "success") return "var(--accent-green)";
  return "var(--text-muted)";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function ResourceLimitsPanel({
  containerId,
  isComposeStack,
  current,
}: ResourceLimitsPanelProps) {
  if (isComposeStack) {
    return <ComposeServiceLimits containerId={containerId} />;
  }

  return <SingleContainerLimits containerId={containerId} current={current} />;
}

function SingleContainerLimits({
  containerId,
  current,
}: {
  containerId: string;
  current: ResourceLimitsPanelProps["current"];
}) {
  const [form, setForm] = useState(() => ({
    cpuShares: current.cpuShares != null ? String(current.cpuShares) : "",
    cpuCores: current.cpuCores ?? "",
    memoryLimit: memoryToMegabytes(current.memoryLimit),
    restartPolicy: current.restartPolicy || "unless-stopped",
  }));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const apply = useCallback(async () => {
    setSaving(true);
    setNotice(null);

    try {
      const response = await containersApi.updateResources(containerId, {
        cpuShares: form.cpuShares.trim() || undefined,
        cpuCores: form.cpuCores.trim() || undefined,
        memoryLimit: megabytesToMemory(form.memoryLimit),
        restartPolicy: form.restartPolicy,
      });
      setNotice({
        tone: response.data.clearedALimit ? "info" : "success",
        message: response.data.message,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error, "Failed to apply the new limits."),
      });
    } finally {
      setSaving(false);
    }
  }, [containerId, form]);

  return (
    <section style={cardStyle}>
      <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Resource Limits</h3>
      <p style={{ margin: "0 0 14px", ...hintStyle, marginTop: 0 }}>
        Applied to the running container straight away. Docker changes these
        without recreating it, so nothing goes down.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <label style={labelStyle} htmlFor="limit-cpu-shares">
            CPU Shares
          </label>
          <input
            id="limit-cpu-shares"
            className="input"
            value={form.cpuShares}
            onChange={(event) =>
              setForm((state) => ({ ...state, cpuShares: event.target.value }))
            }
            placeholder="1024"
            inputMode="numeric"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="limit-cpu-cores">
            CPU Cores
          </label>
          <input
            id="limit-cpu-cores"
            className="input"
            value={form.cpuCores}
            onChange={(event) =>
              setForm((state) => ({ ...state, cpuCores: event.target.value }))
            }
            placeholder="1.5"
            inputMode="decimal"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="limit-memory">
            Memory (MB)
          </label>
          <input
            id="limit-memory"
            className="input"
            value={form.memoryLimit}
            onChange={(event) =>
              setForm((state) => ({
                ...state,
                memoryLimit: event.target.value,
              }))
            }
            placeholder="512"
            inputMode="numeric"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="limit-restart">
            Restart Policy
          </label>
          <select
            id="limit-restart"
            className="input"
            value={form.restartPolicy}
            onChange={(event) =>
              setForm((state) => ({
                ...state,
                restartPolicy: event.target.value,
              }))
            }
            style={{ width: "100%", cursor: "pointer" }}
          >
            {RESTART_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p style={hintStyle}>
        Leave a field empty to let Docker decide. CPU shares is a relative
        weight that only matters when the host is contended; CPU cores is a hard
        ceiling. Clearing a field stores the removal, but Docker cannot lift a
        limit from a running container, so that part applies on the next
        rebuild. Mounts and the command are not here at all for the same
        reason — redeploy to change those.
      </p>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={apply}
          disabled={saving}
        >
          {saving ? "Applying…" : "Apply"}
        </button>
        {notice ? (
          <span style={{ color: noticeColor(notice.tone), fontSize: 12 }}>
            {notice.message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function ComposeServiceLimits({ containerId }: { containerId: string }) {
  const [data, setData] = useState<ContainerComposeServices | null>(null);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Record<string, ComposeServiceOverride>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;

    containersApi
      .composeServices(containerId)
      .then((response) => {
        if (cancelled) return;
        setData(response.data);
        setDraft(response.data.overrides ?? {});
        setSelected(response.data.services[0] ?? "");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice({
          tone: "error",
          message: errorMessage(error, "Failed to load compose services."),
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [containerId]);

  const patchSelected = useCallback(
    (patch: Partial<ComposeServiceOverride>) => {
      if (!selected) return;
      setDraft((state) => ({
        ...state,
        [selected]: { ...state[selected], ...patch },
      }));
    },
    [selected],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setNotice(null);

    try {
      const response = await containersApi.updateComposeServices(
        containerId,
        draft,
      );
      setDraft(response.data.overrides);
      setNotice({ tone: "success", message: response.data.message });
    } catch (error) {
      setNotice({
        tone: "error",
        message: errorMessage(error, "Failed to save compose service settings."),
      });
    } finally {
      setSaving(false);
    }
  }, [containerId, draft]);

  if (loading) {
    return (
      <section style={cardStyle}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
          Loading compose services…
        </p>
      </section>
    );
  }

  if (!data || data.services.length === 0) {
    return (
      <section style={cardStyle}>
        <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>
          Compose Service Settings
        </h3>
        <p style={{ margin: 0, color: noticeColor(notice?.tone ?? "info"), fontSize: 12 }}>
          {notice?.message ??
            "No services could be read from this stack's compose file."}
        </p>
      </section>
    );
  }

  const override = draft[selected] ?? {};

  return (
    <section style={cardStyle}>
      <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>
        Compose Service Settings
      </h3>
      <p style={{ margin: "0 0 14px", ...hintStyle, marginTop: 0 }}>
        Written to a generated override file passed alongside{" "}
        <code>{data.composeFilePath}</code> on every deploy, so these survive a
        rebuild without changing anything in the repository.
      </p>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="compose-service">
          Service
        </label>
        <select
          id="compose-service"
          className="input"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          style={{ width: "100%", cursor: "pointer" }}
        >
          {data.services.map((service) => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <label style={labelStyle} htmlFor="compose-restart">
            Restart Policy
          </label>
          <select
            id="compose-restart"
            className="input"
            value={override.restart ?? ""}
            onChange={(event) =>
              patchSelected({ restart: event.target.value || null })
            }
            style={{ width: "100%", cursor: "pointer" }}
          >
            <option value="">Leave as the compose file has it</option>
            {RESTART_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="compose-cpu-shares">
            CPU Shares
          </label>
          <input
            id="compose-cpu-shares"
            className="input"
            value={override.cpuShares != null ? String(override.cpuShares) : ""}
            onChange={(event) =>
              patchSelected({
                cpuShares: event.target.value.trim()
                  ? Number(event.target.value)
                  : null,
              })
            }
            placeholder="1024"
            inputMode="numeric"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="compose-cpu-cores">
            CPU Cores
          </label>
          <input
            id="compose-cpu-cores"
            className="input"
            value={override.cpuCores ?? ""}
            onChange={(event) =>
              patchSelected({ cpuCores: event.target.value || null })
            }
            placeholder="1.5"
            inputMode="decimal"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="compose-memory">
            Memory (MB)
          </label>
          <input
            id="compose-memory"
            className="input"
            value={memoryToMegabytes(override.memory)}
            onChange={(event) =>
              patchSelected({
                memory: megabytesToMemory(event.target.value) ?? null,
              })
            }
            placeholder="512"
            inputMode="numeric"
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={labelStyle} htmlFor="compose-command">
          Command
        </label>
        <input
          id="compose-command"
          className="input"
          value={override.command ?? ""}
          onChange={(event) =>
            patchSelected({ command: event.target.value || null })
          }
          placeholder="Leave empty to keep the compose file's command"
          style={{ width: "100%", fontFamily: "monospace" }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={labelStyle} htmlFor="compose-volumes">
          Extra Mounts — one per line
        </label>
        <textarea
          id="compose-volumes"
          className="input"
          value={(override.volumes ?? []).join("\n")}
          onChange={(event) =>
            patchSelected({
              volumes: event.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
          rows={3}
          placeholder={"/srv/data:/data\nnamed-volume:/var/lib/app"}
          style={{ width: "100%", fontFamily: "monospace", resize: "vertical" }}
        />
        {data.volumesAreAppended ? (
          <p style={hintStyle}>
            Compose adds these to the mounts the service already declares. A
            mount defined in the repository cannot be removed from here — edit
            the compose file for that.
          </p>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {notice ? (
          <span style={{ color: noticeColor(notice.tone), fontSize: 12 }}>
            {notice.message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
