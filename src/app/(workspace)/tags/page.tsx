import { CommandTrigger } from "@/app/_components/workspace-shell";
import { TagManager } from "@/app/_components/tag-manager";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";
import { listTagsWithUsage } from "@/modules/tags/service";

export default async function TagsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const query = await searchParams;
  return <section className="workspace-view resource-page">
    <header className="workspace-toolbar"><div><h1>管理标签</h1><p>集中处理标签重命名、合并和删除；日常添加与移除可在对象详情中完成。</p></div><CommandTrigger /></header>
    {query.error && <div className="integrity-notice">{mutationNoticeMessage(query.error)}</div>}
    {query.success && <div className="success-notice">标签已更新。</div>}
    <TagManager tags={listTagsWithUsage()} />
  </section>;
}
