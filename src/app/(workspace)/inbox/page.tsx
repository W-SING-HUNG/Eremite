import Link from "next/link";
import { InboxWorkspace } from "@/app/_components/inbox-workspace";
import { listContentItemsPage } from "@/modules/inbox/service";
import { listProjects } from "@/modules/projects/service";
import { listFolderDestinations } from "@/modules/projects/folders";
import { listObjectTagsMap, listTags } from "@/modules/tags/service";
import { verifyCurrentFiles } from "@/platform/backup/service";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";
import { listDraftActionsForContentItems } from "@/modules/actions/service";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ create?: string; selected?: string; preview?: string; processing?: string; unclassified?: string; cursor?: string; error?: string; success?: string }> }) {
  const [integrityProblems, params] = await Promise.all([verifyCurrentFiles(), searchParams]);
  const page = listContentItemsPage({ cursor: params.cursor, limit: 50 });
  const projects = listProjects();
  return <>
    {params.error && <div className="integrity-notice">{mutationNoticeMessage(params.error)}</div>}
    {params.success && <div className="success-notice">操作已完成。</div>}
    <InboxWorkspace
      items={page.items}
      projects={projects}
      folders={listFolderDestinations()}
      tagsByContent={listObjectTagsMap("content", page.items.map((item) => item.id))}
      linkedDrafts={listDraftActionsForContentItems(page.items.map((item) => item.id))}
      availableTags={listTags()}
      integrityProblems={integrityProblems}
      initialCreate={params.create === "1"}
      initialSelectedId={params.selected}
      initialPreview={params.preview === "1"}
      initialProcessing={params.processing === "1"}
      initialUnclassified={params.unclassified === "1"}
    />
    {page.nextCursor && <Link className="page-next" href={`/inbox?cursor=${encodeURIComponent(page.nextCursor)}`}>下一页</Link>}
  </>;
}
