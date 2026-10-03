import { partitionByDueDate } from "@/app/_lib/local-date";
import type { ActionItem } from "@/modules/actions/service";

export type ActionViewMode = "drafts" | "open" | "completed" | "all";
export type ActionViewGroup<T> = { title: string; items: T[] };

export function actionViewGroups<T extends Pick<ActionItem, "status" | "due_date">>(actions: T[], viewMode: ActionViewMode, today: string): ActionViewGroup<T>[] {
  const drafts = actions.filter((action) => action.status === "draft");
  const active = actions.filter((action) => action.status === "active");
  const completed = actions.filter((action) => action.status === "done");
  const other = actions.filter((action) => !["draft", "active", "done"].includes(action.status));
  const { overdue, today: dueToday, next } = partitionByDueDate(active, today);

  if (viewMode === "drafts") return [{ title: "待确认", items: drafts }];
  if (viewMode === "completed") return [{ title: "已完成", items: completed }];
  if (viewMode === "all") {
    return [
      { title: "待确认", items: drafts },
      { title: "逾期", items: overdue },
      { title: "今天", items: dueToday },
      { title: "接下来", items: next },
      { title: "已完成", items: completed },
      { title: "其他", items: other },
    ];
  }
  return [{ title: "逾期", items: overdue }, { title: "今天", items: dueToday }, { title: "接下来", items: next }];
}

export function countActionsByStatus<T extends Pick<ActionItem, "status">>(actions: T[]) {
  return {
    drafts: actions.filter((action) => action.status === "draft").length,
    active: actions.filter((action) => action.status === "active").length,
    completed: actions.filter((action) => action.status === "done").length,
  };
}
