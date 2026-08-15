import assert from "node:assert/strict";
import test from "node:test";
import yaml from "js-yaml";

import {
  buildComposeOverrideYaml,
  extractComposeServiceNames,
  normalizeComposeServiceOverrides,
  readStoredComposeServiceOverrides,
} from "../../src/server/services/compose-override.service";

function parseServices(document: string | null) {
  assert.ok(document, "expected an override document");
  return (yaml.load(document) as { services: Record<string, unknown> })
    .services;
}

test("nothing set produces no file at all", () => {
  // An empty document would make compose fail on the extra -f.
  assert.equal(buildComposeOverrideYaml({}), null);
  assert.equal(
    buildComposeOverrideYaml(
      normalizeComposeServiceOverrides({ web: { restart: "", command: "" } }),
    ),
    null,
  );
});

test("settings land on the compose keys that carry them", () => {
  const services = parseServices(
    buildComposeOverrideYaml(
      normalizeComposeServiceOverrides({
        web: {
          restart: "always",
          command: "nginx -g 'daemon off;'",
          volumes: ["/srv/data:/data"],
          cpuShares: 512,
          cpuCores: "1.5",
          memory: "512m",
        },
      }),
    ),
  );

  assert.deepEqual(services.web, {
    restart: "always",
    command: "nginx -g 'daemon off;'",
    volumes: ["/srv/data:/data"],
    cpu_shares: 512,
    deploy: { resources: { limits: { cpus: "1.5", memory: "512m" } } },
  });
});

test("only the keys that were set appear", () => {
  // A key present with an empty value would override the repository's own.
  const services = parseServices(
    buildComposeOverrideYaml(
      normalizeComposeServiceOverrides({ web: { memory: "1g" } }),
    ),
  );

  assert.deepEqual(services.web, {
    deploy: { resources: { limits: { memory: "1g" } } },
  });
});

test("a service with nothing set is left out entirely", () => {
  const services = parseServices(
    buildComposeOverrideYaml(
      normalizeComposeServiceOverrides({
        web: { memory: "1g" },
        db: { restart: "" },
      }),
    ),
  );

  assert.deepEqual(Object.keys(services), ["web"]);
});

test("a value cannot break out into YAML syntax", () => {
  const services = parseServices(
    buildComposeOverrideYaml(
      normalizeComposeServiceOverrides({
        web: { command: "sh -c 'echo hi'\u0009# not a comment: really" },
      }),
    ),
  );

  assert.deepEqual(services.web, {
    command: "sh -c 'echo hi'\u0009# not a comment: really",
  });
});

test("a restart policy Docker would reject is refused up front", () => {
  for (const restart of ["sometimes", "always:3", "unless-stopped:2", "; id"]) {
    assert.throws(
      () => normalizeComposeServiceOverrides({ web: { restart } }),
      undefined,
      `accepted ${restart}`,
    );
  }
});

test("on-failure keeps its optional retry count", () => {
  assert.equal(
    normalizeComposeServiceOverrides({ web: { restart: "on-failure:5" } }).web
      .restart,
    "on-failure:5",
  );
  assert.equal(
    normalizeComposeServiceOverrides({ web: { restart: "on-failure" } }).web
      .restart,
    "on-failure",
  );
});

test("a service name that is not a valid compose key is refused", () => {
  for (const name of ["../etc", "we b", "-web", "web:latest", "$(id)"]) {
    assert.throws(
      () => normalizeComposeServiceOverrides({ [name]: { memory: "1g" } }),
      undefined,
      `accepted ${name}`,
    );
  }
});

test("duplicate volume entries collapse to one", () => {
  assert.deepEqual(
    normalizeComposeServiceOverrides({
      web: { volumes: ["/a:/a", "/a:/a", " /b:/b ", ""] },
    }).web.volumes,
    ["/a:/a", "/b:/b"],
  );
});

test("a multi-line command is refused rather than silently truncated", () => {
  assert.throws(() =>
    normalizeComposeServiceOverrides({ web: { command: "sh\nrm -rf /" } }),
  );
  assert.throws(() =>
    normalizeComposeServiceOverrides({ web: { volumes: ["/a:/a\n/b:/b"] } }),
  );
});

test("an invalid stored value does not block a deploy", () => {
  // The stack should still come up using its own compose file.
  assert.deepEqual(
    readStoredComposeServiceOverrides({
      composeServiceOverrides: { web: { restart: "nonsense" } },
    }),
    {},
  );
  assert.deepEqual(
    readStoredComposeServiceOverrides({ composeServiceOverrides: null }),
    {},
  );
  assert.deepEqual(
    readStoredComposeServiceOverrides({ composeServiceOverrides: "a string" }),
    {},
  );
});

test("service names are read from the compose document", () => {
  assert.deepEqual(
    extractComposeServiceNames(
      ["services:", "  web:", "    image: nginx", "  db:", "    image: postgres"].join("\n"),
    ),
    ["web", "db"],
  );
});

test("a compose document with no services yields none", () => {
  for (const content of ["", "not yaml: [", "version: '3'", "services:"]) {
    assert.deepEqual(extractComposeServiceNames(content), []);
  }
});
