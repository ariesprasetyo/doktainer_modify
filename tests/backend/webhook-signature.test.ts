import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { verifyWebhookSignature } from "../../src/server/routes/webhooks";

const SECRET = "s3cr3t-webhook-value";
const BODY = Buffer.from(
  JSON.stringify({ ref: "refs/heads/main", after: "abc123" }),
);

function githubHeaders(secret: string, body: Buffer) {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return { "x-hub-signature-256": `sha256=${digest}` };
}

function giteaHeaders(secret: string, body: Buffer) {
  return {
    "x-gitea-signature": crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex"),
  };
}

test("gitlab accepts the exact shared secret", () => {
  assert.equal(
    verifyWebhookSignature({
      provider: "gitlab",
      secret: SECRET,
      rawBody: BODY,
      headers: { "x-gitlab-token": SECRET },
    }),
    true,
  );
});

test("gitlab rejects a wrong or missing token", () => {
  for (const headers of [
    { "x-gitlab-token": "wrong" },
    { "x-gitlab-token": "" },
    {},
  ]) {
    assert.equal(
      verifyWebhookSignature({
        provider: "gitlab",
        secret: SECRET,
        rawBody: BODY,
        headers,
      }),
      false,
    );
  }
});

test("gitlab rejects a token that only shares a prefix", () => {
  assert.equal(
    verifyWebhookSignature({
      provider: "gitlab",
      secret: SECRET,
      rawBody: BODY,
      headers: { "x-gitlab-token": SECRET.slice(0, -1) },
    }),
    false,
  );
});

test("github accepts a correct hmac over the raw body", () => {
  assert.equal(
    verifyWebhookSignature({
      provider: "github",
      secret: SECRET,
      rawBody: BODY,
      headers: githubHeaders(SECRET, BODY),
    }),
    true,
  );
});

test("github rejects an hmac computed with another secret", () => {
  assert.equal(
    verifyWebhookSignature({
      provider: "github",
      secret: SECRET,
      rawBody: BODY,
      headers: githubHeaders("other-secret", BODY),
    }),
    false,
  );
});

test("github rejects an hmac computed over different bytes", () => {
  // Re-serialised JSON is byte-different, which is exactly why the raw body has
  // to be preserved instead of re-stringifying the parsed object.
  const reserialized = Buffer.from(
    JSON.stringify({ after: "abc123", ref: "refs/heads/main" }),
  );
  assert.notEqual(BODY.toString(), reserialized.toString());
  assert.equal(
    verifyWebhookSignature({
      provider: "github",
      secret: SECRET,
      rawBody: BODY,
      headers: githubHeaders(SECRET, reserialized),
    }),
    false,
  );
});

test("gitea accepts a correct hmac", () => {
  assert.equal(
    verifyWebhookSignature({
      provider: "gitea",
      secret: SECRET,
      rawBody: BODY,
      headers: giteaHeaders(SECRET, BODY),
    }),
    true,
  );
});

test("hmac providers reject a truncated signature without throwing", () => {
  const headers = githubHeaders(SECRET, BODY);
  headers["x-hub-signature-256"] = headers["x-hub-signature-256"].slice(0, 20);
  assert.equal(
    verifyWebhookSignature({
      provider: "github",
      secret: SECRET,
      rawBody: BODY,
      headers,
    }),
    false,
  );
});

test("an empty secret is always rejected", () => {
  for (const provider of ["gitlab", "github", "gitea"] as const) {
    assert.equal(
      verifyWebhookSignature({
        provider,
        secret: "",
        rawBody: BODY,
        headers: {
          "x-gitlab-token": "",
          ...githubHeaders("", BODY),
          ...giteaHeaders("", BODY),
        },
      }),
      false,
    );
  }
});

test("hmac providers reject a missing raw body", () => {
  for (const provider of ["github", "gitea"] as const) {
    assert.equal(
      verifyWebhookSignature({
        provider,
        secret: SECRET,
        rawBody: undefined,
        headers: githubHeaders(SECRET, BODY),
      }),
      false,
    );
  }
});
