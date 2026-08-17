import assert from "node:assert/strict";
import test from "node:test";

import { isComposeStackSource } from "../../src/server/routes/containers";

test("a git compose build is recognised by its build type", () => {
  assert.equal(
    isComposeStackSource({
      deployMode: "IMAGE",
      deploymentSource: { buildType: "COMPOSE" },
    }),
    true,
  );
});

test("a pasted compose stack is recognised by its deploy mode", () => {
  // This is the regression: such a stack leaves buildType null, so gating on
  // build type alone excluded every one of them from the compose editors.
  assert.equal(
    isComposeStackSource({
      deployMode: "COMPOSE",
      deploymentSource: { buildType: null },
    }),
    true,
  );
});

test("a stack with no deployment source at all still counts", () => {
  assert.equal(
    isComposeStackSource({ deployMode: "COMPOSE", deploymentSource: null }),
    true,
  );
});

test("a single container is not a compose stack", () => {
  for (const deployMode of ["IMAGE", "DOCKERFILE", null] as const) {
    assert.equal(
      isComposeStackSource({
        deployMode,
        deploymentSource: { buildType: "DOCKERFILE" },
      }),
      false,
      `treated ${deployMode} as compose`,
    );
  }
});

test("an empty record is not a compose stack", () => {
  assert.equal(isComposeStackSource({}), false);
});
