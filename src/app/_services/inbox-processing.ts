import { acceptDraftAction, actionHasContentItem, createAction, type ActionPriority } from "@/modules/actions/service";
import { markContentProcessed } from "@/modules/inbox/service";
import { withUnitOfWork } from "@/platform/db/database";

export class InboxProcessingError extends Error {
  constructor(public readonly code: "action_not_linked") {
    super(code);
    this.name = "InboxProcessingError";
  }
}

export function processContentWithoutAction(input: { contentId: string; expectedContentRevision: number }) {
  return withUnitOfWork((uow) => ({
    contentRevision: markContentProcessed(uow, { id: input.contentId, expectedRevision: input.expectedContentRevision }),
  }));
}

export function processContentWithNewAction(input: {
  contentId: string;
  expectedContentRevision: number;
  title: string;
  priority: ActionPriority;
  dueDate?: string | null;
  projectId: string | null;
}) {
  return withUnitOfWork((uow) => {
    const actionId = createAction({
      title: input.title,
      priority: input.priority,
      dueDate: input.dueDate ?? undefined,
      projectId: input.projectId,
      status: "active",
      contentItemIds: [input.contentId],
    });
    const contentRevision = markContentProcessed(uow, { id: input.contentId, expectedRevision: input.expectedContentRevision });
    return { actionId, contentRevision };
  });
}

export function processContentWithAcceptedDraft(input: {
  contentId: string;
  expectedContentRevision: number;
  actionId: string;
  expectedActionRevision: number;
}) {
  return withUnitOfWork((uow) => {
    if (!actionHasContentItem(input.actionId, input.contentId)) throw new InboxProcessingError("action_not_linked");
    const actionRevision = acceptDraftAction(input.actionId, input.expectedActionRevision);
    const contentRevision = markContentProcessed(uow, { id: input.contentId, expectedRevision: input.expectedContentRevision });
    return { actionRevision, contentRevision };
  });
}
