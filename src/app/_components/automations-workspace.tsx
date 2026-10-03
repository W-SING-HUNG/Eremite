"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Clock3, History, Trash2, WandSparkles, Wrench, X } from "lucide-react";
import { CommandTrigger } from "@/app/_components/workspace-shell";
import { getClientTool } from "@/app/_components/automations/tool-ui-registry";
import { trashAutomationAction } from "@/app/resource-actions";
import { TagPicker } from "@/app/_components/tag-picker";
import { AlertDialog } from "@/app/_components/ui/dialog";
import { ResponsiveInspector } from "@/app/_components/ui/responsive-inspector";
import { useMediaQuery } from "@/app/_lib/use-media-query";
import type { AutomationRun, AutomationRunStatus } from "@/modules/automations/service";
import type { ToolMetadata } from "@/modules/automations/tools/catalog";
import type { Tag } from "@/modules/tags/service";

const runLabel: Record<AutomationRunStatus, string> = { running: "运行中", completed: "完成", failed: "失败" };
type ViewMode = "tools" | "runs";

export function AutomationsWorkspace({
  tools, tagsByRun, availableTags, runs, initialView = "tools", initialToolId, initialSelectedId,
  contextProjectId = null, compactHeader = false, readOnly = false,
}: {
  tools: ToolMetadata[]; tagsByRun: Record<string, Tag[]>; availableTags: Tag[]; runs: AutomationRun[];
  initialView?: ViewMode; initialToolId?: string; initialSelectedId?: string;
  contextProjectId?: string | null; compactHeader?: boolean; readOnly?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>(initialSelectedId ? "runs" : initialToolId ? "tools" : initialView);
  const [toolId, setToolId] = useState(tools.some((tool) => tool.id === initialToolId) ? initialToolId! : tools[0]?.id ?? "");
  const [selectedRunId, setSelectedRunId] = useState(runs.some((run) => run.id === initialSelectedId) ? initialSelectedId! : runs[0]?.id ?? "");
  const [statusFilter, setStatusFilter] = useState<"all" | AutomationRunStatus>("all");
  const [trashOpen, setTrashOpen] = useState(false);
  const narrowInspector = useMediaQuery("(max-width: 1199px)");
  const runTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedTool = tools.find((tool) => tool.id === toolId) ?? null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const visibleRuns = useMemo(() => statusFilter === "all" ? runs : runs.filter((run) => run.status === statusFilter), [runs, statusFilter]);
  useEffect(() => {
    if (initialSelectedId && runs.some((run) => run.id === initialSelectedId)) {
      setSelectedRunId(initialSelectedId); setView("runs"); return;
    }
    if (initialToolId && tools.some((tool) => tool.id === initialToolId)) {
      setToolId(initialToolId); setView("tools"); return;
    }
    setView(initialView);
  }, [initialSelectedId, initialToolId, initialView, runs, tools]);
  const basePath = contextProjectId ? `/projects/${contextProjectId}?tab=automations` : "/automations";
  const returnTo = selectedRun ? `${basePath}${basePath.includes("?") ? "&" : "?"}view=runs&selected=${selectedRun.id}` : `${basePath}${basePath.includes("?") ? "&" : "?"}view=runs`;
  const changeView = (next: ViewMode) => {
    setView(next);
    router.replace(`${basePath}${basePath.includes("?") ? "&" : "?"}view=${next}${next === "tools" && toolId ? `&tool=${encodeURIComponent(toolId)}` : ""}`);
  };
  const selectRun = (runId: string) => {
    setSelectedRunId(runId);
    router.replace(`${basePath}${basePath.includes("?") ? "&" : "?"}view=runs&selected=${runId}`);
  };
  const closeRun = () => {
    const returnRunId = selectedRunId;
    setSelectedRunId("");
    router.replace(`${basePath}${basePath.includes("?") ? "&" : "?"}view=runs`);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-run-id="${CSS.escape(returnRunId)}"]`)?.focus();
    }));
  };
  const openRun = (runId: string) => {
    setView("runs"); setSelectedRunId(runId);
    router.replace(`${basePath}${basePath.includes("?") ? "&" : "?"}view=runs&selected=${runId}`);
    router.refresh();
  };

  return <section className="workspace-view automations-view">
    {!compactHeader && <header className="workspace-toolbar"><div><h1>自动化中心</h1><p>使用个人工具，并查看已经发生的运行记录。</p></div><CommandTrigger /></header>}
    <div className="automation-view-tabs" role="tablist" aria-label="自动化中心视图">
      <button role="tab" aria-selected={view === "tools"} className={view === "tools" ? "selected" : ""} onClick={() => changeView("tools")}><Wrench size={15} />工具</button>
      <button role="tab" aria-selected={view === "runs"} className={view === "runs" ? "selected" : ""} onClick={() => changeView("runs")}><History size={15} />运行记录 <span>{runs.length}</span></button>
    </div>
    {view === "tools" ? <div className="automation-tools-layout" data-tool-count={tools.length}>
      <section className="tool-list-panel" aria-label="工具">
        <div className="tool-list-heading"><span>工具</span><small>{tools.length}</small></div>
        {tools.map((tool) => <button className={tool.id === toolId ? "tool-list-row selected" : "tool-list-row"} aria-pressed={tool.id === toolId} onClick={() => { setToolId(tool.id); router.replace(`${basePath}${basePath.includes("?") ? "&" : "?"}view=tools&tool=${encodeURIComponent(tool.id)}`); }} key={tool.id}><span><WandSparkles size={17} /></span><span><strong>{tool.name}</strong><small>{tool.description}</small></span><span>{tool.category}</span></button>)}
      </section>
      <section className="tool-launcher-panel">
        {selectedTool ? <ToolLauncher tool={selectedTool} contextProjectId={contextProjectId} readOnly={readOnly} onRun={openRun} /> : <div className="panel-empty">当前没有可用工具。</div>}
      </section>
    </div> : <div className={selectedRun ? "automation-runs-layout has-detail" : "automation-runs-layout"}>
      <section className="runs-panel">
        <div className="run-filterbar" role="group" aria-label="运行状态筛选">{(["all", "completed", "failed", "running"] as const).map((status) => <button className={statusFilter === status ? "selected" : ""} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)} key={status}>{status === "all" ? "全部" : runLabel[status]}</button>)}</div>
        {visibleRuns.length === 0 ? <div className="panel-empty"><History size={28} /><strong>还没有运行记录</strong><span>运行工具后，结果会保留在这里。</span></div> : <div className="run-history" role="list">{visibleRuns.map((run) => <button data-run-id={run.id} role="listitem" key={run.id} className={run.id === selectedRunId ? "run-row selected" : "run-row"} aria-pressed={run.id === selectedRunId} onClick={(event) => { runTriggerRef.current = event.currentTarget; selectRun(run.id); }}><span className={`run-dot ${run.status}`} /><span><strong>{run.target_name_snapshot}</strong><small>{run.output_summary ?? run.input_summary}</small></span><span><time>{new Date(run.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><small>{runLabel[run.status]}</small></span></button>)}</div>}
      </section>
      {selectedRun && <RunInspector run={selectedRun} tags={tagsByRun[selectedRun.id] ?? []} availableTags={availableTags} returnTo={returnTo} readOnly={readOnly} modal={narrowInspector} triggerRef={runTriggerRef} onClose={closeRun} onTrash={() => setTrashOpen(true)} />}
    </div>}
    <AlertDialog open={!readOnly && trashOpen && Boolean(selectedRun)} onClose={() => setTrashOpen(false)} title="将运行记录移到回收站？" description="记录会从全局与专案视图隐藏，执行来源仍作为历史事实保留。" className="danger-dialog">{selectedRun && <form action={trashAutomationAction} className="drawer-form"><input type="hidden" name="id" value={selectedRun.id} /><input type="hidden" name="revision" value={selectedRun.revision} /><input type="hidden" name="returnTo" value={basePath} /><p className="confirmation-name">{selectedRun.target_name_snapshot}</p><div className="dialog-actions"><button data-dialog-initial-focus className="quiet-button" type="button" onClick={() => setTrashOpen(false)}>取消</button><button className="danger-button"><Trash2 size={15} />移到回收站</button></div></form>}</AlertDialog>
  </section>;
}

function ToolLauncher({ tool, contextProjectId, readOnly, onRun }: { tool: ToolMetadata; contextProjectId: string | null; readOnly: boolean; onRun: (id: string) => void }) {
  const registration = getClientTool(tool.id);
  if (!registration) return <div className="panel-empty">这个工具当前不可用。</div>;
  const Launcher = registration.Launcher;
  return <><header className="tool-launcher-header"><span><WandSparkles size={19} /></span><div><small>{tool.category}</small><h2>{tool.name}</h2><p>{tool.description}</p></div></header><Launcher contextProjectId={contextProjectId} readOnly={readOnly} onRun={onRun} /></>;
}

function RunInspector({ run, tags, availableTags, returnTo, readOnly, modal, triggerRef, onClose, onTrash }: { run: AutomationRun; tags: Tag[]; availableTags: Tag[]; returnTo: string; readOnly: boolean; modal: boolean; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void; onTrash: () => void }) {
  const duration = run.completed_at ? Math.max(0, new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()) : null;
  const resultRegistration = getClientTool(run.target_id);
  const ResultRenderer = resultRegistration && "ResultRenderer" in resultRegistration ? resultRegistration.ResultRenderer as ComponentType<{ run: AutomationRun }> : undefined;
  return <ResponsiveInspector label="运行详情" className="run-inspector" modal={modal} triggerRef={triggerRef} onClose={onClose}>
    <header><div><span className={`run-state ${run.status}`}>{run.status === "failed" ? <CircleAlert size={15} /> : run.status === "completed" ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{runLabel[run.status]}</span><h2>{run.target_name_snapshot}</h2></div><button data-run-inspector-initial-focus className="detail-close" type="button" onClick={onClose} aria-label="关闭详情"><X size={18} /></button></header>
    <section><h3>结果</h3>{ResultRenderer && run.status === "completed" ? <ResultRenderer run={run} /> : <p className={run.status === "failed" ? "run-error-copy" : "run-result-copy"}>{run.error_message ?? run.output_summary ?? "正在执行…"}</p>}</section>
    <section><h3>运行信息</h3><dl className="run-facts"><div><dt>输入</dt><dd>{run.input_summary}</dd></div><div><dt>运行时专案</dt><dd>{run.project_name_snapshot ?? "未归入专案"}</dd></div><div><dt>开始</dt><dd>{new Date(run.created_at).toLocaleString("zh-CN")}</dd></div>{duration !== null && <div><dt>耗时</dt><dd>{duration < 1000 ? "不足 1 秒" : `${Math.round(duration / 1000)} 秒`}</dd></div>}<div><dt>版本</dt><dd>v{run.target_version}</dd></div></dl></section>
    <TagPicker type="automation_run" objectId={run.id} assigned={tags} available={availableTags} returnTo={returnTo} readOnly={readOnly} />
    {!readOnly && <button className="quiet-button danger-text" type="button" onClick={onTrash}><Trash2 size={14} />移到回收站</button>}
  </ResponsiveInspector>;
}
