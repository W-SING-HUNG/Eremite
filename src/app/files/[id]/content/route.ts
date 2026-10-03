import { getFileAssetForViewing } from "@/modules/inbox/service";
import { errorResponse, respondWithManagedFile } from "@/modules/viewer/binary-response";
import { isAuthorized } from "@/platform/auth/service";

export const runtime = "nodejs";

async function respond(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return errorResponse(401, "unauthorized", "Unauthorized");
  const { id } = await params;
  const asset = getFileAssetForViewing(id);
  if (!asset) return errorResponse(404, "not_found", "File item not found");
  return respondWithManagedFile(request, asset, { disposition: "inline", validatePreview: true });
}

export const GET = respond;
export const HEAD = respond;
