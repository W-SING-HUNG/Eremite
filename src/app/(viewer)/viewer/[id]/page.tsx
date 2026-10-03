import { notFound } from "next/navigation";
import { ViewerShell } from "@/app/_components/file-viewer/viewer-shell";
import { getViewerDescriptor } from "@/modules/viewer/service";
import { getAvailableContentItemSummary, getFileAssetForViewing, listAvailableContentItemsByIds } from "@/modules/inbox/service";
import { listProjects } from "@/modules/projects/service";
import { listTags } from "@/modules/tags/service";
import { viewerDescriptorForReadFailure } from "@/modules/viewer/service";
import { requireAuthorized } from "@/platform/auth/service";

export const dynamic = "force-dynamic";

export default async function FullViewerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  await requireAuthorized();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let descriptor;
  try {
    descriptor = await getViewerDescriptor(id, query.version);
  } catch {
    descriptor = viewerDescriptorForReadFailure(getFileAssetForViewing(id, query.version));
  }
  if (!descriptor) notFound();
  const sourceContent = listAvailableContentItemsByIds([id])[0];
  const sourceSummary = getAvailableContentItemSummary(id);
  if (!sourceContent || !sourceSummary) notFound();
  const returnHref = `/inbox?selected=${encodeURIComponent(id)}`;
  return <ViewerShell
    descriptor={descriptor}
    mode="full"
    returnHref={returnHref}
    processingHref={sourceSummary.status === "inbox" ? `${returnHref}&processing=1` : undefined}
    actionCreateContext={sourceSummary.status === "inbox" ? undefined : { sourceContent, projects: listProjects(), availableTags: listTags() }}
  />;
}
