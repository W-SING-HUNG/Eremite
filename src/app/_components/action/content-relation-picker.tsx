"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, File as FileIcon, Link as LinkIcon, Link2, Search, X } from "lucide-react";
import { Popover } from "@/app/_components/ui/popover";
import { nextRovingIndex } from "@/app/_lib/ui-keyboard";
import type { ContentPickerItem } from "@/modules/inbox/service";
import type { Project } from "@/modules/projects/service";

type PagePayload = { items: ContentPickerItem[]; nextCursor: string | null };

export function ContentRelationPicker({ selected, onChange, projects, name = "contentItemIds", lockedIds = [], disabled = false }: {
  selected: ContentPickerItem[];
  onChange: (items: ContentPickerItem[]) => void;
  projects: Project[];
  name?: string;
  lockedIds?: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ContentPickerItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerFocus = useRef<() => void>(() => undefined);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  const load = async ({ append = false, cursor = "", signal }: { append?: boolean; cursor?: string; signal?: AbortSignal } = {}) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query, limit: "24" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/actions/content-options?${params}`, { signal });
      if (!response.ok) throw new Error("request_failed");
      const payload = await response.json() as PagePayload;
      setItems((current) => append ? [...current, ...payload.items.filter((item) => !current.some((existing) => existing.id === item.id))] : payload.items);
      setNextCursor(payload.nextCursor);
    } catch (requestError) {
      if ((requestError as Error).name !== "AbortError") setError("无法读取资料，请重试。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load({ signal: controller.signal }), 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  const toggle = (item: ContentPickerItem) => {
    if (locked.has(item.id)) return;
    onChange(selectedIds.has(item.id) ? selected.filter((selectedItem) => selectedItem.id !== item.id) : [...selected, item]);
  };

  return <div className="content-relation-picker">
    {selected.map((item) => <input type="hidden" name={name} value={item.id} key={item.id} />)}
    <Popover
      label="关联资料"
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}
      placement="bottom-start"
      initialFocus
      className="content-relation-popover"
      trigger={({ focusTrigger, ...props }) => {
        triggerFocus.current = focusTrigger;
        return <button {...props} className="metadata-chip" disabled={disabled}><Link2 size={14} /><span>{selected.length ? `已关联 ${selected.length} 条` : "关联资料"}</span></button>;
      }}
    >
      {selected.length > 0 && <div className="relation-selection" aria-label="已关联资料">{selected.map((item) => <span key={item.id}>{item.kind === "file" ? <FileIcon size={13} /> : <LinkIcon size={13} />}<span>{item.title}</span>{!locked.has(item.id) && <button type="button" aria-label={`移除 ${item.title}`} onClick={() => toggle(item)}><X size={12} /></button>}</span>)}</div>}
      <label className="picker-search"><Search size={15} /><span className="sr-only">搜索资料</span><input data-popover-initial-focus value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key !== "ArrowDown" || items.length === 0) return; event.preventDefault(); optionRefs.current[0]?.focus(); }} placeholder="搜索资料" /></label>
      <div className="relation-options" role="listbox" aria-label="资料" aria-multiselectable="true" aria-busy={loading} onKeyDown={(event) => {
        const next = nextRovingIndex(event.key, activeIndex, items.length);
        if (!next.handled) return;
        event.preventDefault();
        if (next.activate) { const item = items[next.index]; if (item) toggle(item); }
        else { setActiveIndex(next.index); optionRefs.current[next.index]?.focus(); }
      }}>
        {items.map((item, index) => <button ref={(element) => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selectedIds.has(item.id)} aria-disabled={locked.has(item.id) || undefined} tabIndex={index === activeIndex ? 0 : -1} className={`${index === activeIndex ? "relation-option active" : "relation-option"}${locked.has(item.id) ? " locked" : ""}`} key={item.id} onFocus={() => setActiveIndex(index)} onClick={() => toggle(item)}>
          {item.kind === "file" ? <FileIcon size={15} /> : <LinkIcon size={15} />}
          <span><strong>{item.title}</strong><small>{item.project_id ? projectNames.get(item.project_id) ?? "专案资料" : "未归入专案"}</small></span>
          {selectedIds.has(item.id) && <Check size={15} />}
        </button>)}
        {loading && items.length === 0 && <p className="ui-picker-state" role="status">正在读取资料…</p>}
        {!loading && !error && items.length === 0 && <p className="ui-picker-state">没有匹配的资料</p>}
        {error && <div className="ui-picker-state" role="alert"><span>{error}</span><button className="quiet-button" type="button" onClick={() => void load()}>重试</button></div>}
      </div>
      {nextCursor && !error && <button className="quiet-button relation-load-more" type="button" disabled={loading} onClick={() => void load({ append: true, cursor: nextCursor })}>{loading ? "正在读取…" : "载入更多"}</button>}
    </Popover>
  </div>;
}
