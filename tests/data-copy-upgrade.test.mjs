import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const sourceData = process.env.EREMITE_RELEASE_SOURCE_DATA_DIR;
assert.ok(sourceData && path.isAbsolute(sourceData), "Set EREMITE_RELEASE_SOURCE_DATA_DIR to an absolute, read-only v1.5/0010 data source");
const expectedOldMigrations = [
  "0001_initial.sql", "0002_file_lifecycle.sql", "0003_projects_tags_trash.sql",
  "0004_metadata_search.sql", "0005_compatibility_pagination.sql", "0006_automation_tool_registry.sql",
  "0007_ai_conversations.sql", "0008_ai_action_drafts.sql", "0009_ai_action_update_proposals.sql", "0010_ai_action_disambiguation.sql",
];
const expectedMigrations = [...expectedOldMigrations, "0011_ai_tool_run_proposals.sql", "0012_ai_message_activities.sql"];
const aiTables = ["ai_threads", "ai_messages", "ai_runs", "ai_message_sources", "ai_message_action_drafts", "ai_action_update_proposals", "ai_action_disambiguations", "ai_action_disambiguation_candidates"];
const newTables = ["ai_tool_run_proposals", "ai_message_activities"];
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "eremite-v16-copy-upgrade-"));
const copy = path.join(temporaryRoot, "data");

try {
  const source = new DatabaseSync(path.join(sourceData, "app.sqlite"), { readOnly: true });
  let before;
  let fileReferences;
  try {
    assert.deepEqual(migrations(source), expectedOldMigrations, "release source must be exactly v1.5/0010");
    for (const row of source.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all()) {
      const sql = await readFile(path.join(process.cwd(), "db", "migrations", row.version), "utf8");
      assert.equal(row.checksum, createHash("sha256").update(sql).digest("hex"), `${row.version} source checksum must match the released migration`);
    }
    assert.equal(source.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(source.prepare("PRAGMA foreign_key_check").all().length, 0);
    before = historicalTables(source);
    for (const table of aiTables) assert.ok(before[table], `${table} must exist in the v1.5 source`);
    fileReferences = source.prepare("SELECT storage_key, sha256, byte_size FROM file_blobs ORDER BY storage_key").all();
    await verifyFileReferences(sourceData, fileReferences);
    await mkdir(copy, { recursive: true });
    await backup(source, path.join(copy, "app.sqlite"));
  } finally {
    source.close();
  }

  await cp(path.join(sourceData, "files"), path.join(copy, "files"), { recursive: true });
  const prepared = new DatabaseSync(path.join(copy, "app.sqlite"), { readOnly: true });
  try {
    assert.deepEqual(migrations(prepared), expectedOldMigrations);
    assert.deepEqual(historicalTables(prepared), before, "SQLite backup API copy must preserve every v1.5 table row");
  } finally {
    prepared.close();
  }
  await verifyFileReferences(copy, fileReferences);
  const result = await runUpgradeProbe(copy, Object.keys(before));
  assert.equal(result.exitCode, 0, result.output);
  const report = JSON.parse(result.output.trim().split(/\r?\n/u).at(-1));
  assert.equal(report.integrity, "ok");
  assert.equal(report.foreignKeys, 0);
  assert.deepEqual(report.migrations, expectedMigrations);
  assert.deepEqual(report.historicalTables, before, "all v1.5 table rows, including old AI data, must remain unchanged");
  const snapshotDigest = createHash("sha256").update(JSON.stringify(before)).digest("hex");
  assert.deepEqual(report.newTableCounts, Object.fromEntries(newTables.map((table) => [table, 0])));
  assert.equal(report.currentFileProblems, 0);
  await verifyFileReferences(copy, fileReferences);
  const backups = await readdir(path.join(copy, "backups"), { withFileTypes: true });
  assert.ok(backups.some((entry) => entry.isDirectory() && entry.name.startsWith("pre-migration-")), "upgrade creates a pre-migration backup in the disposable copy");
  console.log(`v1.5/0010 data-copy upgrade passed: ${Object.keys(before).length} old tables, including ${aiTables.length} AI tables, preserved by row count and SHA-256 through 0012; pre/post snapshot digest ${snapshotDigest}; ${fileReferences.length} file blobs verified; integrity and foreign keys clean. Old AI row counts: ${JSON.stringify(Object.fromEntries(aiTables.map((table) => [table, before[table].count])))}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function migrations(connection) {
  return connection.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
}

function historicalTables(connection) {
  const names = connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all().map((row) => row.name);
  return Object.fromEntries(names.map((name) => {
    const rows = connection.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
    const content = rows.map((row) => JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value)).sort().join("\n");
    return [name, { count: rows.length, sha256: createHash("sha256").update(content).digest("hex") }];
  }));
}

async function verifyFileReferences(dataDirectory, references) {
  for (const file of references) {
    assert.match(file.storage_key, /^[a-f0-9]{64}$/u);
    const filename = path.join(dataDirectory, "files", file.storage_key);
    assert.equal((await stat(filename)).size, file.byte_size);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    assert.equal(hash.digest("hex"), file.sha256);
  }
}

function runUpgradeProbe(dataDirectory, oldTableNames) {
  const code = `
    process.env.EREMITE_DATA_DIR = ${JSON.stringify(dataDirectory)};
    const { createHash } = await import('node:crypto');
    const database = await import('./src/platform/db/database.ts');
    const files = await import('./src/platform/backup/service.ts');
    const connection = database.db();
    const names = ${JSON.stringify(oldTableNames)};
    const historicalTables = Object.fromEntries(names.map(name => {
      const rows = connection.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all();
      const content = rows.map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).sort().join('\\n');
      return [name, { count: rows.length, sha256: createHash('sha256').update(content).digest('hex') }];
    }));
    const newTables = ${JSON.stringify(newTables)};
    const report = {
      integrity: connection.prepare('PRAGMA integrity_check').get().integrity_check,
      foreignKeys: connection.prepare('PRAGMA foreign_key_check').all().length,
      migrations: connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version),
      historicalTables,
      newTableCounts: Object.fromEntries(newTables.map(name => [name, connection.prepare('SELECT COUNT(*) AS count FROM "' + name + '"').get().count])),
      currentFileProblems: (await files.verifyCurrentFiles()).length,
    };
    console.log(JSON.stringify(report)); connection.close();
  `;
  return new Promise((resolve) => {
    const output = [];
    const child = spawn(process.execPath, ["--import", "./tests/register-typescript-loader.mjs", "--input-type=module", "--eval", code], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    child.on("exit", (exitCode) => resolve({ exitCode, output: output.join("") }));
  });
}
