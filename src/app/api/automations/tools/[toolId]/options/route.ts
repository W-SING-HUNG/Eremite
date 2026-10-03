import { NextResponse } from "next/server";
import { getServerTool } from "@/modules/automations/registry";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const { toolId } = await params; const tool = getServerTool(toolId);
  if (!tool || !("listInputOptions" in tool)) return NextResponse.json({ code: "not_found" }, { status: 404 });
  const url = new URL(request.url); const query = url.searchParams.get("q") ?? "";
  if (query.length > 200) return NextResponse.json({ code: "invalid_query" }, { status: 400 });
  const rawLimit = Number(url.searchParams.get("limit") ?? "24");
  const constrainProject = url.searchParams.get("constrainProject") === "1";
  const result = tool.listInputOptions({
    query,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: Number.isSafeInteger(rawLimit) ? rawLimit : undefined,
    constrainProject,
    projectId: constrainProject ? url.searchParams.get("projectId") || null : undefined,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
