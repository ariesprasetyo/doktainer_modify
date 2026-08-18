"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import SearchField from "@/components/SearchField";
import ToastViewport from "@/components/ToastViewport";
import ConfirmActionDialog from "@/components/ConfirmActionDialog";
import { useToastManager } from "@/lib/use-toast-manager";
import { formatBytes } from "@/lib/format-bytes";
import {
  servers as serversApi,
  type DockerImageEntry,
  type Server,
} from "@/lib/api";

/**
 * Images held on each server.
 *
 * Unique size is the column that answers the question people actually have.
 * Docker's Size repeats the whole image for every tag sharing its layers, so a
 * project's five build tags each read the same 148 MB while removing one frees
 * a couple of kilobytes — which is what made keeping build history look
 * expensive when it is nearly free.
 */

const PROTECTION_LABEL: Record<string, string> = {
  "in-use": "In use",
  "retention-tag": "Rollback point",
};

const PROTECTION_NOTE: Record<string, string> = {
  "in-use": "A container is using this image.",
  "retention-tag":
    "Keeps a past build addressable so a rollback is instant instead of a rebuild.",
};

const cellStyle: React.CSSProperties = {
  padding: "9px 10px",
  fontSize: 12,
  verticalAlign: "middle",
};

const numericCellStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  color: "var(--text-muted)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

function imageName(image: DockerImageEntry): string {
  if (image.repository === "<none>" && image.tag === "<none>") {
    return "<untagged>";
  }
  return `${image.repository}:${image.tag}`;
}

type PendingRemoval =
  | { kind: "single"; image: DockerImageEntry; force: boolean }
  | { kind: "bulk"; images: DockerImageEntry[]; force: boolean }
  | null;

function confirmTitle(pending: PendingRemoval): string {
  if (!pending) return "";
  if (pending.kind === "single") return `Remove ${imageName(pending.image)}?`;
  return `Remove ${pending.images.length} image${pending.images.length === 1 ? "" : "s"}?`;
}

function confirmDescription(pending: PendingRemoval): string {
  if (!pending) return "";

  const frees = formatBytes(
    (pending.kind === "single"
      ? [pending.image]
      : pending.images
    ).reduce((sum, image) => sum + (image.uniqueSizeBytes ?? 0), 0),
  );

  if (pending.kind === "single") {
    return pending.force
      ? "This image keeps a past build available for an instant rollback. Removing it means that version has to be rebuilt from its commit instead."
      : `This frees ${frees}. The layers it shares with other images stay.`;
  }

  const rollbackPoints = pending.images.filter(
    (image) => image.protectionReason === "retention-tag",
  ).length;

  // Naming the count is the point: a bulk selection is exactly where a rollback
  // point gets swept up without being noticed.
  return rollbackPoints > 0
    ? `This frees ${frees}, and includes ${rollbackPoints} rollback point${rollbackPoints === 1 ? "" : "s"}. Those versions would have to be rebuilt from their commits instead.`
    : `This frees ${frees}. Layers shared with images you keep stay where they are.`;
}

/**
 * Ids the checkboxes may select, matching whatever the filter shows. In-use
 * images are excluded: Docker refuses to remove them, so offering them would
 * only produce a row that fails every time.
 */
function filteredSelectableIds(
  images: DockerImageEntry[],
  search: string,
): string[] {
  const term = search.trim().toLowerCase();

  return images
    .filter((image) => image.protectionReason !== "in-use")
    .filter((image) =>
      term
        ? `${imageName(image)} ${image.id}`.toLowerCase().includes(term)
        : true,
    )
    .map((image) => image.id);
}

