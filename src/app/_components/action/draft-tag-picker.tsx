"use client";

import { useMemo, useState } from "react";
import { Check, Search, Tag as TagIcon } from "lucide-react";
import { Popover } from "@/app/_components/ui/popover";
import type { Tag } from "@/modules/tags/service";

export function DraftTagPicker({ available, value, onValueChange, disabled = false }: {
  available: Tag[];
  value: string[];
  onValueChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.normalize("NFKC").trim();
  const options = useMemo(() => available.filter((tag) => tag.name.toLocaleLowerCase().includes(normalized.toLocaleLowerCase())), [available, normalized]);
  const selected = new Set(value);
  const toggle = (name: string) => onValueChange(selected.has(name) ? value.filter((item) => item !== name) : [...value, name]);
  return <div className="draft-tag-picker">
    <input type="hidden" name="tags" value={value.join(", ")} />
    <Popover label="添加标签" placement="bottom-start" initialFocus className="draft-tag-popover" trigger={({ focusTrigger: _focusTrigger, ...props }) => <button {...props} className="metadata-chip" disabled={disabled}><TagIcon size={14} /><span>{value.length ? `${value.length} 个标签` : "添加标签"}</span></button>}>
      <label className="picker-search"><Search size={15} /><span className="sr-only">搜索标签</span><input data-popover-initial-focus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签" /></label>
      <div className="picker-option-list" role="listbox" aria-label="标签" aria-multiselectable="true">
        {options.map((tag) => <button className="picker-option compact" type="button" role="option" aria-selected={selected.has(tag.name)} key={tag.id} onClick={() => toggle(tag.name)}><TagIcon size={14} /><span><strong>{tag.name}</strong></span>{selected.has(tag.name) && <Check size={14} />}</button>)}
        {normalized && !available.some((tag) => tag.name.toLocaleLowerCase() === normalized.toLocaleLowerCase()) && <button className="picker-option compact" type="button" onClick={() => { onValueChange([...value, normalized]); setQuery(""); }}><TagIcon size={14} /><span><strong>新建“{normalized}”</strong></span></button>}
        {options.length === 0 && !normalized && <p className="ui-picker-state">还没有标签</p>}
      </div>
    </Popover>
  </div>;
}
