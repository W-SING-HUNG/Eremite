import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import crypto, { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const releaseCommit = "a90fe7bb98a9cdcbdfddc32080ad36d1ee97d998";
const oldMigrations = [
  "0001_initial.sql", "0002_file_lifecycle.sql", "0003_projects_tags_trash.sql",
  "0004_metadata_search.sql", "0005_compatibility_pagination.sql", "0006_automation_tool_registry.sql",
  "0007_ai_conversations.sql", "0008_ai_action_drafts.sql", "0009_ai_action_update_proposals.sql", "0010_ai_action_disambiguation.sql",
];
const requiredTables = [
  "projects", "folders", "content_items", "file_assets", "file_versions", "file_blobs",
  "actions", "automation_runs", "ai_threads", "ai_messages", "ai_runs", "ai_message_sources",
  "ai_message_action_drafts", "ai_action_update_proposals", "ai_action_disambiguations",
  "ai_action_disambiguation_candidates",
];

if (process.argv[2] === "--create-source") {
  await createReleaseSource(process.argv[3]);
} else {
  const releaseCheckout = process.env.EREMITE_V15_RELEASE_CHECKOUT;
  assert.ok(releaseCheckout && path.isAbsolute(releaseCheckout), "Set EREMITE_V15_RELEASE_CHECKOUT to an absolute v1.5.0 tag checkout");
  assertReleaseCheckout(releaseCheckout);
  assert.ok(existsSync(path.join(releaseCheckout, "node_modules", "typescript", "package.json")), "Install the v1.5.0 checkout's locked dependencies first");
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-v15-release-fixture-"));
  const dataDirectory = path.join(temporaryRoot, "data");
  try {
    await run(process.execPath, ["--import", "./tests/register-typescript-loader.mjs", path.resolve(process.argv[1]), "--create-source", dataDirectory], {
      cwd: releaseCheckout,
      env: { ...safeEnvironment(), EREMITE_DATA_DIR: dataDirectory },
    });
    const evidence = await validateReleaseSource(dataDirectory);
    await run(process.platform === "win32" ? "npm.cmd run test:data-copy-upgrade" : "npm", process.platform === "win32" ? [] : ["run", "test:data-copy-upgrade"], {
      cwd: process.cwd(),
      env: { ...safeEnvironment(), EREMITE_RELEASE_SOURCE_DATA_DIR: dataDirectory },
      shell: process.platform === "win32",
    });
    console.log(`Populated v1.5.0 release fixture passed: ${JSON.stringify(evidence)}.`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function assertReleaseCheckout(checkout) {
  for (const ref of ["HEAD", "v1.5.0^{}"]) {
    const result = spawnSync("git", ["rev-parse", ref], { cwd: checkout, encoding: "utf8" });
    assert.equal(result.status, 0, "v1.5.0 checkout must have the release tag");
    assert.equal(result.stdout.trim(), releaseCommit, `${ref} must point to the official v1.5.0 release commit`);
  }
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: checkout, encoding: "utf8" });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), "", "release checkout must have no tracked edits");
}

function safeEnvironment() {
  const allowed = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PATHEXT"];
  return Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}

async function run(command, args, options) {
  const output = [];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(exitCode, 0, output.join(""));
  process.stdout.write(output.join(""));
}

