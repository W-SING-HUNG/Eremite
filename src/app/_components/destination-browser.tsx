"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, FolderPlus, FolderRoot, Inbox, RotateCcw } from "lucide-react";
import type { Project } from "@/modules/projects/service";
import { createFolderAction } from "@/app/resource-actions";
import { Dialog } from "@/app/_components/ui/dialog";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { EmptyState, Notice } from "@/app/_components/ui/surface";
import { isSameDestination, serializeDestination, type ResourceDestination } from "@/app/_lib/resource-navigation";

type BrowserFolder = { id: string; name: string; path: string };
type BrowserCrumb = { id: string; name: string };

export function DestinationBrowser({
  projects, allowUnassigned = false, excludeFolderId, original, formId, onDestinationChange,
}: {
  projects: Project[];
  allowUnassigned?: boolean;
  excludeFolderId?: string;
  original: { projectId?: string | null; folderId?: string | null };
  formId: string;
  onDestinationChange?: (state: { destination: ResourceDestination | null; noOp: boolean }) => void;
}) {
  const activeProjects = useMemo(() => projects.filter((project) => !project.archived_at && !project.trashed_at), [projects]);
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<BrowserFolder[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BrowserCrumb[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const project = activeProjects.find((entry) => entry.id === projectId);
  const locationParts = project ? [project.name, ...breadcrumbs.map((entry) => entry.name)] : [];
  const destination: ResourceDestination | null = projectId === undefined
    ? null
    : projectId === null
      ? { projectId: null, folderId: null, label: "未归入专案" }
      : { projectId, folderId, label: locationParts.join(" / ") || project?.name || "所选位置" };
  const noOp = destination ? isSameDestination(destination, original) : false;

  useEffect(() => {
    onDestinationChange?.({ destination, noOp });
  }, [destination?.projectId, destination?.folderId, destination?.label, noOp, onDestinationChange]);

  useEffect(() => {
    if (!projectId) { setFolders([]); setBreadcrumbs([]); setLoading(false); setError(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(false);
    const search = new URLSearchParams({ projectId });
    if (folderId) search.set("parentId", folderId);
    if (excludeFolderId) search.set("exclude", excludeFolderId);
    fetch(`/api/folders/destinations?${search}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("destination_failed")))
      .then((payload: { folders: BrowserFolder[]; breadcrumbs: BrowserCrumb[] }) => {
        setFolders(payload.folders); setBreadcrumbs(payload.breadcrumbs);
      })
      .catch((reason) => { if (!(reason instanceof Error && reason.name === "AbortError")) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [excludeFolderId, folderId, projectId, reloadKey]);

  const enterProject = (id: string) => { setProjectId(id); setFolderId(null); setBreadcrumbs([]); };
  const enterFolder = (id: string) => setFolderId(id);
  const goUp = () => {
    if (!projectId) { setProjectId(undefined); return; }
    if (!folderId) { setProjectId(undefined); return; }
    setFolderId(breadcrumbs.length > 1 ? breadcrumbs.at(-2)?.id ?? null : null);
  };

  return <div className="destination-browser">
    <input form={formId} type="hidden" name="destination" value={destination ? serializeDestination(destination) : ""} />
    <div className="destination-browser__toolbar">
      <button className="icon-button" type="button" aria-label="返回上一级" disabled={projectId === undefined} onClick={goUp}><ArrowLeft size={16} /></button>
      <nav aria-label="目标位置路径">
        <button type="button" onClick={() => setProjectId(undefined)}>所有位置</button>
        {project && <><ChevronRight size={13} aria-hidden="true" /><button type="button" onClick={() => setFolderId(null)}>{project.name}</button></>}
        {breadcrumbs.map((entry) => <span key={entry.id}><ChevronRight size={13} aria-hidden="true" /><button type="button" aria-current={entry.id === folderId ? "location" : undefined} onClick={() => setFolderId(entry.id)}>{entry.name}</button></span>)}
      </nav>
      {projectId && <button className="quiet-button destination-new-folder" type="button" onClick={() => setCreateOpen(true)}><FolderPlus size={15} />新建文件夹</button>}
    </div>
    <div className="destination-browser__list" role="listbox" aria-label="可选位置" aria-busy={loading}>
      {projectId === undefined && <>
        {allowUnassigned && <button type="button" role="option" aria-selected={projectId === null} onClick={() => setProjectId(null)}><span className="resource-icon"><Inbox size={18} /></span><span><strong>未归入专案</strong><small>保留在资料库中，稍后再整理</small></span></button>}
        {activeProjects.map((entry) => <button type="button" role="option" aria-selected={false} key={entry.id} onClick={() => enterProject(entry.id)}><span className="resource-icon"><FolderRoot size={18} /></span><span><strong>{entry.name}</strong><small>浏览专案中的文件夹</small></span><ChevronRight size={16} /></button>)}
      </>}
      {projectId === null && <div className="destination-browser__selected"><Inbox size={22} /><strong>未归入专案</strong><span>资料仍会保留在全局资料库。</span></div>}
      {projectId && loading && <div className="destination-browser__loading" role="status">正在读取文件夹…</div>}
      {projectId && error && <Notice kind="error"><span>无法读取这个位置。</span><button className="quiet-button" type="button" onClick={() => setReloadKey((value) => value + 1)}><RotateCcw size={14} />重试</button></Notice>}
      {projectId && !loading && !error && folders.map((entry) => <button type="button" role="option" aria-selected={false} key={entry.id} onClick={() => enterFolder(entry.id)}><span className="resource-icon"><Folder size={18} /></span><span><strong>{entry.name}</strong><small>{entry.path}</small></span><ChevronRight size={16} /></button>)}
      {projectId && !loading && !error && folders.length === 0 && <EmptyState title="这里没有子文件夹" description="可以直接移到当前位置，或新建文件夹后继续。" />}
    </div>
    <div className="destination-browser__summary" aria-live="polite"><span>将移到</span><strong>{destination?.label ?? "请选择位置"}</strong>{noOp && <small>当前就在这里</small>}</div>
    <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="新建文件夹" description={`创建在 ${destination?.label ?? "当前位置"}`}>
      <MutationForm action={createFolderAction} className="drawer-form" onSuccess={({ objectId }, form) => { form.reset(); setCreateOpen(false); setFolderId(objectId); setReloadKey((value) => value + 1); }}>
        {({ pending }) => <><input type="hidden" name="projectId" value={projectId ?? ""} /><input type="hidden" name="parentId" value={folderId ?? ""} /><label>名称<input data-dialog-initial-focus name="name" required maxLength={255} disabled={pending} /></label><button className="primary-button" disabled={pending}>{pending ? "正在创建…" : "创建并进入"}</button></>}
      </MutationForm>
    </Dialog>
  </div>;
}
