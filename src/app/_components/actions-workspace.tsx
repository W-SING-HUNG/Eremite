"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, CheckCircle2, Circle, File as FileIcon, Flag, Link as LinkIcon, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { acceptActionDraftAction, replaceActionContentItemsAction, updateActionDetailsAction, updateActionStatusAction } from "@/app/actions";
import { trashActionAction } from "@/app/resource-actions";
import { ActionCreateDialog } from "@/app/_components/action/action-create-dialog";
import { ContentRelationPicker } from "@/app/_components/action/content-relation-picker";
import { DatePicker } from "@/app/_components/action/date-picker";
import { PriorityPicker, priorityLabel } from "@/app/_components/action/priority-picker";
import { ProjectPicker } from "@/app/_components/action/project-picker";
import { CommandTrigger } from "@/app/_components/workspace-shell";
import { TagPicker } from "@/app/_components/tag-picker";
import { AlertDialog, Dialog } from "@/app/_components/ui/dialog";
import { Menu, MenuItem } from "@/app/_components/ui/menu";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { showToast } from "@/app/_components/ui/toast";
import { ResponsiveInspector } from "@/app/_components/ui/responsive-inspector";
import { useMediaQuery } from "@/app/_lib/use-media-query";
import { formatCalendarDate, formatDueDate } from "@/app/_lib/action-date";
import { localDateKey, millisecondsUntilNextLocalDay } from "@/app/_lib/local-date";
import { actionViewGroups, countActionsByStatus, type ActionViewMode } from "@/app/_lib/action-views";
import type { MutationFailure } from "@/app/_lib/mutation-result";
import type { ActionItem, ActionPriority } from "@/modules/actions/service";
import type { ContentPickerItem } from "@/modules/inbox/service";
import type { Project } from "@/modules/projects/service";
import type { Tag } from "@/modules/tags/service";

