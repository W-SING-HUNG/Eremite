import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataDirectory } from "@/platform/db/database";

export interface SecretStore {
  read(id: string): string | null;
  write(id: string, secret: string): void;
  delete(id: string): void;
  available(): boolean;
}

const scope = createHash("sha256").update(dataDirectory.toLowerCase()).digest("hex").slice(0, 32);
const credentialId = /^[a-f0-9-]{36}$/u;

export function createWindowsSecretStore(namespace: "AI" | "QA" = "AI"): SecretStore {
  const target = (id: string) => {
    if (!credentialId.test(id)) throw new Error("secret_id_invalid");
    return `Eremite/${namespace}/${scope}-${id}`;
  };
  const call = (operation: "read" | "write" | "delete", id: string, secret?: string) => {
    if (process.platform !== "win32") throw new Error("secret_store_unavailable");
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = path.join(process.cwd(), "scripts", "windows-credential-store.ps1");
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
      input: JSON.stringify({ operation, target: target(id), ...(secret === undefined ? {} : { secret }) }),
      encoding: "utf8", timeout: 12_000, maxBuffer: 8192, windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error("secret_store_failed");
    return result.stdout;
  };
  return {
    read(id) {
      const result = call("read", id);
      if (result === "missing") return null;
      if (!result.startsWith("found:")) throw new Error("secret_store_failed");
      const value = Buffer.from(result.slice(6), "base64").toString("utf8");
      if (!value.trim()) throw new Error("secret_store_failed");
      return value;
    },
    write(id, secret) { if (!secret.trim() || Buffer.byteLength(secret, "utf8") > 2560 || call("write", id, secret) !== "ok") throw new Error("secret_store_failed"); },
    delete(id) { if (call("delete", id) !== "ok") throw new Error("secret_store_failed"); },
    available() { return process.platform === "win32"; },
  };
}
