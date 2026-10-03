"use client";

import { useRef, useState } from "react";
import { Check, Flag } from "lucide-react";
import { Popover } from "@/app/_components/ui/popover";
import { nextRovingIndex } from "@/app/_lib/ui-keyboard";
import type { ActionPriority } from "@/modules/actions/service";

const priorities: Array<{ value: ActionPriority; label: string; description: string }> = [
  { value: "high", label: "高优先级", description: "需要优先处理" },
  { value: "normal", label: "普通优先级", description: "按正常顺序推进" },
  { value: "low", label: "低优先级", description: "有余裕时处理" },
];

export const priorityLabel: Record<ActionPriority, string> = { high: "高优先级", normal: "普通", low: "低优先级" };

export function PriorityPicker({ name, value: controlledValue, defaultValue = "normal", onValueChange, disabled = false }: {
  name?: string;
  value?: ActionPriority;
  defaultValue?: ActionPriority;
  onValueChange?: (value: ActionPriority) => void;
  disabled?: boolean;
}) {
  const [internalValue, setInternalValue] = useState<ActionPriority>(defaultValue);
  const value = controlledValue ?? internalValue;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => priorities.findIndex((item) => item.value === value));
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerFocus = useRef<() => void>(() => undefined);
  const choose = (next: ActionPriority) => {
    if (controlledValue === undefined) setInternalValue(next);
    onValueChange?.(next);
    setOpen(false);
    window.requestAnimationFrame(() => triggerFocus.current());
  };
  return <div className="action-priority-picker">
    {name && <input type="hidden" name={name} value={value} />}
    <Popover
      label="优先级"
      open={open}
      onOpenChange={(next) => { setOpen(next); if (next) setActiveIndex(Math.max(0, priorities.findIndex((item) => item.value === value))); }}
      placement="bottom-start"
      initialFocus
      className="action-priority-popover"
      trigger={({ focusTrigger, ...props }) => {
        triggerFocus.current = focusTrigger;
        return <button {...props} className={`metadata-chip priority-${value}`} disabled={disabled}><Flag size={14} /><span>{priorityLabel[value]}</span></button>;
      }}
    >
      <div className="picker-option-list" role="radiogroup" aria-label="优先级" onKeyDown={(event) => {
        const next = nextRovingIndex(event.key, activeIndex, priorities.length);
        if (!next.handled) return;
        event.preventDefault();
        if (next.activate) choose(priorities[next.index].value);
        else { setActiveIndex(next.index); optionRefs.current[next.index]?.focus(); }
      }}>
        {priorities.map((item, index) => <button
          key={item.value}
          ref={(element) => { optionRefs.current[index] = element; }}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          data-popover-initial-focus={index === activeIndex ? "true" : undefined}
          tabIndex={index === activeIndex ? 0 : -1}
          className={index === activeIndex ? `picker-option active priority-${item.value}` : `picker-option priority-${item.value}`}
          onFocus={() => setActiveIndex(index)}
          onClick={() => choose(item.value)}
        ><Flag size={15} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.value === value && <Check size={15} />}</button>)}
      </div>
    </Popover>
  </div>;
}
