import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createWindowsSecretStore } from "../src/platform/secrets/store.ts";

const store = createWindowsSecretStore("QA");
const id = randomUUID();
const first = randomBytes(32).toString("hex");
const second = randomBytes(32).toString("hex");
try {
  assert.equal(store.available(), true);
  store.write(id, first);
  assert.equal(store.read(id), first);
  store.write(id, second);
  assert.equal(store.read(id), second);
  store.delete(id);
  assert.equal(store.read(id), null);
  console.log("Windows Credential Manager QA smoke: PASS");
} finally {
  store.delete(id);
}
