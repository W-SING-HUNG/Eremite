"use client";

import Link from "next/link";
import { ChevronRight, Ellipsis, FolderOpen } from "lucide-react";
import type { Folder as FolderRecord } from "@/modules/projects/folders";
import { Menu, MenuItem } from "@/app/_components/ui/menu";
import { collapseBreadcrumbs } from "@/app/_lib/resource-navigation";

export function FolderBreadcrumbs({ projectId, breadcrumbs }: { projectId: string; breadcrumbs: FolderRecord[] }) {
  const { leading, hidden, trailing } = collapseBreadcrumbs(breadcrumbs, 4);
  const visible = [...leading, ...trailing];
  return <nav className="breadcrumbs resource-breadcrumbs" aria-label="当前位置">
    <Link href={`/projects/${projectId}`}><FolderOpen size={15} />全部资料</Link>
    {visible.map((folder, index) => <span key={folder.id}>
      <ChevronRight size={13} aria-hidden="true" />
      {hidden.length > 0 && index === leading.length && <><Menu label="展开完整路径">{hidden.map((entry) => <MenuItem key={entry.id} onClick={() => { location.href = `/projects/${projectId}/folders/${entry.id}`; }}>{entry.name}</MenuItem>)}</Menu><ChevronRight size={13} aria-hidden="true" /></>}
      <Link aria-current={folder.id === breadcrumbs.at(-1)?.id ? "location" : undefined} href={`/projects/${projectId}/folders/${folder.id}`} title={folder.name}>{folder.name}</Link>
    </span>)}
    {hidden.length > 0 && visible.length === 0 && <Ellipsis size={16} />}
  </nav>;
}
