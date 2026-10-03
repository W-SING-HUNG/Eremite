import { CommandTrigger } from "@/app/_components/workspace-shell";
import { TrashWorkspace } from "@/app/_components/trash-workspace";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";
import { describeFolderPermanentDeletion, describeProjectPermanentDeletion } from "@/app/_services/resource-operations";
import { listTrashedActions } from "@/modules/actions/service";
import { listTrashedAutomationRuns } from "@/modules/automations/service";
import { listTrashedContentItems } from "@/modules/inbox/service";
import { listTrashedFolderRoots } from "@/modules/projects/folders";
import { listProjects } from "@/modules/projects/service";

export default async function TrashPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const [content, actions, runs, folders, projects, query] = await Promise.all([
    listTrashedContentItems(), listTrashedActions(), listTrashedAutomationRuns(), listTrashedFolderRoots(), listProjects({ trashOnly: true }), searchParams,
  ]);
  return <section className="workspace-view resource-page">
    <header className="workspace-toolbar"><div><h1>回收站</h1><p>恢复时会尽量回到原位置；原专案或文件夹不可用时将采用安全位置。永久删除不可撤销。</p></div><CommandTrigger /></header>
    {query.error && <div className="integrity-notice">{mutationNoticeMessage(query.error)}</div>}
    {query.success && <div className="success-notice">{query.success === "saved" ? "操作已完成。" : query.success}</div>}
    <TrashWorkspace
      projects={projects.map((item) => ({ item, ...describeProjectPermanentDeletion(item.id) }))}
      folders={folders.map((item) => ({ item, ...describeFolderPermanentDeletion(item.id) }))}
      content={content}
      actions={actions}
      runs={runs}
    />
  </section>;
}