type ActionLink = { action_id: string; content_item_id: string };
export function ActionsWorkspace({ actions, content, projects, tagsByAction, availableTags, links, initialCreate, initialContentId, initialSelectedId, contextProjectId = null, compactHeader = false, readOnly = false }: {
  actions: ActionItem[]; content: ContentPickerItem[]; projects: Project[]; tagsByAction: Record<string, Tag[]>; availableTags: Tag[]; links: ActionLink[];
  initialCreate: boolean; initialContentId?: string; initialSelectedId?: string; contextProjectId?: string | null; compactHeader?: boolean; readOnly?: boolean;
}) {
  const router = useRouter();
  const initialSelected = actions.find((action) => action.id === initialSelectedId);
  const [selectedId, setSelectedId] = useState(initialSelected?.id ?? "");
  const [createOpen, setCreateOpen] = useState(initialCreate || Boolean(initialContentId));
  const [viewMode, setViewMode] = useState<ActionViewMode>(initialSelected?.status === "draft" ? "drafts" : "open");
  const [today, setToday] = useState(() => localDateKey());
  const narrowInspector = useMediaQuery("(max-width: 1199px)");
  const inspectorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = actions.find((action) => action.id === selectedId);
  const counts = countActionsByStatus(actions);
  const basePath = contextProjectId ? `/projects/${contextProjectId}?tab=actions` : "/actions";
  const sourceContent = content.find((item) => item.id === initialContentId) ?? null;
  const selectedHref = (id: string) => `${basePath}${basePath.includes("?") ? "&" : "?"}selected=${encodeURIComponent(id)}`;

  useEffect(() => { if (initialCreate || initialContentId) setCreateOpen(true); }, [initialContentId, initialCreate]);
  useEffect(() => {
    const timer = window.setTimeout(() => setToday(localDateKey()), millisecondsUntilNextLocalDay(new Date()) + 100);
    return () => window.clearTimeout(timer);
  }, [today]);

  const closeCreate = () => { setCreateOpen(false); router.replace(basePath); };
  const visibleGroups = actionViewGroups(actions, viewMode, today);
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);

  return <section className="workspace-view actions-view">
    {!compactHeader && <header className="workspace-toolbar"><div><h1>行动台</h1><p>聚焦现在要推进的事情。</p></div><div className="toolbar-actions"><CommandTrigger />{!readOnly && <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={17} />新建行动</button>}</div></header>}
    {compactHeader && !readOnly && <div className="context-toolbar"><button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />新建行动</button></div>}
    <div className={selected ? "workspace-split has-detail" : "workspace-split"}>
      <div className="list-workspace action-workspace-list">
        <div className="action-view-toolbar" role="group" aria-label="行动视图">
          <button className={viewMode === "drafts" ? "selected" : ""} aria-pressed={viewMode === "drafts"} onClick={() => setViewMode("drafts")}>待确认 <span>{counts.drafts}</span></button>
          <button className={viewMode === "open" ? "selected" : ""} aria-pressed={viewMode === "open"} onClick={() => setViewMode("open")}>待办 <span>{counts.active}</span></button>
          <button className={viewMode === "completed" ? "selected" : ""} aria-pressed={viewMode === "completed"} onClick={() => setViewMode("completed")}>已完成 <span>{counts.completed}</span></button>
          <button className={viewMode === "all" ? "selected" : ""} aria-pressed={viewMode === "all"} onClick={() => setViewMode("all")}>全部 <span>{actions.length}</span></button>
        </div>
        {actions.length === 0 ? <ActionEmpty contextProjectId={contextProjectId} readOnly={readOnly} onCreate={() => setCreateOpen(true)} /> : visibleCount === 0 ? <div className="action-filter-empty"><CheckCircle2 size={30} /><h2>{viewMode === "drafts" ? "没有待确认草稿" : viewMode === "open" ? "待办已清空" : "这里还没有行动"}</h2><p>{viewMode === "drafts" ? "自动化生成的行动草稿会先出现在这里。" : viewMode === "open" ? "可以开始新的行动，或查看已完成项目。" : "切换视图查看其他行动。"}</p></div> : visibleGroups.map((group) => group.items.length > 0 && <ActionGroup key={group.title} title={group.title} actions={group.items} projects={projects} selectedId={selectedId} today={today} readOnly={readOnly} onSelect={(id, trigger) => { inspectorTriggerRef.current = trigger; setSelectedId(id); }} onHiddenAfterStatus={(id) => { if (selectedId === id && viewMode !== "all") setSelectedId(""); router.refresh(); }} />)}
      </div>
      {selected && <ActionInspector key={selected.id} action={selected} content={content} projects={projects} linkedIds={links.filter((link) => link.action_id === selected.id).map((link) => link.content_item_id)} tags={tagsByAction[selected.id] ?? []} availableTags={availableTags} returnTo={selectedHref(selected.id)} basePath={basePath} readOnly={readOnly} modal={narrowInspector} triggerRef={inspectorTriggerRef} onClose={() => setSelectedId("")} onRefresh={() => router.refresh()} onAccepted={() => { setViewMode("open"); router.refresh(); }} />}
    </div>
    <ActionCreateDialog open={!readOnly && createOpen} onClose={closeCreate} projects={projects} availableTags={availableTags} contextProjectId={contextProjectId} sourceContent={sourceContent} onCreated={(id) => { setCreateOpen(false); setSelectedId(id); router.replace(selectedHref(id)); router.refresh(); showToast({ title: "行动已创建", tone: "success" }); }} />
  </section>;
}

function ActionEmpty({ contextProjectId, readOnly, onCreate }: { contextProjectId: string | null; readOnly: boolean; onCreate: () => void }) {
  return <div className="empty-workspace"><Check size={34} /><h2>还没有行动</h2><p>{contextProjectId ? "在当前专案创建的行动也会出现在全局行动台。" : "写下下一件要推进的事。"}</p>{!readOnly && <button className="primary-button" onClick={onCreate}>新建行动</button>}</div>;
}

