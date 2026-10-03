import assert from "node:assert/strict";

const baseUrl = process.env.EREMITE_SMOKE_BASE_URL;
const sessionId = process.env.EREMITE_SMOKE_SESSION_ID;
const expectedTitle = process.env.EREMITE_SMOKE_EXPECTED_TITLE;

if (!baseUrl || !sessionId || !expectedTitle) {
  throw new Error("EREMITE_SMOKE_BASE_URL, EREMITE_SMOKE_SESSION_ID and EREMITE_SMOKE_EXPECTED_TITLE are required.");
}

const headers = { cookie: `eremite_session=${sessionId}` };
const pageBodies = [];

for (const pathname of ["/inbox", "/actions", "/automations"]) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers });
  assert.equal(response.status, 200, `${pathname} should render`);
  const body = await response.text();
  assert.doesNotMatch(body, /Application error|Cannot find module|Runtime Error/);
  pageBodies.push(body);
}

assert.match(pageBodies[0], new RegExp(expectedTitle));

const scriptPaths = [...new Set(pageBodies.flatMap((body) => [...body.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map((match) => match[1])))];
assert.ok(scriptPaths.length > 0, "workspace pages should load client chunks");

const scriptBodies = [];
for (const scriptPath of scriptPaths) {
  const response = await fetch(new URL(scriptPath, baseUrl));
  assert.equal(response.status, 200, `client chunk should exist: ${scriptPath}`);
  scriptBodies.push(await response.text());
}

const clientRuntime = scriptBodies.join("\n");
assert.match(clientRuntime, /eremite:open-command/);
assert.match(clientRuntime, /ArrowDown/);
assert.match(clientRuntime, /ArrowUp/);

const rscResponse = await fetch(`${baseUrl}/inbox?_rsc=runtime-smoke`, { headers: { ...headers, RSC: "1" } });
assert.equal(rscResponse.status, 200);
assert.match(await rscResponse.text(), new RegExp(expectedTitle));

console.log(`Runtime HTTP smoke passed with ${scriptPaths.length} client chunks.`);
