import type { Dispatch, SetStateAction } from "react";
import type {
  GitProviderInput,
  GitProviderRecord,
  GitProviderType,
} from "@/lib/api";
import { encodeGithubManifestState } from "@/lib/github-manifest-state";
import {
  isPublicHttpsUrl,
  resolvePublicAppOrigin,
  resolvePublicAppUrl,
} from "@/server/lib/public-url";

export type GitProviderDraft = GitProviderInput & {
  id?: string;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  hasAccessToken: boolean;
};

export type UpdateGitProviderDraft = <K extends keyof GitProviderDraft>(
  key: K,
  value: GitProviderDraft[K],
) => void;

export interface GitProviderModalBaseProps {
  draft: GitProviderDraft;
  setupUrl: string;
  callbackUrl: string;
  updateDraft: UpdateGitProviderDraft;
}

export interface GithubProviderModalProps extends GitProviderModalBaseProps {
  detailsOpen: boolean;
  setDetailsOpen: Dispatch<SetStateAction<boolean>>;
}

export const PROVIDER_OPTIONS: Array<{
  value: GitProviderType;
  label: string;
  description: string;
  color: string;
  accentBackground: string;
  accentBorder: string;
  code: string;
}> = [
  {
    value: "github",
    label: "GitHub",
    description:
      "Register GitHub Apps and keep multiple installation configs per organization.",
    color: "#f8fafc",
    accentBackground: "rgba(255,255,255,0.06)",
    accentBorder: "rgba(148,163,184,0.22)",
    code: "GH",
  },
  {
    value: "gitlab",
    label: "GitLab",
    description:
      "Track GitLab application credentials for repository automation flows.",
    color: "#f97316",
    accentBackground: "rgba(249,115,22,0.12)",
    accentBorder: "rgba(249,115,22,0.24)",
    code: "GL",
  },
  {
    value: "bitbucket",
    label: "Bitbucket",
    description:
      "Store Bitbucket integration setup for workspace or team repositories.",
    color: "#3b82f6",
    accentBackground: "rgba(59,130,246,0.14)",
    accentBorder: "rgba(59,130,246,0.24)",
    code: "BB",
  },
  {
    value: "gitea",
    label: "Gitea",
    description:
      "Record self-hosted Gitea app config and callback details for Doktainer.",
    color: "#22c55e",
    accentBackground: "rgba(34,197,94,0.14)",
    accentBorder: "rgba(34,197,94,0.24)",
    code: "GT",
  },
];

export const BITBUCKET_SCOPES = [
  "read:repository:bitbucket",
  "read:pullrequest:bitbucket",
  "read:webhook:bitbucket",
  "read:workspace:bitbucket",
  "write:webhook:bitbucket",
];

export function createGitProviderDraft(
  provider: GitProviderType = "github",
): GitProviderDraft {
  return {
    provider,
    name: "",
    enabled: true,
    appName:
      provider === "github"
        ? `Doktainer-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${Math.random().toString(36).slice(2, 10)}`
        : "Doktainer Git Integration",
    appId: "",
    clientId: "",
    clientSecret: "",
    hasClientSecret: false,
    webhookSecret: "",
    hasWebhookSecret: false,
    accessToken: "",
    hasAccessToken: false,
    appUrl: "",
    installationUrl: "",
    providerUrl:
      provider === "gitlab"
        ? "https://gitlab.com"
        : provider === "gitea"
          ? "https://gitea.com"
          : "",
    internalUrl: "",
    accountUsername: "",
    accountEmail: "",
    namespace: "",
    organizationScoped: false,
    organizationName: "",
  };
}

export function getProviderMeta(provider: GitProviderType) {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === provider) ||
    PROVIDER_OPTIONS[0]
  );
}

