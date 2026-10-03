"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, File as FileIcon, Link as LinkIcon, LoaderCircle, Search, WandSparkles, X } from "lucide-react";
import { executeAutomationToolAction } from "@/app/actions";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { showToast } from "@/app/_components/ui/toast";
import type { ContentPickerItem } from "@/modules/inbox/service";
import { CONTENT_TO_ACTION_DRAFTS_TOOL_ID } from "@/modules/automations/tools/catalog";

type ToolContentOption = ContentPickerItem & { project_name?: string | null };

export function ContentToActionDraftsLauncher({ contextProjectId, readOnly, onRun }: {
  contextProjectId: string | null; readOnly: boolean; onRun: (runId: string) => void;
}) {
  const router = useRouter();
  const [operationId, setOperationId] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ToolContentOption[]>([]);
  const [selected, setSelected] = useState<ToolContentOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [runFailure, setRunFailure] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const lockedProjectId = contextProjectId ?? selected[0]?.project_id ?? null;
  const lockedProjectName = selected[0]?.project_name ?? null;
  const constrainProject = contextProjectId !== null || selected.length > 0;
  const selectionIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);

  useEffect(() => { setOperationId(crypto.randomUUID()); }, []);

  useEffect(() => {
    const controller = new AbortController(); const timer = window.setTimeout(async () => {
      setLoading(true); setFailed(false);
      try {
        const response = await fetch(optionsUrl({ query, constrainProject, projectId: lockedProjectId }), { signal: controller.signal });
        if (!response.ok) throw new Error("options_failed");
        const payload = await response.json() as { items: ToolContentOption[]; nextCursor: string | null };
        setItems(payload.items); setNextCursor(payload.nextCursor);
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) { setFailed(true); setItems([]); setNextCursor(null); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, constrainProject, lockedProjectId, reloadKey]);

  const toggle = (item: ToolContentOption) => setSelected((current) => current.some((entry) => entry.id === item.id) ? current.filter((entry) => entry.id !== item.id) : [...current, item]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return; setLoadingMore(true); setFailed(false);
    try {
      const response = await fetch(optionsUrl({ query, constrainProject, projectId: lockedProjectId, cursor: nextCursor }));
      if (!response.ok) throw new Error("options_failed");
      const payload = await response.json() as { items: ToolContentOption[]; nextCursor: string | null };
      setItems((current) => [...current, ...payload.items.filter((item) => !current.some((entry) => entry.id === item.id))]);
      setNextCursor(payload.nextCursor);
    } catch { setFailed(true); } finally { setLoadingMore(false); }
  };

  if (readOnly) return <p className="lifecycle-banner">当前专案已归档，不能启动新运行。</p>;
  return <MutationForm action={executeAutomationToolAction} className="tool-launcher-form" onSuccess={({ objectId, status }) => {
    setOperationId(crypto.randomUUID());
    if (status === "failed") {
      const message = "生成行动草稿时发生错误，未创建任何新草稿。";
      setRunFailure(message); router.refresh(); showToast({ title: "自动化运行失败", description: message, tone: "error" });
      return;
    }
    setRunFailure(""); setSelected([]); showToast({ title: "自动化已完成", tone: "success" }); onRun(objectId);
  }}>{({ pending }) => <>
    <input type="hidden" name="operationId" value={operationId} />
    <input type="hidden" name="toolId" value={CONTENT_TO_ACTION_DRAFTS_TOOL_ID} />
    {constrainProject && <input type="hidden" name="projectId" value={lockedProjectId ?? ""} />}
    {selected.map((item) => <input type="hidden" name="contentItemIds" value={item.id} key={item.id} />)}
    <div className="tool-selection-summary"><span>{contextProjectId ? "当前专案" : selected.length ? lockedProjectId ? `已锁定：${lockedProjectName ?? "当前专案"}` : "已锁定：未归入专案" : "选择第一条资料后自动确定专案范围"}</span><strong>{selected.length} 条</strong></div>
    {selected.length > 0 && <div className="tool-selection-chips" aria-label="已选择资料">{selected.map((item) => <span key={item.id}>{item.title}<button type="button" onClick={() => toggle(item)} aria-label={`移除 ${item.title}`} disabled={pending}><X size={12} /></button></span>)}</div>}
    <label className="tool-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索可用资料" aria-label="搜索可用资料" disabled={pending} /></label>
    <div className="tool-input-list" role="listbox" aria-label="可用资料" aria-multiselectable="true" aria-busy={loading || loadingMore}>
      {loading && <p className="tool-input-state" role="status"><LoaderCircle className="ui-spin" size={17} />正在载入…</p>}
      {!loading && failed && <div className="tool-input-state error" role="alert"><span>载入失败。</span><button className="quiet-button" type="button" onClick={() => setReloadKey((value) => value + 1)}>重试</button></div>}
      {!loading && !failed && items.length === 0 && <p className="tool-input-state">没有符合条件的可用资料。</p>}
      {!loading && items.map((item) => <button type="button" role="option" aria-selected={selectionIds.has(item.id)} className={selectionIds.has(item.id) ? "tool-input-option selected" : "tool-input-option"} onClick={() => toggle(item)} disabled={pending} key={item.id}>
        <span className="tool-option-check">{selectionIds.has(item.id) ? <Check size={13} /> : null}</span>{item.kind === "file" ? <FileIcon size={15} /> : <LinkIcon size={15} />}<span><strong>{item.title}</strong><small>{item.project_name ?? "未归入专案"}</small></span>
      </button>)}
    </div>
    {nextCursor && <button className="quiet-button" type="button" onClick={loadMore} disabled={pending || loadingMore}>{loadingMore ? "正在载入…" : "载入更多"}</button>}
    <button className="primary-button tool-run-button" disabled={pending || !operationId || selected.length === 0}>{pending ? <><LoaderCircle className="ui-spin" size={16} />正在生成草稿…</> : <><WandSparkles size={16} />生成草稿</>}</button>
    {runFailure && <div className="mutation-feedback" role="alert"><span>{runFailure}</span></div>}
  </>}</MutationForm>;
}

function optionsUrl(input: { query: string; constrainProject: boolean; projectId: string | null; cursor?: string }) {
  const params = new URLSearchParams({ q: input.query, limit: "24" });
  if (input.constrainProject) { params.set("constrainProject", "1"); if (input.projectId) params.set("projectId", input.projectId); }
  if (input.cursor) params.set("cursor", input.cursor);
  return `/api/automations/tools/${encodeURIComponent(CONTENT_TO_ACTION_DRAFTS_TOOL_ID)}/options?${params}`;
}
