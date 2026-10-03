"use client";

import { useState } from "react";
import { FileText, Folder, FolderKanban, ListChecks, RotateCcw, Trash2, Workflow } from "lucide-react";
import {
  permanentlyDeleteActionAction, permanentlyDeleteAutomationAction, permanentlyDeleteContentAction,
  permanentlyDeleteFolderAction, permanentlyDeleteProjectAction, restoreActionAction,
  restoreAutomationAction, restoreContentAction, restoreFolderAction, restoreProjectAction,
} from "@/app/resource-actions";
import { AlertDialog } from "@/app/_components/ui/dialog";
import { Menu, MenuItem } from "@/app/_components/ui/menu";
import type { ActionItem } from "@/modules/actions/service";
import type { AutomationRun } from "@/modules/automations/service";
import type { ContentItem } from "@/modules/inbox/service";
import type { Folder as FolderRecord } from "@/modules/projects/folders";
import type { Project } from "@/modules/projects/service";

type ProjectEntry = { item: Project; folders: number; content: number; actions: number; runs: number };
type FolderEntry = { item: FolderRecord; folders: number; content: number };
const actionStatusLabel: Record<string, string> = { draft: "草稿", active: "进行中", done: "已完成", cancelled: "已取消", archived: "已归档" };
const priorityLabel: Record<string, string> = { high: "高", normal: "普通", low: "低" };
const runStatusLabel: Record<string, string> = { running: "运行中", completed: "完成", failed: "失败" };
type Selection =
  | { type: "project"; entry: ProjectEntry }
  | { type: "folder"; entry: FolderEntry }
  | { type: "content"; entry: ContentItem }
  | { type: "action"; entry: ActionItem }
  | { type: "run"; entry: AutomationRun }
  | null;

export function TrashWorkspace({ projects, folders, content, actions, runs }: { projects: ProjectEntry[]; folders: FolderEntry[]; content: ContentItem[]; actions: ActionItem[]; runs: AutomationRun[] }) {
  const [selection, setSelection] = useState<Selection>(null);
  const total = projects.length + folders.length + content.length + actions.length + runs.length;
  return <div className="trash-workspace">
    {total === 0 ? <div className="unified-empty"><Trash2 size={28} /><h2>回收站是空的</h2><p>移到回收站的专案、文件夹、资料、行动和运行记录会出现在这里。</p></div> : <>
      <TrashGroup title="专案">{projects.map((entry) => <TrashRow key={entry.item.id} icon={<FolderKanban size={17} />} title={entry.item.name} meta={`${entry.folders} 个文件夹 · ${entry.content} 条资料 · ${entry.actions} 个行动 · ${entry.runs} 条运行记录`} restore={<form action={restoreProjectAction}><Base id={entry.item.id} revision={entry.item.revision} /><button className="quiet-button"><RotateCcw size={14} />恢复</button></form>} onDelete={() => setSelection({ type: "project", entry })} />)}</TrashGroup>
      <TrashGroup title="文件夹">{folders.map((entry) => <TrashRow key={entry.item.id} icon={<Folder size={17} />} title={entry.item.name} meta={`${entry.folders} 个文件夹 · ${entry.content} 条资料`} restore={<form action={restoreFolderAction}><Base id={entry.item.id} revision={entry.item.revision} /><button className="quiet-button"><RotateCcw size={14} />恢复</button></form>} onDelete={() => setSelection({ type: "folder", entry })} />)}</TrashGroup>
      <TrashGroup title="资料">{content.map((entry) => <TrashRow key={entry.id} icon={<FileText size={17} />} title={entry.title} meta={entry.kind === "file" ? `文件 · ${entry.original_name}` : "链接"} restore={<form action={restoreContentAction}><Base id={entry.id} revision={entry.revision} /><button className="quiet-button"><RotateCcw size={14} />恢复</button></form>} onDelete={() => setSelection({ type: "content", entry })} />)}</TrashGroup>
      <TrashGroup title="行动">{actions.map((entry) => <TrashRow key={entry.id} icon={<ListChecks size={17} />} title={entry.title} meta={`${actionStatusLabel[entry.status] ?? entry.status} · ${priorityLabel[entry.priority] ?? entry.priority}`} restore={<form action={restoreActionAction}><Base id={entry.id} revision={entry.revision} /><button className="quiet-button"><RotateCcw size={14} />恢复</button></form>} onDelete={() => setSelection({ type: "action", entry })} />)}</TrashGroup>
      <TrashGroup title="运行记录">{runs.map((entry) => <TrashRow key={entry.id} icon={<Workflow size={17} />} title={entry.target_name_snapshot} meta={`${entry.input_summary} · ${runStatusLabel[entry.status] ?? entry.status} · ${entry.project_name_snapshot ?? "未归入专案"}`} restore={<form action={restoreAutomationAction}><Base id={entry.id} revision={entry.revision} /><button className="quiet-button"><RotateCcw size={14} />恢复</button></form>} onDelete={() => setSelection({ type: "run", entry })} />)}</TrashGroup>
    </>}
    <PermanentDeleteDialog selection={selection} onClose={() => setSelection(null)} />
  </div>;
}

function TrashGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  if (!count) return null;
  return <section className="trash-section"><h2>{title}<span>{count}</span></h2><div className="trash-list">{children}</div></section>;
}

function TrashRow({ icon, title, meta, restore, onDelete }: { icon: React.ReactNode; title: string; meta: string; restore: React.ReactNode; onDelete: () => void }) {
  return <article className="trash-row"><span className="resource-icon">{icon}</span><div><strong title={title}>{title}</strong><small>{meta}</small></div><div className="trash-actions">{restore}<Menu label={`${title} 更多操作`}><MenuItem danger onClick={onDelete}><Trash2 size={14} />永久删除</MenuItem></Menu></div></article>;
}

function PermanentDeleteDialog({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const title = !selection ? "" : selection.type === "project" || selection.type === "folder" ? selection.entry.item.name : selection.type === "run" ? selection.entry.target_name_snapshot : selection.entry.title;
  const description = selection?.type === "project"
    ? "只永久删除专案与文件夹组织结构；其中资料和行动会变为未归入专案，运行记录会保留执行时的专案。"
    : selection?.type === "folder"
      ? "将永久删除整个文件夹及其中资料，资料的版本历史也会一并删除；其他资料不会受影响。"
      : selection?.type === "content"
        ? "将永久删除这条资料及其全部版本记录；其他资料不会受影响。"
        : selection?.type === "run"
          ? "将永久删除这条历史运行记录及其输入、输出快照关系。"
          : "将永久删除这条行动；关联资料本身不会被删除。";
  return <AlertDialog open={Boolean(selection)} onClose={onClose} title={`永久删除“${title}”？`} description={description} className="danger-dialog">
    {selection?.type === "project" && <form action={permanentlyDeleteProjectAction} className="drawer-form"><Base id={selection.entry.item.id} revision={selection.entry.item.revision} /><input type="hidden" name="projectName" value={selection.entry.item.name} /><input type="hidden" name="folders" value={selection.entry.folders} /><input type="hidden" name="content" value={selection.entry.content} /><input type="hidden" name="actions" value={selection.entry.actions} /><input type="hidden" name="runs" value={selection.entry.runs} /><Confirmation expected={selection.entry.item.name} /><DeleteActions onClose={onClose} /></form>}
    {selection?.type === "folder" && <form action={permanentlyDeleteFolderAction} className="drawer-form"><Base id={selection.entry.item.id} revision={selection.entry.item.revision} /><input type="hidden" name="folders" value={selection.entry.folders} /><input type="hidden" name="content" value={selection.entry.content} /><Confirmation expected="DELETE" /><DeleteActions onClose={onClose} /></form>}
    {selection?.type === "content" && <form action={permanentlyDeleteContentAction} className="drawer-form"><Base id={selection.entry.id} revision={selection.entry.revision} /><Confirmation expected="DELETE" /><DeleteActions onClose={onClose} /></form>}
    {selection?.type === "action" && <form action={permanentlyDeleteActionAction} className="drawer-form"><Base id={selection.entry.id} revision={selection.entry.revision} /><DeleteActions onClose={onClose} /></form>}
    {selection?.type === "run" && <form action={permanentlyDeleteAutomationAction} className="drawer-form"><Base id={selection.entry.id} revision={selection.entry.revision} /><DeleteActions onClose={onClose} /></form>}
  </AlertDialog>;
}

function Base({ id, revision }: { id: string; revision: number }) { return <><input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="returnTo" value="/trash" /></>; }
function Confirmation({ expected }: { expected: string }) { return <label>输入 <strong>{expected}</strong> 以确认<input name="confirmation" autoFocus required autoComplete="off" /></label>; }
function DeleteActions({ onClose }: { onClose: () => void }) { return <div className="dialog-actions"><button data-dialog-initial-focus type="button" className="quiet-button" onClick={onClose}>取消</button><button className="danger-button">永久删除</button></div>; }
