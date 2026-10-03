"use client";

import { useEffect, useState } from "react";
import { ChevronDown, File as FileIcon, Link as LinkIcon } from "lucide-react";
import { createActionAction } from "@/app/actions";
import { Dialog } from "@/app/_components/ui/dialog";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { ContentRelationPicker } from "@/app/_components/action/content-relation-picker";
import { DatePicker } from "@/app/_components/action/date-picker";
import { DraftTagPicker } from "@/app/_components/action/draft-tag-picker";
import { PriorityPicker } from "@/app/_components/action/priority-picker";
import { ProjectPicker } from "@/app/_components/action/project-picker";
import type { ContentPickerItem } from "@/modules/inbox/service";
import type { Project } from "@/modules/projects/service";
import type { Tag } from "@/modules/tags/service";
import type { ActionPriority } from "@/modules/actions/service";

export function ActionCreateDialog({ open, onClose, onCreated, projects, availableTags, contextProjectId = null, sourceContent = null }: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  projects: Project[];
  availableTags: Tag[];
  contextProjectId?: string | null;
  sourceContent?: ContentPickerItem | null;
}) {
  const inheritedProjectId = contextProjectId ?? sourceContent?.project_id ?? "";
  const [projectId, setProjectId] = useState(inheritedProjectId);
  const [priority, setPriority] = useState<ActionPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [relations, setRelations] = useState<ContentPickerItem[]>(sourceContent ? [sourceContent] : []);
  const [tags, setTags] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);
  const inheritedProjectName = projects.find((project) => project.id === inheritedProjectId)?.name ?? "未归入专案";

  useEffect(() => {
    if (!open) return;
    setProjectId(inheritedProjectId);
    setPriority("normal");
    setDueDate("");
    setRelations(sourceContent ? [sourceContent] : []);
    setTags([]);
    setShowMore(false);
  }, [inheritedProjectId, open, sourceContent?.id]);

  return <Dialog
    open={open}
    onClose={onClose}
    title="新建行动"
    description={sourceContent ? "来源资料和所属专案已自动带入。" : contextProjectId ? "行动会自动归入当前专案。" : "先写下要做的事，需要时再补充细节。"}
    className="action-create-dialog"
  >
    <MutationForm key={`${inheritedProjectId}:${sourceContent?.id ?? "none"}:${open ? "open" : "closed"}`} action={createActionAction} className="action-quick-create" onSuccess={({ objectId }, form) => { form.reset(); onCreated(objectId); }}>
      {({ pending }) => <>
        <label className="action-title-field"><span className="sr-only">行动标题</span><input data-dialog-initial-focus name="title" placeholder="要推进什么？" required disabled={pending} autoComplete="off" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /></label>
        <div className="action-metadata-bar" aria-label="行动信息">
          {contextProjectId || sourceContent ? <><input type="hidden" name="projectId" value={inheritedProjectId} /><span className="metadata-chip static">{inheritedProjectName}</span></> : <ProjectPicker projects={projects} name="projectId" value={projectId} onValueChange={setProjectId} disabled={pending} />}
          <PriorityPicker name="priority" value={priority} onValueChange={setPriority} disabled={pending} />
          <DatePicker name="dueDate" value={dueDate} onValueChange={setDueDate} disabled={pending} />
          <button className={showMore ? "metadata-chip active" : "metadata-chip"} type="button" aria-expanded={showMore} onClick={() => setShowMore((current) => !current)} disabled={pending}>更多<ChevronDown size={13} /></button>
        </div>
        {sourceContent && <div className="action-source-context"><span>{sourceContent.kind === "file" ? <FileIcon size={15} /> : <LinkIcon size={15} />}</span><div><small>来源资料</small><strong>{sourceContent.title}</strong></div></div>}
        {showMore && <div className="action-create-more">
          <DraftTagPicker available={availableTags} value={tags} onValueChange={setTags} disabled={pending} />
          <ContentRelationPicker selected={relations} onChange={setRelations} projects={projects} lockedIds={sourceContent ? [sourceContent.id] : []} disabled={pending} />
        </div>}
        {!showMore && relations.map((item) => <input type="hidden" name="contentItemIds" value={item.id} key={item.id} />)}
        <div className="dialog-actions action-create-actions"><button className="quiet-button" type="button" onClick={onClose} disabled={pending}>取消</button><button className="primary-button" disabled={pending}>{pending ? "正在创建…" : "创建行动"}</button></div>
      </>}
    </MutationForm>
  </Dialog>;
}
