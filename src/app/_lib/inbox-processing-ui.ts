import type { InboxStatus } from "@/modules/inbox/service";

export const canProcessContent = (status: InboxStatus) => status === "inbox";
export const canCreateActionDirectly = (status: InboxStatus) => status !== "inbox";

export function editableContentStatuses(status: InboxStatus): InboxStatus[] {
  return status === "inbox" ? ["inbox"] : ["processed", "archived"];
}