export default function ImagesPage() {
  const { toasts, pushToast, dismissToast } = useToastManager();
  const [serverList, setServerList] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [images, setImages] = useState<DockerImageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [confirm, setConfirm] = useState<
    | { kind: "single"; image: DockerImageEntry; force: boolean }
    | { kind: "bulk"; images: DockerImageEntry[]; force: boolean }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    serversApi
      .list()
      .then((response) => {
        if (cancelled) return;
        const list = response.data ?? [];
        setServerList(list);
        setSelectedServerId((current) => current || (list[0]?.id ?? ""));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load servers.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Chained off the promise rather than setting state as the effect runs, and
  // the result is dropped if the selection changed while it was in flight.
  useEffect(() => {
    if (!selectedServerId) return;
    let cancelled = false;

    serversApi
      .images(selectedServerId)
      .then((response) => {
        if (!cancelled) setImages(response.data.images);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setImages([]);
        setError(err instanceof Error ? err.message : "Failed to read images.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedServerId]);

  /** Used by the refresh button and after a removal, never from an effect. */
  const loadImages = useCallback(async (serverId: string) => {
    if (!serverId) return;
    setLoading(true);
    setError("");

    try {
      const response = await serversApi.images(serverId);
      setImages(response.data.images);
    } catch (err) {
      setImages([]);
      setError(err instanceof Error ? err.message : "Failed to read images.");
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(
    async (image: DockerImageEntry, force: boolean) => {
      setRemovingId(image.id);

      try {
        await serversApi.removeImage(selectedServerId, image.id, force);
        pushToast({
          tone: "success",
          message: `Removed ${imageName(image)}`,
        });
        await loadImages(selectedServerId);
      } catch (err) {
        pushToast({
          tone: "error",
          message:
            err instanceof Error ? err.message : "Failed to remove image",
        });
      } finally {
        setRemovingId(null);
      }
    },
    [selectedServerId, loadImages, pushToast],
  );

  /** In-use images are never selectable: Docker refuses to remove them. */
  const selectable = useMemo(
    () => filteredSelectableIds(images, search),
    [images, search],
  );

  const selectedImages = useMemo(
    () => images.filter((image) => selected.has(image.id)),
    [images, selected],
  );

  const selectedFrees = useMemo(
    () =>
      selectedImages.reduce((sum, image) => sum + (image.uniqueSizeBytes ?? 0), 0),
    [selectedImages],
  );

  const selectedRollbackPoints = useMemo(
    () =>
      selectedImages.filter(
        (image) => image.protectionReason === "retention-tag",
      ).length,
    [selectedImages],
  );

  const toggleOne = useCallback((imageId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) =>
      selectable.every((imageId) => current.has(imageId))
        ? new Set()
        : new Set(selectable),
    );
  }, [selectable]);

  const removeMany = useCallback(
    async (targets: DockerImageEntry[], force: boolean) => {
      setBulkRunning(true);

      try {
        const response = await serversApi.removeImages(
          selectedServerId,
          targets.map((image) => image.id),
          force,
        );
        const { removed, skipped } = response.data;

        pushToast({
          tone: skipped.length > 0 ? "warning" : "success",
          message:
            skipped.length > 0
              ? `Removed ${removed.length}, kept ${skipped.length}: ${skipped[0]?.error ?? ""}`
              : `Removed ${removed.length} image${removed.length === 1 ? "" : "s"}`,
        });

        setSelected(new Set());
        await loadImages(selectedServerId);
      } catch (err) {
        pushToast({
          tone: "error",
          message:
            err instanceof Error ? err.message : "Failed to remove images",
        });
      } finally {
        setBulkRunning(false);
      }
    },
    [selectedServerId, loadImages, pushToast],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return images;
    return images.filter((image) =>
      `${imageName(image)} ${image.id}`.toLowerCase().includes(term),
    );
  }, [images, search]);

  const reclaimable = useMemo(
    () =>
      images
        .filter((image) => image.protectionReason === null)
        .reduce((sum, image) => sum + (image.uniqueSizeBytes ?? 0), 0),
    [images],
  );

  return (
    <DashboardLayout
      title="Images"
      subtitle="Docker images held on each server"
    >
      <ConfirmActionDialog
        open={confirm !== null}
        title={confirmTitle(confirm)}
        description={confirmDescription(confirm)}
        confirmLabel={
          confirm?.force
            ? confirm.kind === "bulk"
              ? "Remove, rollback points included"
              : "Remove rollback point"
            : confirm?.kind === "bulk"
              ? `Remove ${confirm.images.length} images`
              : "Remove image"
        }
        tone="danger"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const current = confirm;
          setConfirm(null);
          if (!current) return;
          if (current.kind === "single") {
            void remove(current.image, current.force);
          } else {
            void removeMany(current.images, current.force);
          }
        }}
      />
      <ToastViewport toasts={toasts} onClose={dismissToast} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <select
          className="input"
          value={selectedServerId}
          onChange={(event) => {
            // A selection made on one server means nothing on another.
            setSelected(new Set());
            setSelectedServerId(event.target.value);
          }}
          style={{ maxWidth: 260, cursor: "pointer" }}
          aria-label="Server"
        >
          {serverList.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name} ({server.ip})
            </option>
          ))}
        </select>

        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by name or id"
        />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {selected.size > 0 ? (
            <>
              <span
                style={{
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {selected.size} selected · frees {formatBytes(selectedFrees)}
                {selectedRollbackPoints > 0
                  ? ` · ${selectedRollbackPoints} rollback point${selectedRollbackPoints === 1 ? "" : "s"}`
                  : ""}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={bulkRunning}
                onClick={() =>
                  setConfirm({
                    kind: "bulk",
                    images: selectedImages,
                    force: selectedRollbackPoints > 0,
                  })
                }
              >
                {bulkRunning ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Remove selected
              </button>
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {images.length} images · {formatBytes(reclaimable)} removable
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void loadImages(selectedServerId)}
            disabled={loading}
            aria-label="Refresh images"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
        </div>
      </div>

      {error ? (
        <p style={{ color: "var(--accent-red)", fontSize: 12 }}>{error}</p>
      ) : null}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...headerCellStyle, width: 34 }}>
                <input
                  type="checkbox"
                  checked={
                    selectable.length > 0 &&
                    selectable.every((imageId) => selected.has(imageId))
                  }
                  // Distinguishes "some selected" from "all", so the box does
                  // not read as empty when a subset is chosen.
                  ref={(node) => {
                    if (node) {
                      node.indeterminate =
                        selected.size > 0 && selected.size < selectable.length;
                    }
                  }}
                  disabled={selectable.length === 0}
                  onChange={toggleAll}
                  aria-label="Select all removable images"
                />
              </th>
              <th style={{ ...headerCellStyle, textAlign: "left" }}>Image</th>
              <th style={{ ...headerCellStyle, textAlign: "left" }}>ID</th>
              <th style={{ ...headerCellStyle, textAlign: "left" }}>Created</th>
              <th style={{ ...numericCellStyle, ...headerCellStyle }}>Size</th>
              <th style={{ ...numericCellStyle, ...headerCellStyle }}>
                Frees If Removed
              </th>
              <th style={{ ...headerCellStyle, textAlign: "left" }}>Status</th>
              <th style={{ ...headerCellStyle, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{ ...cellStyle, color: "var(--text-muted)", textAlign: "center", padding: 24 }}
                >
                  {loading ? "Reading images…" : "No images."}
                </td>
              </tr>
            ) : (
              filtered.map((image) => {
                const label = image.protectionReason
                  ? PROTECTION_LABEL[image.protectionReason]
                  : null;

                return (
                  <tr
                    key={image.id}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: selected.has(image.id)
                        ? "var(--bg-input)"
                        : undefined,
                    }}
                  >
                    <td style={{ ...cellStyle, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(image.id)}
                        disabled={image.protectionReason === "in-use"}
                        onChange={() => toggleOne(image.id)}
                        aria-label={`Select ${imageName(image)}`}
                      />
                    </td>
                    <td style={{ ...cellStyle, fontFamily: "var(--font--code)" }}>
                      {imageName(image)}
                    </td>
                    <td style={{ ...cellStyle, color: "var(--text-muted)", fontFamily: "var(--font--code)" }}>
                      {image.id}
                    </td>
                    <td style={{ ...cellStyle, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {image.createdSince || "—"}
                    </td>
                    <td style={numericCellStyle}>
                      {image.sizeBytes === null ? "—" : formatBytes(image.sizeBytes)}
                    </td>
                    <td
                      style={{
                        ...numericCellStyle,
                        color:
                          (image.uniqueSizeBytes ?? 0) > 10 * 1024 * 1024
                            ? "var(--accent-yellow)"
                            : "var(--text-muted)",
                      }}
                    >
                      {image.uniqueSizeBytes === null
                        ? "—"
                        : formatBytes(image.uniqueSizeBytes)}
                    </td>
                    <td style={cellStyle}>
                      {label ? (
                        <span
                          title={PROTECTION_NOTE[image.protectionReason ?? ""]}
                          style={{
                            fontSize: 11,
                            padding: "2px 7px",
                            borderRadius: 999,
                            border: "1px solid var(--border)",
                            color:
                              image.protectionReason === "in-use"
                                ? "var(--accent-green)"
                                : "var(--accent-yellow)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          Unused
                        </span>
                      )}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        // In use is Docker's own refusal, so there is nothing to
                        // offer. A rollback point can go, but says so first.
                        disabled={
                          image.protectionReason === "in-use" ||
                          removingId === image.id
                        }
                        onClick={() =>
                          setConfirm({
                            kind: "single",
                            image,
                            force: image.protectionReason === "retention-tag",
                          })
                        }
                        aria-label={`Remove ${imageName(image)}`}
                      >
                        {removingId === image.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p
        style={{
          marginTop: 12,
          color: "var(--text-muted)",
          fontSize: 11,
          lineHeight: 1.6,
        }}
      >
        <strong>Frees if removed</strong> is what the disk actually gets back.
        Docker&apos;s size column counts every shared layer against each image,
        so a project&apos;s build history reads as many copies of the same
        hundreds of megabytes while each extra tag really costs kilobytes.
      </p>
    </DashboardLayout>
  );
}
