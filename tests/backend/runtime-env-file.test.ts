import assert from "node:assert/strict";
import test from "node:test";

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? "test-encryption-key-for-runtime-env-32c";

import {
  applyRuntimeEnvMounts,
  buildRuntimeEnvFilesWrite,
  buildRuntimeEnvMounts,
  normalizeRuntimeEnvContainerPath,
  normalizeRuntimeEnvFiles,
  readStoredRuntimeEnvFiles,
  runtimeEnvHostFileName,
  runtimeEnvHostPath,
} from "../../src/server/services/runtime-env-file.service";

const DEPLOY = "/opt/doktainer/deployments/app";

test("a file becomes a read-only mount at the path the user named", () => {
  const mounts = buildRuntimeEnvMounts(DEPLOY, [
    { containerPath: "/app/.env", content: "A=1" },
  ]);

  assert.equal(mounts.length, 1);
  assert.ok(mounts[0].startsWith(`${DEPLOY}/.doktainer-env/`));
  assert.ok(mounts[0].endsWith(":/app/.env:ro"));
});

test("distinct container paths never share a host file", () => {
  // /a_b/.env and /a/b/.env both flatten to the same name if separators are
  // simply replaced, which would have one file overwrite the other.
  assert.notEqual(
    runtimeEnvHostFileName("/a_b/.env"),
    runtimeEnvHostFileName("/a/b/.env"),
  );
});

test("the same container path always resolves to the same host file", () => {
  assert.equal(
    runtimeEnvHostPath(DEPLOY, "/app/.env"),
    runtimeEnvHostPath(DEPLOY, "/app/.env"),
  );
});

test("a relative or unsafe container path is refused", () => {
  for (const path of [
    "app/.env",
    ".env",
    "",
    "   ",
    "/",
    "/app/",
    "/app/../etc/passwd",
    "/app/.env:extra",
    "/app/my env",
  ]) {
    assert.throws(
      () => normalizeRuntimeEnvContainerPath(path),
      undefined,
      `accepted ${path}`,
    );
  }
});

test("a normal absolute path is accepted unchanged", () => {
  assert.equal(normalizeRuntimeEnvContainerPath("/app/.env"), "/app/.env");
  assert.equal(
    normalizeRuntimeEnvContainerPath("  /srv/config/.env  "),
    "/srv/config/.env",
  );
});

test("the same target twice collapses rather than mounting twice", () => {
  // Docker refuses two mounts on one target.
  assert.deepEqual(
    normalizeRuntimeEnvFiles([
      { containerPath: "/app/.env", content: "first" },
      { containerPath: "/app/.env", content: "second" },
    ]),
    [{ containerPath: "/app/.env", content: "second" }],
  );
});

test("malformed entries are dropped, not passed through", () => {
  assert.deepEqual(
    normalizeRuntimeEnvFiles([
      { containerPath: "/app/.env", content: "A=1" },
      { containerPath: "/app/no-content" },
      { content: "no path" },
      null,
      "a string",
      42,
    ]),
    [{ containerPath: "/app/.env", content: "A=1" }],
  );
  assert.deepEqual(normalizeRuntimeEnvFiles(null), []);
});

test("mounts are added alongside volumes the deploy already asked for", () => {
  assert.equal(
    applyRuntimeEnvMounts("/srv/data:/data", DEPLOY, [
      { containerPath: "/app/.env", content: "A=1" },
    ]),
    `/srv/data:/data,${runtimeEnvHostPath(DEPLOY, "/app/.env")}:/app/.env:ro`,
  );
});

test("no files leaves other volumes untouched", () => {
  assert.equal(applyRuntimeEnvMounts("/srv/data:/data", DEPLOY, []), "/srv/data:/data");
  assert.equal(applyRuntimeEnvMounts(undefined, DEPLOY, []), undefined);
});

test("a stored file is encrypted and round-trips", () => {
  const files = [{ containerPath: "/app/.env", content: "DB_PASSWORD=s3cr3t" }];
  const written = buildRuntimeEnvFilesWrite(files);

  assert.ok(written.runtimeEnvFilesEnc);
  assert.ok(!written.runtimeEnvFilesEnc.includes("s3cr3t"));
  assert.deepEqual(
    readStoredRuntimeEnvFiles({ runtimeEnvFilesEnc: written.runtimeEnvFilesEnc }),
    files,
  );
});

test("nothing stored means nothing written", () => {
  assert.equal(buildRuntimeEnvFilesWrite([]).runtimeEnvFilesEnc, null);
  assert.deepEqual(readStoredRuntimeEnvFiles({ runtimeEnvFilesEnc: null }), []);
});

test("an undecryptable value yields nothing rather than partial config", () => {
  assert.deepEqual(
    readStoredRuntimeEnvFiles({ runtimeEnvFilesEnc: "not:valid:ciphertext" }),
    [],
  );
});

test("a rebuild does not duplicate the mount it already has", () => {
  // Volumes are read back off the running container, so the mount is already
  // in the list. Docker refuses two mounts on one target.
  const files = [{ containerPath: "/app/.env", content: "A=1" }];
  const first = applyRuntimeEnvMounts(undefined, DEPLOY, files);
  const second = applyRuntimeEnvMounts(first, DEPLOY, files);

  assert.equal(second, first);
  assert.equal((second ?? "").split(",").length, 1);
});

test("removing a file removes its mount", () => {
  // The regression this guards: the mount was read back off the container and
  // carried forward forever. The clone is fresh each deploy, so the file was
  // gone and Docker created a directory at the mount source instead.
  const before = applyRuntimeEnvMounts(undefined, DEPLOY, [
    { containerPath: "/app/.env", content: "A=1" },
  ]);

  assert.equal(applyRuntimeEnvMounts(before, DEPLOY, []), "");
});

test("removing one file keeps the other, and keeps unrelated volumes", () => {
  const before = applyRuntimeEnvMounts("/srv/data:/data", DEPLOY, [
    { containerPath: "/app/.env", content: "A=1" },
    { containerPath: "/srv/other.env", content: "B=2" },
  ]);

  const after = applyRuntimeEnvMounts(before, DEPLOY, [
    { containerPath: "/srv/other.env", content: "B=2" },
  ]);

  assert.ok((after ?? "").includes("/srv/data:/data"));
  assert.ok((after ?? "").includes(":/srv/other.env:ro"));
  assert.ok(!(after ?? "").includes(":/app/.env:ro"));
});

test("a volume the user added is never mistaken for a panel mount", () => {
  const userVolume = "/srv/app-data:/data";
  assert.equal(applyRuntimeEnvMounts(userVolume, DEPLOY, []), userVolume);
});
