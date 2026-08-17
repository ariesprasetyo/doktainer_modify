"use client";

import { useEffect, useRef, useState } from "react";
import ConfirmActionDialog from "@/components/ConfirmActionDialog";
import GuardedPage from "@/components/GuardedPage";
import ToastViewport from "@/components/ToastViewport";
import GitProvidersPanel from "@/app/git/components/GitProvidersPanel";
import {
  Banner,
  SettingsLoadingPanel,
} from "@/app/settings/components/SettingsPrimitives";
import {
  gitProvidersApi,
  type GitProviderInput,
  type GitProviderRecord,
} from "@/lib/api";
import { useToastManager } from "@/lib/use-toast-manager";

type GitProviderDraft = GitProviderInput & {
  id?: string;
  hasClientSecret: boolean;
};

type PendingConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "warning" | "info";
  note?: string;
  onConfirm: () => void;
};

function toProviderInput(
  provider: GitProviderDraft | GitProviderRecord,
): GitProviderInput {
  return {
    provider: provider.provider,
    name: provider.name,
    enabled: provider.enabled,
    appName: provider.appName,
    appId: provider.appId,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    appUrl: provider.appUrl,
    installationUrl: provider.installationUrl,
    providerUrl: provider.providerUrl,
    internalUrl: provider.internalUrl,
    accountUsername: provider.accountUsername,
    accountEmail: provider.accountEmail,
    namespace: provider.namespace,
    organizationScoped: provider.organizationScoped,
    organizationName: provider.organizationName,
  };
}

function upsertProviderState(
  current: GitProviderRecord[],
  next: GitProviderRecord,
) {
  const existingIndex = current.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    return [...current, next].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  const updated = [...current];
  updated[existingIndex] = next;
  return updated;
}

export default function GitPage() {
  const [providers, setProviders] = useState<GitProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] =
    useState<PendingConfirmAction | null>(null);
  const callbackHandledRef = useRef<string | null>(null);
  const { toasts, pushToast, dismissToast } = useToastManager();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const callbackProvider = params.get("callbackProvider");
    const callbackStatus = params.get("callbackStatus");
    const callbackMessage = params.get("callbackMessage");

    if (!callbackProvider || !callbackStatus || !callbackMessage) {
      return;
    }

    const callbackKey = `${callbackProvider}:${callbackStatus}:${callbackMessage}`;
    if (callbackHandledRef.current === callbackKey) {
      return;
    }

    callbackHandledRef.current = callbackKey;
    pushToast({
      tone: callbackStatus === "error" ? "error" : "success",
      message: callbackMessage,
    });
    window.history.replaceState({}, "", "/git");
  }, [pushToast]);

  useEffect(() => {
    let mounted = true;

    const loadProviders = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await gitProvidersApi.list();
        if (!mounted) return;
        setProviders(response.data);
      } catch (err) {
        if (!mounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to load git providers",
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadProviders();
    return () => {
      mounted = false;
    };
  }, []);

  const upsertProvider = async (draft: GitProviderDraft) => {
    const pendingId = draft.id || "new-provider";
    setSavingProviderId(pendingId);

    try {
      const payload = toProviderInput(draft);
      const response = draft.id
        ? await gitProvidersApi.update(draft.id, payload)
        : await gitProvidersApi.create(payload);

      setProviders((current) => upsertProviderState(current, response.data));
      pushToast({
        tone: "success",
        message:
          response.message ||
          (draft.id
            ? "Git provider updated successfully"
            : "Git provider added successfully"),
      });
      return true;
    } catch (err) {
      pushToast({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Failed to save git provider",
      });
      return false;
    } finally {
      setSavingProviderId(null);
    }
  };

  const toggleProvider = async (provider: GitProviderRecord) => {
    const pendingId = `toggle-${provider.id}`;
    setSavingProviderId(pendingId);

    try {
      const response = await gitProvidersApi.update(provider.id, {
        ...toProviderInput(provider),
        enabled: !provider.enabled,
        clientSecret: "",
      });

      setProviders((current) => upsertProviderState(current, response.data));
      pushToast({
        tone: "success",
        message: response.message || "Git provider status updated successfully",
      });
    } catch (err) {
      pushToast({
        tone: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to update git provider status",
      });
    } finally {
      setSavingProviderId(null);
    }
  };

  const performDeleteProvider = async (provider: GitProviderRecord) => {
    const providerId = provider.id;
    setSavingProviderId(`delete-${providerId}`);

    try {
      const response = await gitProvidersApi.remove(providerId);
      setProviders((current) =>
        current.filter((provider) => provider.id !== providerId),
      );
      pushToast({
        tone: "success",
        message: response.message || "Git provider deleted successfully",
      });
    } catch (err) {
      pushToast({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Failed to delete git provider",
      });
    } finally {
      setSavingProviderId(null);
    }
  };

  const handleDeleteProvider = (provider: GitProviderRecord) => {
    setConfirmDialog({
      title: "Delete Git Provider",
      description: `Delete git provider "${provider.name}"?`,
      confirmLabel: "Delete Provider",
      tone: "danger",
      note: "This removes the saved Git provider configuration and credentials from Doktainer.",
      onConfirm: () => {
        void performDeleteProvider(provider);
      },
    });
  };

  const verifyProvider = async (draft: GitProviderDraft) => {
    setActionLoading(`verify-${draft.id ?? "draft"}`);

    try {
      const response = await gitProvidersApi.verify({
        ...toProviderInput(draft),
        id: draft.id,
      });

      pushToast({
        tone: "success",
        message:
          response.message ||
          "Git provider configuration verified successfully",
      });
    } catch (err) {
      pushToast({
        tone: "error",
        message:
          err instanceof Error ? err.message : "Failed to verify git provider",
      });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <GuardedPage
      route="/git"
      title="Git"
      subtitle="Manage Git provider apps and keep per-organization configurations ready for Doktainer workflows"
      redirectSubtitle="Redirecting to a page allowed for your role"
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
      <ToastViewport toasts={toasts} onClose={dismissToast} />
      <div
        className="animate-slide-in"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {error ? <Banner message={error} tone="error" /> : null}

        {loading ? (
          <SettingsLoadingPanel />
        ) : (
          <GitProvidersPanel
            providers={providers}
            actionLoading={actionLoading}
            savingProviderId={savingProviderId}
            onUpsertProvider={upsertProvider}
            onVerifyProvider={verifyProvider}
            onToggleProvider={toggleProvider}
            onDeleteProvider={handleDeleteProvider}
          />
        )}
      </div>
    </GuardedPage>
  );
}
