"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Settings, Trash2 } from "lucide-react";
import { archiveProjectAction, trashProjectAction, unarchiveProjectAction } from "@/app/resource-actions";
import { AlertDialog } from "@/app/_components/ui/dialog";
import { Menu, MenuItem } from "@/app/_components/ui/menu";
import type { Project } from "@/modules/projects/service";

export function ProjectLifecycleControls({ project }: { project: Project }) {
  const router = useRouter();
  const [trashOpen, setTrashOpen] = useState(false);
  const returnTo = `/projects/${project.id}`;
  return <>
    <Menu label={`${project.name} 专案菜单`}>
      <MenuItem onClick={() => router.push(`/projects/${project.id}?tab=settings`)}><Settings size={15} />专案设置</MenuItem>
      <form action={project.archived_at ? unarchiveProjectAction : archiveProjectAction}>
        <input type="hidden" name="id" value={project.id} />
        <input type="hidden" name="revision" value={project.revision} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button className="menu-item" role="menuitem" tabIndex={-1}>{project.archived_at ? <ArchiveRestore size={15} /> : <Archive size={15} />}{project.archived_at ? "取消归档" : "归档专案"}</button>
      </form>
      <MenuItem danger onClick={() => setTrashOpen(true)}><Trash2 size={15} />移到回收站</MenuItem>
    </Menu>
    <AlertDialog open={trashOpen} onClose={() => setTrashOpen(false)} title="将专案移到回收站？" description="专案会从导航中隐藏；其中资料、行动与运行记录不会被永久删除。" className="danger-dialog">
      <form action={trashProjectAction} className="drawer-form">
        <input type="hidden" name="id" value={project.id} />
        <input type="hidden" name="revision" value={project.revision} />
        <input type="hidden" name="returnTo" value="/projects" />
        <p className="confirmation-name">{project.name}</p>
        <div className="dialog-actions"><button data-dialog-initial-focus className="quiet-button" type="button" onClick={() => setTrashOpen(false)}>取消</button><button className="danger-button"><Trash2 size={15} />移到回收站</button></div>
      </form>
    </AlertDialog>
  </>;
}
