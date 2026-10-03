"use client";

import { useMemo, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import type { FolderDestination } from "@/modules/projects/folders";
import type { Project } from "@/modules/projects/service";
import type { SearchScope } from "@/modules/search/service";
import type { Tag } from "@/modules/tags/service";
import { Select } from "@/app/_components/ui/select";
import { ControlField } from "@/app/_components/ui/field";
import { Popover } from "@/app/_components/ui/popover";

export function SearchScopeForm({ projects, folders, tags, initial }: {
  projects: Project[]; folders: FolderDestination[]; tags: Tag[];
  initial: { query: string; scope: SearchScope; projectId?: string; folderId?: string; tagId?: string };
}) {
  const [scope, setScope] = useState(initial.scope);
  const [projectId, setProjectId] = useState(initial.projectId ?? projects[0]?.id ?? "");
  const [folderId, setFolderId] = useState(initial.folderId ?? "");
  const [tagId, setTagId] = useState(initial.tagId ?? "");
  const projectFolders = useMemo(() => folders.filter((folder) => folder.project_id === projectId), [folders, projectId]);
  const project = projects.find((entry) => entry.id === projectId);
  const folder = folders.find((entry) => entry.id === folderId);
  const tag = tags.find((entry) => entry.id === tagId);
  const invalid = scope !== "global" && (!projectId || (scope === "folder" && !folderId));
  const scopeErrorId = "search-scope-error";
  const filterCount = Number(scope !== "global") + Number(Boolean(tagId));
  const resetScope = () => { setScope("global"); setProjectId(projects[0]?.id ?? ""); setFolderId(""); };

  return <form className="search-page-form" method="get">
    <label className="search-query"><span className="sr-only">搜索关键词</span><Search size={18} /><input name="q" defaultValue={initial.query} maxLength={500} placeholder="搜索资料、行动、运行记录、专案或文件夹" autoFocus /></label>
    <input type="hidden" name="scope" value={scope} />
    {scope !== "global" && <input type="hidden" name="projectId" value={projectId} />}
    {scope === "folder" && <input type="hidden" name="folderId" value={folderId} />}
    {tagId && <input type="hidden" name="tagId" value={tagId} />}
    <div className="search-form-actions">
      <Popover label="搜索筛选" placement="bottom-end" initialFocus trigger={({ focusTrigger: _focusTrigger, ...props }) => <button {...props} className={filterCount ? "quiet-button active" : "quiet-button"}><Filter size={15} />筛选{filterCount ? ` ${filterCount}` : ""}</button>}>
        <div className="search-filter-popover">
          <ControlField label="搜索范围"><Select label="搜索范围" value={scope} onValueChange={(value) => { const next = value as SearchScope; setScope(next); if (next !== "folder") setFolderId(""); }} options={[{ value: "global", label: "整个 Eremite" }, { value: "project", label: "一个专案" }, { value: "folder", label: "一个文件夹及其子文件夹" }]} /></ControlField>
          {scope !== "global" && <ControlField label="专案"><Select label="专案" value={projectId} onValueChange={(value) => { setProjectId(value); setFolderId(""); }} invalid={invalid && !projectId} describedBy={invalid ? scopeErrorId : undefined} options={projects.map((entry) => ({ value: entry.id, label: entry.name }))} /></ControlField>}
          {scope === "folder" && <ControlField label="文件夹"><Select label="文件夹" value={folderId} onValueChange={setFolderId} placeholder="选择文件夹" invalid={invalid && !folderId} describedBy={invalid ? scopeErrorId : undefined} options={projectFolders.map((entry) => ({ value: entry.id, label: entry.path }))} /></ControlField>}
          <ControlField label="标签"><Select label="标签" value={tagId} onValueChange={setTagId} options={[{ value: "", label: "所有标签" }, ...tags.map((entry) => ({ value: entry.id, label: entry.name }))]} /></ControlField>
        </div>
      </Popover>
      <button className="primary-button" disabled={invalid}>搜索</button>
    </div>
    {(scope !== "global" || tagId) && <div className="search-filter-chips" aria-label="当前筛选">
      {scope !== "global" && <button type="button" onClick={resetScope}><span>{scope === "folder" ? `位置：${project?.name ?? "专案"} / ${folder?.path ?? "选择文件夹"}` : `专案：${project?.name ?? "选择专案"}`}</span><X size={13} aria-hidden="true" /></button>}
      {tag && <button type="button" onClick={() => setTagId("")}><span>标签：{tag.name}</span><X size={13} aria-hidden="true" /></button>}
    </div>}
    {invalid && <p className="search-scope-error" id={scopeErrorId} role="alert">请选择完整的搜索位置。</p>}
  </form>;
}
