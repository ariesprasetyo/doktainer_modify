import assert from "node:assert/strict";
import test from "node:test";

import {
  PREDEFINED_DOCKER_NETWORKS,
  isPredefinedDockerNetwork,
} from "../../src/server/services/ssh-services/docker-networks";

test("the three networks Docker owns are recognised", () => {
  assert.deepEqual([...PREDEFINED_DOCKER_NETWORKS], ["bridge", "host", "none"]);
  for (const name of PREDEFINED_DOCKER_NETWORKS) {
    assert.equal(isPredefinedDockerNetwork(name), true, name);
  }
});

test("case and surrounding whitespace do not let one slip through", () => {
  for (const name of ["Bridge", "HOST", "  none  ", "NoNe"]) {
    assert.equal(isPredefinedDockerNetwork(name), true, JSON.stringify(name));
  }
});

test("a user network that merely contains a reserved word is still deletable", () => {
  // Guarding on substrings instead of the whole name would wrongly protect
  // these, leaving the user unable to delete their own networks.
  for (const name of [
    "bridge-app",
    "my-bridge",
    "host-network",
    "none-of-the-above",
    "doktainer-internal",
    "cku_bridge",
  ]) {
    assert.equal(isPredefinedDockerNetwork(name), false, name);
  }
});

test("an empty name is not treated as predefined", () => {
  assert.equal(isPredefinedDockerNetwork(""), false);
  assert.equal(isPredefinedDockerNetwork("   "), false);
});
