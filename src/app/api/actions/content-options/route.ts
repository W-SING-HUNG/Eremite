import { NextResponse } from "next/server";
import { listContentPickerPage } from "@/modules/inbox/service";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  if (query.length > 200) return NextResponse.json({ code: "invalid_query" }, { status: 400 });
  const rawLimit = Number(url.searchParams.get("limit") ?? "24");
  const result = listContentPickerPage({
    query,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: Number.isSafeInteger(rawLimit) ? rawLimit : undefined,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
