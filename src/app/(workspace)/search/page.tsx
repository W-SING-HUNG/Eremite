import Link from "next/link";
import { FileText, Folder, FolderKanban, ListChecks, Search, Workflow } from "lucide-react";
import { CommandTrigger } from "@/app/_components/workspace-shell";
import { SearchScopeForm } from "@/app/_components/search-scope-form";
import { listFolderDestinations } from "@/modules/projects/folders";
import { listProjects } from "@/modules/projects/service";
import { searchWorkspace, type SearchScope, type SearchResult } from "@/modules/search/service";
import { listTags } from "@/modules/tags/service";

const resultIcons = { content: FileText, action: ListChecks, automation: Workflow, project: FolderKanban, folder: Folder } as const;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; scope?: SearchScope; projectId?: string; folderId?: string; tagId?: string }> }) {
  const params = await searchParams;
  const scope: SearchScope = ["project", "folder"].includes(params.scope ?? "") ? params.scope! : "global";
  const query = params.q ?? "";
  const projects = listProjects({ includeArchived: true }).filter((project) => !project.trashed_at);
  const tags = listTags();
  const searched = Boolean(query.trim() || params.tagId);
  const validScope = scope === "global" || Boolean(params.projectId && (scope !== "folder" || params.folderId));
  const retryParams = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  let results: SearchResult[] = [];
  let searchFailed = false;
  if (searched && validScope) {
    try {
      results = searchWorkspace({ query, scope, projectId: params.projectId, folderId: params.folderId, tagId: params.tagId, limit: 50 }).results;
    } catch {
      searchFailed = true;
    }
  }
  return <section className="workspace-view resource-page search-view">
    <header className="workspace-toolbar"><div><h1>搜索</h1><p>查找 Eremite 中的资料、行动和运行记录。</p></div><CommandTrigger /></header>
    <SearchScopeForm projects={projects} folders={listFolderDestinations()} tags={tags} initial={{ query, scope, projectId: params.projectId, folderId: params.folderId, tagId: params.tagId }} />
    <div className="search-results" aria-live="polite">
      {!searchFailed && results.map((result) => <SearchRow key={result.id} result={result} projectName={projects.find((project) => project.id === result.projectId)?.name} />)}
      {searchFailed && <div className="unified-empty search-error" role="alert"><Search size={28} /><h2>搜索暂时不可用</h2><p>查询没有完成，这不代表没有结果。请稍后重试。</p><Link className="quiet-button" href={`/search?${retryParams}`}>重试</Link></div>}
      {searched && validScope && !searchFailed && results.length === 0 && <div className="unified-empty"><Search size={28} /><h2>没有匹配结果</h2><p>尝试更短的关键词、扩大范围，或清除标签筛选。</p></div>}
      {!searched && <div className="unified-empty"><Search size={28} /><h2>查找整个 Eremite</h2><p>输入关键词，或只选择一个标签查看所有关联对象。</p></div>}
    </div>
  </section>;
}

function SearchRow({ result, projectName }: { result: SearchResult; projectName?: string }) {
  const Icon = resultIcons[result.type];
  return <Link className="search-result-row" href={result.href}><span className="resource-icon"><Icon size={17} /></span><span><strong title={result.title}>{result.title}</strong><small>{result.group} · {projectName ?? "未归入专案"}</small></span><span>{result.meta}</span><span>打开</span></Link>;
}
