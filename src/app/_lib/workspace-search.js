const statusLabel = {
  inbox: "待整理", processed: "已处理", archived: "已归档",
  draft: "草稿", active: "进行中", done: "已完成", cancelled: "已取消",
  running: "运行中", completed: "完成", failed: "失败",
};

/** Builds a read-only, in-memory index from data already loaded by the workspace shell. */
export function buildWorkspaceSearchEntries({ content, actions, runs }) {
  return [
    ...content.map((item) => ({
      id: `content:${item.id}`, group: "资料", title: item.title,
      meta: `${item.kind === "file" ? "文件" : "链接"} · ${statusLabel[item.status]}`,
      href: `/inbox?selected=${item.id}`, terms: `${item.title} ${item.tags} ${item.kind} ${item.status}`.toLowerCase(),
    })),
    ...actions.map((action) => ({
      id: `action:${action.id}`, group: "行动台", title: action.title,
      meta: `${statusLabel[action.status]} · ${action.due_date ?? "未设截止日期"}`,
      href: `/actions?selected=${action.id}`, terms: `${action.title} ${action.status} ${action.priority} ${action.due_date ?? ""}`.toLowerCase(),
    })),
    ...runs.map((run) => ({
      id: `run:${run.id}`, group: "运行记录", title: run.target_name_snapshot ?? run.input_summary,
      meta: `${statusLabel[run.status]} · ${run.output_summary ?? run.error_message ?? "正在执行"}`,
      href: `/automations?view=runs&selected=${run.id}`, terms: `${run.target_name_snapshot ?? ""} ${run.target_id ?? ""} ${run.input_summary} ${run.output_summary ?? ""} ${run.error_message ?? ""} ${run.status}`.toLowerCase(),
    })),
  ];
}
