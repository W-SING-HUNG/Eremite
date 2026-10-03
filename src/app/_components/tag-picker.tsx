"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Tag as TagIcon, X } from "lucide-react";
import { setObjectTagsResultAction } from "@/app/resource-actions";
import type { Tag, TagObjectType } from "@/modules/tags/service";
import { tagPickerIdentity } from "@/app/_lib/tag-picker-state";
import { Popover } from "@/app/_components/ui/popover";
import { TextInput } from "@/app/_components/ui/field";
import { Button } from "@/app/_components/ui/button";
import { nextRovingIndex } from "@/app/_lib/ui-keyboard";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { showToast } from "@/app/_components/ui/toast";

export function TagPicker({ type, objectId, assigned, available, returnTo, readOnly = false }: {
  type: TagObjectType; objectId: string; assigned: Tag[]; available: Tag[]; returnTo: string; readOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [names, setNames] = useState(() => assigned.map((tag) => tag.name));
  const [activeIndex, setActiveIndex] = useState(0);
  const identity = tagPickerIdentity(type, objectId, assigned);
  useEffect(() => {
    setOpen(false);
    setQuery("");
    setNames(assigned.map((tag) => tag.name));
  }, [identity]);
  const visible = useMemo(
    () => available.filter((tag) => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    [available, query],
  );
  const toggle = (name: string) => setNames((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  const newName = query.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const canCreate = Boolean(newName && !available.some((tag) => tag.name.localeCompare(newName, undefined, { sensitivity: "accent" }) === 0) && !names.includes(newName));
  const pickerOptions = [...visible, ...(canCreate ? [{ id: "__create__", name: newName, name_key: newName, color: null, revision: 0, created_at: "", updated_at: "" }] : [])];
  const close = () => { setNames(assigned.map((tag) => tag.name)); setQuery(""); setOpen(false); };
  const onPickerKeyDown = (event: React.KeyboardEvent) => {
    const next = nextRovingIndex(event.key, activeIndex, pickerOptions.length);
    if (!next.handled) return;
    event.preventDefault();
    setActiveIndex(next.index);
    if (!next.activate) { document.getElementById(`tag-picker-${objectId}-${next.index}`)?.scrollIntoView({ block: "nearest" }); return; }
    const option = pickerOptions[next.index];
    if (!option) return;
    if (option.id === "__create__") { setNames((current) => [...current, newName]); setQuery(""); }
    else toggle(option.name);
  };

  return <section className="tag-picker">
    <header><span><TagIcon size={14} />标签</span>{!readOnly && <Popover open={open} onOpenChange={(next) => next ? setOpen(true) : close()} label="编辑标签" placement="bottom-end" initialFocus className="tag-popover-shell" trigger={({ focusTrigger: _focusTrigger, ...props }) => <button {...props} className="quiet-icon-button"><Plus size={14} />编辑</button>}><MutationForm action={setObjectTagsResultAction} className="tag-popover" onSuccess={() => { setOpen(false); setQuery(""); showToast({ title: "标签已更新", tone: "success" }); router.refresh(); }}>{({ pending }) => <>
      <input type="hidden" name="type" value={type} /><input type="hidden" name="id" value={objectId} /><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="tags" value={names.join(", ")} />
      <label><span className="sr-only">查找或创建标签</span><TextInput data-popover-initial-focus role="combobox" aria-expanded="true" aria-controls={`tag-options-${objectId}`} aria-activedescendant={pickerOptions[activeIndex] ? `tag-picker-${objectId}-${activeIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onPickerKeyDown} placeholder="查找或创建标签" disabled={pending} /></label>
      <div className="tag-options" id={`tag-options-${objectId}`} role="listbox" aria-label="可用标签" aria-multiselectable="true">{visible.map((tag, index) => <button id={`tag-picker-${objectId}-${index}`} type="button" role="option" aria-selected={names.includes(tag.name)} tabIndex={-1} className={index === activeIndex ? "tag-option active" : "tag-option"} onMouseEnter={() => setActiveIndex(index)} onClick={() => toggle(tag.name)} disabled={pending} key={tag.id}><span>{tag.name}</span>{names.includes(tag.name) && <Check size={14} />}</button>)}{canCreate && <button id={`tag-picker-${objectId}-${visible.length}`} type="button" role="option" aria-selected="false" tabIndex={-1} className={visible.length === activeIndex ? "tag-option active" : "tag-option"} onMouseEnter={() => setActiveIndex(visible.length)} onClick={() => { setNames((current) => [...current, newName]); setQuery(""); }} disabled={pending}><span>创建“{newName}”</span><Plus size={14} /></button>}{visible.length === 0 && !canCreate && <p>没有匹配标签</p>}</div>
      <div className="tag-picker-footer"><Link href="/tags">管理标签</Link><div className="dialog-actions"><Button type="button" size="small" onClick={close} disabled={pending}>取消</Button><Button variant="primary" size="small" loading={pending}>保存</Button></div></div>
    </>}</MutationForm></Popover>}</header>
    <div className="tag-chips">{names.length === 0 ? <span className="tag-placeholder">未添加标签</span> : names.map((name) => <span className="tag-chip" key={name}>{name}{open && <button type="button" aria-label={`移除 ${name}`} onClick={() => toggle(name)}><X size={12} /></button>}</span>)}</div>
  </section>;
}
