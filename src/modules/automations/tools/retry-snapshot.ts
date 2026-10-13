import { createHash } from "node:crypto";
import { getAvailableContentItemSummary, getFileAssetForViewing } from "@/modules/inbox/service";
import { assertProjectAcceptsMembers, ProjectError } from "@/modules/projects/service";
import { getFolderBreadcrumbs, isFolderAvailable } from "@/modules/projects/folders";

export class ToolRetryError extends Error {
  constructor(public readonly code: "retry_not_allowed" | "retry_snapshot_incomplete" | "retry_stale_source" | "retry_stale_tool" | "retry_stale_destination" | "retry_output_exists" | "retry_history_required") { super(code); }
}

export function policyFingerprint(policy: unknown): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

function folderPathEvidence(folderId: string | null) {
  return folderId ? getFolderBreadcrumbs(folderId).map(folder => ({ id: folder.id, name: folder.name, parentId: folder.parent_id, projectId: folder.project_id })) : [];
}

/** Preserve destination errors before the ordinary validator's generic context error. */
export function assertRetryDestinationAvailable(destination: { projectId: string | null; folderId: string | null }) {
  if ((destination.projectId !== null && (typeof destination.projectId !== "string" || !destination.projectId.trim()))
    || (destination.folderId !== null && (typeof destination.folderId !== "string" || !destination.folderId.trim()))) throw new ToolRetryError("retry_snapshot_incomplete");
  try { assertProjectAcceptsMembers(destination.projectId); }
  catch (error) {
    if (error instanceof ProjectError && (error.code === "not_found" || error.code === "archived")) throw new ToolRetryError("retry_stale_destination");
    throw error;
  }
  if (destination.folderId && (!destination.projectId || !isFolderAvailable(destination.folderId, destination.projectId))) throw new ToolRetryError("retry_stale_destination");
}

/** Host provenance only; compatible accepted Supplier upgrades are not frozen here. */
export function captureRetryEvidence(contentIds: string[], destination: { projectId: string | null; folderId: string | null }, policy: string) {
  const sources = contentIds.map(contentId => {
    const item = getAvailableContentItemSummary(contentId);
    const asset = getFileAssetForViewing(contentId);
    if (!item || !asset || item.status === "archived") throw new ToolRetryError("retry_stale_source");
    return { contentId, revision: item.revision, versionId: asset.versionId, assetId: asset.assetId, sha256: asset.sha256, byteSize: asset.byteSize,
      title: item.title, originalName: asset.originalName, mimeType: asset.declaredMimeType, projectId: item.project_id, folderId: item.folder_id };
  });
  const project = assertProjectAcceptsMembers(destination.projectId);
  if (destination.folderId && (!destination.projectId || !isFolderAvailable(destination.folderId, destination.projectId))) throw new ToolRetryError("retry_stale_destination");
  const location = { projectId: destination.projectId, folderId: destination.folderId, projectName: project?.name ?? null,
    folderPathSha256: policyFingerprint(folderPathEvidence(destination.folderId)) };
  return { schemaVersion: 2 as const, sources, destination: location, policy };
}

type RetryEvidence = ReturnType<typeof captureRetryEvidence>;
type LegacyRetryEvidence = Omit<RetryEvidence, "schemaVersion" | "destination"> & {
  schemaVersion: 1;
  destination: Omit<RetryEvidence["destination"], "folderPathSha256"> & { folders: ReturnType<typeof folderPathEvidence> };
};

export function assertRetryPayload(stored: unknown, current: unknown) {
  const value = stored as { retryEvidence?: RetryEvidence | LegacyRetryEvidence } | null;
  if (!value?.retryEvidence || ![1, 2].includes(value.retryEvidence.schemaVersion)) throw new ToolRetryError("retry_snapshot_incomplete");
  const fresh = current as { retryEvidence: RetryEvidence };
  if (value.retryEvidence.policy !== fresh.retryEvidence.policy) throw new ToolRetryError("retry_stale_tool");
  if (JSON.stringify(value.retryEvidence.sources) !== JSON.stringify(fresh.retryEvidence.sources)) throw new ToolRetryError("retry_stale_source");
  let comparable: unknown = fresh;
  if (value.retryEvidence.schemaVersion === 1) {
    const old = value.retryEvidence.destination;
    if (!old || !Array.isArray(old.folders)) throw new ToolRetryError("retry_snapshot_incomplete");
    if (policyFingerprint(old.folders) !== fresh.retryEvidence.destination.folderPathSha256) throw new ToolRetryError("retry_stale_destination");
    // Reconstruct only the comparison shape. Never rewrite historical payloads.
    comparable = { ...fresh, retryEvidence: { schemaVersion: 1, sources: fresh.retryEvidence.sources,
      destination: { projectId: fresh.retryEvidence.destination.projectId, folderId: fresh.retryEvidence.destination.folderId,
        projectName: fresh.retryEvidence.destination.projectName, folders: old.folders }, policy: fresh.retryEvidence.policy } };
    if (JSON.stringify(old) !== JSON.stringify((comparable as { retryEvidence: LegacyRetryEvidence }).retryEvidence.destination)) throw new ToolRetryError("retry_stale_destination");
  } else {
    if (!value.retryEvidence.destination || !/^[a-f0-9]{64}$/u.test(value.retryEvidence.destination.folderPathSha256)) throw new ToolRetryError("retry_snapshot_incomplete");
    if (JSON.stringify(value.retryEvidence.destination) !== JSON.stringify(fresh.retryEvidence.destination)) throw new ToolRetryError("retry_stale_destination");
  }
  // Also rejects unknown fields, alternate/default parameters and damaged evidence.
  if (JSON.stringify(stored) !== JSON.stringify(comparable)) throw new ToolRetryError("retry_snapshot_incomplete");
}

export function fixedRetryAsset(contentId: string, versionId: string) {
  const item = getAvailableContentItemSummary(contentId);
  if (!item || item.status === "archived") throw new ToolRetryError("retry_stale_source");
  const fixed = getFileAssetForViewing(contentId, versionId);
  const current = getFileAssetForViewing(contentId);
  if (!fixed || !current || fixed.versionId !== current.versionId) throw new ToolRetryError("retry_stale_source");
  return fixed;
}
