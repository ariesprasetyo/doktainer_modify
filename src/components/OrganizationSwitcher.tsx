"use client";

import {
  organizationsApi,
  type CreateOrganizationBody,
  type OrganizationRecord,
} from "@/lib/api";
import {
  addOrganizationStateListener,
  getStoredOrganizationId,
  setStoredOrganizationId,
} from "@/lib/organization-state";
import {
  Building2,
  ChevronDown,
  ChevronsUpDown,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface OrganizationSwitcherProps {
  collapsed: boolean;
  canManage: boolean;
}

const emptyForm: CreateOrganizationBody = {
  name: "",
  logoUrl: "",
};

let organizationsCache: OrganizationRecord[] | null = null;
let organizationsCacheUpdatedAt = 0;
let organizationsRequest: Promise<OrganizationRecord[]> | null = null;

const ORGANIZATIONS_CACHE_TTL_MS = 30_000;

async function fetchOrganizations() {
  if (organizationsRequest) {
    return organizationsRequest;
  }

  organizationsRequest = organizationsApi
    .list()
    .then((response) => {
      const items = response.data ?? [];
      organizationsCache = items;
      organizationsCacheUpdatedAt = Date.now();
      return items;
    })
    .finally(() => {
      organizationsRequest = null;
    });

  return organizationsRequest;
}

/**
 * A logo URL points at a third party's server, so it fails in ways this panel
 * does not control. Two are worth handling rather than rendering a broken
 * image:
 *
 * - Hotlink protection. Sending a Referer that identifies this panel is by
 *   itself enough for some CDNs to answer 403 — Cloudflare error 1011 was hit
 *   in practice with a real logo, where the byte-identical request without a
 *   Referer returned the image fine. Nothing here needs the referrer, so it is
 *   suppressed.
 * - A URL that is mistyped, moved, or offline. Falling back to the same
 *   placeholder used when no logo is set keeps the row looking deliberate.
 *
 * Callers pass the URL as `key` so a corrected one gets a fresh attempt
 * instead of staying stuck on a previous failure.
 */
function OrganizationLogo({
  logoUrl,
  name,
  size,
  iconSize,
}: {
  logoUrl: string | null | undefined;
  name: string;
  size: number;
  iconSize: number;
}) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        flexShrink: 0,
      }}
    >
      <Building2 size={iconSize} />
    </div>
  );
}

