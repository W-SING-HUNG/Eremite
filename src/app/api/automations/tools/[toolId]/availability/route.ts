import { NextResponse } from "next/server";
import { getServerTool } from "@/modules/automations/registry";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const { toolId } = await params; const tool = getServerTool(toolId);
  if (!tool || !("getAvailability" in tool)) return NextResponse.json({ code: "not_found" }, { status: 404 });
  return NextResponse.json(await tool.getAvailability(), { headers: { "Cache-Control": "private, no-store" } });
}
