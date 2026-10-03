"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover } from "@/app/_components/ui/popover";
import { addLocalDays, addLocalMonths, calendarKeyboardTarget, calendarMonthGrid, formatCalendarDate, formatDueDate, monthLabel, nextMondayKey, parseLocalDateKey } from "@/app/_lib/action-date";
import { localDateKey } from "@/app/_lib/local-date";

export function DatePicker({ name, value: controlledValue, defaultValue = "", onValueChange, disabled = false, label = "截止日期", showRelativeStatus = true }: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  label?: string;
  showRelativeStatus?: boolean;
}) {
  const today = localDateKey();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const initialKey = value || today;
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [monthKey, setMonthKey] = useState(initialKey.slice(0, 7));
  const triggerFocus = useRef<() => void>(() => undefined);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const days = useMemo(() => calendarMonthGrid(monthKey, today), [monthKey, today]);

  useEffect(() => {
    if (!open) return;
    const next = value || today;
    setActiveKey(next);
    setMonthKey(next.slice(0, 7));
  }, [open, today, value]);

  const setValue = (next: string) => {
    if (controlledValue === undefined) setInternalValue(next);
    onValueChange?.(next);
  };
  const choose = (next: string) => {
    setValue(next);
    setOpen(false);
    window.requestAnimationFrame(() => triggerFocus.current());
  };
  const focusDay = (next: string) => {
    setActiveKey(next);
    setMonthKey(next.slice(0, 7));
    window.requestAnimationFrame(() => dayRefs.current.get(next)?.focus());
  };
  const shiftMonth = (amount: number) => focusDay(addLocalMonths(activeKey, amount));

  return <div className="action-date-picker">
    {name && <input type="hidden" name={name} value={value} />}
    <Popover
      label={label}
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      initialFocus
      className="action-date-popover"
      trigger={({ focusTrigger, ...props }) => {
        triggerFocus.current = focusTrigger;
        return <button {...props} className={value ? "metadata-chip due" : "metadata-chip"} disabled={disabled}><CalendarDays size={14} /><span>{showRelativeStatus ? formatDueDate(value || null, today) : formatCalendarDate(value || null)}</span></button>;
      }}
    >
      <div className="date-shortcuts" aria-label="快捷日期">
        <button type="button" onClick={() => choose(today)}>今天</button>
        <button type="button" onClick={() => choose(addLocalDays(today, 1))}>明天</button>
        <button type="button" onClick={() => choose(nextMondayKey(today))}>下周一</button>
        {value && <button type="button" onClick={() => choose("")}><X size={13} />清除</button>}
      </div>
      <div className="calendar-header">
        <button className="icon-button" type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
        <strong aria-live="polite">{monthLabel(monthKey)}</strong>
        <button className="icon-button" type="button" aria-label="下个月" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid" role="grid" aria-label={monthLabel(monthKey)}>
        {days.map((day) => <button
          key={day.key}
          ref={(element) => { if (element) dayRefs.current.set(day.key, element); else dayRefs.current.delete(day.key); }}
          type="button"
          role="gridcell"
          data-popover-initial-focus={day.key === activeKey ? "true" : undefined}
          tabIndex={day.key === activeKey ? 0 : -1}
          aria-label={new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(parseLocalDateKey(day.key)!)}
          aria-current={day.today ? "date" : undefined}
          aria-selected={day.key === value}
          className={`${day.inMonth ? "" : "outside"}${day.today ? " today" : ""}${day.key === value ? " selected" : ""}`.trim()}
          onFocus={() => setActiveKey(day.key)}
          onClick={() => choose(day.key)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(day.key); return; }
            const next = calendarKeyboardTarget(day.key, event.key);
            if (!next) return;
            event.preventDefault();
            focusDay(next);
          }}
        >{day.day}</button>)}
      </div>
    </Popover>
  </div>;
}