async function createReleaseSource(dataDirectory) {
  assertReleaseCheckout(process.cwd());
  const parent = path.dirname(dataDirectory);
  assert.equal(path.basename(dataDirectory), "data");
  assert.match(path.basename(parent), /^eremite-v15-release-fixture-/u);
  assert.equal(path.resolve(path.dirname(parent)), path.resolve(tmpdir()));
  assert.equal(path.resolve(process.env.EREMITE_DATA_DIR ?? ""), path.resolve(dataDirectory));
  assert.equal(existsSync(dataDirectory), false, "fixture must start with a new temporary data directory");
  assert.deepEqual((await readdir(path.join(process.cwd(), "db", "migrations"))).filter((name) => name.endsWith(".sql")).sort(), oldMigrations);
  installDeterministicClockAndIds();

  const releaseImport = (name) => import(pathToFileURL(path.join(process.cwd(), name)).href);
  const database = await releaseImport("src/platform/db/database.ts");
  const projects = await releaseImport("src/modules/projects/service.ts");
  const folders = await releaseImport("src/modules/projects/folders.ts");
  const inbox = await releaseImport("src/modules/inbox/service.ts");
  const actions = await releaseImport("src/modules/actions/service.ts");
  const automations = await releaseImport("src/modules/automations/service.ts");
  const chat = await releaseImport("src/modules/ai/chat-store.ts");

  const projectId = projects.createProject({ name: "Release fixture project" });
  const folderId = folders.createFolder({ projectId, name: "Fixture folder" });
  const bytes = Buffer.from("Eremite v1.5.0 release migration fixture.\n", "utf8");
  const contentId = await inbox.createFileContentItemFromStream({
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    originalName: "release-fixture.txt", mimeType: "text/plain", expectedSize: bytes.length,
    title: "Fixture file", projectId, folderId,
  });
  inbox.createLinkContentItem({ title: "Fixture link", url: "https://example.invalid/fixture", projectId, folderId });
  const actionId = actions.createAction({ title: "Review fixture", priority: "normal", contentItemIds: [contentId], projectId });
  const draftActionId = actions.createAction({ title: "Fixture draft", priority: "high", status: "draft", contentItemIds: [contentId], projectId });
  const automationRunId = automations.runInboxToDrafts([contentId], projectId);
  assert.equal(automations.listAutomationRuns().find((run) => run.id === automationRunId)?.status, "completed");

  const thread = chat.createAIThread();
  const started = chat.beginAIRun({
    threadId: thread.id, expectedRevision: thread.revision,
    requestId: "00000000-0000-4000-8000-000000000015", text: "Summarize the fixture",
    model: "fixture-model", deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const action = actions.getAction(actionId);
  const draftAction = actions.getAction(draftActionId);
  assert.ok(action && draftAction);
  database.withUnitOfWork((uow) => {
    chat.recordAIActionDraft(uow, { threadId: thread.id, messageId: started.assistantId, runId: started.runId, actionId: draftActionId, actionRevision: draftAction.revision });
    chat.recordAIActionUpdateProposal(uow, {
      threadId: thread.id, messageId: started.assistantId, runId: started.runId,
      actionId, actionRevision: action.revision, beforeTitle: action.title,
      beforePriority: action.priority, beforeDueDate: action.due_date,
      patchTitle: "Review fixture update", patchDueDateSet: false, patchDueDate: null,
    });
    chat.recordAIActionDisambiguation(uow, {
      threadId: thread.id, messageId: started.assistantId, runId: started.runId,
      referenceKey: "review fixture", patchTitle: "Review fixture candidate",
      patchDueDateSet: false, patchDueDate: null,
      candidates: [{ actionId, revision: action.revision, title: action.title,
        projectId, projectName: "Release fixture project", dueDate: action.due_date,
        priority: action.priority, createdAt: action.created_at }],
    });
  });
  assert.equal(chat.finishAIRun({ runId: started.runId, status: "completed", content: "Fixture answer", sources: [
    { module: "inbox", entity: "content", id: contentId, label: "Fixture file", href: `/inbox?content=${contentId}` },
  ] }), true);
  const connection = database.db();
  connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  connection.close();
}

function installDeterministicClockAndIds() {
  // Keep v1.5 service behavior intact while making its generated IDs and timestamps repeatable.
  const NativeDate = Date;
  let nextMillisecond = NativeDate.parse("2025-06-01T00:00:00.000Z");
  globalThis.Date = class FixtureDate extends NativeDate {
    constructor(...args) { if (args.length === 0) super(nextMillisecond++); else super(...args); }
    static now() { return nextMillisecond++; }
  };
  let sequence = 0;
  const nextBytes = (size) => {
    const parts = [];
    while (Buffer.concat(parts).length < size) parts.push(createHash("sha256").update(`eremite-v15-fixture-${sequence++}`).digest());
    return Buffer.concat(parts).subarray(0, size);
  };
  crypto.randomBytes = nextBytes;
  crypto.randomUUID = () => {
    const bytes = nextBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  syncBuiltinESMExports();
}

async function validateReleaseSource(dataDirectory) {
  const source = new DatabaseSync(path.join(dataDirectory, "app.sqlite"), { readOnly: true });
  try {
    assert.deepEqual(source.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version), oldMigrations);
    assert.equal(source.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(source.prepare("PRAGMA foreign_key_check").all(), []);
    const counts = Object.fromEntries(requiredTables.map((table) => [table, source.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
    for (const [table, count] of Object.entries(counts)) assert.ok(count > 0, `${table} must be populated by v1.5.0 services`);
    const blobs = source.prepare("SELECT storage_key, sha256, byte_size FROM file_blobs ORDER BY storage_key").all();
    for (const blob of blobs) {
      assert.match(blob.storage_key, /^[a-f0-9]{64}$/u);
      const filename = path.join(dataDirectory, "files", blob.storage_key);
      assert.equal((await stat(filename)).size, blob.byte_size);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(filename)) hash.update(chunk);
      assert.equal(hash.digest("hex"), blob.sha256);
    }
    assert.equal(source.prepare("SELECT COUNT(*) AS count FROM app_settings").get().count, 0, "fixture must contain no settings or secrets");
    return { releaseCommit, migrations: oldMigrations.length, counts,
      fileBlobs: blobs.map((blob) => ({ byteSize: blob.byte_size, sha256: blob.sha256 })),
      integrity: "ok", foreignKeys: 0 };
  } finally {
    source.close();
  }
}
