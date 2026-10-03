import { getFileAssetForViewing } from "@/modules/inbox/service";
import { errorResponse, respondWithManagedFile } from "@/modules/viewer/binary-response";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

async function respond(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  if (!(await isAuthorized())) return errorResponse(401, "unauthorized", "Unauthorized");
  const { id, versionId } = await params;
  const asset = getFileAssetForViewing(id, versionId);
  if (!asset) return errorResponse(404, "not_found", "File version not found");
  return respondWithManagedFile(request, asset, { disposition: "attachment", validatePreview: false });
}

export const GET = respond;
export const HEAD = respond;