function ActionGroup({ title, actions, projects, selectedId, today, readOnly, onSelect, onHiddenAfterStatus }: {
  title: string; actions: ActionItem[]; projects: Project[]; selectedId: string; today: string; readOnly: boolean; onSelect: (id: string, trigger: HTMLButtonElement) => void; onHiddenAfterStatus: (id: string) => void;
}) {
  return <section className="action-group"><div className="group-title"><h2>{title}</h2><span>{actions.length}</span></div><div className="action-list" role="list">{actions.map((action) => <ActionRow key={action.id} action={action} projectName={projects.find((project) => project.id === action.project_id)?.name ?? "未归入专案"} selected={action.id === selectedId} today={today} readOnly={readOnly} onSelect={(trigger) => onSelect(action.id, trigger)} onStatusChanged={() => onHiddenAfterStatus(action.id)} />)}</div></section>;
}

function ActionRow({ action, projectName, selected, today, readOnly, onSelect, onStatusChanged }: { action: ActionItem; projectName: string; selected: boolean; today: string; readOnly: boolean; onSelect: (trigger: HTMLButtonElement) => void; onStatusChanged: () => void }) {
  const draft = action.status === "draft";
  const done = action.status === "done";
  return <div className={`action-row${draft ? " draft" : ""}${selected ? " selected" : ""}`} role="listitem">
    {draft ? <span className="action-draft-marker">草稿</span> : <MutationForm action={updateActionStatusAction} className="action-completion-form" successMessage={done ? "行动已恢复" : "行动已完成"} onSuccess={() => onStatusChanged()} onConflict={onStatusChanged}>
      {({ pending }) => <><input type="hidden" name="id" value={action.id} /><input type="hidden" name="revision" value={action.revision} /><input type="hidden" name="status" value={done ? "active" : "done"} /><button className={done ? "action-complete-button done" : "action-complete-button"} type="submit" disabled={readOnly || pending} aria-label={done ? `恢复行动：${action.title}` : `完成行动：${action.title}`}>{pending ? <span className="ui-spinner" /> : done ? <Check size={14} /> : <Circle size={17} />}</button></>}
    </MutationForm>}
    <button className="action-row-main" type="button" aria-pressed={selected} onClick={(event) => onSelect(event.currentTarget)}>
      <span className="action-row-copy"><strong title={action.title}>{action.title}</strong><span className="action-row-meta">{action.due_date && <span className={action.due_date < today && !done && !draft ? "action-due overdue" : "action-due"}><CalendarDays size={12} />{draft ? formatCalendarDate(action.due_date) : formatDueDate(action.due_date, today)}</span>}{action.priority !== "normal" && <span className={`action-priority priority-${action.priority}`}><Flag size={12} />{priorityLabel[action.priority]}</span>}<span className="action-project">{projectName}</span></span></span>
      {action.source_count > 0 && <span className="action-source-count" aria-label={`关联 ${action.source_count} 条资料`}>{action.source_count}</span>}
    </button>
  </div>;
}

