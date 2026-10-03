import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const baseUrl = process.env.EREMITE_E2E_BASE_URL;
const databasePath = process.env.EREMITE_E2E_DATABASE_PATH;

if (!baseUrl || !databasePath) throw new Error("EREMITE_E2E_BASE_URL and EREMITE_E2E_DATABASE_PATH are required.");

const unauthenticatedRoot = await fetch(`${baseUrl}/`, { redirect: "manual" });
assert.equal(unauthenticatedRoot.status, 307);
assert.equal(unauthenticatedRoot.headers.get("location"), "/inbox");

const unauthenticatedInbox = await fetch(`${baseUrl}/inbox`, { redirect: "manual" });
assert.equal(unauthenticatedInbox.status, 307);
assert.equal(unauthenticatedInbox.headers.get("location"), "/login");

const unauthenticatedFile = await fetch(`${baseUrl}/files/missing-file`);
assert.equal(unauthenticatedFile.status, 401);

const sessionId = randomUUID();
const database = new DatabaseSync(databasePath);
database.prepare("INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)").run(sessionId, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
database.close();

const authorizedHeaders = { cookie: `eremite_session=${sessionId}` };
for (const path of ["/inbox", "/actions", "/automations"]) {
  const response = await fetch(`${baseUrl}${path}`, { headers: authorizedHeaders });
  assert.equal(response.status, 200, `${path} should render for an authenticated session`);
  assert.match(await response.text(), /Eremite/);
}

console.log("HTTP auth and workspace route regression test passed.");
