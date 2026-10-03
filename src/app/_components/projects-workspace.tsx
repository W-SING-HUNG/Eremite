"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArchiveRestore, FolderKanban, Plus, Trash2 } from "lucide-react";
import { archiveProjectAction, createProjectAction, trashProjectAction, unarchiveProjectAction } from "@/app/resource-actions";
import { CommandTrigger } from "@/app/_components/workspace-shell";
import { AlertDialog, Dialog } from "@/app/_components/ui/dialog";
import { ContextMenu, Menu, MenuItem } from "@/app/_components/ui/menu";
import { EmptyState, Notice } from "@/app/_components/ui/surface";
import type { Project } from "@/modules/projects/service";
import { MutationForm } from "@/app/_components/ui/mutation-form";

export function ProjectsWorkspace({ projects, notice }: { projects: Project[]; notice?: { kind: "success" | "error"; text: string } }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [trashTarget, setTrashTarget] = useState<Project | null>(null);
  const active = projects.filter((project) => !project.archived_at);
  const archived = projects.filter((project) => project.archived_at);

  return <section className="workspace-view projects-view">
    <header className="workspace-toolbar">
      <div><h1>专案</h1><p>把同一件事的资料、行动与自动化集中在一起。</p></div>
      <div className="toolbar-actions"><CommandTrigger /><button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={17} />新建专案</button></div>
    </header>
    {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
    <div className="projects-catalog">
      <ProjectSection title="进行中" projects={active} onTrash={setTrashTarget} />
      {active.length === 0 && <EmptyState title="还没有专案" description="新建专案，把相关资料、行动与自动化集中起来。" action={<button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>新建专案</button>} />}
      {archived.length > 0 && <ProjectSection title="已归档" projects={archived} onTrash={setTrashTarget} />}
    </div>

    <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="新建专案" description="专案会集中显示相关资料、行动与自动化。">
      <MutationForm action={createProjectAction} className="drawer-form" onSuccess={(_, form) => { form.reset(); setCreateOpen(false); router.refresh(); }}>{({ pending }) => <>
        <input type="hidden" name="returnTo" value="/projects" />
        <label>名称<input autoFocus name="name" required maxLength={120} disabled={pending} /></label>
        <label>用途说明（可选）<textarea name="description" maxLength={2000} rows={4} disabled={pending} /></label>
        <div className="dialog-actions"><button className="quiet-button" type="button" disabled={pending} onClick={() => setCreateOpen(false)}>取消</button><button className="primary-button" disabled={pending}><Plus size={16} />{pending ? "正在创建…" : "新建专案"}</button></div>
      </>}</MutationForm>
    </Dialog>

    <AlertDialog open={Boolean(trashTarget)} onClose={() => setTrashTarget(null)} title="将专案移到回收站？" description="专案中的资料、行动和运行记录不会被永久删除；恢复专案后仍可继续访问。" className="danger-dialog">
      {trashTarget && <form action={trashProjectAction} className="drawer-form">
        <input type="hidden" name="id" value={trashTarget.id} />
        <input type="hidden" name="revision" value={trashTarget.revision} />
        <input type="hidden" name="returnTo" value="/projects" />
        <p className="confirmation-name">{trashTarget.name}</p>
        <div className="dialog-actions"><button data-dialog-initial-focus className="quiet-button" type="button" onClick={() => setTrashTarget(null)}>取消</button><button className="danger-button"><Trash2 size={16} />移到回收站</button></div>
      </form>}
    </AlertDialog>
  </section>;
}

function ProjectSection({ title, projects, onTrash }: { title: string; projects: Project[]; onTrash: (project: Project) => void }) {
  if (projects.length === 0) return null;
  return <section className="project-section"><header><h2>{title}</h2><span>{projects.length}</span></header><div className="project-grid">{projects.map((project) => <ContextMenu key={project.id} label={`${project.name} 上下文菜单`} trigger={<article className="project-card">
      <Link className="project-card-link" href={`/projects/${project.id}`}>
        <span className="resource-icon"><FolderKanban size={17} /></span>
        <span><strong title={project.name}>{project.name}</strong><small>{project.description || "尚未添加用途说明"}</small></span>
      </Link>
      <Menu label={`${project.name} 操作`}><ProjectMenuItems project={project} onTrash={onTrash} /></Menu>
    </article>}>
      <ProjectMenuItems project={project} onTrash={onTrash} />
    </ContextMenu>)}</div></section>;
}

function ProjectMenuItems({ project, onTrash }: { project: Project; onTrash: (project: Project) => void }) {
  return <>
      <form action={project.archived_at ? unarchiveProjectAction : archiveProjectAction}>
        <input type="hidden" name="id" value={project.id} /><input type="hidden" name="revision" value={project.revision} /><input type="hidden" name="returnTo" value="/projects" />
        <button className="menu-item" role="menuitem" tabIndex={-1}>{project.archived_at ? <ArchiveRestore size={15} /> : <Archive size={15} />}{project.archived_at ? "取消归档" : "归档"}</button>
      </form>
      <MenuItem danger onClick={() => onTrash(project)}><Trash2 size={15} />移到回收站</MenuItem>
    </>;
}
