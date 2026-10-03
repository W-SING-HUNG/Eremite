import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { addLocalDays, calendarKeyboardTarget, calendarMonthGrid, formatCalendarDate, formatDueDate, nextMondayKey } from "@/app/_lib/action-date";
import { partitionByDueDate } from "@/app/_lib/local-date";
import { actionViewGroups, countActionsByStatus } from "@/app/_lib/action-views";

const [workspace, createDialog, datePicker, priorityPicker, relationPicker, inbox, viewerShell, actionsPage, projectPage, styles] = await Promise.all([
  readFile(new URL("../src/app/_components/actions-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/action/action-create-dialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/action/date-picker.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/action/priority-picker.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/action/content-relation-picker.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/inbox-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/_components/file-viewer/viewer-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/actions/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(workspace)/projects/[id]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/styles.css", import.meta.url), "utf8"),
]);

const grouped = partitionByDueDate([
  { id: "late", due_date: "2026-08-20" },
  { id: "today", due_date: "2026-08-21" },
  { id: "future", due_date: "2026-08-22" },
  { id: "none", due_date: null },
], "2026-08-21");
assert.deepEqual(grouped.overdue.map((item) => item.id), ["late"]);
assert.deepEqual(grouped.today.map((item) => item.id), ["today"]);
assert.deepEqual(grouped.next.map((item) => item.id), ["future", "none"]);
assert.equal(formatDueDate("2026-08-20", "2026-08-21").startsWith("逾期"), true);
assert.equal(formatCalendarDate("2026-08-20").includes("逾期"), false, "draft due dates remain metadata rather than overdue task labels");
assert.equal(addLocalDays("2026-08-21", 1), "2026-08-22");
assert.equal(nextMondayKey("2026-08-21"), "2026-08-24");
assert.equal(calendarMonthGrid("2026-08", "2026-08-21").length, 42);
assert.equal(calendarKeyboardTarget("2026-08-21", "ArrowDown"), "2026-08-28");
assert.equal(calendarKeyboardTarget("2026-08-21", "Home"), "2026-08-17");
assert.equal(calendarKeyboardTarget("2026-08-21", "PageDown"), "2026-09-21");

const actionFixtures = [
  { id: "draft-past", status: "draft", due_date: "2026-08-20" },
  { id: "active-past", status: "active", due_date: "2026-08-20" },
  { id: "active-today", status: "active", due_date: "2026-08-21" },
  { id: "active-next", status: "active", due_date: "2026-08-22" },
  { id: "done", status: "done", due_date: null },
];
assert.deepEqual(countActionsByStatus(actionFixtures), { drafts: 1, active: 3, completed: 1 }, "drafts never count as ordinary todos");
assert.deepEqual(actionViewGroups(actionFixtures, "drafts", "2026-08-21").flatMap((group) => group.items.map((item) => item.id)), ["draft-past"]);
const openGroups = actionViewGroups(actionFixtures, "open", "2026-08-21");
assert.deepEqual(openGroups.find((group) => group.title === "逾期").items.map((item) => item.id), ["active-past"]);
assert.deepEqual(openGroups.find((group) => group.title === "今天").items.map((item) => item.id), ["active-today"]);
assert.deepEqual(openGroups.find((group) => group.title === "接下来").items.map((item) => item.id), ["active-next"]);
const allGroups = actionViewGroups(actionFixtures, "all", "2026-08-21");
assert.equal(allGroups[0].title, "待确认");
assert.deepEqual(allGroups[0].items.map((item) => item.id), ["draft-past"], "all view keeps overdue drafts in the pending-confirmation group");

assert.match(workspace, /action-completion-form/);
assert.match(workspace, /action-row-main/);
assert.match(workspace, /标记为完成/);
assert.match(workspace, /恢复为待办/);
assert.match(workspace, /待确认 <span>\{counts\.drafts\}<\/span>/);
assert.match(workspace, /action\.status === "draft" && <MutationForm action=\{acceptActionDraftAction\}/);
assert.match(workspace, /接受为行动/);
assert.match(workspace, /draft \? <span className="action-draft-marker">草稿<\/span> : <MutationForm action=\{updateActionStatusAction\}/);
assert.match(workspace, /showRelativeStatus=\{action\.status !== "draft"\}/);
assert.match(workspace, /ActionInspector/);
assert.match(workspace, /ResponsiveInspector/);
assert.match(workspace, /updateActionDetailsAction/);
assert.match(workspace, /replaceActionContentItemsAction/);
assert.match(workspace, /\[\.\.\.relations\.map\(\(item\) => item\.id\)\]\.sort\(\)/);
assert.match(workspace, /\[\.\.\.savedRelationIds\]\.sort\(\)/);
assert.doesNotMatch(workspace, /type="date"/);
assert.doesNotMatch(workspace, /<Select/);
assert.doesNotMatch(workspace, /source-picker/);
assert.doesNotMatch(workspace, /disabled[^>]*专案|专案[^<]*<input[^>]*disabled/s);

assert.match(createDialog, /要推进什么？/);
assert.match(createDialog, /contextProjectId \?\?/);
assert.match(createDialog, /sourceContent\?\.project_id/);
assert.match(createDialog, /lockedIds=\{sourceContent \? \[sourceContent\.id\] : \[\]\}/);
assert.match(createDialog, /更多/);
assert.match(createDialog, /event\.ctrlKey \|\| event\.metaKey/);
assert.match(createDialog, /requestSubmit/);
assert.doesNotMatch(createDialog, /type="date"/);
assert.doesNotMatch(createDialog, /<Select/);

assert.match(datePicker, /calendarKeyboardTarget\(day\.key, event\.key\)/);
assert.match(datePicker, /role="grid"/);
assert.match(datePicker, /aria-live="polite"/);
assert.match(priorityPicker, /role="radiogroup"/);
assert.match(priorityPicker, /nextRovingIndex/);
assert.match(relationPicker, /aria-multiselectable="true"/);
assert.match(relationPicker, /nextCursor/);
assert.match(relationPicker, /载入更多/);
assert.match(relationPicker, /AbortController/);
assert.match(relationPicker, /nextRovingIndex/);
assert.match(relationPicker, /event\.key !== "ArrowDown"/);

assert.match(inbox, /setCreateActionOpen\(true\)/);
assert.match(inbox, /ActionCreateDialog/);
assert.doesNotMatch(inbox, /router\.push\(`\/actions\?createFor=/);
assert.match(viewerShell, /ActionCreateDialog/);
assert.doesNotMatch(viewerShell, /router\.push\(`\/actions\?createFor=/);
assert.match(actionsPage, /listAvailableContentItemsByIds/);
assert.doesNotMatch(actionsPage, /listContentItems/);
assert.doesNotMatch(projectPage, /listContentItems\(\)/, "Project automation view must not preload the complete Content library");
assert.match(projectPage, /tools=\{listTools\("project"\)\}/);
assert.match(styles, /v1\.2 phase 5: focused action system/);
assert.match(styles, /@media \(max-width: 420px\)/);

await assert.rejects(access(new URL("../src/app/_components/action/action-form-old.tsx", import.meta.url)));
console.log("Action system UI test passed: focused groups, true completion, contextual quick capture, local calendar, scalable relation picker and responsive inspector.");
