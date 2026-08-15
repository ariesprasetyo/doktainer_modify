import assert from "node:assert/strict";
import test from "node:test";

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? "test-encryption-key-for-compose-env-32ch";

import { encrypt } from "../../src/server/lib/crypto";
import {
  buildComposeEnvOverridesWrite,
  parseComposeEnvOverrides,
  readStoredComposeEnvOverrides,
} from "../../src/server/services/compose-env.service";

const FILES = [
  { path: "app.env", content: "DATABASE_URL=postgres://u:p@db:5432/app" },
  { path: "db.env", content: "POSTGRES_PASSWORD=s3cr3t" },
];

test("a written value is encrypted, not readable in the stored string", () => {
  const written = buildComposeEnvOverridesWrite(FILES);

  assert.ok(written.composeEnvOverridesEnc);
  // The whole point: the secret must not survive as readable text.
  assert.ok(!written.composeEnvOverridesEnc.includes("s3cr3t"));
  assert.ok(!written.composeEnvOverridesEnc.includes("POSTGRES_PASSWORD"));
});

test("a written value round-trips back to the original files", () => {
  const written = buildComposeEnvOverridesWrite(FILES);
  assert.deepEqual(
    readStoredComposeEnvOverrides({
      composeEnvOverridesEnc: written.composeEnvOverridesEnc,
    }),
    FILES,
  );
});

test("writing clears the legacy plaintext column", () => {
  // Otherwise a rewritten row would keep a readable copy alongside the
  // encrypted one, defeating the change.
  const written = buildComposeEnvOverridesWrite(FILES);
  assert.notEqual(written.composeEnvOverrides, undefined);
  assert.notDeepEqual(written.composeEnvOverrides, FILES);
});

test("an empty list stores nothing rather than an encrypted empty array", () => {
  assert.equal(buildComposeEnvOverridesWrite([]).composeEnvOverridesEnc, null);
});

test("rows written before encryption are still readable from the legacy column", () => {
  assert.deepEqual(
    readStoredComposeEnvOverrides({
      composeEnvOverridesEnc: null,
      composeEnvOverrides: FILES,
    }),
    FILES,
  );
});

test("the encrypted column wins when both are present", () => {
  const written = buildComposeEnvOverridesWrite(FILES);
  assert.deepEqual(
    readStoredComposeEnvOverrides({
      composeEnvOverridesEnc: written.composeEnvOverridesEnc,
      composeEnvOverrides: [{ path: "stale.env", content: "OLD=1" }],
    }),
    FILES,
  );
});

test("an undecryptable value yields nothing instead of partial configuration", () => {
  // Deploying a stack with its env files silently missing would be worse than
  // failing on the absent file.
  assert.deepEqual(
    readStoredComposeEnvOverrides({
      composeEnvOverridesEnc: "not:valid:ciphertext",
    }),
    [],
  );
  assert.deepEqual(
    readStoredComposeEnvOverrides({
      composeEnvOverridesEnc: encrypt("this is not json"),
    }),
    [],
  );
});

test("malformed entries are dropped rather than passed through", () => {
  assert.deepEqual(
    parseComposeEnvOverrides([
      { path: "ok.env", content: "A=1" },
      { path: "missing-content" },
      { content: "missing-path" },
      null,
      "a string",
      42,
    ]),
    [{ path: "ok.env", content: "A=1" }],
  );
});

test("a non-array legacy value yields nothing", () => {
  for (const value of [null, undefined, {}, "", 0]) {
    assert.deepEqual(parseComposeEnvOverrides(value), []);
  }
});
