"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "@/app/_components/ui/popover";
import { isVisiblyFocusable } from "@/app/_components/ui/overlay";
import { nextRovingIndex } from "@/app/_lib/ui-keyboard";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export function Select({
  options, value: controlledValue, defaultValue = "", onValueChange, name, label, placeholder = "请选择", disabled = false, invalid = false, describedBy, className = "",
}: {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const initialIndexRef = useRef(0);
  const focusTriggerRef = useRef<() => void>(() => undefined);
  const listboxId = useId();
  const value = controlledValue ?? internalValue;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value && !option.disabled));
  const selected = options.find((option) => option.value === value);
  const choose = (nextValue: string) => {
    if (controlledValue === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    setOpen(false);
    window.requestAnimationFrame(() => focusTriggerRef.current());
  };
  useEffect(() => {
    if (!open) return;
    const initialIndex = initialIndexRef.current;
    setActiveIndex(initialIndex);
    let frame = 0;
    const focusWhenMounted = () => {
      const target = document.getElementById(`${listboxId}-${initialIndex}`);
      if (!target || !isVisiblyFocusable(target)) { frame = window.requestAnimationFrame(focusWhenMounted); return; }
      target.focus();
    };
    frame = window.requestAnimationFrame(focusWhenMounted);
    return () => window.cancelAnimationFrame(frame);
  }, [listboxId, open]);
  return <div className={`ui-select ${className}`.trim()}>
    {name && <input type="hidden" name={name} value={value} />}
    <Popover
      label={label}
      open={open}
      onOpenChange={(next) => { if (!disabled) setOpen(next); }}
      placement="bottom-start"
      className="ui-select__popover"
      trigger={({ focusTrigger, ...triggerProps }) => {
        focusTriggerRef.current = focusTrigger;
        return <button
        {...triggerProps}
        className="ui-select__trigger"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => { initialIndexRef.current = selectedIndex; triggerProps.onClick(); }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            initialIndexRef.current = event.key === "ArrowUp" || event.key === "End" ? Math.max(0, options.length - 1) : 0;
            setOpen(true);
          }
        }}
      ><span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder}</span><ChevronDown size={15} aria-hidden="true" /></button>;
      }}
    >
      <div
        id={listboxId}
        className="ui-select__list"
        role="listbox"
        aria-label={label}
        aria-activedescendant={options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        onKeyDown={(event) => {
          const enabled = options.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled);
          const enabledIndex = Math.max(0, enabled.findIndex(({ index }) => index === activeIndex));
          const next = nextRovingIndex(event.key, enabledIndex, enabled.length);
          if (!next.handled) return;
          event.preventDefault();
          const target = enabled[next.index];
          if (!target) return;
          if (next.activate) choose(target.option.value); else { setActiveIndex(target.index); document.getElementById(`${listboxId}-${target.index}`)?.focus(); }
        }}
      >
        {options.map((option, index) => <button
          id={`${listboxId}-${index}`}
          type="button"
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          tabIndex={index === activeIndex ? 0 : -1}
          className="ui-select__option"
          key={option.value}
          onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
          onClick={() => { if (!option.disabled) choose(option.value); }}
        ><span>{option.label}</span>{option.value === value && <Check size={14} aria-hidden="true" />}</button>)}
      </div>
    </Popover>
  </div>;
}
