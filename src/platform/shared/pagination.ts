export type PageCursor = { timestamp: string; id: string; values?: Array<string | number | null> };

export function encodeCursor(cursor: PageCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value?: string | null): PageCursor | null {
  if (!value || value.length > 500) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<PageCursor>;
    return typeof parsed.timestamp === "string" && typeof parsed.id === "string" && (parsed.values === undefined || Array.isArray(parsed.values)) ? parsed as PageCursor : null;
  } catch { return null; }
}

export function pageLimit(value?: number, maximum = 50) {
  return Math.max(1, Math.min(Number.isSafeInteger(value) ? value! : 30, maximum));
}
