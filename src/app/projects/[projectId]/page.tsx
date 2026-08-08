"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Container,
  FolderTree,
  Layers3,
  Loader2,
  Server as ServerIcon,
  Trash2,
  Wrench,
} from "lucide-react";
import ConfirmActionDialog from "@/components/ConfirmActionDialog";
import DashboardLayout from "@/components/DashboardLayout";
import SensitiveConnectionValue from "@/components/SensitiveConnectionValue";
import ToastViewport from "@/components/ToastViewport";
import EnvironmentFormModal from "@/app/projects/components/EnvironmentFormModal";
import EnvironmentOpsModal from "@/app/projects/components/EnvironmentOpsModal";
import ProjectsStatePanel from "@/app/projects/components/ProjectsStatePanel";
import ProjectsToolbar from "@/app/projects/components/ProjectsToolbar";
import {
  type ProjectEnvironmentCreateBody,
  type ProjectRecord,
  type ProjectEnvironmentUpdateBody,
  projectsApi,
  type Server,
  servers,
  canViewServerConnection,
} from "@/lib/api";
import { useToastManager } from "@/lib/use-toast-manager";

type PendingConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "warning" | "info";
  note?: string;
  onConfirm: () => void;
};

function formatKindLabel(kind: string) {
  return kind.charAt(0) + kind.slice(1).toLowerCase();
}

