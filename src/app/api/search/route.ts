import { NextResponse } from "next/server";
import { searchWorkspace, type SearchScope } from "@/modules/search/service";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  if (query.length > 500) return NextResponse.json({ code: "invalid_query" }, { status: 400 });
  const scopeValue = url.searchParams.get("scope");
  const scope = (["global", "project", "folder"] as const).includes(scopeValue as SearchScope) ? scopeValue as SearchScope : "global";
  const rawLimit = Number(url.searchParams.get("limit") ?? "10");
  const result = searchWorkspace({ query, scope, projectId: url.searchParams.get("projectId") ?? undefined, folderId: url.searchParams.get("folderId") ?? undefined, tagId: url.searchParams.get("tagId") ?? undefined, grouped: url.searchParams.get("grouped") === "1", limit: Number.isSafeInteger(rawLimit) ? rawLimit : undefined });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
