import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeKey } from "@/platform/shared/normalization";
import { uuidv7 } from "@/platform/shared/ids";

const root = process.cwd();
export const dataDirectory = process.env.EREMITE_DATA_DIR ? path.resolve(process.env.EREMITE_DATA_DIR) : path.join(root, "data");
export const databasePath = path.join(dataDirectory, "app.sqlite");
export const filesDirectory = path.join(dataDirectory, "files");
export const backupsDirectory = path.join(dataDirectory, "backups");
const migrationsDirectory = path.join(root, "db", "migrations");

type Row = Record<string, unknown>;
let database: DatabaseSync | undefined;
let transactionDepth = 0;
const unitOfWork = Object.freeze({ kind: "eremite-sqlite-unit-of-work" as const });
export type UnitOfWork = typeof unitOfWork;

function checksum(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function initializeDatabase(): DatabaseSync {
  if (database) return database;
  const databaseExisted = existsSync(databasePath);
  for (const directory of [dataDirectory, filesDirectory, backupsDirectory]) {
    // Sync is intentional here: startup runs once before requests are handled.
    mkdirSync(directory, { recursive: true });
  }
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.function("eremite_uuidv7", () => uuidv7());
  db.function("eremite_normalize_key", (value: unknown) => normalizeKey(String(value ?? "")));
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;");

  const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();
  const pendingMigrations = migrationFiles.filter((filename) => !db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(filename));
  const appliedMigrationCount = Number((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number | bigint }).count);
  if (databaseExisted && appliedMigrationCount > 0 && pendingMigrations.length > 0) {
    createPreMigrationBackup(db, pendingMigrations);
  }

  for (const filename of migrationFiles) {
    const source = readFileSync(path.join(migrationsDirectory, filename), "utf8");
    const existing = db.prepare("SELECT checksum FROM schema_migrations WHERE version = ?").get(filename) as Row | undefined;
    const hash = checksum(source);
    if (existing) {
      if (existing.checksum !== hash) throw new Error(`Migration ${filename} was changed after it was applied.`);
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(source);
      db.prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)").run(filename, hash, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  database = db;
  return db;
}

export function db() {
  return initializeDatabase();
}

export function all<T extends Row>(sql: string, ...params: unknown[]): T[] {
  return (db().prepare(sql).all(...(params as any[])) as T[]).map((row) => ({ ...row }) as T);
}

export function one<T extends Row>(sql: string, ...params: unknown[]): T | undefined {
  const row = db().prepare(sql).get(...(params as any[])) as T | undefined;
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...(params as any[]));
}

export function transaction<T>(work: () => T): T {
  const connection = db();
  const outermost = transactionDepth === 0;
  const savepoint = `eremite_nested_${transactionDepth}`;
  connection.exec(outermost ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  transactionDepth += 1;
  try {
    const result = work();
    connection.exec(outermost ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    if (outermost) connection.exec("ROLLBACK");
    else connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  } finally {
    transactionDepth -= 1;
  }
}

/** A narrow participation token for cross-module writes committed by one SQLite transaction. */
export function withUnitOfWork<T>(work: (uow: UnitOfWork) => T): T {
  return transaction(() => work(unitOfWork));
}

export function assertUnitOfWork(uow: UnitOfWork) {
  if (uow !== unitOfWork) throw new Error("invalid_unit_of_work");
}

function createPreMigrationBackup(connection: DatabaseSync, pendingMigrations: string[]) {
  const integrity = connection.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("Pre-migration integrity check failed.");
  const foreignKeyProblems = connection.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyProblems.length > 0) throw new Error("Pre-migration foreign-key check failed.");

  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const incompleteDirectory = path.join(backupsDirectory, `.pre-migration-${stamp}.incomplete`);
  const completedDirectory = path.join(backupsDirectory, `pre-migration-${stamp}`);
  const databaseTarget = path.join(incompleteDirectory, "app.sqlite");
  const filesTarget = path.join(incompleteDirectory, "files");
  mkdirSync(filesTarget, { recursive: true });
  try {
    connection.exec(`VACUUM INTO '${databaseTarget.replaceAll("'", "''")}'`);
    const snapshot = new DatabaseSync(databaseTarget, { readOnly: true });
    let retained: Array<{ storage_key: string; sha256: string; byte_size: number }>;
    try {
      const hasVersions = Boolean(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'file_versions'").get());
      retained = hasVersions
        ? snapshot.prepare(`SELECT DISTINCT fb.storage_key, fb.sha256, fb.byte_size
                              FROM file_versions fv JOIN file_blobs fb ON fb.id = fv.blob_id
                             ORDER BY fb.storage_key`).all() as typeof retained
        : snapshot.prepare("SELECT storage_key, sha256, byte_size FROM file_assets ORDER BY storage_key").all() as typeof retained;
      const snapshotIntegrity = snapshot.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (snapshotIntegrity.integrity_check !== "ok" || snapshot.prepare("PRAGMA foreign_key_check").all().length > 0) {
        throw new Error("Pre-migration snapshot validation failed.");
      }
    } finally {
      snapshot.close();
    }
    for (const file of retained) {
      assertStorageKey(file.storage_key);
      const source = path.join(filesDirectory, file.storage_key);
      if (statSync(source).size !== file.byte_size || hashFileSync(source) !== file.sha256) {
        throw new Error(`Pre-migration file verification failed for ${file.storage_key}.`);
      }
      copyFileSync(source, path.join(filesTarget, file.storage_key));
    }
    const manifest = {
      kind: "pre-migration",
      createdAt: new Date().toISOString(),
      pendingMigrations,
      database: "app.sqlite",
      files: retained,
    };
    writeFileSync(path.join(incompleteDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(incompleteDirectory, "complete"), "ok\n");
    renameSync(incompleteDirectory, completedDirectory);
  } catch (error) {
    rmSync(incompleteDirectory, { recursive: true, force: true });
    throw error;
  }
}

function hashFileSync(filename: string) {
  const handle = openSync(filename, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(handle);
  }
  return hash.digest("hex");
}

function assertStorageKey(storageKey: string) {
  if (!/^[a-f0-9]{64}$/.test(storageKey) || path.basename(storageKey) !== storageKey) {
    throw new Error("Unsafe managed-file storage key.");
  }
}
