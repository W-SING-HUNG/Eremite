import Link from "next/link";
import { ActionsWorkspace } from "@/app/_components/actions-workspace";
import { listActionContentLinks, listActionsPage } from "@/modules/actions/service";
import { listAvailableContentItemsByIds } from "@/modules/inbox/service";
import { listProjects } from "@/modules/projects/service";
import { listObjectTagsMap, listTags } from "@/modules/tags/service";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ create?: string; createFor?: string; selected?: string; cursor?: string; error?: string; success?: string }> }) {
  const [projects, params] = await Promise.all([listProjects(), searchParams]);
  const page = listActionsPage({ cursor: params.cursor, limit: 50 });
  const links = listActionContentLinks(page.items.map((action) => action.id));
  const content = listAvailableContentItemsByIds([...links.map((link) => link.content_item_id), ...(params.createFor ? [params.createFor] : [])]);
  return <>
    {params.error && <div className="integrity-notice">{mutationNoticeMessage(params.error)}</div>}
    {params.success && <div className="success-notice">操作已完成。</div>}
    <ActionsWorkspace
      actions={page.items}
      content={content}
      projects={projects}
      tagsByAction={listObjectTagsMap("action", page.items.map((action) => action.id))}
      availableTags={listTags()}
      links={links}
      initialCreate={params.create === "1"}
      initialContentId={params.createFor}
      initialSelectedId={params.selected}
    />
    {page.nextCursor && <Link className="page-next" href={`/actions?cursor=${encodeURIComponent(page.nextCursor)}`}>下一页</Link>}
  </>;
}