export function ProviderBadge({
  provider,
  size = 34,
}: {
  provider: GitProviderType;
  size?: number;
}) {
  const meta = getProviderMeta(provider);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 3),
        background: meta.accentBackground,
        border: `1px solid ${meta.accentBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: meta.color,
        fontSize: size <= 24 ? 9 : 11,
        fontWeight: 800,
        letterSpacing: 0.4,
      }}
    >
      {meta.code}
    </div>
  );
}

export function buildGitProviderSetupUrl(draft: GitProviderDraft) {
  const orgName = (draft.organizationName ?? "").trim();
  const providerUrl = (draft.providerUrl ?? "").trim().replace(/\/+$/, "");
  const normalizedBaseUrl = resolvePublicAppOrigin();

  switch (draft.provider) {
    case "github": {
      const url = new URL("/git/github/create", `${normalizedBaseUrl}/`);
      if (draft.appName?.trim()) {
        url.searchParams.set("appName", draft.appName.trim());
      }
      if (draft.name?.trim()) {
        url.searchParams.set("configName", draft.name.trim());
      }
      if (draft.organizationScoped) {
        url.searchParams.set("organizationScoped", "true");
        if (orgName) {
          url.searchParams.set("organizationName", orgName);
        }
      }
      return url.toString();
    }
    case "gitlab":
      return `${providerUrl || "https://gitlab.com"}/-/user_settings/applications`;
    case "bitbucket":
      return "https://id.atlassian.com/manage-profile/security/api-tokens";
    case "gitea":
    default:
      return providerUrl
        ? `${providerUrl}/user/settings/applications`
        : "https://docs.gitea.com/usage/oauth2-provider";
  }
}

export function getGitProviderCallbackUrl(provider: GitProviderType) {
  return resolvePublicAppUrl(`/api/providers/${provider}/callback`);
}

export function getGitProviderRedirectUrl(provider: GitProviderType) {
  if (provider === "github") {
    return resolvePublicAppUrl("/git/github/callback");
  }

  return getGitProviderCallbackUrl(provider);
}

/**
 * Endpoint the provider posts push events to. The provider record id is part of
 * the path so the receiver can look up the matching webhook secret.
 */
export function getGitProviderWebhookUrl(
  provider: GitProviderType,
  providerId: string,
) {
  return resolvePublicAppUrl(`/api/v1/webhooks/${provider}/${providerId}`);
}

export function getGitProviderBaseUrl() {
  return resolvePublicAppOrigin();
}

export function hasPublicGitProviderBaseUrl() {
  return isPublicHttpsUrl(getGitProviderBaseUrl());
}

export function launchGithubManifestFlow(draft: GitProviderDraft) {
  const normalizedPanelUrl = getGitProviderBaseUrl();
  if (!hasPublicGitProviderBaseUrl() || !normalizedPanelUrl) {
    return false;
  }

  const appName = draft.appName?.trim() || "Doktainer GitHub App";
  const configName = draft.name?.trim() || "";
  const organizationName = (draft.organizationName ?? "").trim();
  const organizationScoped = Boolean(
    draft.organizationScoped && organizationName,
  );
  const callbackUrl = getGitProviderCallbackUrl("github");
  const redirectUrl = getGitProviderRedirectUrl("github");
  const action = organizationScoped
    ? `https://github.com/organizations/${encodeURIComponent(organizationName)}/settings/apps/new`
    : "https://github.com/settings/apps/new";
  const state = encodeGithubManifestState({
    appName,
    configName,
    organizationScoped,
    organizationName: organizationScoped ? organizationName : "",
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
  const manifest = JSON.stringify({
    name: appName,
    url: normalizedPanelUrl,
    redirect_url: redirectUrl,
    callback_urls: [callbackUrl],
    setup_url: `${normalizedPanelUrl}/git`,
    description:
      "Doktainer Git integration for repository access and deployment workflows.",
    public: false,
    request_oauth_on_install: true,
    hook_attributes: {
      url: resolvePublicAppUrl("/api/providers/github/webhook"),
      active: true,
    },
    default_permissions: {
      contents: "read",
      metadata: "read",
      pull_requests: "write",
      checks: "write",
      statuses: "write",
    },
    default_events: ["push", "pull_request", "check_suite", "check_run"],
  });

  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  form.style.display = "none";

  const manifestInput = document.createElement("input");
  manifestInput.type = "hidden";
  manifestInput.name = "manifest";
  manifestInput.value = manifest;
  form.appendChild(manifestInput);

  const stateInput = document.createElement("input");
  stateInput.type = "hidden";
  stateInput.name = "state";
  stateInput.value = state;
  form.appendChild(stateInput);

  document.body.appendChild(form);
  form.submit();
  form.remove();
  return true;
}

export function getGitProviderSummary(
  provider: GitProviderDraft | GitProviderRecord,
) {
  const appId = (provider.appId ?? "").trim();
  const parts = [
    provider.appName,
    provider.organizationScoped ? (provider.organizationName ?? "") : "Global",
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  if (appId) {
    parts.push(`App ID ${appId}`);
  }

  if (provider.provider === "bitbucket" && provider.accountUsername?.trim()) {
    parts.push(`@${provider.accountUsername.trim()}`);
  }

  if (
    (provider.provider === "gitlab" || provider.provider === "bitbucket") &&
    provider.namespace?.trim()
  ) {
    parts.push(provider.namespace.trim());
  }

  return parts.length > 0 ? parts.join(" • ") : "Konfigurasi Git belum lengkap";
}
