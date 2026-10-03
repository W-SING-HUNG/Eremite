"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, Bot, CheckSquare, Command, FilePlus2, FolderKanban, LibraryBig, LogOut, Search, Settings2, Trash2, WandSparkles } from "lucide-react";
import { backupAction, logoutAction } from "@/app/actions";
import { resolvePaletteKey } from "@/app/_lib/command-palette-keyboard";
import type { Project } from "@/modules/projects/service";
import type { SearchResult } from "@/modules/search/service";
import { Dialog } from "@/app/_components/ui/dialog";
import { Shortcut } from "@/app/_components/ui/shortcut";
import { ToastViewport } from "@/app/_components/ui/toast";
import { toolCatalog } from "@/modules/automations/tools/catalog";
import { AskEremite } from './ask-eremite';

const modules = [
  { href: "/inbox", label: "资料库", icon: LibraryBig },
  { href: "/actions", label: "行动台", icon: CheckSquare },
  { href: "/automations", label: "自动化中心", icon: Bot },
  { href: "/trash", label: "回收站", icon: Trash2 },
  { href: "/settings", label: "设置", icon: Settings2 },
];

const corePaletteCommands = [
  { id: "go-inbox", href: "/inbox", label: "前往资料库", hint: ["mod", "1"], icon: LibraryBig },
  { id: "go-actions", href: "/actions", label: "前往行动台", hint: ["mod", "2"], icon: CheckSquare },
  { id: "go-automations", href: "/automations", label: "前往自动化中心", hint: ["mod", "3"], icon: Bot },
  { id: "create-content", href: "/inbox?create=1", label: "新建资料", hint: ["mod", "N"], icon: FilePlus2 },
  { id: "create-action", href: "/actions?create=1", label: "新建行动", hint: ["mod", "shift", "N"], icon: Command },
] as const;

export function CommandTrigger() {
  return <button className="command-trigger" type="button" aria-label="打开命令面板" onClick={() => window.dispatchEvent(new Event("eremite:open-command"))}>
    <Search size={17} /><span>搜索或输入命令</span><Shortcut keys={["mod", "K"]} />
  </button>;
}

