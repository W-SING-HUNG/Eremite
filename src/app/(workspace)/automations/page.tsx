import Link from "next/link";
import { AutomationsWorkspace } from "@/app/_components/automations-workspace";
import { listAutomationRunsPage } from "@/modules/automations/service";
import { reconcileInterruptedAutomationRuns } from "@/modules/automations/reconciliation";
import { listTools } from "@/modules/automations/registry";
import { listObjectTagsMap, listTags } from "@/modules/tags/service";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ view?: string; tool?: string; selected?: string; cursor?: string; error?: string; success?: string }> }) {
  const params = await searchParams;
  reconcileInterruptedAutomationRuns();
  const page = listAutomationRunsPage({ cursor: params.cursor, limit: 50 });
  return <>
    {params.error && <div className="integrity-notice">{mutationNoticeMessage(params.error)}</div>}
    {params.success && <div className="success-notice">操作已完成。</div>}
    <AutomationsWorkspace
      tools={listTools("global")}
      tagsByRun={listObjectTagsMap("automation_run", page.items.map((run) => run.id))}
      availableTags={listTags()}
      runs={page.items}
      initialView={params.view === "runs" ? "runs" : "tools"}
      initialToolId={params.tool}
      initialSelectedId={params.selected}
    />
    {page.nextCursor && <Link className="page-next" href={`/automations?view=runs&cursor=${encodeURIComponent(page.nextCursor)}`}>下一页</Link>}
  </>;
}
