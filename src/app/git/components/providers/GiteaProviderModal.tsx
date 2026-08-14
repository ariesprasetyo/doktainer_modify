import { ExternalLink } from "lucide-react";
import { FieldLabel } from "@/app/settings/components/SettingsPrimitives";
import {
  type GitProviderModalBaseProps,
  ProviderBadge,
  getProviderMeta,
} from "./git-provider-shared";
import { markGitProviderCallbackIntent } from "@/lib/git-provider-callback-intent";

export default function GiteaProviderModal({
  draft,
  setupUrl,
  callbackUrl,
  updateDraft,
}: GitProviderModalBaseProps) {
  return (
    <>
      <section
        style={{
          display: "grid",
          gap: 14,
          padding: 20,
          borderRadius: 16,
          border: `1px solid ${getProviderMeta(draft.provider).accentBorder}`,
          background: "var(--bg-input)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* <ProviderBadge provider="gitea" size={40} /> */}
          <img
            src="https://thesvg.org/icons/gitea/default.svg"
            alt="Gitea"
            width={50}
            height={50}
            style={{ background: "transparent" }}
          />
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              Gitea Provider
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 4,
                lineHeight: 1.6,
              }}
            >
              For self-hosted Gitea, create a new OAuth2 Application and record
              the Client ID and Secret in Doktainer.
            </div>
          </div>
        </div>
        <hr style={{ borderColor: "var(--border)" }} />

        <a
          href={setupUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => markGitProviderCallbackIntent("gitea")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            paddingLeft: 18,
            gap: 8,
            fontSize: 12,
            color: "var(--text-primary)",
            textDecoration: "none",
            width: "fit-content",
          }}
        >
          Go to your Gitea settings <ExternalLink size={13} />
        </a>

        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "grid",
            gap: 8,
            fontSize: 12,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          <li>Navigate to Applications and create a new OAuth2 Application.</li>
          <li>
            Use the app name <strong>{draft.appName}</strong> and redirect URI{" "}
            <strong>{callbackUrl}</strong>.
          </li>
          <li>
            Copy the generated Client ID and Client Secret back into Doktainer.
          </li>
        </ol>
      </section>

      <section
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <FieldLabel>Name</FieldLabel>
          <input
            className="input"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
            placeholder="Random Name eg(my-personal-account)"
          />
        </div>

        <div>
          <FieldLabel>Application Name</FieldLabel>
          <input
            className="input"
            value={draft.appName}
            onChange={(event) => updateDraft("appName", event.target.value)}
            placeholder="Doktainer"
          />
        </div>

        <div>
          <FieldLabel>Gitea URL</FieldLabel>
          <input
            className="input"
            value={draft.providerUrl}
            onChange={(event) => updateDraft("providerUrl", event.target.value)}
            placeholder="https://gitea.com"
          />
        </div>

        <div>
          <FieldLabel>Internal URL (Optional)</FieldLabel>
          <input
            className="input"
            value={draft.internalUrl}
            onChange={(event) => updateDraft("internalUrl", event.target.value)}
            placeholder="http://gitea:3000"
          />
        </div>

        <div>
          <FieldLabel>Redirect URI</FieldLabel>
          <input className="input" value={callbackUrl} readOnly />
        </div>

        <div>
          <FieldLabel>Client ID</FieldLabel>
          <input
            className="input"
            value={draft.clientId}
            onChange={(event) => updateDraft("clientId", event.target.value)}
            placeholder="Client ID"
          />
        </div>

        <div>
          <FieldLabel>Client Secret</FieldLabel>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={draft.clientSecret}
            onChange={(event) => {
              updateDraft("clientSecret", event.target.value);
              if (event.target.value.trim()) {
                updateDraft("hasClientSecret", true);
              }
            }}
            placeholder={
              draft.hasClientSecret ? "Secret configured" : "Client Secret"
            }
          />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <FieldLabel>Access Token (Required For Private Repositories)</FieldLabel>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={draft.accessToken}
            onChange={(event) => {
              updateDraft("accessToken", event.target.value);
              if (event.target.value.trim()) {
                updateDraft("hasAccessToken", true);
              }
            }}
            placeholder={
              draft.hasAccessToken
                ? "Token configured"
                : "Personal access token with read:repository scope"
            }
          />
        </div>
      </section>
    </>
  );
}
