"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, ExternalLink, Eye, File as FileIcon, FilePenLine, FilePlus2, Filter, FolderInput, Link as LinkIcon, ListPlus, MessageCircle, Search, Trash2, X } from "lucide-react";
import { createLinkAction, updateContentAction } from "@/app/actions";
import { moveContentResultAction, trashContentAction } from "@/app/resource-actions";
import type { DraftActionForContentItem } from "@/modules/actions/service";
import type { ContentItem } from "@/modules/inbox/service";
import type { Folder as FolderRecord } from "@/modules/projects/folders";
import type { Project } from "@/modules/projects/service";
import type { Tag } from "@/modules/tags/service";
import { CommandTrigger } from "@/app/_components/workspace-shell";
import { uploadSelectedFile } from "@/app/_lib/file-upload-client";
import { QuickViewer } from "@/app/_components/file-viewer/quick-viewer";
import { isEditableTarget } from "@/app/_components/file-viewer/viewer-shell";
import { DestinationBrowser } from "@/app/_components/destination-browser";
import { AlertDialog, Dialog } from "@/app/_components/ui/dialog";
import { EmptyState, Notice } from "@/app/_components/ui/surface";
import { TagPicker } from "@/app/_components/tag-picker";
import { globalWorkspaceContext, workspaceHref, type WorkspaceContext } from "@/app/_lib/workspace-context";
import { detailFormKey } from "@/app/_lib/detail-form-key";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { Select } from "@/app/_components/ui/select";
import { ControlField } from "@/app/_components/ui/field";
import { Menu, MenuItem } from "@/app/_components/ui/menu";
import { Popover } from "@/app/_components/ui/popover";
import { showToast } from "@/app/_components/ui/toast";
import type { ResourceDestination } from "@/app/_lib/resource-navigation";
import { ActionCreateDialog } from "@/app/_components/action/action-create-dialog";
import { ResponsiveInspector } from "@/app/_components/ui/responsive-inspector";
import { useMediaQuery } from "@/app/_lib/use-media-query";
import { InboxProcessingDialog } from "@/app/_components/inbox-processing-dialog";
import { canCreateActionDirectly, canProcessContent, editableContentStatuses } from "@/app/_lib/inbox-processing-ui";

const contentStatus = { inbox: "新资料", processed: "已处理", archived: "已归档" } as const;
type StatusFilter = "all" | ContentItem["status"];
type KindFilter = "all" | ContentItem["kind"];