export default function OrganizationSwitcher({
  collapsed,
  canManage,
}: OrganizationSwitcherProps) {
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrganizationRecord | null>(
    null,
  );
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [confirmDeleteStep, setConfirmDeleteStep] = useState(false);
  const [form, setForm] = useState<CreateOrganizationBody>(emptyForm);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const loadOrganizations = async (options?: { force?: boolean }) => {
    const cacheFresh =
      organizationsCache &&
      Date.now() - organizationsCacheUpdatedAt < ORGANIZATIONS_CACHE_TTL_MS;

    if (organizationsCache) {
      setOrganizations(organizationsCache);
    }

    if (!organizationsCache || options?.force) {
      setLoading(true);
    } else {
      setLoading(false);
    }

    if (cacheFresh && !options?.force) {
      return;
    }

    setError("");

    try {
      const items = await fetchOrganizations();
      setOrganizations(items);

      const storedOrganizationId = getStoredOrganizationId();
      const fallbackOrganization =
        items.find(
          (organization) => organization.id === storedOrganizationId,
        ) ??
        items.find((organization) => organization.isActive) ??
        items.find((organization) => organization.isDefault) ??
        items[0];

      if (
        fallbackOrganization?.id &&
        fallbackOrganization.id !== storedOrganizationId
      ) {
        setStoredOrganizationId(fallbackOrganization.id);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load organizations",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const syncViewport = () => {
      setIsNarrowViewport(window.innerWidth < 1180);
    };

    const initialLoadTimer = window.setTimeout(() => {
      void loadOrganizations();
      syncViewport();
    }, 0);

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const removeOrganizationListener = addOrganizationStateListener(() => {
      void loadOrganizations({ force: true });
    });

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", syncViewport);

    return () => {
      window.clearTimeout(initialLoadTimer);
      removeOrganizationListener();
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  const activeOrganization = useMemo(() => {
    const storedOrganizationId = getStoredOrganizationId();
    return (
      organizations.find(
        (organization) => organization.id === storedOrganizationId,
      ) ??
      organizations.find((organization) => organization.isActive) ??
      organizations[0] ??
      null
    );
  }, [organizations]);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
    setOpen(false);
  };

  const openEditModal = (organization: OrganizationRecord) => {
    setEditingId(organization.id);
    setForm({ name: organization.name, logoUrl: organization.logoUrl ?? "" });
    setModalOpen(true);
    setOpen(false);
  };

  const resetDeleteModal = () => {
    setDeleteTarget(null);
    setDeleteConfirmation("");
    setConfirmDeleteStep(false);
  };

  const closeDeleteModal = () => {
    if (saving) {
      return;
    }

    resetDeleteModal();
  };

  const openDeleteModal = (organization: OrganizationRecord) => {
    setDeleteTarget(organization);
    setDeleteConfirmation("");
    setConfirmDeleteStep(false);
    setError("");
    setOpen(false);
  };

  const handleSelect = async (organization: OrganizationRecord) => {
    if (organization.id === activeOrganization?.id) {
      setOpen(false);
      return;
    }

    setSaving(true);
    setError("");
    const previousOrganizationId = activeOrganization?.id;
    setStoredOrganizationId(organization.id);

    try {
      await organizationsApi.activate(organization.id);
      setOpen(false);
      window.location.reload();
    } catch (err) {
      if (previousOrganizationId) {
        setStoredOrganizationId(previousOrganizationId);
      }
      setError(
        err instanceof Error ? err.message : "Failed to switch organization",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (organization: OrganizationRecord) => {
    setSaving(true);
    setError("");

    try {
      await organizationsApi.setDefault(organization.id);
      if (organization.id === activeOrganization?.id) {
        setStoredOrganizationId(organization.id);
      }
      await loadOrganizations({ force: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to set default organization",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (organization: OrganizationRecord) => {
    setSaving(true);
    setError("");
    const wasActive = organization.id === activeOrganization?.id;

    try {
      await organizationsApi.remove(organization.id, {
        confirmation: "DELETE",
      });
      await loadOrganizations({ force: true });
      resetDeleteModal();

      if (wasActive) {
        window.location.reload();
        return;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete organization",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        name: form.name.trim(),
        logoUrl: form.logoUrl?.trim() || undefined,
      };

      if (editingId) {
        await organizationsApi.update(editingId, payload);
      } else {
        await organizationsApi.create(payload);
      }

      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadOrganizations({ force: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save organization",
      );
    } finally {
      setSaving(false);
    }
  };

  if (collapsed) return null;

  return (
    <div ref={rootRef} style={{ position: "relative", margin: "12px 8px 8px" }}>
      <button
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          //   background: "rgba(255,255,255,0.04)",
          background: activeOrganization
            ? "transparent"
            : "var(--bg-secondary)",
          color: "var(--text-primary)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <OrganizationLogo
          key={activeOrganization?.logoUrl ?? "no-logo"}
          logoUrl={activeOrganization?.logoUrl}
          name={activeOrganization?.name ?? "Organization"}
          size={20}
          iconSize={12}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginBottom: 2,
            }}
          >
            Organization
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {activeOrganization?.name ??
              (loading ? "Loading..." : "No organization")}
          </div>
        </div>
        <ChevronsUpDown size={16} color="var(--text-muted)" />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: isNarrowViewport ? "calc(100% + 8px)" : 0,
            left: isNarrowViewport ? 0 : "calc(100% + 14px)",
            minHeight: "250px",
            maxHeight: "350px",
            width: 300,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 16px 40px rgba(0,0,0,0.22)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: 12,
            zIndex: 60,
          }}
        >
          <div
            style={{
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 2,
              color: "var(--text-muted)",
              padding: "2px 6px 10px",
            }}
          >
            <Building2 size={12} style={{ marginRight: 4 }} />
            Organizations
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {organizations.map((organization) => {
              const selected = organization.id === activeOrganization?.id;

              return (
                <div
                  key={organization.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void handleSelect(organization)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleSelect(organization);
                    }
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 10px",
                    borderRadius: 12,
                    background: selected
                      ? "rgba(59, 130, 246, 0.12)"
                      : "transparent",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                    outline: "none",
                  }}
                >
                  <OrganizationLogo
                    key={organization.logoUrl ?? "no-logo"}
                    logoUrl={organization.logoUrl}
                    name={organization.name}
                    size={18}
                    iconSize={11}
                  />
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: 15,
                        fontWeight: 500,
                      }}
                    >
                      {organization.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Set default organization"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleSetDefault(organization);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: organization.isDefault
                        ? "#f5c451"
                        : "var(--text-muted)",
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    <Star
                      size={15}
                      fill={organization.isDefault ? "currentColor" : "none"}
                    />
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      title="Edit organization"
                      disabled={saving}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditModal(organization);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        padding: 2,
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {canManage && organizations.length > 1 && (
                    <button
                      type="button"
                      title={
                        selected
                          ? "Current organization cannot be deleted"
                          : "Delete organization"
                      }
                      disabled={saving || selected}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (selected) {
                          return;
                        }
                        openDeleteModal(organization);
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "var(--text-muted)",
                        cursor: saving || selected ? "not-allowed" : "pointer",
                        opacity: selected ? 0.45 : 1,
                        padding: 2,
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              disabled={saving}
              style={{
                marginTop: 10,
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 6px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              <Plus size={14} /> Add organization
            </button>
          )}

          {error && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444" }}>
              {error}
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.68)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 90,
          }}
          onClick={closeDeleteModal}
        >
          <div
            className="card"
            style={{
              width: "min(100%, 520px)",
              padding: 0,
              overflow: "hidden",
              boxShadow: "0 28px 70px rgba(2, 6, 23, 0.46)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {!confirmDeleteStep ? (
              <div style={{ padding: 28, display: "grid", gap: 18 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          border: "1px solid rgba(239,68,68,0.2)",
                          background: "rgba(239,68,68,0.08)",
                          display: "grid",
                          placeItems: "center",
                          color: "#ef4444",
                        }}
                      >
                        <Trash2 size={16} />
                      </div>
                      <strong
                        style={{ color: "var(--text-primary)", fontSize: 18 }}
                      >
                        Delete Organization
                      </strong>
                    </div>
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 14,
                        lineHeight: 1.7,
                        maxWidth: 430,
                      }}
                    >
                      Type DELETE to unlock the final removal confirmation. This
                      will delete organization data and related records in the
                      database, including servers, containers, domains, SSL,
                      networks, backups, security presets, installed apps,
                      invitations, API keys, and linked access records.
                    </p>
                  </div>
                  <button
                    onClick={closeDeleteModal}
                    disabled={saving}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: saving ? "not-allowed" : "pointer",
                      color: "var(--text-muted)",
                      alignSelf: "flex-start",
                    }}
                    aria-label="Close delete organization dialog"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(239,68,68,0.18)",
                    background: "rgba(239,68,68,0.08)",
                    padding: "14px 16px",
                    color: "#f87171",
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  Target: {deleteTarget.name}. If some related records do not
                  exist in the database, they will be skipped automatically.
                </div>

                <input
                  className="input"
                  placeholder="Type DELETE to confirm"
                  value={deleteConfirmation}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDeleteConfirmation(nextValue);
                    if (nextValue.trim() !== "DELETE") {
                      setConfirmDeleteStep(false);
                    }
                  }}
                  autoFocus
                />

                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => setConfirmDeleteStep(true)}
                    disabled={deleteConfirmation.trim() !== "DELETE"}
                    style={{
                      background: "rgba(239,68,68,0.12)",
                      color: "#ef4444",
                      border: "1px solid rgba(239,68,68,0.22)",
                    }}
                  >
                    <Trash2 size={14} /> Continue
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 28, display: "grid", gap: 18 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <strong
                    style={{ color: "var(--text-primary)", fontSize: 18 }}
                  >
                    Delete Organization
                  </strong>
                  <p
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 14,
                      lineHeight: 1.7,
                    }}
                  >
                    This will permanently remove the organization record and all
                    related database data tied to {deleteTarget.name}. This
                    action cannot be undone.
                  </p>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    padding: "14px 16px",
                    fontSize: 13,
                    color: "#ef4444",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.24)",
                    lineHeight: 1.7,
                  }}
                >
                  Confirm this action only if you expect permanent database
                  cleanup for this organization and its related records.
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    className="btn"
                    onClick={() => setConfirmDeleteStep(false)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    onClick={() => void handleDelete(deleteTarget)}
                    disabled={saving}
                    style={{
                      background: "rgba(239,68,68,0.12)",
                      color: "#ef4444",
                      border: "1px solid rgba(239,68,68,0.22)",
                    }}
                  >
                    <Trash2 size={14} />
                    {saving ? "Deleting..." : "Delete Organization"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10, 14, 23, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 80,
          }}
        >
          <form
            onSubmit={(event) => void handleSubmit(event)}
            style={{
              width: "100%",
              maxWidth: 520,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 18,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                {editingId ? "Edit organization" : "Add organization"}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 14,
                  color: "var(--text-muted)",
                }}
              >
                Create a separate workspace for projects, domains, apps,
                security, invitations, and API keys.
              </div>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Name *
              </span>
              <input
                className="input"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Organization name"
                required
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Logo URL
              </span>
              <input
                className="input"
                value={form.logoUrl ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    logoUrl: event.target.value,
                  }))
                }
                placeholder="https://example.com/logo.png"
              />
            </label>

            {error && (
              <div style={{ fontSize: 13, color: "#ef4444" }}>{error}</div>
            )}

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
            >
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setModalOpen(false);
                  setEditingId(null);
                  setForm(emptyForm);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Create organization"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
