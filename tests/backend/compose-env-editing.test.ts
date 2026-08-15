import assert from "node:assert/strict";
import test from "node:test";

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? "test-encryption-key-for-compose-env-32ch";

import {
  mergeComposeEnvOverride,
  normalizeComposeEnvPath,
} from "../../src/server/services/compose-env.service";
import { parseComposeEnvFileReadOutput } from "../../src/server/services/ssh-services/docker-containers";

test("editing one env file leaves the others untouched", () => {
  // The whole set is rewritten on save, so a merge that dropped siblings would
  // silently delete another service's configuration.
  const before = [
    { path: "app.env", content: "A=1" },
    { path: "db.env", content: "POSTGRES_PASSWORD=keep-me" },
  ];

  assert.deepEqual(mergeComposeEnvOverride(before, "app.env", "A=2"), [
    { path: "app.env", content: "A=2" },
    { path: "db.env", content: "POSTGRES_PASSWORD=keep-me" },
  ]);
});

test("editing a declared file that has no stored value yet appends it", () => {
  assert.deepEqual(
    mergeComposeEnvOverride([{ path: "app.env", content: "A=1" }], "db.env", "B=2"),
    [
      { path: "app.env", content: "A=1" },
      { path: "db.env", content: "B=2" },
    ],
  );
});

test("a path is matched after normalization, not by raw string", () => {
  // "./app.env" and "app.env" are the same file; treating them as different
  // would leave two entries and make the last deploy win arbitrarily.
  assert.deepEqual(
    mergeComposeEnvOverride([{ path: "./app.env", content: "A=1" }], "app.env", "A=2"),
    [{ path: "app.env", content: "A=2" }],
  );
});

test("a duplicated stored path collapses to the edited value", () => {
  assert.deepEqual(
    mergeComposeEnvOverride(
      [
        { path: "app.env", content: "A=1" },
        { path: "./app.env", content: "A=stale" },
      ],
      "app.env",
      "A=2",
    ),
    [{ path: "app.env", content: "A=2" }],
  );
});

test("an unreadable stored path is dropped rather than carried forward", () => {
  assert.deepEqual(
    mergeComposeEnvOverride(
      [
        { path: "../escape.env", content: "BAD=1" },
        { path: "app.env", content: "A=1" },
      ],
      "app.env",
      "A=2",
    ),
    [{ path: "app.env", content: "A=2" }],
  );
});

test("a path that escapes the deployment directory is rejected", () => {
  for (const value of [
    "/etc/passwd",
    "../../etc/passwd",
    "..",
    "C:/windows/system32",
    "   ",
    "",
  ]) {
    assert.throws(() => normalizeComposeEnvPath(value), undefined, `accepted ${value}`);
  }
});

test("a backslash path cannot be used to slip past the escape check", () => {
  assert.throws(() => normalizeComposeEnvPath("..\\..\\etc\\passwd"));
});

test("a nested path inside the deployment directory is allowed", () => {
  assert.equal(normalizeComposeEnvPath("config/./app.env"), "config/app.env");
  assert.equal(normalizeComposeEnvPath("  ./app.env  "), "app.env");
});

test("env file contents survive the shell round trip intact", () => {
  const content = 'MULTI="line one\nline two"\n# comment: héllo 🚀\n';
  const output = [
    `__ENVFILE__:0:1:${Buffer.from(content, "utf8").toString("base64")}`,
    "__ENVFILE__:1:0:",
  ].join("\n");

  assert.deepEqual(parseComposeEnvFileReadOutput(["app.env", "db.env"], output), [
    { path: "app.env", content, exists: true },
    { path: "db.env", content: "", exists: false },
  ]);
});

test("unrelated shell chatter around the markers is ignored", () => {
  // A login shell can print banners; those lines must not become env content.
  const output = [
    "Welcome to Ubuntu",
    `__ENVFILE__:0:1:${Buffer.from("A=1", "utf8").toString("base64")}`,
    "some trailing notice",
  ].join("\n");

  assert.deepEqual(parseComposeEnvFileReadOutput(["app.env"], output), [
    { path: "app.env", content: "A=1", exists: true },
  ]);
});

test("a file missing from the output is reported as absent, not as empty content", () => {
  assert.deepEqual(parseComposeEnvFileReadOutput(["app.env"], ""), [
    { path: "app.env", content: "", exists: false },
  ]);
});

test("an empty declared file reads back as existing but empty", () => {
  assert.deepEqual(parseComposeEnvFileReadOutput(["app.env"], "__ENVFILE__:0:1:"), [
    { path: "app.env", content: "", exists: true },
  ]);
});
