import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one, run } from "@/platform/db/database";
import { now, uuidv7 } from "@/platform/shared/ids";

const cookieName = "eremite_session";
const settingsKey = "auth.password";
type Setting = { value: string };
type Session = { id: string };

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function isPasswordConfigured() {
  return Boolean(one<Setting>("SELECT value FROM app_settings WHERE key = ?", settingsKey));
}

export async function isAuthorized() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return false;
  const session = one<Session>("SELECT id FROM sessions WHERE id = ? AND expires_at > ?", token, now());
  return Boolean(session);
}

export async function requireAuthorized() {
  if (await isAuthorized()) return;
  redirect(isPasswordConfigured() ? "/login" : "/setup");
}

async function createSession() {
  const id = uuidv7();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  run("DELETE FROM sessions WHERE expires_at <= ?", now());
  run("INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)", id, expiresAt, now());
  (await cookies()).set(cookieName, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: new Date(expiresAt), path: "/" });
}

export async function setupPassword(password: string) {
  if (isPasswordConfigured()) throw new Error("Password is already configured.");
  if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
  run("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)", settingsKey, hashPassword(password), now());
  await createSession();
}

export async function login(password: string) {
  const record = one<Setting>("SELECT value FROM app_settings WHERE key = ?", settingsKey);
  if (!record || !verifyPassword(password, record.value)) throw new Error("Incorrect password.");
  await createSession();
}

export async function logout() {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  if (token) run("DELETE FROM sessions WHERE id = ?", token);
  store.delete(cookieName);
}