export function WorkspaceShell({ children, projects }: { children: React.ReactNode; projects: Project[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const hasQuery = Boolean(query.trim());
  const activeProjectId = /^\/projects\/([^/]+)/u.exec(pathname)?.[1] ?? null;
  const toolCommands = useMemo(() => toolCatalog.map((tool) => ({
    id: `run-tool-${tool.id}`,
    href: activeProjectId ? `/projects/${activeProjectId}?tab=automations&tool=${encodeURIComponent(tool.id)}` : `/automations?tool=${encodeURIComponent(tool.id)}`,
    label: `运行：${tool.name}`,
    hint: [] as string[],
    icon: WandSparkles,
    keywords: [tool.name, tool.description, tool.category, ...tool.keywords].join(" ").toLocaleLowerCase("zh-CN"),
  })), [activeProjectId]);
  const paletteCommands = useMemo(() => [...corePaletteCommands, ...toolCommands], [toolCommands]);
  const matchingToolCommands = useMemo(() => {
    const key = query.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
    return key ? toolCommands.filter((command) => command.keywords.includes(key)) : [];
  }, [query, toolCommands]);
  const grouped = useMemo(() => results.reduce<Record<string, typeof results>>((groups, entry) => {
    (groups[entry.group] ??= []).push(entry);
    return groups;
  }, {}), [results]);

  const candidateKey = hasQuery ? [...matchingToolCommands.map((entry) => entry.id), ...results.map((entry) => entry.id)].join("\u0000") : paletteCommands.map((command) => command.id).join("\u0000");

  useEffect(() => setActiveResult(0), [candidateKey]);

  useEffect(() => {
    if (!hasQuery) { setResults([]); setSearching(false); setSearchError(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(false);
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}&grouped=1&limit=10`, { signal: controller.signal })
        .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("search_failed")))
        .then((payload: { results: SearchResult[] }) => setResults(payload.results))
        .catch((error) => { if (error instanceof Error && error.name !== "AbortError") { setResults([]); setSearchError(true); } })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [hasQuery, query]);

  useEffect(() => {
    const openPalette = () => {
      setActiveResult(0);
      setOpen(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("eremite:open-command", openPalette);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("eremite:open-command", openPalette);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const navigate = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };
  const handlePaletteKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const candidateCount = hasQuery ? matchingToolCommands.length + results.length : paletteCommands.length;
    const keyResult = resolvePaletteKey(event.key, activeResult, candidateCount);
    if (!keyResult.handled) return;

    event.preventDefault();
    if (keyResult.close) {
      setOpen(false);
      return;
    }

    setActiveResult(keyResult.activeIndex);
    if (keyResult.execute) {
      const href = hasQuery
        ? matchingToolCommands[keyResult.activeIndex]?.href ?? results[keyResult.activeIndex - matchingToolCommands.length]?.href
        : paletteCommands[keyResult.activeIndex]?.href;
      if (href) navigate(href);
    }
  };

  return <div className="workspace-shell">
    <aside className="app-sidebar">
      <Link className="wordmark" href="/inbox">Eremite</Link>
      <nav className="module-nav" aria-label="模块导航">
        {modules.map(({ href, label, icon: Icon }) => <Link className={pathname === href ? "nav-item active" : "nav-item"} aria-current={pathname === href ? "page" : undefined} href={href} key={href}>
          <Icon size={18} /><span>{label}</span>
        </Link>)}
      </nav>
      <nav className="sidebar-projects" aria-label="专案导航"><span>专案</span>{projects.slice(0, 6).map((project) => { const active = pathname.startsWith(`/projects/${project.id}`); return <Link className={active ? "nav-item active" : "nav-item"} aria-current={active ? "page" : undefined} href={`/projects/${project.id}`} key={project.id}><FolderKanban size={17} /><span>{project.name}</span></Link>; })}<Link className={pathname === "/projects" ? "nav-item active" : "nav-item"} aria-current={pathname === "/projects" ? "page" : undefined} href="/projects"><FolderKanban size={17} /><span>全部专案</span></Link></nav>
      <div className="module-growth" aria-hidden="true" />
      <div className="sidebar-footer">
        <span className="local-indicator"><i />本地模式</span>
        <form action={backupAction}><button className="sidebar-action" type="submit"><ArchiveRestore size={17} />立即备份</button></form>
        <form action={logoutAction}><button className="sidebar-action" type="submit"><LogOut size={17} />退出</button></form>
      </div>
    </aside>
    <main className="workspace-content">{children}</main>
    <AskEremite />
    <Dialog open={open} onClose={() => setOpen(false)} title="命令面板" hideHeader className="command-palette">
        <div className="palette-input"><Search size={18} /><input data-overlay-initial-focus value={query} onChange={(event) => { setQuery(event.target.value); setActiveResult(0); }} onKeyDown={handlePaletteKeyDown} aria-label="搜索命令、资料或行动" aria-controls="command-palette-results" aria-expanded="true" role="combobox" aria-autocomplete="list" aria-activedescendant={hasQuery ? matchingToolCommands[activeResult] ? `palette-result-${matchingToolCommands[activeResult].id}` : results[activeResult - matchingToolCommands.length] ? `palette-result-${results[activeResult - matchingToolCommands.length].id}` : undefined : `palette-command-${paletteCommands[activeResult].id}`} placeholder="搜索命令、资料或行动" /><Shortcut keys={["escape"]} /></div>
        {!hasQuery && <div className="palette-list" id="command-palette-results" role="listbox" aria-label="常用命令">
          {paletteCommands.map((command, index) => <PaletteAction id={`palette-command-${command.id}`} icon={<command.icon size={17} />} label={command.label} hint={command.hint} selected={index === activeResult} onMouseEnter={() => setActiveResult(index)} onClick={() => navigate(command.href)} key={command.id} />)}
        </div>}
        {hasQuery && <div className="palette-results" id="command-palette-results" role="listbox" aria-label="搜索结果">
          {matchingToolCommands.length > 0 && <div><p className="palette-group">工具</p>{matchingToolCommands.map((command, index) => <button id={`palette-result-${command.id}`} className={index === activeResult ? "palette-result active" : "palette-result"} aria-selected={index === activeResult} role="option" key={command.id} onMouseEnter={() => setActiveResult(index)} onClick={() => navigate(command.href)}><span><strong>{command.label}</strong><small>自动化工具</small></span><span>运行</span></button>)}</div>}
          {Object.entries(grouped).map(([group, items]) => <div key={group}><p className="palette-group">{group}</p>{items.map((item) => { const index = matchingToolCommands.length + results.indexOf(item); return <button id={`palette-result-${item.id}`} className={index === activeResult ? "palette-result active" : "palette-result"} aria-selected={index === activeResult} role="option" key={item.id} onMouseEnter={() => setActiveResult(index)} onClick={() => navigate(item.href)}><span><strong>{item.title}</strong><small>{item.meta}</small></span><span>打开</span></button>; })}</div>)}
          {searching && <p className="palette-empty">正在搜索…</p>}
          {!searching && searchError && <p className="palette-empty error" role="alert">搜索暂时不可用，请稍后重试。</p>}
          {!searching && !searchError && results.length === 0 && matchingToolCommands.length === 0 && <p className="palette-empty">没有匹配的命令、专案、文件夹、资料、行动或运行记录。</p>}
        </div>}
    </Dialog>
    <ToastViewport />
  </div>;
}

function PaletteAction({ id, icon, label, hint, selected, onMouseEnter, onClick }: { id: string; icon: React.ReactNode; label: string; hint: readonly string[]; selected: boolean; onMouseEnter: () => void; onClick: () => void }) {
  return <button id={id} className={selected ? "palette-action active" : "palette-action"} type="button" role="option" aria-selected={selected} onMouseEnter={onMouseEnter} onClick={onClick}><span>{icon}{label}</span><Shortcut keys={[...hint]} /></button>;
}
