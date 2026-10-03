export type ResourceDestination = {
  projectId: string | null;
  folderId: string | null;
  label: string;
};

export function serializeDestination(destination: Pick<ResourceDestination, "projectId" | "folderId">) {
  return destination.projectId ? `${destination.projectId}|${destination.folderId ?? ""}` : "inbox";
}

export function isSameDestination(
  destination: Pick<ResourceDestination, "projectId" | "folderId">,
  original: { projectId?: string | null; folderId?: string | null },
) {
  return (destination.projectId ?? null) === (original.projectId ?? null)
    && (destination.folderId ?? null) === (original.folderId ?? null);
}

export function collapseBreadcrumbs<T>(items: T[], visibleCount = 4) {
  if (items.length <= visibleCount) return { leading: items, hidden: [] as T[], trailing: [] as T[] };
  const trailingCount = Math.max(2, visibleCount - 2);
  return {
    leading: items.slice(0, 1),
    hidden: items.slice(1, -trailingCount),
    trailing: items.slice(-trailingCount),
  };
}
