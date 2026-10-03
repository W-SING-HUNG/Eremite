import { localDateKey } from "@/app/_lib/local-date";

export type CalendarDay = { key: string; day: number; inMonth: boolean; today: boolean };

export function parseLocalDateKey(key: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(key);
  if (!match) return null;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (value.getFullYear() !== Number(match[1]) || value.getMonth() !== Number(match[2]) - 1 || value.getDate() !== Number(match[3])) return null;
  return value;
}

export function addLocalDays(key: string, amount: number) {
  const date = parseLocalDateKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function addLocalMonths(key: string, amount: number) {
  const date = parseLocalDateKey(key);
  if (!date) return key;
  const targetDay = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(targetDay, lastDay));
  return localDateKey(target);
}

export function startOfLocalWeek(key: string) {
  const date = parseLocalDateKey(key);
  if (!date) return key;
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return localDateKey(date);
}

export function endOfLocalWeek(key: string) {
  return addLocalDays(startOfLocalWeek(key), 6);
}

export function nextMondayKey(today = localDateKey()) {
  const date = parseLocalDateKey(today);
  if (!date) return today;
  const days = ((8 - date.getDay()) % 7) || 7;
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function calendarMonthGrid(monthKey: string, today = localDateKey()) {
  const month = parseLocalDateKey(`${monthKey.slice(0, 7)}-01`) ?? parseLocalDateKey(today)!;
  const startOffset = (month.getDay() + 6) % 7;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - startOffset);
  return Array.from({ length: 42 }, (_, index): CalendarDay => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = localDateKey(date);
    return { key, day: date.getDate(), inMonth: date.getMonth() === month.getMonth(), today: key === today };
  });
}

export function monthLabel(monthKey: string) {
  const date = parseLocalDateKey(`${monthKey.slice(0, 7)}-01`);
  return date ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date) : monthKey;
}

export function formatDueDate(key: string | null, today = localDateKey()) {
  if (!key) return "无截止日期";
  if (key === today) return "今天";
  if (key === addLocalDays(today, 1)) return "明天";
  const label = formatCalendarDate(key);
  return key < today ? `逾期 · ${label}` : label;
}

export function formatCalendarDate(key: string | null) {
  if (!key) return "无截止日期";
  const date = parseLocalDateKey(key);
  if (!date) return key;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

export function calendarKeyboardTarget(activeKey: string, key: string) {
  switch (key) {
    case "ArrowLeft": return addLocalDays(activeKey, -1);
    case "ArrowRight": return addLocalDays(activeKey, 1);
    case "ArrowUp": return addLocalDays(activeKey, -7);
    case "ArrowDown": return addLocalDays(activeKey, 7);
    case "Home": return startOfLocalWeek(activeKey);
    case "End": return endOfLocalWeek(activeKey);
    case "PageUp": return addLocalMonths(activeKey, -1);
    case "PageDown": return addLocalMonths(activeKey, 1);
    default: return null;
  }
}