export default function ProjectDetailPage() {
  const isConnectionRedacted = !canViewServerConnection();
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [serverList, setServerList] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [showEnvironmentModal, setShowEnvironmentModal] = useState(false);
  const [opsEnvironment, setOpsEnvironment] = useState<
    ProjectRecord["environments"][number] | null
  >(null);
  const [creatingEnvironment, setCreatingEnvironment] = useState(false);
  const [updatingEnvironment, setUpdatingEnvironment] = useState(false);
  const [deletingEnvironmentId, setDeletingEnvironmentId] = useState<
    string | null
  >(null);
  const [confirmDialog, setConfirmDialog] =
    useState<PendingConfirmAction | null>(null);
  const redirectedMissingProjectRef = useRef(false);
  const { toasts, pushToast, dismissToast } = useToastManager();

  const redirectMissingProject = useCallback(() => {
    if (redirectedMissingProjectRef.current) {
      return;
    }

    redirectedMissingProjectRef.current = true;
    setProject(null);
    pushToast({
      tone: "warning",
      title: "Project not found",
      message:
        "This project no longer exists. You have been redirected to Projects.",
    });
    router.replace("/projects");
  }, [pushToast, router]);

  const load = useCallback(
    async (showRefreshState = false) => {
      if (showRefreshState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [projectResponse, serversResponse] = await Promise.all([
          projectsApi.detail(projectId),
          servers.list(),
        ]);
        if (!projectResponse.data) {
          redirectMissingProject();
          return;
        }

        setProject(projectResponse.data);
        setServerList(serversResponse.data ?? []);
        if (showRefreshState) {
          pushToast({
            tone: "success",
            title: "Environment refreshed",
            message: "Project environment data has been updated.",
          });
        }
      } catch (error) {
        if (error instanceof Error && error.message === "Project not found") {
          redirectMissingProject();
          return;
        }

        pushToast({
          tone: "error",
          title: "Project load failed",
          message:
            error instanceof Error
              ? error.message
              : "Project details cannot be loaded at this time.",
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, pushToast, redirectMissingProject],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    const verifyProjectStillExists = async () => {
      if (redirectedMissingProjectRef.current) {
        return;
      }

      try {
        await projectsApi.detail(projectId);
      } catch (error) {
        if (error instanceof Error && error.message === "Project not found") {
          redirectMissingProject();
        }
      }
    };

    const handleFocus = () => {
      void verifyProjectStillExists();
    };
    const intervalId = window.setInterval(() => {
      void verifyProjectStillExists();
    }, 15000);

    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [projectId, redirectMissingProject]);

  const query = search.trim().toLowerCase();
  const filteredEnvironments = useMemo(() => {
    if (!project) {
      return [];
    }

    if (!query) {
      return project.environments;
    }

    return project.environments.filter((environment) => {
      return (
        environment.name.toLowerCase().includes(query) ||
        environment.slug.toLowerCase().includes(query) ||
        environment.kind.toLowerCase().includes(query) ||
        (environment.description ?? "").toLowerCase().includes(query) ||
        environment.server.name.toLowerCase().includes(query) ||
        environment.server.ip?.toLowerCase().includes(query)
      );
    });
  }, [project, query]);

  const handleCreateEnvironment = useCallback(
    async (payload: ProjectEnvironmentCreateBody) => {
      if (!project) {
        return;
      }

      setCreatingEnvironment(true);
      try {
        const response = await projectsApi.addEnvironment(project.id, payload);
        const createdEnvironment = response.data;
        if (createdEnvironment) {
          setProject((current) =>
            current
              ? {
                  ...current,
                  environmentCount: current.environmentCount + 1,
                  environments: [...current.environments, createdEnvironment],
                  updatedAt: new Date().toISOString(),
                }
              : current,
          );
        }
        setShowEnvironmentModal(false);
        pushToast({
          tone: "success",
          title: "Environment added",
          message: `Environment ${payload.name} has been successfully added.`,
        });
      } catch (error) {
        pushToast({
          tone: "error",
          title: "Add failed",
          message:
            error instanceof Error
              ? error.message
              : "Environment addition failed.",
        });
      } finally {
        setCreatingEnvironment(false);
      }
    },
    [project, pushToast],
  );

  const performDeleteEnvironment = useCallback(
    async (environment: ProjectRecord["environments"][number]) => {
      setDeletingEnvironmentId(environment.id);
      try {
        await projectsApi.removeEnvironment(environment.id, {
          confirmation: "DELETE",
        });
        setProject((current) =>
          current
            ? {
                ...current,
                environmentCount: Math.max(0, current.environmentCount - 1),
                containersCount:
                  current.containersCount - environment.containersCount,
                environments: current.environments.filter(
                  (entry) => entry.id !== environment.id,
                ),
                updatedAt: new Date().toISOString(),
              }
            : current,
        );
        pushToast({
          tone: "success",
          title: "Environment deleted",
          message: `Environment ${environment.name} has been successfully deleted.`,
        });
      } catch (error) {
        pushToast({
          tone: "error",
          title: "Delete failed",
          message:
            error instanceof Error
              ? error.message
              : "Environment deletion failed.",
        });
      } finally {
        setDeletingEnvironmentId(null);
      }
    },
    [pushToast],
  );

  const handleUpdateEnvironmentOps = useCallback(
    async (
      environmentId: string,
      payload: ProjectEnvironmentUpdateBody,
    ) => {
      setUpdatingEnvironment(true);
      try {
        const updateResponse = await projectsApi.updateEnvironment(
          environmentId,
          payload,
        );
        const updatedEnvironment = updateResponse.data;

        if (updatedEnvironment) {
          setProject((current) => {
            if (!current) {
              return current;
            }

            const previousEnvironment = current.environments.find(
              (environment) => environment.id === environmentId,
            );
            const previousCount = previousEnvironment?.containersCount ?? 0;

            return {
              ...current,
              containersCount:
                current.containersCount -
                previousCount +
                updatedEnvironment.containersCount,
              environments: current.environments.map((environment) =>
                environment.id === environmentId
                  ? updatedEnvironment
                  : environment,
              ),
              updatedAt: new Date().toISOString(),
            };
          });
        }

        setOpsEnvironment(null);
        pushToast({
          tone: "success",
          title: "Environment updated",
          message: `Environment ${payload.name} has been successfully updated.`,
        });
      } catch (error) {
        pushToast({
          tone: "error",
          title: "Update failed",
          message:
            error instanceof Error
              ? error.message
              : "Environment update failed.",
        });
      } finally {
        setUpdatingEnvironment(false);
      }
    },
    [pushToast],
  );

  const handleDeleteEnvironment = useCallback(
    (environment: ProjectRecord["environments"][number]) => {
      setConfirmDialog({
        title: "Delete Environment",
        description: `Delete environment \"${environment.name}\"?`,
        confirmLabel: "Delete Environment",
        tone: "danger",
        note: "This action cannot be undone and all containers within this environment will be removed.",
        onConfirm: () => {
          void performDeleteEnvironment(environment);
        },
      });
    },
    [performDeleteEnvironment],
  );

  return (
    <DashboardLayout
      title={project?.name ?? "Project"}
      subtitle={
        project?.description ||
        "Manage all environments related to this project and their operations here."
      }
    >
      <ConfirmActionDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ""}
        description={confirmDialog?.description ?? ""}
        confirmLabel={confirmDialog?.confirmLabel ?? "Confirm"}
        tone={confirmDialog?.tone ?? "danger"}
        note={confirmDialog?.note}
        onClose={() => setConfirmDialog(null)}
        onConfirm={() => {
          const current = confirmDialog;
          setConfirmDialog(null);
          current?.onConfirm();
        }}
      />
      <ToastViewport
        toasts={toasts}
        onClose={dismissToast}
        position="top-right"
      />

      <div
        className="animate-slide-in"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/projects"
            className="btn btn-ghost"
            style={{ fontSize: 12, textDecoration: "none" }}
          >
            <ArrowLeft size={14} />
            Projects
          </Link>
        </div>

        <ProjectsToolbar
          search={search}
          refreshing={refreshing}
          canCreate={Boolean(project) && serverList.length > 0}
          searchPlaceholder="Filter environments..."
          refreshLabel="Refresh Env"
          addLabel="Add Env"
          onSearchChange={setSearch}
          onRefresh={() => load(true)}
          onAdd={() => setShowEnvironmentModal(true)}
        />

        {loading ? (
          <div
            className="card"
            style={{
              padding: 48,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            <Loader2
              size={28}
              className="animate-spin"
              style={{ color: "var(--accent)", marginBottom: 12 }}
            />
            <p style={{ color: "var(--text-muted)" }}>Loading Project...</p>
          </div>
        ) : null}

        {!loading && project && filteredEnvironments.length === 0 ? (
          <ProjectsStatePanel
            loading={false}
            isEmpty={true}
            searchActive={Boolean(search.trim())}
            canCreate={serverList.length > 0}
            emptyText="No environments have been created for this project"
            searchEmptyText="No environments match your search"
            createLabel="Create Environment"
            onAdd={() => setShowEnvironmentModal(true)}
          />
        ) : null}

        {!loading && project && filteredEnvironments.length > 0 ? (
          <section
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(380px, 100%), 1fr))",
              gap: 14,
            }}
          >
            {filteredEnvironments.map((environment) => (
              <article
                key={environment.id}
                className="card"
                style={{
                  padding: 18,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: -20,
                    right: -20,
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    background: "#f59e0b",
                    opacity: 0.05,
                    filter: "blur(20px)",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 9,
                        background: "rgba(245,158,11,0.09)",
                        border: "1px solid rgba(245,158,11,0.26)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Layers3 size={16} style={{ color: "#f59e0b" }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {environment.name}
                      </h3>
                      <p
                        style={{
                          margin: "3px 0 0",
                          color: "var(--text-muted)",
                          fontSize: 11,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {environment.description ||
                          "Environment haven't description yet"}
                      </p>
                    </div>
                  </div>
                  <span
                    style={{
                      background: "rgba(245,158,11,0.1)",
                      color: "#f59e0b",
                      border: "1px solid rgba(245,158,11,0.3)",
                      padding: "3px 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {formatKindLabel(environment.kind)}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginBottom: 14,
                  }}
                >
                  {[
                    { label: "Server", value: environment.server.name },
                    { label: "Server IP", value: environment.server.ip },
                    { label: "Container", value: environment.containersCount },
                    { label: "Slug", value: environment.slug },
                  ].map((meta) => (
                    <div
                      key={meta.label}
                      style={{
                        background: "var(--bg-input)",
                        borderRadius: 7,
                        padding: "8px 10px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <p
                        style={{
                          color: "var(--text-muted)",
                          fontSize: 10,
                          marginBottom: 2,
                        }}
                      >
                        {meta.label}
                      </p>
                      <p
                        style={{
                          display:
                            meta.label === "Server IP"
                              ? "inline-flex"
                              : "block",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          fontFamily: "JetBrains Mono, monospace",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {meta.label === "Server IP" ? (
                          <ServerIcon size={12} />
                        ) : null}
                        {meta.label === "Server IP" ? (
                          <SensitiveConnectionValue
                            value={String(meta.value ?? "")}
                            isRedacted={isConnectionRedacted}
                          />
                        ) : (
                          meta.value
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => setOpsEnvironment(environment)}
                    style={{
                      flex: "1 1 120px",
                      fontSize: 11,
                      padding: "5px",
                    }}
                  >
                    <Wrench size={11} />
                    Detail/Ops
                  </button>
                  <Link
                    href={`/projects/${project.id}/environments/${environment.id}`}
                    className="btn btn-primary"
                    style={{
                      flex: "1 1 120px",
                      fontSize: 11,
                      padding: "5px",
                      textDecoration: "none",
                    }}
                  >
                    <Container size={11} />
                    Open Env
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => handleDeleteEnvironment(environment)}
                    disabled={deletingEnvironmentId === environment.id}
                    style={{ flex: "1 1 120px", fontSize: 11, padding: "5px" }}
                  >
                    <Trash2 size={11} />
                    {deletingEnvironmentId === environment.id
                      ? "Deleting..."
                      : "Remove"}
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {!loading && !project ? (
          <div
            className="card"
            style={{
              padding: 48,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            <FolderTree
              size={36}
              style={{ color: "var(--text-muted)", marginBottom: 12 }}
            />
            <p style={{ color: "var(--text-muted)" }}>
              Project not found for the active organization.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 16, fontSize: 12 }}
              onClick={() => router.push("/projects")}
            >
              Back to Projects
            </button>
          </div>
        ) : null}
      </div>

      {project && showEnvironmentModal ? (
        <EnvironmentFormModal
          projectName={project.name}
          serverList={serverList}
          submitting={creatingEnvironment}
          onClose={() => setShowEnvironmentModal(false)}
          onSubmit={handleCreateEnvironment}
        />
      ) : null}

      {opsEnvironment ? (
        <EnvironmentOpsModal
          environment={opsEnvironment}
          serverList={serverList}
          submitting={updatingEnvironment}
          onClose={() => setOpsEnvironment(null)}
          onSubmit={handleUpdateEnvironmentOps}
        />
      ) : null}
    </DashboardLayout>
  );
}
