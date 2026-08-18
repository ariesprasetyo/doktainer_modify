"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, RefreshCw, Trash2 } from "lucide-react";
import ConfirmActionDialog from "@/components/ConfirmActionDialog";
import { formatBytes } from "@/lib/format-bytes";
import { servers as serversApi, type DockerImageEntry } from "@/lib/api";

/**
 * A server's images, inside the Docker manager panel.
 *
 * The column that matters is what removing an image would free. Docker's own
 * size counts every shared layer against each image, so a project's build tags
 * all report the same hundreds of megabytes while each extra tag really costs
 * kilobytes — which is what made keeping build history look expensive.
 *
 * In-use images are not selectable. Docker refuses to remove them, so a
 * checkbox there could only ever produce a row that fails.
 */

type SortKey = "name" | "created" | "size" | "frees" | "status";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "in-use" | "retention-tag" | "unused";

const STATUS_META = {
  "in-use": { label: "In use", color: "var(--accent-green)" },
  "retention-tag": { label: "Rollback point", color: "var(--accent-yellow)" },
  unused: { label: "Unused", color: "var(--text-muted)" },
} as const;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "in-use", label: "In use" },
  { value: "retention-tag", label: "Rollback points" },
  { value: "unused", label: "Unused" },
];

/** Sorting by label would order rollback points between the other two. */
const STATUS_ORDER: Record<string, number> = {
  "in-use": 0,
  "retention-tag": 1,
  unused: 2,
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** DD MMM YYYY HH:MM in the viewer's own timezone. */
export function formatImageDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function imageName(image: DockerImageEntry): string {
  if (image.repository === "<none>" && image.tag === "<none>") {
    return "<untagged>";
  }
  return `${image.repository}:${image.tag}`;
}

function statusKey(image: DockerImageEntry): keyof typeof STATUS_META {
  return image.protectionReason ?? "unused";
}

/**
 * Nulls sort last in both directions: an unknown size is not smaller than a
 * known one, it is simply unknown, and burying it keeps the useful rows on top.
 */
function compareNullable(
  left: number | null,
  right: number | null,
  direction: SortDirection,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

export function sortImages(
  images: DockerImageEntry[],
  key: SortKey,
  direction: SortDirection,
): DockerImageEntry[] {
  const factor = direction === "asc" ? 1 : -1;

  return [...images].sort((left, right) => {
    switch (key) {
      case "name":
        return imageName(left).localeCompare(imageName(right)) * factor;
      case "created":
        return compareNullable(
          left.createdAt ? Date.parse(left.createdAt) : null,
          right.createdAt ? Date.parse(right.createdAt) : null,
          direction,
        );
      case "size":
        return compareNullable(left.sizeBytes, right.sizeBytes, direction);
      case "frees":
        return compareNullable(
          left.uniqueSizeBytes,
          right.uniqueSizeBytes,
          direction,
        );
      case "status":
        return (
          (STATUS_ORDER[statusKey(left)] - STATUS_ORDER[statusKey(right)]) *
          factor
        );
    }
  });
}

export function filterImages(
  images: DockerImageEntry[],
  search: string,
  status: StatusFilter,
): DockerImageEntry[] {
  const term = search.trim().toLowerCase();

  return images
    .filter((image) => status === "all" || statusKey(image) === status)
    .filter((image) =>
      term
        ? `${imageName(image)} ${image.id}`.toLowerCase().includes(term)
        : true,
    );
}

const cell: React.CSSProperties = { padding: "8px", fontSize: 12 };
const numeric: React.CSSProperties = {
  ...cell,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

interface ServerImagesPanelProps {
  serverId: string;
  onToast: (message: string, tone: "success" | "error" | "warning") => void;
}

export default function ServerImagesPanel({
  serverId,
  onToast,
}: ServerImagesPanelProps) {
  const [images, setImages] = useState<DockerImageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("frees");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<DockerImageEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    serversApi
      .images(serverId)
      .then((response) => {
        if (!cancelled) setImages(response.data.images);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to read images.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serverId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await serversApi.images(serverId);
      setImages(response.data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read images.");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  const visible = useMemo(
    () => sortImages(filterImages(images, search, status), sortKey, sortDirection),
    [images, search, status, sortKey, sortDirection],
  );

  const selectableVisible = useMemo(
    () =>
      visible
        .filter((image) => image.protectionReason !== "in-use")
        .map((image) => image.id),
    [visible],
  );

  const selectedImages = useMemo(
    () => images.filter((image) => selected.has(image.id)),
    [images, selected],
  );

  const selectedFrees = selectedImages.reduce(
    (sum, image) => sum + (image.uniqueSizeBytes ?? 0),
    0,
  );
  const selectedRollbackPoints = selectedImages.filter(
    (image) => image.protectionReason === "retention-tag",
  ).length;

  const toggleSort = useCallback(
    (key: SortKey) => {
      setSortKey((currentKey) => {
        if (currentKey === key) {
          setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
          return currentKey;
        }
        // A new column starts descending for sizes and dates, where the
        // interesting rows are the big and the recent ones.
        setSortDirection(key === "name" || key === "status" ? "asc" : "desc");
        return key;
      });
    },
    [],
  );

  const removeSelected = useCallback(
    async (targets: DockerImageEntry[]) => {
      setBusy(true);

      try {
        const response = await serversApi.removeImages(
          serverId,
          targets.map((image) => image.id),
          targets.some((image) => image.protectionReason === "retention-tag"),
        );
        const { removed, skipped } = response.data;

        onToast(
          skipped.length > 0
            ? `Removed ${removed.length}, kept ${skipped.length}: ${skipped[0]?.error ?? ""}`
            : `Removed ${removed.length} image${removed.length === 1 ? "" : "s"}`,
          skipped.length > 0 ? "warning" : "success",
        );

        setSelected(new Set());
        await reload();
      } catch (err) {
        onToast(
          err instanceof Error ? err.message : "Failed to remove images",
          "error",
        );
      } finally {
        setBusy(false);
      }
    },
    [serverId, reload, onToast],
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

  const headerCell: React.CSSProperties = {
    padding: "6px 8px",
    color: "var(--text-muted)",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <ConfirmActionDialog
        open={confirm !== null}
        title={`Remove ${confirm?.length ?? 0} image${(confirm?.length ?? 0) === 1 ? "" : "s"}?`}
        description={
          selectedRollbackPoints > 0
            ? `This frees ${formatBytes(selectedFrees)}, and includes ${selectedRollbackPoints} rollback point${selectedRollbackPoints === 1 ? "" : "s"}. Those versions would have to be rebuilt from their commits instead.`
            : `This frees ${formatBytes(selectedFrees)}. Layers shared with images you keep stay where they are.`
        }
        confirmLabel={
          selectedRollbackPoints > 0
            ? "Remove, rollback points included"
            : "Remove images"
        }
        tone="danger"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const targets = confirm;
          setConfirm(null);
          if (targets) void removeSelected(targets);
        }}
      />

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
          placeholder="Search name or id"
          style={{ flex: "1 1 180px", minWidth: 160, fontSize: 12 }}
          aria-label="Search images"
        />
        <select
          className="input"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          style={{ width: 150, fontSize: 12, cursor: "pointer" }}
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {selected.size > 0 ? (
          <>
            <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              {selected.size} selected · {formatBytes(selectedFrees)}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "4px 8px" }}
              disabled={busy}
              onClick={() => setConfirm(selectedImages)}
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
            {visible.length} of {images.length}
          </span>
        )}

        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: "4px 8px" }}
          onClick={() => void reload()}
          disabled={loading}
          aria-label="Refresh images"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
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
                  aria-label="Select all removable images shown"
                />
              </th>
              <th style={{ ...headerCell, textAlign: "left" }}>
                {headerButton("name", "Image", "left")}
              </th>
              <th style={{ ...headerCell, textAlign: "left" }}>
                {headerButton("created", "Created", "left")}
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>
                {headerButton("size", "Size", "right")}
              </th>
              <th style={{ ...headerCell, textAlign: "right" }}>
                {headerButton("frees", "Frees", "right")}
              </th>
              <th style={{ ...headerCell, textAlign: "left" }}>
                {headerButton("status", "Status", "left")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    ...cell,
                    color: "var(--text-muted)",
                    textAlign: "center",
                    padding: 20,
                  }}
                >
                  {loading ? "Reading images…" : "No images match."}
                </td>
              </tr>
            ) : (
              visible.map((image) => {
                const meta = STATUS_META[statusKey(image)];
                const isSelected = selected.has(image.id);

                return (
                  <tr
                    key={image.id}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: isSelected ? "var(--bg-input)" : undefined,
                    }}
                  >
                    <td style={{ ...cell, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={image.protectionReason === "in-use"}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(image.id)) next.delete(image.id);
                            else next.add(image.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${imageName(image)}`}
                      />
                    </td>
                    <td
                      style={{
                        ...cell,
                        fontFamily: "var(--font--code)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {imageName(image)}
                      <span
                        style={{
                          display: "block",
                          color: "var(--text-muted)",
                          fontSize: 11,
                        }}
                      >
                        {image.id}
                      </span>
                    </td>
                    <td
                      style={{
                        ...cell,
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatImageDate(image.createdAt)}
                    </td>
                    <td style={numeric}>
                      {image.sizeBytes === null
                        ? "—"
                        : formatBytes(image.sizeBytes)}
                    </td>
                    <td
                      style={{
                        ...numeric,
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
                    <td style={{ ...cell, fontSize: 11 }}>
                      <span style={{ color: meta.color, whiteSpace: "nowrap" }}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="server-config-component-description">
        <strong>Frees</strong> is what the disk actually gets back. Docker&apos;s
        size counts every shared layer against each image, so build history reads
        as many copies of the same hundreds of megabytes while each extra tag
        really costs kilobytes. In-use images cannot be selected — Docker refuses
        to remove them.
      </p>
    </div>
  );
}