export function InboxWorkspace({
  items, projects, folders = [], tagsByContent, availableTags, linkedDrafts, integrityProblems, initialCreate, initialSelectedId, initialPreview,
  initialProcessing = false, initialUnclassified = false, context = globalWorkspaceContext, title = "资料库", subtitle = "所有资料的统一入口", showHeader = true, mutable = true,
}: {
  items: ContentItem[]; projects: Project[]; folders?: Array<Pick<FolderRecord, "id" | "project_id" | "parent_id" | "name">>;
  tagsByContent: Record<string, Tag[]>; availableTags: Tag[]; linkedDrafts: DraftActionForContentItem[]; integrityProblems: string[];
  initialCreate: boolean; initialSelectedId?: string; initialPreview: boolean; initialProcessing?: boolean; initialUnclassified?: boolean;
  context?: WorkspaceContext; title?: string; subtitle?: string; showHeader?: boolean; mutable?: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(items.some((item) => item.id === initialSelectedId) ? initialSelectedId ?? "" : "");
  const [askInspectorSuspended, setAskInspectorSuspended] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [unclassifiedOnly, setUnclassifiedOnly] = useState(initialUnclassified);
  const [createOpen, setCreateOpen] = useState(initialCreate);
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [createActionOpen, setCreateActionOpen] = useState(false);
  const [processingOpen, setProcessingOpen] = useState(false);
  const [sourceKind, setSourceKind] = useState<"link" | "file">("file");
  const [previewId, setPreviewId] = useState(initialPreview && initialSelectedId ? initialSelectedId : "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [moveState, setMoveState] = useState<{ destination: ResourceDestination | null; noOp: boolean }>({ destination: null, noOp: false });
  const listRef = useRef<HTMLDivElement>(null);
  const inspectorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const narrowInspector = useMediaQuery("(width < 1200px)");
  useEffect(() => {
    const restoreInspector = () => setAskInspectorSuspended(false);
    window.addEventListener('eremite:ask-closed', restoreInspector);
    return () => window.removeEventListener('eremite:ask-closed', restoreInspector);
  }, []);
  const returnTo = workspaceHref(context, selectedId ? { selected: selectedId } : {});
  const visibleItems = useMemo(() => items.filter((item) =>
    (statusFilter === "all" || item.status === statusFilter)
    && (kindFilter === "all" || item.kind === kindFilter)
    && (!unclassifiedOnly || item.project_id === null)
  ), [items, kindFilter, statusFilter, unclassifiedOnly]);
  const previewableItems = useMemo(() => visibleItems.filter((item) => item.kind === "file"), [visibleItems]);
  const folderPaths = useMemo(() => buildFolderPaths(folders), [folders]);
  const selected = items.find((item) => item.id === selectedId);
  const previewItem = items.find((item) => item.id === previewId);
  const isBroken = Boolean(selected?.storage_key && integrityProblems.includes(selected.storage_key));
  const previewIndex = previewableItems.findIndex((item) => item.id === previewId);
  const activeFilterCount = Number(statusFilter !== "all") + Number(kindFilter !== "all");
  const replaceContextUrl = (id: string, preview: boolean) => router.replace(workspaceHref(context, { selected: id, ...(preview ? { preview: "1" } : {}) }), { scroll: false });
  const openPreview = (id: string) => { setSelectedId(id); setPreviewId(id); replaceContextUrl(id, true); };
  const closePreview = () => { setPreviewId(""); if (selectedId) replaceContextUrl(selectedId, false); };
  const closeCreate = () => { setCreateOpen(false); router.replace(workspaceHref(context)); };
  const closeInspector = () => { setSelectedId(""); setAskInspectorSuspended(false); setEditOpen(false); setMoveOpen(false); setCreateActionOpen(false); setProcessingOpen(false); router.replace(workspaceHref(context)); };
  const closeProcessing = () => { setProcessingOpen(false); if (selectedId) router.replace(workspaceHref(context, { selected: selectedId }), { scroll: false }); };
  const finishProcessing = () => { setProcessingOpen(false); if (selectedId) router.replace(workspaceHref(context, { selected: selectedId }), { scroll: false }); router.refresh(); };
  const openFullViewer = (id: string) => {
    const returnPath = workspaceHref(context, { selected: id });
    sessionStorage.setItem("eremite:library-view-state", JSON.stringify({ statusFilter, kindFilter, unclassifiedOnly, selectedId: id, scrollTop: listRef.current?.scrollTop ?? window.scrollY }));
    sessionStorage.setItem(`eremite:viewer-return:${id}`, returnPath);
    router.push(`/viewer/${encodeURIComponent(id)}`);
  };
  const uploadFile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (uploading) return;
    const form = event.currentTarget; setUploading(true); setUploadError("");
    try {
      const data = new globalThis.FormData(form);
      const result = await uploadSelectedFile({ selectedFile: data.get("file"), title: String(data.get("title") ?? ""), projectId: context.projectId, folderId: context.folderId });
      if (!result.ok) { setUploadError(result.message); return; }
      form.reset(); setCreateOpen(false); setSelectedId(result.contentId);
      router.replace(workspaceHref(context, { selected: result.contentId }), { scroll: false }); router.refresh();
    } catch { setUploadError("上传连接中断。资料库仍可继续使用，请重试。"); }
    finally { setUploading(false); }
  };

  useEffect(() => {
    const stored = sessionStorage.getItem("eremite:library-view-state"); if (!stored || context.scope !== "global") return;
    sessionStorage.removeItem("eremite:library-view-state");
    try {
      const state = JSON.parse(stored) as { statusFilter?: StatusFilter; kindFilter?: KindFilter; unclassifiedOnly?: boolean; selectedId?: string; scrollTop?: number };
      if (state.statusFilter) setStatusFilter(state.statusFilter); if (state.kindFilter) setKindFilter(state.kindFilter);
      if (typeof state.unclassifiedOnly === "boolean") setUnclassifiedOnly(state.unclassifiedOnly);
      if (state.selectedId && items.some((item) => item.id === state.selectedId)) setSelectedId(state.selectedId);
      requestAnimationFrame(() => { if (listRef.current && typeof state.scrollTop === "number") listRef.current.scrollTop = state.scrollTop; });
    } catch { /* Optional transient state. */ }
  }, [context.scope, items]);
  useEffect(() => { if (initialCreate) setCreateOpen(true); }, [initialCreate]);
  useEffect(() => { if (initialProcessing && selected?.status === "inbox") setProcessingOpen(true); }, [initialProcessing, selected?.id, selected?.status]);
  useEffect(() => {
    if (!previewId) return;
    const navigatePreview = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); const next = previewableItems[previewIndex + (event.key === "ArrowUp" ? -1 : 1)]; if (next) openPreview(next.id);
    };
    window.addEventListener("keydown", navigatePreview); return () => window.removeEventListener("keydown", navigatePreview);
  });
  return <section className="workspace-view library-view">
    {showHeader && <header className="workspace-toolbar"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="toolbar-actions"><CommandTrigger />{mutable && <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><FilePlus2 size={17} />新建资料</button>}</div></header>}
    {integrityProblems.length > 0 && <Notice kind="error">发现 {integrityProblems.length} 个资料文件缺失、不可读或校验失败。请检查本地存储或从备份恢复。</Notice>}
    <div className={`${selected ? "workspace-split has-detail" : "workspace-split"}${previewId ? " previewing" : ""}`}>
      <div className="list-workspace" ref={listRef}>
        <div className="resource-list-toolbar">
          <div className="resource-scopes"><button className={!unclassifiedOnly ? "filter active" : "filter"} onClick={() => setUnclassifiedOnly(false)}>全部 <span>{items.length}</span></button>{context.scope === "global" && <button className={unclassifiedOnly ? "filter active" : "filter"} onClick={() => setUnclassifiedOnly(true)}>未归入专案 <span>{items.filter((item) => !item.project_id).length}</span></button>}</div>
          <div className="resource-list-actions"><a className="quiet-button" href={context.scope === "global" ? "/search" : `/search?scope=${context.scope}&projectId=${context.projectId ?? ""}${context.folderId ? `&folderId=${context.folderId}` : ""}`}><Search size={15} />搜索</a><Popover label="筛选资料" placement="bottom-end" trigger={({ focusTrigger: _focusTrigger, ...props }) => <button {...props} className={activeFilterCount ? "quiet-button active" : "quiet-button"}><Filter size={15} />筛选{activeFilterCount ? ` ${activeFilterCount}` : ""}</button>}><div className="resource-filter-popover"><ControlField label="状态"><Select label="资料状态" value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)} options={[{ value: "all", label: "所有状态" }, { value: "inbox", label: "新资料" }, { value: "processed", label: "已处理" }, { value: "archived", label: "已归档" }]} /></ControlField><ControlField label="类型"><Select label="资料类型" value={kindFilter} onValueChange={(value) => setKindFilter(value as KindFilter)} options={[{ value: "all", label: "所有类型" }, { value: "file", label: "文件" }, { value: "link", label: "链接" }]} /></ControlField>{activeFilterCount > 0 && <button className="quiet-button" type="button" onClick={() => { setStatusFilter("all"); setKindFilter("all"); }}>清除筛选</button>}</div></Popover></div>
        </div>
        {items.length === 0 ? <EmptyState title="还没有资料" description="上传文件或保存链接。你可以先收集，再随时整理到专案与文件夹。" action={mutable ? <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>新建资料</button> : undefined} /> : <div className="data-list"><div className="list-heading"><span className="content-heading"><i aria-hidden="true" /><span>资料</span></span><span>位置</span><span>状态</span><span>最近修改</span></div>{visibleItems.map((item) => {
          const location = contentLocation(item, projects, folderPaths);
          const itemTags = tagsByContent[item.id] ?? [];
          return <button className={item.id === selectedId ? "content-row selected" : "content-row"} aria-pressed={item.id === selectedId} key={item.id} onClick={(event) => { inspectorTriggerRef.current = event.currentTarget; setSelectedId(item.id); setPreviewId(""); replaceContextUrl(item.id, false); }} onDoubleClick={() => item.kind === "file" && openFullViewer(item.id)} onKeyDown={(event) => { if (event.key === "F2" && mutable) { event.preventDefault(); inspectorTriggerRef.current = event.currentTarget; setSelectedId(item.id); setEditOpen(true); return; } if (item.kind !== "file") return; if (event.key === " ") { event.preventDefault(); openPreview(item.id); } if (event.key === "Enter") { event.preventDefault(); openFullViewer(item.id); } }}>
            <span className="content-primary"><span className="resource-icon">{item.kind === "file" ? <FileIcon size={17} /> : <LinkIcon size={17} />}</span><span><strong title={item.title}>{item.title}</strong>{itemTags.length > 0 && <small>{itemTags.slice(0, 3).map((tag) => tag.name).join(" · ")}{itemTags.length > 3 ? ` +${itemTags.length - 3}` : ""}</small>}</span></span>
            <span className="location-text" title={location}>{location}</span><span className="status-text">{contentStatus[item.status]}</span><time>{new Date(item.updated_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
          </button>;
        })}{visibleItems.length === 0 && <div className="filtered-empty">没有符合当前筛选条件的资料。</div>}</div>}
      </div>
      {previewId ? <QuickViewer key={previewId} contentId={previewId} returnHref={workspaceHref(context, { selected: previewId })} onClose={closePreview} onPrevious={previewIndex > 0 ? () => openPreview(previewableItems[previewIndex - 1].id) : undefined} onNext={previewIndex >= 0 && previewIndex < previewableItems.length - 1 ? () => openPreview(previewableItems[previewIndex + 1].id) : undefined} onProcessContent={mutable && previewItem?.status === "inbox" ? () => setProcessingOpen(true) : undefined} onCreateAction={mutable && previewItem && canCreateActionDirectly(previewItem.status) ? () => setCreateActionOpen(true) : undefined} /> : selected && <ResponsiveInspector label={`${selected.title} 资料详情`} className="detail-panel resource-inspector" modal={narrowInspector && !askInspectorSuspended} triggerRef={inspectorTriggerRef} onClose={closeInspector} key={detailFormKey(selected)}>
         <header className="inspector-header"><div className="detail-title"><span>{selected.kind === "file" ? <FileIcon size={18} /> : <LinkIcon size={18} />}</span><div><h2>{selected.title}</h2><small>{selected.kind === "file" ? formatBytes(selected.byte_size) : "网页链接"}</small></div></div><div className="inspector-header-actions"><button className="quiet-button" type="button" onClick={() => { setAskInspectorSuspended(true); window.dispatchEvent(new Event('eremite:open-ask-from-inspector')); }} aria-label="基于当前资料打开 Ask Eremite"><MessageCircle size={16} />Ask</button>{mutable && <Menu label="资料操作"><MenuItem onClick={() => setEditOpen(true)}><FilePenLine size={15} />编辑资料</MenuItem><MenuItem onClick={() => setMoveOpen(true)}><FolderInput size={15} />移动位置</MenuItem>{canProcessContent(selected.status) ? <MenuItem onClick={() => setProcessingOpen(true)}><CheckCircle2 size={15} />处理资料</MenuItem> : <MenuItem onClick={() => setCreateActionOpen(true)}><ListPlus size={15} />创建行动</MenuItem>}<MenuItem danger onClick={() => setTrashOpen(true)}><Trash2 size={15} />移到回收站</MenuItem></Menu>}<button data-inspector-initial-focus className="icon-button" type="button" onClick={closeInspector} aria-label="关闭详情"><X size={18} /></button></div></header>
         {mutable && canProcessContent(selected.status) && <div className="inspector-primary-actions"><button className="primary-button" type="button" onClick={() => setProcessingOpen(true)}><CheckCircle2 size={16} />处理资料</button></div>}
        {isBroken ? <div className="detail-error"><strong>无法打开原始文件</strong><p>存储文件缺失或校验失败。请从备份恢复后重试。</p></div> : selected.kind === "file" ? <div className="inspector-primary-actions"><button className="primary-button" type="button" onClick={() => openPreview(selected.id)}><Eye size={16} />快速预览</button><a className="quiet-button" href={`/files/${selected.id}/download`}><Download size={16} />下载</a></div> : <a className="source-link" href={selected.source_url ?? "#"} target="_blank" rel="noreferrer"><ExternalLink size={16} />打开原始链接</a>}
        <section className="inspector-section"><h3>信息</h3><dl className="read-details"><div><dt>位置</dt><dd>{contentLocation(selected, projects, folderPaths)}</dd></div><div><dt>状态</dt><dd>{contentStatus[selected.status]}</dd></div><div><dt>最近修改</dt><dd>{new Date(selected.updated_at).toLocaleString("zh-CN")}</dd></div></dl></section>
        <section className="inspector-section"><TagPicker type="content" objectId={selected.id} assigned={tagsByContent[selected.id] ?? []} available={availableTags} returnTo={returnTo} readOnly={!mutable} /></section>
       </ResponsiveInspector>}
    </div>
    <Dialog open={createOpen} onClose={closeCreate} title="新建资料" description={context.scope === "global" ? "先保存到资料库，之后可随时整理位置。" : context.scope === "folder" ? "将自动保存到当前文件夹。" : "将自动保存到当前专案。"}><div className="drawer-tabs"><button type="button" className={sourceKind === "file" ? "active" : ""} onClick={() => setSourceKind("file")}>上传文件</button><button type="button" className={sourceKind === "link" ? "active" : ""} onClick={() => setSourceKind("link")}>保存链接</button></div>{sourceKind === "file" ? <form onSubmit={uploadFile} className="drawer-form"><label>文件<input autoFocus name="file" type="file" required disabled={uploading} /></label><label>显示标题（可选）<input name="title" disabled={uploading} /></label><small className="upload-limit">单个文件最大 512 MiB；上传失败不会留下不完整资料。</small>{uploadError && <div className="upload-error" role="alert">{uploadError}</div>}<button className="primary-button" disabled={uploading}>{uploading ? "正在上传…" : "保存资料"}</button></form> : <MutationForm action={createLinkAction} className="drawer-form" onSuccess={({ objectId }, form) => { form.reset(); setCreateOpen(false); setSelectedId(objectId); router.replace(workspaceHref(context, { selected: objectId }), { scroll: false }); router.refresh(); }}>{({ pending }) => <><input type="hidden" name="projectId" value={context.projectId ?? ""} /><input type="hidden" name="folderId" value={context.folderId ?? ""} /><label>链接<input autoFocus name="url" type="url" placeholder="https://" required disabled={pending} /></label><label>标题（可选）<input name="title" disabled={pending} /></label><label>标签（可选）<input name="tags" placeholder="例如：参考, 重要" disabled={pending} /></label><button className="primary-button" disabled={pending}>{pending ? "正在保存…" : "保存资料"}</button></>}</MutationForm>}</Dialog>
    <Dialog open={editOpen && Boolean(selected)} onClose={() => setEditOpen(false)} title="编辑资料" description={selected?.status === "inbox" ? "修改显示名称；新资料请通过处理资料完成整理。" : "修改显示名称或生命周期状态。"}>{selected && <MutationForm key={detailFormKey(selected)} action={updateContentAction} className="drawer-form" onSuccess={() => { setEditOpen(false); router.refresh(); }} onConflict={() => router.refresh()} successMessage="资料已保存">{({ pending }) => <><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} /><input type="hidden" name="tags" value={(tagsByContent[selected.id] ?? []).map((tag) => tag.name).join(", ")} /><label>标题<input data-dialog-initial-focus name="title" defaultValue={selected.title} required disabled={pending} /></label>{selected.status === "inbox" ? <><input type="hidden" name="status" value="inbox" /><p className="lifecycle-note">新资料请通过“处理资料”完成整理。</p></> : <ControlField label="资料状态"><Select name="status" label="资料状态" defaultValue={selected.status} disabled={pending} options={editableContentStatuses(selected.status).map((status) => ({ value: status, label: contentStatus[status] }))} /></ControlField>}<div className="dialog-actions"><button type="button" className="quiet-button" onClick={() => setEditOpen(false)}>取消</button><button className="primary-button" disabled={pending}>{pending ? "正在保存…" : "保存"}</button></div></>}</MutationForm>}</Dialog>
    <Dialog open={moveOpen && Boolean(selected)} onClose={() => setMoveOpen(false)} title="移动资料" description="浏览并选择新的位置；资料与版本记录不会产生副本。" className="destination-dialog">{selected && <><DestinationBrowser projects={projects} allowUnassigned original={{ projectId: selected.project_id, folderId: selected.folder_id }} formId="move-content-form" onDestinationChange={setMoveState} /><MutationForm id="move-content-form" action={moveContentResultAction} className="destination-actions" onSuccess={() => { const label = moveState.destination?.label ?? "所选位置"; setMoveOpen(false); showToast({ title: `已移到 ${label}`, tone: "success" }); router.refresh(); }} onConflict={() => router.refresh()}>{({ pending }) => <><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} /><div className="dialog-actions"><button type="button" className="quiet-button" onClick={() => setMoveOpen(false)}>取消</button><button className="primary-button" disabled={pending || !moveState.destination || moveState.noOp}>{pending ? "正在移动…" : moveState.noOp ? "已在此位置" : "移到这里"}</button></div></>}</MutationForm></>}</Dialog>
    {selected && <InboxProcessingDialog open={mutable && processingOpen && canProcessContent(selected.status)} onClose={closeProcessing} onProcessed={finishProcessing} content={selected} drafts={linkedDrafts.filter((draft) => draft.content_item_id === selected.id)} projects={projects} />}
    <ActionCreateDialog open={mutable && createActionOpen && Boolean(selected) && Boolean(selected && canCreateActionDirectly(selected.status))} onClose={() => setCreateActionOpen(false)} projects={projects} availableTags={availableTags} sourceContent={selected ?? null} onCreated={(id) => { setCreateActionOpen(false); showToast({ title: "行动已创建", tone: "success", action: { label: "查看行动", href: `/actions?selected=${encodeURIComponent(id)}` } }); router.refresh(); }} />
    <AlertDialog open={trashOpen && Boolean(selected)} onClose={() => setTrashOpen(false)} title="将资料移到回收站？" description="资料会从资料库与专案视图中隐藏，版本记录会保留，可从回收站恢复。" className="danger-dialog">{selected && <form action={trashContentAction} className="drawer-form"><input type="hidden" name="id" value={selected.id} /><input type="hidden" name="revision" value={selected.revision} /><input type="hidden" name="returnTo" value={workspaceHref(context)} /><p className="confirmation-name">{selected.title}</p><div className="dialog-actions"><button data-dialog-initial-focus className="quiet-button" type="button" onClick={() => setTrashOpen(false)}>取消</button><button className="danger-button">移到回收站</button></div></form>}</AlertDialog>
  </section>;
}

function buildFolderPaths(folders: Array<Pick<FolderRecord, "id" | "parent_id" | "name">>) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return new Map(folders.map((folder) => {
    const names: string[] = []; const seen = new Set<string>(); let current: Pick<FolderRecord, "id" | "parent_id" | "name"> | undefined = folder;
    while (current && !seen.has(current.id)) { seen.add(current.id); names.unshift(current.name); current = current.parent_id ? byId.get(current.parent_id) : undefined; }
    return [folder.id, names.join(" / ")] as const;
  }));
}

function contentLocation(item: Pick<ContentItem, "project_id" | "folder_id">, projects: Project[], folderPaths: Map<string, string>) {
  if (!item.project_id) return "未归入专案";
  const projectName = projects.find((project) => project.id === item.project_id)?.name ?? "专案不可用";
  const folderPath = item.folder_id ? folderPaths.get(item.folder_id) : null;
  return folderPath ? `${projectName} / ${folderPath}` : projectName;
}

function formatBytes(value: number | null) {
  if (value === null) return "文件";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
