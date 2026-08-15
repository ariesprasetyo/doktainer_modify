import assert from "node:assert/strict";
import test from "node:test";

import { dedupePublishedPorts } from "../../src/server/services/docker-port-format";

test("the IPv4/IPv6 pair for one binding collapses to one entry", () => {
  // Exactly what `docker ps` reports for a container started with -p 80:8000,
  // whose HostConfig.PortBindings holds a single entry.
  assert.deepEqual(
    dedupePublishedPorts(["0.0.0.0:80->8000/tcp", "[::]:80->8000/tcp"]),
    ["0.0.0.0:80->8000/tcp"],
  );
});

test("the first spelling is kept so displayed text stays as Docker reported it", () => {
  assert.deepEqual(
    dedupePublishedPorts(["[::]:80->8000/tcp", "0.0.0.0:80->8000/tcp"]),
    ["[::]:80->8000/tcp"],
  );
});

test("several distinct bindings each survive", () => {
  assert.deepEqual(
    dedupePublishedPorts([
      "0.0.0.0:80->8000/tcp",
      "[::]:80->8000/tcp",
      "0.0.0.0:443->8443/tcp",
      "[::]:443->8443/tcp",
    ]),
    ["0.0.0.0:80->8000/tcp", "0.0.0.0:443->8443/tcp"],
  );
});

test("a specific bind address stays distinct from the wildcard", () => {
  // 127.0.0.1:80 is a deliberate, narrower binding — folding it into
  // 0.0.0.0:80 would hide that the port is not exposed externally.
  const entries = ["127.0.0.1:8080->80/tcp", "0.0.0.0:9090->80/tcp"];
  assert.deepEqual(dedupePublishedPorts(entries), entries);
});

test("different host ports to the same container port are both kept", () => {
  const entries = ["0.0.0.0:80->8000/tcp", "0.0.0.0:8080->8000/tcp"];
  assert.deepEqual(dedupePublishedPorts(entries), entries);
});

test("different protocols on the same port are both kept", () => {
  const entries = ["0.0.0.0:53->53/tcp", "0.0.0.0:53->53/udp"];
  assert.deepEqual(dedupePublishedPorts(entries), entries);
});

test("bracketed IPv6 addresses are parsed by their trailing port", () => {
  assert.deepEqual(
    dedupePublishedPorts([
      "[2001:db8::1]:80->8000/tcp",
      "[2001:db8::2]:80->8000/tcp",
    ]),
    ["[2001:db8::1]:80->8000/tcp", "[2001:db8::2]:80->8000/tcp"],
  );
});

test("plain deploy-form mappings pass through, with exact repeats collapsed", () => {
  assert.deepEqual(dedupePublishedPorts(["80:8000", "443:8443"]), [
    "80:8000",
    "443:8443",
  ]);
  assert.deepEqual(dedupePublishedPorts(["80:8000", "80:8000"]), ["80:8000"]);
});

test("blank entries and padding are discarded", () => {
  assert.deepEqual(
    dedupePublishedPorts(["", "   ", " 0.0.0.0:80->8000/tcp "]),
    ["0.0.0.0:80->8000/tcp"],
  );
  assert.deepEqual(dedupePublishedPorts([]), []);
});
