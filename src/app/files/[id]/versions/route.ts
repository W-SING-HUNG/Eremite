import { NextResponse } from "next/server";
import { getFileAssetForViewing, listFileVersions } from "@/modules/inbox/service";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const current = getFileAssetForViewing(id);
  if (!current) return NextResponse.json({ code: "not_found" }, { status: 404 });
  return NextResponse.json({ currentVersionId: current.versionId, versions: listFileVersions(id) }, { headers: { "Cache-Control": "private, no-store" } });
}
