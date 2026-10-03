import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "@/platform/db/database";

const heartbeatIntervalMs = 10_000;
const staleAfterMs = 60_000;
const lockDirectory = path.join(dataDirectory, ".writer-lock");
const ownerPath = path.join(lockDirectory, "owner.json");

type LeaseOwner = { token: string; pid: number; startedAt: string; heartbeatAt: string };
let writerQueue: Promise<void> = Promise.resolve();

export class DataWriterLeaseError extends Error {
  constructor() {
    super("Another Eremite process currently owns the data writer lease.");
    this.name = "DataWriterLeaseError";
  }
}

export async function withDataWriterLease<T>(work: () => Promise<T>): Promise<T> {
  const predecessor = writerQueue;
  let releaseQueue!: () => void;
  const ownTurn = new Promise<void>((resolve) => { releaseQueue = resolve; });
  writerQueue = predecessor.then(() => ownTurn);
  await predecessor;
  let owner: LeaseOwner | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    owner = await acquireLease();
    heartbeat = setInterval(() => void refreshLease(owner!), heartbeatIntervalMs);
    heartbeat.unref();
    return await work();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (owner) await releaseLease(owner);
    releaseQueue();
  }
}

async function acquireLease(): Promise<LeaseOwner> {
  await mkdir(dataDirectory, { recursive: true });
  const owner: LeaseOwner = {
    token: randomUUID(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  const deadline = Date.now() + 5_000;
  let attempt = 0;
  while (Date.now() <= deadline) {
    try {
      await mkdir(lockDirectory);
      const handle = await open(ownerPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(owner));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return owner;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await removeStaleLease()) continue;
      attempt += 1;
      await delay(Math.min(250, 40 + attempt * 10));
    }
  }
  throw new DataWriterLeaseError();
}

async function refreshLease(owner: LeaseOwner) {
  const current = await readOwner();
  if (current?.token !== owner.token) return;
  owner.heartbeatAt = new Date().toISOString();
  await writeFile(ownerPath, JSON.stringify(owner)).catch(() => undefined);
}

async function releaseLease(owner: LeaseOwner) {
  const current = await readOwner();
  if (current?.token === owner.token) await rm(lockDirectory, { recursive: true, force: true });
}

async function removeStaleLease() {
  const current = await readOwner();
  const details = await stat(lockDirectory).catch(() => null);
  const heartbeat = current ? Date.parse(current.heartbeatAt) : details?.mtimeMs ?? Number.POSITIVE_INFINITY;
  if (Date.now() - heartbeat <= staleAfterMs) return false;
  if (current && isProcessAlive(current.pid)) return false;
  await rm(lockDirectory, { recursive: true, force: true });
  return true;
}

async function readOwner(): Promise<LeaseOwner | null> {
  try {
    const parsed = JSON.parse(await readFile(ownerPath, "utf8")) as Partial<LeaseOwner>;
    return typeof parsed.token === "string" && typeof parsed.pid === "number" && typeof parsed.heartbeatAt === "string"
      ? parsed as LeaseOwner
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

const isAlreadyExists = (error: unknown) => error instanceof Error && "code" in error && error.code === "EEXIST";
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
