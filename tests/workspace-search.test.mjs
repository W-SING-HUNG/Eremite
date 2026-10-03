import assert from "node:assert/strict";
import { buildWorkspaceSearchEntries } from "../src/app/_lib/workspace-search.js";

const entries = buildWorkspaceSearchEntries({
  content: [{ id: "c1", title: "访谈记录", kind: "file", tags: "研究", status: "inbox" }],
  actions: [{ id: "a1", title: "整理访谈", status: "active", priority: "high", due_date: "2026-08-10" }],
  runs: [{ id: "r1", target_id: "core.content-to-action-drafts", target_name_snapshot: "从资料生成行动草稿", input_summary: "已选择 1 条资料", status: "completed", output_summary: "创建 1 个草稿。", error_message: null }],
});

assert.equal(entries.length, 3);
assert.deepEqual(entries.map((entry) => entry.group), ["资料", "行动台", "运行记录"]);
assert.equal(entries.find((entry) => entry.id === "action:a1")?.href, "/actions?selected=a1");
console.log("Workspace search test passed.");
