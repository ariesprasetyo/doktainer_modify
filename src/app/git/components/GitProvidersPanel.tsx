"use client";

import { type MouseEvent, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Copy,
  Edit3,
  ExternalLink,
  GitBranch,
  Globe2,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  TestTube2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import TablePagination from "@/components/TablePagination";
import type { GitProviderRecord, GitProviderType } from "@/lib/api";
import BitbucketProviderModal from "@/app/git/components/providers/BitbucketProviderModal";
import GiteaProviderModal from "@/app/git/components/providers/GiteaProviderModal";
import GithubProviderModal from "@/app/git/components/providers/GithubProviderModal";
import GitlabProviderModal from "@/app/git/components/providers/GitlabProviderModal";
import {
  type GitProviderDraft,
  PROVIDER_OPTIONS,
  buildGitProviderSetupUrl,
  createGitProviderDraft,
  getGitProviderCallbackUrl,
  getGitProviderSummary,
  getProviderMeta,
} from "@/app/git/components/providers/git-provider-shared";


interface GitProvidersPanelProps {
  providers: GitProviderRecord[];
  actionLoading: string | null;
  savingProviderId: string | null;
  onUpsertProvider: (provider: GitProviderDraft) => Promise<boolean>;
  onVerifyProvider: (provider: GitProviderDraft) => Promise<void>;
  onToggleProvider: (provider: GitProviderRecord) => Promise<void>;
  onDeleteProvider: (provider: GitProviderRecord) => void;
}

const PAGE_SIZE = 6;

type GitProviderStatusFilter = "all" | "active" | "disabled";
type GitProviderTypeFilter = "all" | GitProviderType;

const PROVIDER_CARD_COPY: Record<
  GitProviderType,
  {
    description: string;
    iconUrl: string;
    iconSize: number;
    iconBackground: string;
    borderColor: string;
    background: string;
  }
> = {
  github: {
    description: "Connect GitHub Apps and repositories",
    iconUrl: "https://thesvg.org/icons/github/default.svg",
    iconSize: 34,
    iconBackground: "#ffffff",
    borderColor: "rgba(148,163,184,0.42)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(148,163,184,0.04))",
  },
  gitlab: {
    description: "Connect GitLab instance or group",
    iconUrl: "https://thesvg.org/icons/gitlab/default.svg",
    iconSize: 36,
    iconBackground: "rgba(249,115,22,0.08)",
    borderColor: "rgba(249,115,22,0.38)",
    background:
      "linear-gradient(180deg, rgba(249,115,22,0.08), rgba(249,115,22,0.03))",
  },
  bitbucket: {
    description: "Connect Bitbucket Cloud or Server",
    iconUrl: "https://thesvg.org/icons/bitbucket/default.svg",
    iconSize: 34,
    iconBackground: "rgba(59,130,246,0.1)",
    borderColor: "rgba(59,130,246,0.42)",
    background:
      "linear-gradient(180deg, rgba(59,130,246,0.08), rgba(59,130,246,0.03))",
  },
  gitea: {
    description: "Connect Gitea instance (self-hosted)",
    iconUrl: "https://thesvg.org/icons/gitea/default.svg",
    iconSize: 34,
    iconBackground: "rgba(34,197,94,0.1)",
    borderColor: "rgba(34,197,94,0.42)",
    background:
      "linear-gradient(180deg, rgba(34,197,94,0.08), rgba(34,197,94,0.03))",
  },
};

export default function GitProvidersPanel({
  providers,
  actionLoading,
  savingProviderId,
  onUpsertProvider,
  onVerifyProvider,
  onToggleProvider,
  onDeleteProvider,
}: GitProvidersPanelProps) {
  const [draft, setDraft] = useState<GitProviderDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [githubDetailsOpen, setGithubDetailsOpen] = useState(false);
  const [providerSelectorOpen, setProviderSelectorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<GitProviderStatusFilter>("all");
  const [providerFilter, setProviderFilter] =
    useState<GitProviderTypeFilter>("all");
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    const handleWindowClick = () => {
      setOpenActionMenuId(null);
      setActionMenuPosition(null);
    };

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  const filteredProviders = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return providers.filter((provider) => {
      if (statusFilter === "active" && !provider.enabled) return false;
      if (statusFilter === "disabled" && provider.enabled) return false;
      if (providerFilter !== "all" && provider.provider !== providerFilter) {
        return false;
      }

      if (!normalizedQuery) return true;

      return [
        provider.name,
        provider.provider,
        provider.appName,
        provider.organizationName,
        provider.namespace,
        provider.accountUsername,
        getGitProviderSummary(provider),
      ]
        .filter(Boolean)
        .some((value) => `${value}`.toLowerCase().includes(normalizedQuery));
    });
  }, [providers, providerFilter, searchQuery, statusFilter]);

  const totalItems = filteredProviders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pagedProviders = filteredProviders.slice(
    startIndex,
    startIndex + PAGE_SIZE,
  );
  const startItem = totalItems === 0 ? 0 : startIndex + 1;
  const endItem = totalItems === 0 ? 0 : startIndex + pagedProviders.length;

  const setupUrl = useMemo(
    () => (draft ? buildGitProviderSetupUrl(draft) : ""),
    [draft],
  );
  const callbackUrl = useMemo(
    () => (draft ? getGitProviderCallbackUrl(draft.provider) : ""),
    [draft],
  );

  const openCreateModal = (provider: GitProviderType) => {
    setProviderSelectorOpen(false);
    setEditingId(null);
    setGithubDetailsOpen(false);
    setDraft(createGitProviderDraft(provider));
  };

  const openEditModal = (provider: GitProviderRecord) => {
    setEditingId(provider.id);
    setGithubDetailsOpen(
      provider.provider === "github" &&
        Boolean(
          provider.clientId ||
          provider.appId ||
          provider.appUrl ||
          provider.installationUrl,
        ),
    );
    setDraft({
      id: provider.id,
      provider: provider.provider,
      name: provider.name,
      enabled: provider.enabled,
      appName: provider.appName,
      appId: provider.appId,
      clientId: provider.clientId,
      clientSecret: "",
      hasClientSecret: provider.hasClientSecret,
      accessToken: "",
      hasAccessToken: provider.hasAccessToken,
      appUrl: provider.appUrl,
      installationUrl: provider.installationUrl,
      providerUrl: provider.providerUrl,
      internalUrl: provider.internalUrl,
      accountUsername: provider.accountUsername,
      accountEmail: provider.accountEmail,
      namespace: provider.namespace,
      organizationScoped: provider.organizationScoped,
      organizationName: provider.organizationName,
    });
  };

  const closeModal = () => {
    setEditingId(null);
    setGithubDetailsOpen(false);
    setDraft(null);
  };

  const closeProviderSelector = () => {
    setProviderSelectorOpen(false);
  };

  const handleActionMenuToggle = (
    event: MouseEvent<HTMLButtonElement>,
    providerId: string,
  ) => {
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 176;
    const menuHeight = 174;
    const nextLeft = Math.min(
      window.innerWidth - menuWidth - 12,
      Math.max(12, rect.right - menuWidth + rect.width),
    );
    const nextTop = Math.min(
      window.innerHeight - menuHeight - 12,
      rect.bottom + 6,
    );

    setActionMenuPosition({
      top: Math.max(12, nextTop),
      left: nextLeft,
    });
    setOpenActionMenuId((current) =>
      current === providerId ? null : providerId,
    );
  };

  const saveDraft = async () => {
    if (!draft) return;
    const success = await onUpsertProvider(draft);
    if (success) {
      closeModal();
    }
  };

  const verifyDraft = async () => {
    if (!draft) return;
    await onVerifyProvider(draft);
  };

  const updateDraft = <K extends keyof GitProviderDraft>(
    key: K,
    value: GitProviderDraft[K],
  ) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const modalTitle = draft
    ? `${getProviderMeta(draft.provider).label} Provider`
    : "Git Provider";
  const hideGithubFooterActions =
    draft?.provider === "github" && !githubDetailsOpen;

  const formatProviderCreatedAt = (value: string) => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return { date: value, time: "" };
    }

    return {
      date: date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      time: date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  };

  const isProviderIncomplete = (provider: GitProviderRecord) => {
    switch (provider.provider) {
      case "github":
        return !provider.clientId || !provider.hasClientSecret;
      case "gitlab":
        return (
          !provider.providerUrl ||
          !provider.clientId ||
          !provider.hasClientSecret
        );
      case "bitbucket":
        return !provider.accountUsername || !provider.hasClientSecret;
      case "gitea":
      default:
        return (
          !provider.providerUrl ||
          !provider.clientId ||
          !provider.hasClientSecret
        );
    }
  };

  const getPrimaryProviderLink = (provider: GitProviderRecord) =>
    provider.appUrl ||
    provider.installationUrl ||
    buildGitProviderSetupUrl({
      ...createGitProviderDraft(provider.provider),
      ...provider,
      hasClientSecret: provider.hasClientSecret,
    });

  const getProviderDisplayName = (provider: GitProviderRecord) => {
    if (provider.provider === "github")
      return provider.appName || provider.name;
    if (provider.provider === "bitbucket") {
      return provider.name || provider.appName || "Bitbucket Provider";
    }
    return (
      provider.name ||
      provider.appName ||
      getProviderMeta(provider.provider).label
    );
  };

  const getProviderSubtitle = (provider: GitProviderRecord) =>
    provider.appName ||
    provider.providerUrl ||
    provider.accountEmail ||
    getGitProviderSummary(provider);

  const getProviderTypeLabel = (provider: GitProviderRecord) => {
    if (provider.provider === "github") return "GitHub App";
    return getProviderMeta(provider.provider).label;
  };

  const getProviderScopeLabel = (provider: GitProviderRecord) => {
    if (provider.organizationScoped) {
      return (
        provider.organizationName ||
        provider.namespace ||
        provider.accountUsername ||
        "Organization"
      );
    }

    return provider.namespace || "Global";
  };

  const getProviderTypeTone = (provider: GitProviderType) => {
    switch (provider) {
      case "github":
      case "bitbucket":
        return {
          color: "#2563eb",
          background: "rgba(37,99,235,0.12)",
          border: "rgba(37,99,235,0.16)",
        };
      case "gitlab":
        return {
          color: "#ea580c",
          background: "rgba(249,115,22,0.13)",
          border: "rgba(249,115,22,0.18)",
        };
      case "gitea":
      default:
        return {
          color: "#16a34a",
          background: "rgba(34,197,94,0.14)",
          border: "rgba(34,197,94,0.18)",
        };
    }
  };

  const renderProviderSelectionRow = () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
      }}
    >
      {PROVIDER_OPTIONS.map((option) => {
        const card = PROVIDER_CARD_COPY[option.value];

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => openCreateModal(option.value)}
            style={{
              display: "grid",
              gridTemplateColumns: "54px minmax(0, 1fr) 18px",
              alignItems: "center",
              gap: 14,
              minHeight: 120,
              padding: 16,
              borderRadius: 12,
              border: "1px solid rgba(59,130,246,0.24)",
              background: "rgba(59,130,246,0.08)",
              color: "var(--text-primary)",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 50,
                height: 50,
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: card.iconBackground,
                overflow: "hidden",
              }}
            >
              <img
                src={card.iconUrl}
                alt=""
                width={card.iconSize}
                height={card.iconSize}
                style={{
                  display: "block",
                  objectFit: "contain",
                }}
              />
            </span>
            <span style={{ minWidth: 0 }}>
              <strong
                style={{
                  display: "block",
                  fontSize: 14,
                  lineHeight: 1.25,
                  color: "var(--text-primary)",
                }}
              >
                {option.label}
              </strong>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--text-secondary)",
                  marginTop: 8,
                }}
              >
                {card.description}
              </span>
            </span>
            <ChevronRight
              size={18}
              aria-hidden="true"
              style={{ color: "var(--text-secondary)" }}
            />
          </button>
        );
      })}
    </div>
  );

  const renderProviderSelectorModal = () => (
    <div className="modal-overlay" onClick={closeProviderSelector}>
      <div
        className="modal-shell"
        style={{ maxWidth: 640 }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={closeProviderSelector}
          className="modal-close"
          aria-label="Close modal"
          title="Close"
        >
          <X size={22} />
        </button>
      <div
        className="modal animate-slide-in"
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          padding: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            marginBottom: 20,
            gap: 12,
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
              Add Git Provider
            </h3>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 4,
              }}
            >
              Select a Git provider to connect with Doktainer for authentication
              and repository access.
            </p>
          </div>
        </div>

        {renderProviderSelectionRow()}
        </div>
      </div>
    </div>
  );

  const renderSharedCredentialFooter = () => (
    <section
      style={{
        display: "grid",
        gap: 8,
        padding: 16,
        borderRadius: 14,
        border: "1px solid rgba(34,197,94,0.2)",
        background: "rgba(34,197,94,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ShieldCheck size={16} style={{ color: "#22c55e" }} />
        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>
          Recorded by Doktainer
        </strong>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Save important credentials and metadata here so Doktainer can use the
        same configuration for subsequent Git flows without having to start the
        setup from scratch.
      </div>
    </section>
  );

  const renderGithubFields = () => (
    <GithubProviderModal
      draft={draft!}
      setupUrl={setupUrl}
      callbackUrl={callbackUrl}
      updateDraft={updateDraft}
      detailsOpen={githubDetailsOpen}
      setDetailsOpen={setGithubDetailsOpen}
    />
  );

  const renderGitlabFields = () => (
    <GitlabProviderModal
      draft={draft!}
      setupUrl={setupUrl}
      callbackUrl={callbackUrl}
      updateDraft={updateDraft}
    />
  );

  const renderBitbucketFields = () => (
    <BitbucketProviderModal
      draft={draft!}
      setupUrl={setupUrl}
      callbackUrl={callbackUrl}
      updateDraft={updateDraft}
    />
  );

  const renderGiteaFields = () => (
    <GiteaProviderModal
      draft={draft!}
      setupUrl={setupUrl}
      callbackUrl={callbackUrl}
      updateDraft={updateDraft}
    />
  );

  const renderProviderModalBody = () => {
    if (!draft) return null;

    switch (draft.provider) {
      case "github":
        return renderGithubFields();
      case "gitlab":
        return renderGitlabFields();
      case "bitbucket":
        return renderBitbucketFields();
      case "gitea":
      default:
        return renderGiteaFields();
    }
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ overflow: "visible" }}>
          <div
            style={{
              padding: 20,
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 8,
                  background:
                    "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(37,99,235,0.06))",
                  border: "1px solid rgba(37,99,235,0.16)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <GitBranch size={18} style={{ color: "#2563eb" }} />
              </div>
              <div>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    lineHeight: 1.2,
                  }}
                >
                  Git Providers
                </h2>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginTop: 4,
                  }}
                >
                  Manage Git providers used by Doktainer for authentication and
                  repository access.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setProviderSelectorOpen(true)}
              style={{
                padding: "5px 14px",
                fontSize: 13,
                minHeight: 35,
                marginLeft: "auto",
              }}
            >
              <Plus size={16} />
              Add Provider
            </button>
          </div>
        </div>

        {providers.length === 0 ? (
          <div className="card" style={{ padding: 20 }}>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 18,
                padding: "52px 24px",
                textAlign: "center",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <GitBranch
                size={32}
                style={{
                  color: "var(--text-muted)",
                  marginBottom: 16,
                  textAlign: "center",
                  margin: "0 auto 12px",
                }}
              />
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Create your first Git Provider
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginTop: 6,
                }}
              >
                Start with GitHub App setup, then record the credentials in
                Doktainer for this organization.
              </p>
            </div>
          </div>
        ) : (
          <div className="card" style={{ overflow: "visible" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                padding: "16px 18px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <label
                style={{
                  position: "relative",
                  flex: "1 1 260px",
                  // maxWidth: 300,
                }}
              >
                <Search
                  size={16}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-secondary)",
                    pointerEvents: "none",
                  }}
                />
                <input
                  className="input"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search provider..."
                  style={{ paddingLeft: 38, minHeight: 30 }}
                />
              </label>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 12,
                  flexWrap: "wrap",
                  marginLeft: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "var(--bg-input)",
                  }}
                >
                  {[
                    ["all", "All"],
                    ["active", "Active"],
                    ["disabled", "Disabled"],
                  ].map(([value, label]) => {
                    const active = statusFilter === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setStatusFilter(value as GitProviderStatusFilter);
                          setCurrentPage(1);
                        }}
                        style={{
                          minHeight: 35,
                          padding: "0 18px",
                          border: "none",
                          borderRight:
                            value === "disabled"
                              ? "none"
                              : "1px solid var(--border)",
                          background: active
                            ? "rgba(37,99,235,0.14)"
                            : "transparent",
                          color: active ? "#2563eb" : "var(--text-secondary)",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <select
                  className="input"
                  value={providerFilter}
                  onChange={(event) => {
                    setProviderFilter(
                      event.target.value as GitProviderTypeFilter,
                    );
                    setCurrentPage(1);
                  }}
                  style={{
                    width: 160,
                    minHeight: 30,
                    cursor: "pointer",
                  }}
                >
                  <option value="all">Provider: All</option>
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Type</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedProviders.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center" }}>
                        No providers match the current filters.
                      </td>
                    </tr>
                  ) : (
                    pagedProviders.map((provider) => {
                      const card = PROVIDER_CARD_COPY[provider.provider];
                      const tone = getProviderTypeTone(provider.provider);
                      const createdAt = formatProviderCreatedAt(
                        provider.createdAt,
                      );
                      const isSaving =
                        savingProviderId === provider.id ||
                        savingProviderId === `toggle-${provider.id}` ||
                        savingProviderId === `delete-${provider.id}`;
                      const needsAction = isProviderIncomplete(provider);
                      const menuOpen = openActionMenuId === provider.id;

                      return (
                        <tr key={provider.id}>
                          <td>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                                minWidth: 0,
                              }}
                            >
                              <span
                                aria-hidden="true"
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  background: card.iconBackground,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                <img
                                  src={card.iconUrl}
                                  alt=""
                                  width={32}
                                  height={32}
                                  style={{
                                    display: "block",
                                    objectFit: "contain",
                                  }}
                                />
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <p
                                  style={{
                                    color: "var(--text-primary)",
                                    fontWeight: 700,
                                    fontSize: 13,
                                    lineHeight: 1.25,
                                  }}
                                >
                                  {getProviderDisplayName(provider)}
                                </p>
                                <p
                                  style={{
                                    color: "var(--text-secondary)",
                                    fontSize: 12,
                                    marginTop: 3,
                                  }}
                                >
                                  {getProviderSubtitle(provider)}
                                </p>
                                {provider.appId ? (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      marginTop: 6,
                                      padding: "2px 8px",
                                      borderRadius: 6,
                                      background: "rgba(148,163,184,0.16)",
                                      color: "var(--text-secondary)",
                                      fontSize: 11,
                                      fontWeight: 600,
                                    }}
                                  >
                                    App ID: {provider.appId}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "4px 9px",
                                borderRadius: 7,
                                border: `1px solid ${tone.border}`,
                                background: tone.background,
                                color: tone.color,
                                fontSize: 12,
                                fontWeight: 600,
                              }}
                            >
                              {getProviderTypeLabel(provider)}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 7,
                                color: "var(--text-secondary)",
                                fontSize: 12,
                              }}
                            >
                              {provider.organizationScoped ? (
                                <Users size={14} />
                              ) : (
                                <Globe2 size={14} />
                              )}
                              {getProviderScopeLabel(provider)}
                            </span>
                          </td>
                          <td>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 10px",
                                borderRadius: 7,
                                background: provider.enabled
                                  ? "rgba(16,185,129,0.14)"
                                  : "rgba(148,163,184,0.16)",
                                color: provider.enabled
                                  ? "#059669"
                                  : "var(--text-secondary)",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: 999,
                                  background: provider.enabled
                                    ? "#059669"
                                    : "var(--text-muted)",
                                }}
                              />
                              {provider.enabled ? "Active" : "Disabled"}
                            </span>
                            {needsAction ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  marginLeft: 8,
                                  padding: "4px 9px",
                                  borderRadius: 7,
                                  background: "rgba(245,158,11,0.12)",
                                  color: "#d97706",
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                Action Required
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <div style={{ fontSize: 12 }}>
                              <div style={{ color: "var(--text-primary)" }}>
                                {createdAt.date}
                              </div>
                              <div
                                style={{
                                  color: "var(--text-secondary)",
                                  marginTop: 2,
                                }}
                              >
                                {createdAt.time}
                              </div>
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                gap: 6,
                              }}
                            >
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => openEditModal(provider)}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: 11,
                                }}
                              >
                                <Edit3 size={12} />
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={(event) =>
                                  handleActionMenuToggle(event, provider.id)
                                }
                                disabled={isSaving}
                                aria-label={`More actions for ${provider.name}`}
                                title="More actions"
                                style={{
                                  padding: "4px 8px",
                                  fontSize: 11,
                                }}
                              >
                                {isSaving ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <MoreVertical size={12} />
                                )}
                              </button>

                              {menuOpen && actionMenuPosition ? (
                                <div
                                  className="card"
                                  onClick={(event) => event.stopPropagation()}
                                  style={{
                                    position: "fixed",
                                    top: actionMenuPosition.top,
                                    left: actionMenuPosition.left,
                                    minWidth: 176,
                                    padding: 6,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 4,
                                    zIndex: 160,
                                    boxShadow:
                                      "0 18px 40px rgba(2, 6, 23, 0.42)",
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      window.open(
                                        getPrimaryProviderLink(provider),
                                        "_blank",
                                        "noopener,noreferrer",
                                      );
                                    }}
                                    style={{
                                      fontSize: 12,
                                      justifyContent: "flex-start",
                                    }}
                                  >
                                    <ExternalLink size={12} />
                                    Open Provider
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      void onToggleProvider(provider);
                                    }}
                                    style={{
                                      fontSize: 12,
                                      justifyContent: "flex-start",
                                    }}
                                  >
                                    <Power size={12} />
                                    {provider.enabled ? "Disable" : "Enable"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      onDeleteProvider(provider);
                                    }}
                                    style={{
                                      fontSize: 12,
                                      justifyContent: "flex-start",
                                      color: "#ef4444",
                                    }}
                                  >
                                    <Trash2 size={12} />
                                    Delete
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <TablePagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={totalItems}
              startItem={startItem}
              endItem={endItem}
              itemLabel="providers"
              onPageChange={(page) =>
                setCurrentPage(Math.min(Math.max(page, 1), totalPages))
              }
            />
          </div>
        )}
      </div>

      {providerSelectorOpen ? renderProviderSelectorModal() : null}

      {draft ? (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal-shell"
            style={{
              width:
                draft.provider === "github"
                  ? "min(640px, calc(100% - 48px))"
                  : "min(720px, calc(100% - 48px))",
              maxWidth: 720,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeModal}
              className="modal-close"
              aria-label="Close modal"
              title="Close"
            >
              <X size={22} />
            </button>
          <div
            className="modal animate-slide-in"
            style={{
              width:
                draft.provider === "github"
                  ? "min(640px, 100%)"
                  : "min(720px, 100%)",
              maxWidth: 720,
              maxHeight: "calc(100vh - 40px)",
              overflowY: "auto",
              padding: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                marginBottom: 22,
                paddingRight: 36,
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  {editingId ? `Update ${modalTitle}` : modalTitle}
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginTop: 6,
                  }}
                >
                  Multi-configurations are still stored per organization, with a
                  structure that more closely mirrors the provider onboarding
                  flow.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {renderProviderModalBody()}
              {renderSharedCredentialFooter()}
            </div>

            {hideGithubFooterActions ? null : (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  marginTop: 24,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void verifyDraft()}
                  disabled={actionLoading === `verify-${draft.id ?? "draft"}`}
                >
                  {actionLoading === `verify-${draft.id ?? "draft"}` ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <TestTube2 size={14} />
                  )}
                  Verify Config
                </button>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={closeModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      void saveDraft();
                    }}
                    disabled={savingProviderId === (draft.id || "new-provider")}
                  >
                    {savingProviderId === (draft.id || "new-provider") ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : editingId ? (
                      <Pencil size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {editingId ? "Save Changes" : "Save Provider"}
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
