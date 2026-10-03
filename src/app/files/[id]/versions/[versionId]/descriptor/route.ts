import { NextResponse } from "next/server";
import { getFileAssetForViewing } from "@/modules/inbox/service";
import { getViewerDescriptorForAsset, viewerDescriptorForReadFailure } from "@/modules/viewer/service";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  if (!(await isAuthorized())) return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  const { id, versionId } = await params;
  const asset = getFileAssetForViewing(id, versionId);
  if (!asset) return NextResponse.json({ code: "not_found" }, { status: 404 });
  let descriptor;
  try { descriptor = await getViewerDescriptorForAsset(asset); }
  catch { descriptor = viewerDescriptorForReadFailure(asset); }
  return NextResponse.json(descriptor, { headers: { "Cache-Control": "private, no-store" } });
}
