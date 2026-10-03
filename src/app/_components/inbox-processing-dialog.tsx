"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Flag, ListPlus } from "lucide-react";
import { processContentWithAcceptedDraftAction, processContentWithNewActionAction, processContentWithoutActionAction } from "@/app/actions";
import { DatePicker } from "@/app/_components/action/date-picker";
import { PriorityPicker, priorityLabel } from "@/app/_components/action/priority-picker";
import { ProjectPicker } from "@/app/_components/action/project-picker";
import { Dialog } from "@/app/_components/ui/dialog";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { showToast } from "@/app/_components/ui/toast";
import { formatCalendarDate } from "@/app/_lib/action-date";
import type { ActionPriority, DraftActionForContentItem } from "@/modules/actions/service";
import type { ContentItem } from "@/modules/inbox/service";
import type { Project } from "@/modules/projects/service";

export function InboxProcessingDialog({ open, onClose, onProcessed, content, drafts, projects }: {
  open: boolean;
  onClose: () => void;
  onProcessed: () => void;
  content: ContentItem;
  drafts: DraftActionForContentItem[];
  projects: Project[];
}) {
  const [priority, setPriority] = useState<ActionPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState(content.project_id ?? "");

  useEffect(() => {
    if (!open) return;
    setPriority("normal");
    setDueDate("");
    setProjectId(content.project_id ?? "");
  }, [content.id, content.project_id, open]);

  const processed = (message: string, actionId?: string) => {
    showToast({
      title: message,
      tone: "success",
      ...(actionId ? { action: { label: "查看行动", href: `/actions?selected=${encodeURIComponent(actionId)}` } } : {}),
    });
    onProcessed();
  };

  return <Dialog open={open} onClose={onClose} title="处理资料" description="为这条新资料选择一个明确结果。" className="inbox-processing-dialog">
    <div className="processing-source"><span>当前资料</span><strong>{content.title}</strong></div>
    <div className="processing-outcomes">
      <section className="processing-outcome">
        <header><span><CheckCircle2 size={17} /></span><div><h3>无需行动</h3><p>资料已经整理完成，不需要建立后续行动。</p></div></header>
        <MutationForm action={processContentWithoutActionAction} onSuccess={() => processed("资料已标记为已处理")} onConflict={onProcessed}>
          {({ pending }) => <><input type="hidden" name="contentId" value={content.id} /><input type="hidden" name="revision" value={content.revision} /><button data-dialog-initial-focus className="quiet-button" disabled={pending}>{pending ? "正在处理…" : "无需行动，标记为已处理"}</button></>}
        </MutationForm>
      </section>

      <section className="processing-outcome">
        <header><span><ListPlus size={17} /></span><div><h3>创建行动</h3><p>创建正式待办，并在同一事务中完成当前资料的处理。</p></div></header>
        <MutationForm action={processContentWithNewActionAction} className="processing-action-form" onSuccess={({ actionId }) => processed("行动已创建，资料已处理", actionId)} onConflict={onProcessed}>
          {({ pending }) => <>
            <input type="hidden" name="contentId" value={content.id} /><input type="hidden" name="revision" value={content.revision} />
            <label className="ui-field"><span>行动标题</span><input name="title" placeholder="要推进什么？" required disabled={pending} autoComplete="off" /></label>
            <div className="action-metadata-bar" aria-label="行动信息">
              <ProjectPicker projects={projects} name="projectId" value={projectId} onValueChange={setProjectId} disabled={pending} />
              <PriorityPicker name="priority" value={priority} onValueChange={setPriority} disabled={pending} />
              <DatePicker name="dueDate" value={dueDate} onValueChange={setDueDate} disabled={pending} />
            </div>
            <div className="processing-locked-relation">当前资料将固定关联到新行动。</div>
            <button className="primary-button" disabled={pending}>{pending ? "正在创建…" : "创建行动并处理"}</button>
          </>}
        </MutationForm>
      </section>

      <section className="processing-outcome">
        <header><span><CheckCircle2 size={17} /></span><div><h3>接受自动草稿</h3><p>仅显示仍为待确认、且真实关联当前资料的草稿。</p></div></header>
        {drafts.length === 0 ? <p className="processing-empty">没有可接受的关联草稿。</p> : <div className="processing-draft-list">{drafts.map((draft) => {
          const projectName = projects.find((project) => project.id === draft.project_id)?.name ?? "未归入专案";
          return <article className="processing-draft" key={draft.id}>
            <div><span className="processing-draft-status">待确认</span><strong>{draft.title}</strong></div>
            <p><span><Flag size={12} />{priorityLabel[draft.priority]}</span><span><CalendarDays size={12} />{formatCalendarDate(draft.due_date)}</span><span>{projectName}</span></p>
            <div className="processing-draft-actions"><Link className="quiet-button" href={`/actions?selected=${encodeURIComponent(draft.id)}`}>编辑草稿</Link><MutationForm action={processContentWithAcceptedDraftAction} onSuccess={() => processed("草稿已接受，资料已处理", draft.id)} onConflict={onProcessed}>{({ pending }) => <><input type="hidden" name="contentId" value={content.id} /><input type="hidden" name="revision" value={content.revision} /><input type="hidden" name="actionId" value={draft.id} /><input type="hidden" name="actionRevision" value={draft.revision} /><button className="primary-button" disabled={pending}>{pending ? "正在接受…" : "接受为行动并完成处理"}</button></>}</MutationForm></div>
          </article>;
        })}</div>}
      </section>
    </div>
  </Dialog>;
}
