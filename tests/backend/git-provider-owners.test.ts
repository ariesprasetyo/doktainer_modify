import assert from "node:assert/strict";
import test from "node:test";

import { getProviderOwners } from "../../src/server/routes/git-providers";

const blank = { namespace: null, organizationName: null, accountUsername: null };

test("a group and a username both produce an owner", () => {
  assert.deepEqual(
    getProviderOwners({
      ...blank,
      namespace: "CKU",
      accountUsername: "sauron",
    }),
    [
      { name: "CKU", isNamespace: true },
      { name: "sauron", isNamespace: false },
    ],
  );
});

test("a comma separated namespace lists every group", () => {
  assert.deepEqual(
    getProviderOwners({ ...blank, namespace: "CIP,CKU" }),
    [
      { name: "CIP", isNamespace: true },
      { name: "CKU", isNamespace: true },
    ],
  );
});

test("surrounding whitespace and empty entries are dropped", () => {
  assert.deepEqual(
    getProviderOwners({ ...blank, namespace: " CIP , , CKU ,, " }),
    [
      { name: "CIP", isNamespace: true },
      { name: "CKU", isNamespace: true },
    ],
  );
});

test("subgroup paths survive intact", () => {
  assert.deepEqual(
    getProviderOwners({ ...blank, namespace: "CIP/backend,CKU" }),
    [
      { name: "CIP/backend", isNamespace: true },
      { name: "CKU", isNamespace: true },
    ],
  );
});

test("namespace and organizationName are combined, not chosen between", () => {
  assert.deepEqual(
    getProviderOwners({
      namespace: "CKU",
      organizationName: "CIP",
      accountUsername: "sauron",
    }),
    [
      { name: "CKU", isNamespace: true },
      { name: "CIP", isNamespace: true },
      { name: "sauron", isNamespace: false },
    ],
  );
});

test("a repeated name is listed once", () => {
  assert.deepEqual(
    getProviderOwners({
      namespace: "CKU,cku",
      organizationName: "CKU",
      accountUsername: null,
    }),
    [{ name: "CKU", isNamespace: true }],
  );
});

test("the same name as group and as account stays distinct", () => {
  // A group and a personal account can share a name but resolve through
  // different endpoints, so both have to be tried.
  assert.deepEqual(
    getProviderOwners({
      ...blank,
      namespace: "sauron",
      accountUsername: "sauron",
    }),
    [
      { name: "sauron", isNamespace: true },
      { name: "sauron", isNamespace: false },
    ],
  );
});

test("nothing configured yields no owners", () => {
  assert.deepEqual(getProviderOwners(blank), []);
  assert.deepEqual(
    getProviderOwners({ namespace: "  ", organizationName: "", accountUsername: null }),
    [],
  );
});

test("only a username yields a single account owner", () => {
  assert.deepEqual(
    getProviderOwners({ ...blank, accountUsername: "sauron" }),
    [{ name: "sauron", isNamespace: false }],
  );
});
