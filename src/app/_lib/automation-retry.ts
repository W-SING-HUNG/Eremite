export function automationRetryMessage(reason: string | null) {
  switch (reason) {
    case "retry_snapshot_incomplete": return "这次运行未保留完整的重试依据，请从工具页重新选择文件运行。";
    case "retry_stale_source": return "来源文件或资料已变化，不能按原输入重试。";
    case "retry_stale_tool": return "当前工具与原运行契约不兼容，不能重试。";
    case "retry_stale_destination": return "原输出位置已变化或不可用，不能重试。";
    case "retry_output_exists": return "这次运行已进入结果提交阶段，不能重试。";
    case "retry_history_required": return "这条记录属于重试历史，只能移到回收站，不能永久删除。";
    default: return "当前运行不能重试。";
  }
}

export function automationRetryConfirmation(payloadJson: string) {
  try {
    const value = JSON.parse(payloadJson);
    const evidence = value.retryEvidence;
    const sourceNames = evidence.sources.map((source: { originalName: string }) => source.originalName).join("、");
    const destination = evidence.destination;
    let location: string;
    if (evidence.schemaVersion === 2) {
      if ((destination.projectId !== null && typeof destination.projectId !== "string")
        || (destination.folderId !== null && typeof destination.folderId !== "string")) return null;
      if (destination.projectId === null) {
        if (destination.folderId !== null) return null;
        location = "未归入专案";
      } else {
        const projectName = destination.projectName || "原专案（名称未记录）";
        const snapshot = value.destination?.projectId === destination.projectId && value.destination?.folderId === destination.folderId
          ? value.destination.folderNameSnapshot : null;
        location = destination.folderId === null ? `${projectName} / 专案根目录`
          : typeof snapshot === "string" && snapshot.trim() ? `${projectName} · 文件夹：${snapshot}（完整路径未记录）`
            : `${projectName} · 原文件夹（名称及完整路径未记录）`;
      }
    } else {
      location = destination.projectName ? [destination.projectName, ...destination.folders.map((folder: { name: string }) => folder.name)].join(" / ") : "未归入专案";
    }
    const p = value.parameters;
    const pageList = (pages: number[]) => pages.map(page => page + 1).join("、");
    const conversion = typeof value.conversionId === "string" ? value.conversionId.split("-to-").map((format: string) => format.toUpperCase()).join(" → ") : "";
    const profiles: Record<string, string> = { balanced: "均衡", standard: "标准", quality: "高质量", compact: "紧凑" };
    const parameters = value.conversionId ? `转换：${conversion}；方式：${profiles[value.profile] ?? value.profile}`
      : p?.strategy ? `每份 ${p.strategy.n} 页` : p?.pageSelector ? `提取页码：${pageList(p.pageSelector.pages)}`
        : p?.pages ? `旋转页码：${pageList(p.pages.pages)}；${p.angle}°；${p.mode === "relative" ? "相对" : "绝对"}`
          : p?.pageOrder ? `页面顺序：${pageList(p.pageOrder)}` : "按原顺序合并";
    return { sourceNames, location, parameters };
  } catch { return null; }
}
