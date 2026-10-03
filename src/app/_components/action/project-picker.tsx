"use client";

import { useMemo, useRef, useState } from "react";
import { Check, FolderKanban, Search } from "lucide-react";
import { Popover } from "@/app/_components/ui/popover";
import type { Project } from "@/modules/projects/service";

export function ProjectPicker({ projects, name, value, onValueChange, disabled = false }: {
  projects: Project[];
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerFocus = useRef<() => void>(() => undefined);
  const options = useMemo(() => [{ id: "", name: "未归入专案" }, ...projects].filter((project) => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [projects, query]);
  const label = projects.find((project) => project.id === value)?.name ?? "未归入专案";
  const choose = (next: string) => {
    onValueChange(next);
    setOpen(false);
    setQuery("");
    window.requestAnimationFrame(() => triggerFocus.current());
  };
  return <div className="action-project-picker">
    {name && <input type="hidden" name={name} value={value} />}
    <Popover
      label="选择专案"
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}
      placement="bottom-start"
      initialFocus
      className="action-project-popover"
      trigger={({ focusTrigger, ...props }) => {
        triggerFocus.current = focusTrigger;
        return <button {...props} className="metadata-chip" disabled={disabled}><FolderKanban size={14} /><span>{label}</span></button>;
      }}
    >
      <label className="picker-search"><Search size={15} /><span className="sr-only">搜索专案</span><input data-popover-initial-focus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索专案" /></label>
      <div className="picker-option-list" role="listbox" aria-label="专案">
        {options.map((project) => <button type="button" role="option" aria-selected={project.id === value} className="picker-option compact" key={project.id || "unassigned"} onClick={() => choose(project.id)}><FolderKanban size={15} /><span><strong>{project.name}</strong></span>{project.id === value && <Check size={15} />}</button>)}
        {options.length === 0 && <p className="ui-picker-state">没有匹配的专案</p>}
      </div>
    </Popover>
  </div>;
}
