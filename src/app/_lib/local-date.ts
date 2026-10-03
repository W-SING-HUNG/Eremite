export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dueDateGroup(dueDate: string | null, today = localDateKey()): "overdue" | "today" | "next" {
  if (!dueDate) return "next";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "next";
}

export function partitionByDueDate<T extends { due_date: string | null }>(items: T[], today = localDateKey()) {
  const result = { overdue: [] as T[], today: [] as T[], next: [] as T[] };
  for (const item of items) result[dueDateGroup(item.due_date, today)].push(item);
  return result;
}

export function millisecondsUntilNextLocalDay(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1, next.getTime() - date.getTime());
}
