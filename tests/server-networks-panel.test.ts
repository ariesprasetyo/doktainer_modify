import assert from "node:assert/strict";
import test from "node:test";

import {
  filterNetworks,
  isPredefinedNetwork,
  sortNetworks,
} from "../src/app/servers/components/ServerNetworksPanel";
import type { NetworkRecord } from "../src/lib/api";

function net(over: Partial<NetworkRecord> = {}): NetworkRecord {
  return {
    id: "n1",
    name: "app-net",
    driver: "bridge",
    scope: "local",
    subnet: "172.20.0.0/16",
    gateway: "172.20.0.1",
    containers: 0,
    serverId: "s1",
    createdAt: "2026-08-14T08:00:00.000Z",
    updatedAt: "2026-08-14T08:00:00.000Z",
    ...over,
  };
}

test("Docker's built-in networks are recognised", () => {
  for (const name of ["bridge", "host", "none", "BRIDGE", "  host  "]) {
    assert.equal(isPredefinedNetwork(name), true, `missed ${name}`);
  }
  for (const name of ["bridge-app", "hostile", "app-net", ""]) {
    assert.equal(isPredefinedNetwork(name), false, `wrongly matched ${name}`);
  }
});

test("search covers name, driver and subnet", () => {
  const items = [
    net({ id: "1", name: "web-net", driver: "bridge", subnet: "10.1.0.0/16" }),
    net({ id: "2", name: "db-net", driver: "overlay", subnet: "10.2.0.0/16" }),
  ];

  assert.equal(filterNetworks(items, "web", "all")[0].id, "1");
  assert.equal(filterNetworks(items, "overlay", "all")[0].id, "2");
  assert.equal(filterNetworks(items, "10.2", "all")[0].id, "2");
  assert.equal(filterNetworks(items, "  WEB ", "all").length, 1);
});

test("a network with no subnet is still searchable by name", () => {
  const items = [net({ id: "1", name: "hostnet", subnet: null })];
  assert.equal(filterNetworks(items, "hostnet", "all").length, 1);
});

test("the driver filter narrows to one driver", () => {
  const items = [
    net({ id: "1", driver: "bridge" }),
    net({ id: "2", driver: "overlay" }),
  ];

  assert.equal(filterNetworks(items, "", "overlay").length, 1);
  assert.equal(filterNetworks(items, "", "all").length, 2);
});

test("every column sorts both ways", () => {
  const items = [
    net({ id: "1", name: "b", driver: "overlay", scope: "swarm", containers: 1, createdAt: "2026-01-01T00:00:00.000Z" }),
    net({ id: "2", name: "a", driver: "bridge", scope: "local", containers: 5, createdAt: "2026-06-01T00:00:00.000Z" }),
  ];

  assert.equal(sortNetworks(items, "name", "asc")[0].name, "a");
  assert.equal(sortNetworks(items, "name", "desc")[0].name, "b");
  assert.equal(sortNetworks(items, "driver", "asc")[0].driver, "bridge");
  assert.equal(sortNetworks(items, "scope", "asc")[0].scope, "local");
  assert.equal(sortNetworks(items, "containers", "desc")[0].containers, 5);
  assert.equal(sortNetworks(items, "containers", "asc")[0].containers, 1);
  assert.equal(sortNetworks(items, "created", "desc")[0].id, "2");
});

test("an unparseable created date does not reorder unpredictably", () => {
  // Treated as epoch zero rather than NaN, which would make the comparator
  // return NaN and leave the order undefined.
  const items = [
    net({ id: "1", createdAt: "not a date" }),
    net({ id: "2", createdAt: "2026-06-01T00:00:00.000Z" }),
  ];

  assert.equal(sortNetworks(items, "created", "desc")[0].id, "2");
  assert.equal(sortNetworks(items, "created", "asc")[0].id, "1");
});

test("sorting leaves the original list alone", () => {
  const items = [net({ id: "1", containers: 1 }), net({ id: "2", containers: 9 })];
  sortNetworks(items, "containers", "desc");

  assert.equal(items[0].id, "1");
});