function ActionInspector({ action, content, projects, linkedIds, tags, availableTags, returnTo, basePath, readOnly, modal, triggerRef, onClose, onRefresh, onAccepted }: {
  action: ActionItem; content: ContentPickerItem[]; projects: Project[]; linkedIds: string[]; tags: Tag[]; availableTags: Tag[]; returnTo: string; basePath: string; readOnly: boolean; modal: boolean; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void; onRefresh: () => void; onAccepted: () => void;
}) {
  const [title, setTitle] = useState(action.title);
  const [priority, setPriority] = useState<ActionPriority>(action.priority);
  const [dueDate, setDueDate] = useState(action.due_date ?? "");
  const [projectId, setProjectId] = useState(action.project_id ?? "");
  const [revision, setRevision] = useState(action.revision);
  const [relations, setRelations] = useState(() => content.filter((item) => linkedIds.includes(item.id)));
  const [savedRelationIds, setSavedRelationIds] = useState(linkedIds);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [failure, setFailure] = useState<MutationFailure | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const relationDirty = [...relations.map((item) => item.id)].sort().join("\u0000") !== [...savedRelationIds].sort().join("\u0000");
  const projectName = projects.find((project) => project.id === projectId)?.name ?? "未归入专案";

  useEffect(() => { setTitle(action.title); setPriority(action.priority); setDueDate(action.due_date ?? ""); setProjectId(action.project_id ?? ""); setRevision(action.revision); setFailure(null); }, [action.id, action.revision, action.title, action.priority, action.due_date, action.project_id]);
  useEffect(() => { const next = content.filter((item) => linkedIds.includes(item.id)); setRelations(next); setSavedRelationIds(linkedIds); }, [action.id, content, linkedIds.join("\u0000")]);

  const updateDetails = async (next: { title?: string; priority?: ActionPriority; dueDate?: string; projectId?: string }, label: string) => {
    if (pendingRef.current) return false;
    pendingRef.current = true; setPending(true); setFailure(null);
    const data = new FormData();
    data.set("id", action.id); data.set("revision", String(revision)); data.set("title", next.title ?? title); data.set("priority", next.priority ?? priority); data.set("dueDate", next.dueDate ?? dueDate); data.set("projectId", next.projectId ?? projectId);
    try {
      const result = await updateActionDetailsAction(data);
      if (!result.ok) { setFailure(result); return false; }
      setRevision(result.value.revision); showToast({ title: label, tone: "success" }); onRefresh(); return true;
    } finally { pendingRef.current = false; setPending(false); }
  };

  const saveRelationSuccess = ({ revision: nextRevision }: { revision: number }) => { setRevision(nextRevision); setSavedRelationIds(relations.map((item) => item.id)); onRefresh(); };
  return <ResponsiveInspector label="行动详情" className="detail-panel action-inspector" modal={modal} triggerRef={triggerRef} onClose={onClose}>
    <div className="action-inspector-header"><div><span className="eyebrow">{action.status === "draft" ? "待确认草稿" : "行动"}</span><h2>{title}</h2></div><div className="action-inspector-actions">{!readOnly && <Menu label="行动菜单"><MenuItem onClick={() => setRenameOpen(true)}><Pencil size={15} />重命名</MenuItem><MenuItem danger onClick={() => setTrashOpen(true)}><Trash2 size={15} />移到回收站</MenuItem></Menu>}<button data-inspector-initial-focus className="detail-close" type="button" onClick={onClose} aria-label="关闭详情"><X size={18} /></button></div></div>
    {!readOnly && action.status === "draft" && <MutationForm action={acceptActionDraftAction} className="action-inspector-accept" successMessage="草稿已接受为行动" onSuccess={({ revision: nextRevision }) => { setRevision(nextRevision); onAccepted(); }} onConflict={onRefresh}>{({ pending: acceptPending }) => <><input type="hidden" name="id" value={action.id} /><input type="hidden" name="revision" value={revision} /><button className="primary-button" disabled={acceptPending}>{acceptPending ? "正在接受…" : "接受为行动"}</button></>}</MutationForm>}
    {!readOnly && action.status !== "draft" && <MutationForm action={updateActionStatusAction} className="action-inspector-completion" successMessage={action.status === "done" ? "行动已恢复" : "行动已完成"} onSuccess={({ revision: nextRevision }) => { setRevision(nextRevision); onRefresh(); }} onConflict={onRefresh}>{({ pending: statusPending }) => <><input type="hidden" name="id" value={action.id} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="status" value={action.status === "done" ? "active" : "done"} /><button className={action.status === "done" ? "quiet-button completion-done" : "quiet-button"} disabled={statusPending}>{action.status === "done" ? <><RotateCcw size={15} />恢复为待办</> : <><CheckCircle2 size={15} />标记为完成</>}</button></>}</MutationForm>}
    <section className="action-inspector-section"><h3>安排</h3><div className="action-inspector-metadata">
      {readOnly ? <MetadataRead icon={<CalendarDays size={15} />} label="截止日期" value={action.status === "draft" ? formatCalendarDate(dueDate || null) : formatDueDate(dueDate || null)} /> : <DatePicker value={dueDate} disabled={pending} showRelativeStatus={action.status !== "draft"} onValueChange={async (next) => { const previous = dueDate; setDueDate(next); if (!await updateDetails({ dueDate: next }, next ? "截止日期已更新" : "截止日期已清除")) setDueDate(previous); }} />}
      {readOnly ? <MetadataRead icon={<Flag size={15} />} label="优先级" value={priorityLabel[priority]} /> : <PriorityPicker value={priority} disabled={pending} onValueChange={async (next) => { const previous = priority; setPriority(next); if (!await updateDetails({ priority: next }, "优先级已更新")) setPriority(previous); }} />}
      {readOnly ? <MetadataRead label="专案" value={projectName} /> : <ProjectPicker projects={projects} value={projectId} disabled={pending} onValueChange={async (next) => { const previous = projectId; setProjectId(next); if (!await updateDetails({ projectId: next }, "所属专案已更新")) setProjectId(previous); }} />}
    </div>{failure && <div className="mutation-feedback" role="alert"><span>{failure.message}</span>{failure.code === "conflict" && <button className="quiet-button" type="button" onClick={onRefresh}>载入最新内容</button>}</div>}</section>
    <section className="action-inspector-section"><header><h3>关联资料</h3><span>{relations.length}</span></header>{relations.length === 0 ? <p className="inspector-placeholder">未关联资料</p> : <div className="linked-materials">{relations.map((item) => <a href={item.kind === "file" ? `/viewer/${item.id}` : item.source_url ?? "#"} target={item.kind === "file" ? undefined : "_blank"} rel={item.kind === "file" ? undefined : "noreferrer"} key={item.id}>{item.kind === "file" ? <FileIcon size={15} /> : <LinkIcon size={15} />}<span>{item.title}</span></a>)}</div>}
      {!readOnly && <MutationForm action={replaceActionContentItemsAction} className="action-relation-editor" successMessage="关联资料已更新" onSuccess={saveRelationSuccess} onConflict={onRefresh}>{({ pending: relationPending }) => <><input type="hidden" name="id" value={action.id} /><input type="hidden" name="revision" value={revision} /><ContentRelationPicker selected={relations} onChange={setRelations} projects={projects} disabled={relationPending} />{relationDirty && <div className="inline-save-bar"><button className="quiet-button" type="button" onClick={() => setRelations(content.filter((item) => savedRelationIds.includes(item.id)))}>取消</button><button className="primary-button" disabled={relationPending}>{relationPending ? "正在保存…" : "保存关联"}</button></div>}</>}</MutationForm>}
    </section>
    <TagPicker type="action" objectId={action.id} assigned={tags} available={availableTags} returnTo={returnTo} readOnly={readOnly} />
    <Dialog open={!readOnly && renameOpen} onClose={() => setRenameOpen(false)} title="重命名行动" className="compact-dialog"><MutationForm action={updateActionDetailsAction} className="drawer-form" successMessage="行动名称已更新" onSuccess={({ revision: nextRevision }) => { setRevision(nextRevision); setTitle(title.trim()); setRenameOpen(false); onRefresh(); }} onConflict={onRefresh}>{({ pending: renamePending }) => <><input type="hidden" name="id" value={action.id} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="priority" value={priority} /><input type="hidden" name="dueDate" value={dueDate} /><input type="hidden" name="projectId" value={projectId} /><label className="ui-field"><span>名称</span><input data-dialog-initial-focus name="title" value={title} onChange={(event) => setTitle(event.target.value)} required disabled={renamePending} /></label><div className="dialog-actions"><button className="quiet-button" type="button" onClick={() => { setTitle(action.title); setRenameOpen(false); }} disabled={renamePending}>取消</button><button className="primary-button" disabled={renamePending}>保存</button></div></>}</MutationForm></Dialog>
    <AlertDialog open={!readOnly && trashOpen} onClose={() => setTrashOpen(false)} title="将行动移到回收站？" description="行动会从行动台与专案视图隐藏，可从回收站恢复。" className="danger-dialog"><form action={trashActionAction} className="drawer-form"><input type="hidden" name="id" value={action.id} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="returnTo" value={basePath} /><p className="confirmation-name">{title}</p><div className="dialog-actions"><button data-dialog-initial-focus className="quiet-button" type="button" onClick={() => setTrashOpen(false)}>取消</button><button className="danger-button"><Trash2 size={15} />移到回收站</button></div></form></AlertDialog>
  </ResponsiveInspector>;
}

function MetadataRead({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return <div className="metadata-read">{icon}<span>{label}</span><strong>{value}</strong></div>;
}
