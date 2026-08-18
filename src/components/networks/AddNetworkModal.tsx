"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { networks as networksApi, type Server } from "@/lib/api";

/**
 * Creates a Docker network on a chosen server.
 *
 * Lifted out of the networks page unchanged so the Docker manager panel can
 * open the same form rather than a second, thinner one being written.
 */
export default function AddNetworkModal({
  serverList,
  onClose,
  onAdded,
}: {
  serverList: Server[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    driver: "bridge",
    scope: "local",
    subnet: "",
    gateway: "",
    serverId: serverList[0]?.id ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await networksApi.create({
        ...form,
        subnet: form.subnet || undefined,
        gateway: form.gateway || undefined,
      });
      onAdded();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create network");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-shell" style={{ maxWidth: 520 }}>
        <button
          type="button"
          onClick={onClose}
          className="modal-close"
          aria-label="Close create network modal"
        >
          <X size={22} />
        </button>
      <div
        className="modal animate-slide-in"
        style={{ width: "100%", maxWidth: 520, padding: 24 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 18,
            paddingRight: 36,
          }}
        >
          <div>
            <h3
              style={{
                color: "var(--text-primary)",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              Create Network
            </h3>
            <p
              style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}
            >
              Create a Docker network on the selected server and save it in the
              database.
            </p>
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 14,
              fontSize: 13,
              color: "#ef4444",
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={submit}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div>
            <label
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Target Server *
            </label>
            <select
              className="input"
              value={form.serverId}
              onChange={(e) =>
                setForm((current) => ({ ...current, serverId: e.target.value }))
              }
              style={{ width: "100%" }}
              required
            >
              <option value="">Select server</option>
              {serverList.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name} ({server.ip})
                </option>
              ))}
            </select>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Name *
              </label>
              <input
                className="input"
                value={form.name}
                onChange={(e) =>
                  setForm((current) => ({ ...current, name: e.target.value }))
                }
                placeholder="app-network"
                style={{ width: "100%" }}
                required
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Driver
              </label>
              <select
                className="input"
                value={form.driver}
                onChange={(e) =>
                  setForm((current) => ({ ...current, driver: e.target.value }))
                }
                style={{ width: "100%" }}
              >
                {["bridge", "overlay", "host", "macvlan"].map((driver) => (
                  <option key={driver} value={driver}>
                    {driver}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
            }}
          >
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Scope
              </label>
              <input
                className="input"
                value={form.scope}
                onChange={(e) =>
                  setForm((current) => ({ ...current, scope: e.target.value }))
                }
                placeholder="local"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Subnet
              </label>
              <input
                className="input"
                value={form.subnet}
                onChange={(e) =>
                  setForm((current) => ({ ...current, subnet: e.target.value }))
                }
                placeholder="172.18.0.0/16"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Gateway
              </label>
              <input
                className="input"
                value={form.gateway}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    gateway: e.target.value,
                  }))
                }
                placeholder="172.18.0.1"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              className="btn"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{
                flex: 1.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Create Network
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
