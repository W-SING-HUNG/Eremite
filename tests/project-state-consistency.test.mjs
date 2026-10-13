import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkDocument, checkPullRequest } from "../scripts/check-project-state.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(projectRoot, "scripts/check-project-state.mjs");
const document = await readFile(path.join(projectRoot, "docs/PUBLIC-STATE.md"), "utf8");
const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
const root = await mkdtemp(path.join(tmpdir(), "eremite-project-state-consistency-"));
const repo = path.join(root, "repository");
const env = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1", EREMITE_DATA_DIR: path.join(root, "data"), TEMP: root, TMP: root };
for (const key of ["GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_TEMPLATE_DIR"]) delete env[key];
let cases = 0;
function cli(cwd, args = [], extraEnv = {}, expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env: { ...env, ...extraEnv }, encoding: "utf8", shell: false, windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
  cases += 1;
  return result;
}
function git(...args) {
  const result = spawnSync("git", args, { cwd: repo, env, encoding: "utf8", shell: false, windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Fixture git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}
async function put(filename, content) {
  await mkdir(path.dirname(path.join(repo, filename)), { recursive: true });
  await writeFile(path.join(repo, filename), content);
}
function commit(message) { git("add", "--all"); git("commit", "-m", message); return git("rev-parse", "HEAD"); }
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const body = reason => `## Project state impact\n\n- [ ] Updated current project state\n- [x] No state update needed\n\n- tools: ${reason}\n`;
const toolPath = "src/modules/automations/tools/file-converter/server-tool.ts";
const capabilityPath = "src/modules/automations/tools/file-converter/accepted-capabilities.json";
const canonicalPath = "src/modules/automations/tools/file-converter/canonical-tool-contract-v1.1.json";
const realCapabilities = JSON.parse(await readFile(path.join(projectRoot, capabilityPath), "utf8"));
const realContract = JSON.parse(await readFile(path.join(projectRoot, canonicalPath), "utf8"));
const withRow = (text, id, update) => text.replace(new RegExp(`^\\| ${id} \\|[^\\n]+$`, "mu"), line => {
  const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
  const changed = update(cells);
  return `| ${changed.join(" | ")} |`;
});
const describeRow = (text, id, note) => withRow(text, id, cells => [cells[0], cells[1], `${cells[2]} ${note}`]);
const gitTodoRegressions = [
  "该修复尚未合入 main", "尚未集成到 main", "待合入", "未合入", "待创建 PR", "待开 PR",
  "not merged into main yet", "pending integration into main", "still on the feature branch",
  "not yet in main", "to be merged after CI", "needs a squash merge",
];
const engineeringDescriptions = [
  "pdf.merge must merge the supplied pages in the given order.",
  "a retry must create a new child Automation Run.",
  "需要合并的页序由调用方显式给出。",
];
const disguisedGitTodos = [
  "Maintenance rule: never write pending push as current project state, but push the branch and create a PR as current project state.",
  "工程规范：不得把待推送写成当前项目状态，但待创建 PR 应作为当前项目状态。",
  "Maintenance rule: never write pending push as current project state; not merged into main yet.",
  "Engineering rule: never record pending merge as current project state, but still on the feature branch.",
  "工程规范：不得把待合并写成当前项目状态；该修复尚未合入 main。",
  "Maintenance rule: never push the branch. Needs a squash merge.",
];
try {
  checkDocument(document, pkg, lock);
  const mutations = [
    ["PDF pending", document.replace("| pdf-tools-root-destination | RESOLVED |", "| pdf-tools-root-destination | PARTIAL | Git integration remains pending; ")],
    ["PDF partial", document.replace("| pdf-tools-root-destination | RESOLVED |", "| pdf-tools-root-destination | PARTIAL |")],
    ["FC partial", document.replace("| file-converter-root-destination | RESOLVED |", "| file-converter-root-destination | PARTIAL |")],
    ["public version", document.replace(`| public-host-package | \`${pkg.version}\` |`, "| public-host-package | `9.9.9` |")],
    ["merge next step", document.replace("## Current Next Step", "## Current Next Step\n\nMerge PR #4 only after CI SUCCESS.")],
    ["Chinese pending", document.replace("## Current Next Step", "## Current Next Step\n\n等待 Git 集成，合并 PR #4。")],
    ["missing entry", document.replace(/^\| pdf-tools-root-destination.*\n/mu, "")],
    ["duplicate entry", document.replace("| pdf-tools-root-destination |", "| pdf-tools-root-destination | RESOLVED | duplicate |\n| pdf-tools-root-destination |")],
    ["duplicate section", document + "\n## Current Version\ninvalid\n"],
    ["pending current prose", document.replace("## In Progress", "## In Progress\n\nPDF Tools is not yet resolved in main; Git integration remains pending.")],
    ...["待推送、待合并。", "需要 push 分支并创建 PR。", "Need to push the branch and create a PR.", "Pending push and merge.", "Awaiting push of the current branch.", "下一步需推送当前分支。"].map((text, i) => [`F2 variant ${i}`, document.replace("## Current Next Step", `## Current Next Step\n\n${text}`)]),
    ...gitTodoRegressions.map((text, i) => [`B1 Git object and state ${i}`, document.replace("## Current Next Step", `## Current Next Step\n\n${text}`)]),
    ...disguisedGitTodos.map((text, i) => [`B1 disguised rule ${i}`, document.replace("## Current Next Step", `## Current Next Step\n\n${text}`)]),
  ];
  for (const [name, mutated] of mutations) {
    const filename = path.join(root, `${name.replaceAll(" ", "-")}.md`);
    await writeFile(filename, mutated);
    assert.throws(() => checkDocument(mutated, pkg, lock), undefined, name);
    const result = cli(projectRoot, ["--document", filename], {}, 1);
    assert.match(result.stderr, /Project state check failed/u);
  }
  for (const [i, text] of engineeringDescriptions.entries()) {
    const fixture = document.replace("## Current Next Step", `## Current Next Step\n\n${text}`);
    checkDocument(fixture, pkg, lock);
    const filename = path.join(root, `B2-engineering-${i}.md`);
    await writeFile(filename, fixture);
    cli(projectRoot, ["--document", filename]);
  }
  // The same examples remain correctly classified in other current chapters.
  assert.throws(() => checkDocument(document.replace("## Current Architecture", "## Current Architecture\n\npending integration into main\n"), pkg, lock), /Temporary Git workflow/u);
  checkDocument(document.replace("## Current Architecture", `## Current Architecture\n\n${engineeringDescriptions.join("\n")}\n`), pkg, lock);
  for (const mutatedLock of [{ ...lock, version: "9.9.9" }, { ...lock, packages: { ...lock.packages, "": { ...lock.packages[""], version: "9.9.9" } } }]) assert.throws(() => checkDocument(document, pkg, mutatedLock), /versions disagree/u);
  assert.throws(() => checkDocument(document, { ...pkg, version: "9.9.9" }, lock), /versions disagree/u);
  const historical = document + "\n## Historical fixture — 2026-01-01\nOld HEAD abcdef0123456789; Git integration remains pending. Merge PR #4 only after CI. Screenshot acceptance NOT VERIFIED. 待推送、待合并；需要 push 分支并创建 PR。 Need to push the branch and create a PR. Pending push and merge.\n" + gitTodoRegressions.join("\n") + "\n";
  await writeFile(path.join(root, "historical.md"), historical);
  cli(projectRoot, ["--document", path.join(root, "historical.md")]);
  const followUp = document.replace("## Current Next Step", "## Current Next Step\n\nFOLLOW-UP — unfinished new capability, NOT VERIFIED.\n");
  checkDocument(followUp, pkg, lock);
  await writeFile(path.join(root, "follow-up.md"), followUp);
  cli(projectRoot, ["--document", path.join(root, "follow-up.md")]);
  const rules = document.replace("## Git / GitHub Source of Truth", "## Git / GitHub Source of Truth\n\nEngineering rule: never record pending push or pending merge as current project state.\n工程规范：不得把待推送、待合并写成当前项目状态。\n");
  await writeFile(path.join(root, "rules.md"), rules);
  cli(projectRoot, ["--document", path.join(root, "rules.md")]);
  const directProhibitions = document.replace("## Git / GitHub Source of Truth", "## Git / GitHub Source of Truth\n\nEngineering rule: never push the branch directly to main.\n工程规范：不得创建 PR。\n");
  await writeFile(path.join(root, "direct-prohibitions.md"), directProhibitions);
  cli(projectRoot, ["--document", path.join(root, "direct-prohibitions.md")]);
  for (const [i, text] of gitTodoRegressions.entries()) {
    const rule = /[\u4e00-\u9fff]/u.test(text) ? `工程规范：不得把${text}写成当前项目状态。` : `Maintenance rule: never write ${text} as current project state.`;
    const legal = document.replace("## Git / GitHub Source of Truth", `## Git / GitHub Source of Truth\n\n${rule}\n`);
    await writeFile(path.join(root, `B1-legal-example-${i}.md`), legal);
    cli(projectRoot, ["--document", path.join(root, `B1-legal-example-${i}.md`)]);
    const smuggled = legal.replace(rule, `${rule} ${text}`);
    await writeFile(path.join(root, `B1-rule-with-todo-${i}.md`), smuggled);
    cli(projectRoot, ["--document", path.join(root, `B1-rule-with-todo-${i}.md`)], {}, 1);
  }
  assert.throws(() => checkDocument(document.replace("## Current Next Step", "## Current Next Step\n\nEngineering rule: never record pending push in this summary; Need to push this branch.\n"), pkg, lock), /Temporary Git workflow/u);
  cli(projectRoot);
  console.log("B1/B2 PASS: all 12 reported Git todos exit 1; all 3 engineering descriptions exit 0; 6 disguised-rule todos exit 1; existing todos, history, rules, FOLLOW-UP and NOT VERIFIED remain covered.");

  // All commits and the Squash Merge below occur only in this new disposable repository.
  await mkdir(repo);
  git("init", "--initial-branch=main");
  git("config", "user.name", "Project State QA");
  git("config", "user.email", "project-state-qa@local.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("config", "core.longpaths", "true");
  const hooks = path.join(root, "empty-hooks"); await mkdir(hooks); git("config", "core.hooksPath", hooks);
  await put("docs/PUBLIC-STATE.md", document);
  await put("package.json", JSON.stringify(pkg));
  await put("package-lock.json", JSON.stringify(lock));
  await put(toolPath, "export const validationMessage = 'original';\n");
  await put(capabilityPath, JSON.stringify(realCapabilities));
  await put(canonicalPath, JSON.stringify(realContract));
  for (const filename of ["src/modules/automations/tools/pdf-tools/accepted-capabilities.json", "src/modules/automations/tools/pdf-tools/canonical-supplier-protocol-v1.json"]) await put(filename, await readFile(path.join(projectRoot, filename), "utf8"));
  await put("src/modules/automations/tools/file-converter/contract.ts", "export type Protocol = { version: 1 };\n");
  await put("src/app/actions.ts", "export async function executeAutomationToolAction() { return 1; }\nexport async function ordinaryAction() { return 1; }\n");
  const baseline = commit("fixture baseline");
  // Retry can change entirely within these two public UI surfaces; both need Tool state review.
  for (const [i, filename] of ["src/app/_components/automations-workspace.tsx", "src/app/_lib/automation-retry.ts"].entries()) {
    git("switch", "-c", `retry-monitor-${i}`, baseline);
    await put(filename, "export const retryAvailable = true;\n");
    const monitored = commit("isolated Retry UI change without state");
    assert.throws(() => checkPullRequest({ root: repo, base: baseline, head: monitored, body: "" }), /explicit no-update/u, filename);
    assert.throws(() => checkPullRequest({ root: repo, base: baseline, head: monitored, body: body("<reason>") }), /Concrete review/u, filename);
    const explanation = body("Only clarifies an existing Retry confirmation message; frozen inputs, supported capabilities and all verification boundaries remain unchanged.");
    assert.deepEqual(checkPullRequest({ root: repo, base: baseline, head: monitored, body: explanation }).groups, ["tools"]);
    await writeFile(path.join(root, "retry-body.md"), explanation);
    cli(repo, ["--base", baseline, "--head", monitored], {}, 1);
    cli(repo, ["--base", baseline, "--head", monitored, "--pr-body-file", path.join(root, "retry-body.md")]);
    await put("docs/PUBLIC-STATE.md", describeRow(document, "file-converter-root-destination", "Reviewed the existing Retry confirmation surface and frozen destination boundary."));
    const synchronized = commit("isolated Retry UI and corresponding state review");
    checkPullRequest({ root: repo, base: baseline, head: synchronized, body: "## Project state impact\n- [x] Updated current project state\n" });
    git("switch", "-c", `retry-removal-${i}`, monitored);
    git("rm", "--", filename);
    const removed = commit("isolated Retry capability removal without state");
    assert.throws(() => checkPullRequest({ root: repo, base: monitored, head: removed, body: "" }), /explicit no-update/u, filename);
    cli(repo, ["--base", monitored, "--head", removed], {}, 1);
  }
  git("switch", "main");
  git("switch", "-c", "feature");
  await put(toolPath, "export const validationMessage = 'clarified';\n");
  const noDocHead = commit("ordinary monitored change without state update");
  const compare = explanation => checkPullRequest({ root: repo, base: baseline, head: noDocHead, body: explanation });
  assert.throws(() => compare(""), /explicit no-update/u);
  assert.throws(() => compare(body("<reason>")), /Concrete review/u);
  assert.throws(() => compare(body("No impact")), /Concrete review/u);
  compare(body("Only clarifies an existing validation error message; supported conversions, destination semantics and verification limits remain unchanged."));
  const bodyFile = path.join(root, "pr-body.md");
  await writeFile(bodyFile, body("Only clarifies an existing validation error message; supported conversions, destination semantics and verification limits remain unchanged."));
  cli(repo, ["--base", baseline, "--head", noDocHead], {}, 1);
  cli(repo, ["--base", baseline, "--head", noDocHead, "--pr-body-file", bodyFile]);

  await put("docs/PUBLIC-STATE.md", historical.replace("Last Verified Date:", "Last Verified Date: "));
  const historyHead = commit("history and whitespace do not synchronize current state");
  assert.throws(() => checkPullRequest({ root: repo, base: baseline, head: historyHead, body: "" }), /explicit no-update/u);
  await put("docs/PUBLIC-STATE.md", document.replace("2026-10-12 (Asia/Shanghai)", "2026-10-13 (Asia/Shanghai)").replace("Current Post-release Maintenance — 2026-10-12", "Current Post-release Maintenance — 2026-10-13"));
  const dateHead = commit("date alone does not synchronize capabilities");
  assert.throws(() => checkPullRequest({ root: repo, base: baseline, head: dateHead, body: "" }), /explicit no-update/u);

  // A feature PR updates implementation and its target state before merge.
  const featureDocument = describeRow(document, "file-converter-capabilities", "Isolated feature fixture changes the first conversion default profile to high_quality.").replace("## Current Next Step", "## Current Next Step\n\nFOLLOW-UP — reviewed fixture feature remains bounded to its current verification coverage.\n");
  const featureCapabilities = structuredClone(realCapabilities);
  featureCapabilities.conversions[0].defaultProfile = "high_quality";
  await put(capabilityPath, JSON.stringify(featureCapabilities));
  await put(toolPath, "export const validationMessage = 'clarified';\nexport const fixtureCapability = true;\n");
  await put("docs/PUBLIC-STATE.md", featureDocument);
  const head = commit("feature implementation and target state in the same PR");
  const eventFile = path.join(root, "pull-request.json");
  await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: baseline }, head: { sha: head }, body: "## Project state impact\n- [x] Updated current project state\n" } }));
  const beforeMerge = await readFile(path.join(repo, "docs/PUBLIC-STATE.md"));
  cli(repo, [], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventFile });
  cli(repo, [], { GITHUB_EVENT_NAME: "pull_request" }, 1);
  await writeFile(path.join(root, "invalid-event.json"), "{}");
  cli(repo, [], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: path.join(root, "invalid-event.json") }, 1);
  git("switch", "main");
  await put("README.md", "Independent main advancement.\n");
  const advancedMain = commit("main advances independently");
  await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: advancedMain }, head: { sha: head }, body: "" } }));
  git("switch", "feature");
  cli(repo, [], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventFile });
  git("switch", "main");
  git("merge", "--squash", "feature");
  const merged = commit("squashed feature");
  assert.notEqual(merged, head);
  assert.equal(git("rev-list", "--count", `${advancedMain}..${merged}`), "1");
  assert.equal(digest(await readFile(path.join(repo, "docs/PUBLIC-STATE.md"))), digest(beforeMerge), "main receives byte-identical state; no post-merge documentation repair");
  cli(repo, [], { GITHUB_EVENT_NAME: "push" });
  cli(repo, [], { GITHUB_EVENT_NAME: "workflow_dispatch" });
  assert.equal(git("status", "--porcelain"), "", "main checks modify no fixture files");
  console.log("Lifecycle PASS: code + state PR → PR checks (including advanced base) → Squash Merge → main/dispatch checks; PUBLIC-STATE.md SHA-256 identical before/after merge, no post-merge edit.");

  git("switch", "-c", "critical");
  await put(capabilityPath, JSON.stringify({ ...featureCapabilities, schemaVersion: 2 }));
  const criticalHead = commit("critical capability change without state update");
  await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: merged }, head: { sha: criticalHead }, body: await readFile(bodyFile, "utf8") } }));
  cli(repo, [], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventFile }, 1);
  const changedVersion = { ...pkg, version: "9.9.9" };
  await put("package.json", JSON.stringify(changedVersion));
  cli(repo, [], {}, 1);
  await put("package.json", JSON.stringify(pkg));
  const badDocument = featureDocument.replace("| pdf-tools-root-destination | RESOLVED |", "| pdf-tools-root-destination | PARTIAL |");
  await put("docs/PUBLIC-STATE.md", badDocument);
  cli(repo, [], {}, 1);
  await put("docs/PUBLIC-STATE.md", featureDocument);

  const reviewExplanation = await readFile(bodyFile, "utf8");
  for (const [name, filename, content] of [
    ["version", "package.json", JSON.stringify({ ...pkg, version: "9.9.9" })],
    ["canonical-contract", canonicalPath, JSON.stringify({ ...realContract, description: "Isolated changed contract description" })],
    ["typed-contract", "src/modules/automations/tools/file-converter/contract.ts", "export type Protocol = { version: 2 };\n"],
    ["supplier-artifact", "vendor/file-converter/fixture.tgz", "disposable artifact change fixture"],
    ["supplier-lock", "package-lock.json", JSON.stringify({ ...lock, packages: { ...lock.packages, "node_modules/file-converter-core": { ...lock.packages["node_modules/file-converter-core"], version: "9.9.9" } } })],
  ]) {
    git("switch", "-c", `critical-${name}`, merged);
    await put(filename, content);
    const changed = commit(`critical ${name} without current-state synchronization`);
    assert.throws(() => checkPullRequest({ root: repo, base: merged, head: changed, body: reviewExplanation }), /Critical boundary changes/u, `Critical change case: ${name}`);
    cli(repo, ["--base", merged, "--head", changed, "--pr-body-file", bodyFile], {}, 1);
  }

  // F1: valid public version tuple; real capability/protocol JSON changes cannot be
  // synchronized by dates, historical records, unrelated prose or another Tool's entry.
  const pdfCapabilitiesPath = "src/modules/automations/tools/pdf-tools/accepted-capabilities.json";
  const pdfProtocolPath = "src/modules/automations/tools/pdf-tools/canonical-supplier-protocol-v1.json";
  const pdfCapabilities = JSON.parse(await readFile(path.join(projectRoot, pdfCapabilitiesPath), "utf8"));
  const pdfProtocol = JSON.parse(await readFile(path.join(projectRoot, pdfProtocolPath), "utf8"));
  const changedCapabilities = structuredClone(featureCapabilities);
  changedCapabilities.conversions[0].defaultProfile = "lossless";
  const changedPdfCapabilities = structuredClone(pdfCapabilities);
  changedPdfCapabilities.operations[0].maximumInputs -= 1;
  const boundaryCases = [
    ["fc-capabilities", capabilityPath, "file-converter-capabilities", JSON.stringify(changedCapabilities), "Isolated fixture changes the first conversion default profile to lossless."],
    ["fc-contract", canonicalPath, "file-converter-contract", JSON.stringify({ ...realContract, description: "Isolated revised canonical contract" }), "Isolated fixture revises the canonical contract description; existing Host authority remains bounded."],
    ["pdf-capabilities", pdfCapabilitiesPath, "pdf-tools-capabilities", JSON.stringify(changedPdfCapabilities), "Isolated fixture reduces the merge maximum input count by one."],
    ["pdf-protocol", pdfProtocolPath, "pdf-tools-contract", JSON.stringify({ ...pdfProtocol, description: "Isolated revised PDF protocol" }), "Isolated fixture revises the PDF protocol description; output validation remains Host-owned."],
    ["fc-typed-contract", "src/modules/automations/tools/file-converter/contract.ts", "file-converter-contract", "export type Protocol = { version: 2 };\n", "Isolated fixture declares Protocol version 2 in the typed Contract."],
    ["provider-contract", "src/modules/ai/contracts.ts", "provider-contract", "export type RuntimeFixture = { version: 2 };\n", "Isolated fixture introduces a revised typed Runtime interface."],
  ];
  for (const [name, filename, id, content, description] of boundaryCases) {
    const unrelatedEntry = id.startsWith("pdf-tools") ? "file-converter-capabilities" : "pdf-tools-capabilities";
    const falseUpdates = [
      ["inline-date", featureDocument.replace("public source release last checked 2026-10-04", "public source release last checked 2026-10-11")],
      ["unrelated-prose", featureDocument.replace("## Current Next Step", "## Current Next Step\n\nDocumentation explanation: reviewed local engineering guidance.\n")],
      ["wrong-entry", describeRow(featureDocument, unrelatedEntry, "Reviewed an unrelated capability explanation.")],
      ["entry-date", describeRow(featureDocument, id, "; reviewed 2026-10-11")],
      ["entry-timestamp", describeRow(featureDocument, id, "; reviewed 2026-10-11T12:30:00Z")],
      ["layout", withRow(featureDocument, id, cells => [cells[0], cells[1], cells[2].replaceAll(" ", "  ")])],
      ["history", featureDocument + "\n## Historical review — 2026-10-11\nThis dated note does not describe the current boundary.\n"],
    ];
    for (const [variant, falseDocument] of falseUpdates) {
      git("switch", "-c", `F1-${name}-${variant}`, merged);
      await put(filename, content);
      await put("docs/PUBLIC-STATE.md", falseDocument);
      const changed = commit(`F1 ${name} false synchronization: ${variant}`);
      assert.throws(() => checkPullRequest({ root: repo, base: merged, head: changed, body: reviewExplanation }), /Critical boundary changes|corresponding current entry/u);
      cli(repo, ["--base", merged, "--head", changed, "--pr-body-file", bodyFile], {}, 1);
    }
    git("switch", "-c", `F1-${name}-correct`, merged);
    await put(filename, content);
    await put("docs/PUBLIC-STATE.md", describeRow(featureDocument, id, description));
    const correct = commit(`F1 ${name} corresponding current entry updated`);
    assert.ok(checkPullRequest({ root: repo, base: merged, head: correct, body: "" }).requiredEntries.includes(id));
    cli(repo, ["--base", merged, "--head", correct]);
  }

  // Host version controls distinguish a malformed fixture from a valid version update.
  git("switch", "-c", "F1-invalid-host-version-date", merged);
  await put("package.json", JSON.stringify({ ...pkg, version: "9.9.9" }));
  await put("docs/PUBLIC-STATE.md", featureDocument.replace("public source release last checked 2026-10-04", "public source release last checked 2026-10-11"));
  const invalidVersion = commit("invalid host version tuple, not a valid bypass");
  assert.match(cli(repo, ["--base", merged, "--head", invalidVersion], {}, 1).stderr, /versions disagree/u);
  git("switch", "-c", "F1-valid-host-version", merged);
  const nextPackage = { ...pkg, version: "9.9.9" };
  const nextLock = { ...lock, version: "9.9.9", packages: { ...lock.packages, "": { ...lock.packages[""], version: "9.9.9" } } };
  const nextVersionDocument = withRow(featureDocument, "public-host-package", cells => [cells[0], "`9.9.9`", cells[2]]);
  checkDocument(nextVersionDocument, nextPackage, nextLock);
  await put("package.json", JSON.stringify(nextPackage));
  await put("package-lock.json", JSON.stringify(nextLock));
  await put("docs/PUBLIC-STATE.md", nextVersionDocument);
  const validVersion = commit("all four host version values and actual entry value updated");
  cli(repo, ["--base", merged, "--head", validVersion]);
  console.log("F1 Host version controls PASS: package/lock/root-lock/current-entry agree for the valid update; a date-only malformed tuple is rejected.");

  // An actual Node boundary change must update its value, not its commentary.
  for (const [variant, nextDocument, expected] of [
    ["date", featureDocument.replace("public source release last checked 2026-10-04", "public source release last checked 2026-10-11"), 1],
    ["note", describeRow(featureDocument, "public-node-range", "Reviewed the engine boundary."), 1],
    ["value", withRow(featureDocument, "public-node-range", cells => [cells[0], "`>=24.16.0 <25`", cells[2]]), 0],
  ]) {
    git("switch", "-c", `F1-node-${variant}`, merged);
    await put("package.json", JSON.stringify({ ...pkg, engines: { ...pkg.engines, node: ">=24.16.0 <25" } }));
    await put("package-lock.json", JSON.stringify({ ...lock, packages: { ...lock.packages, "": { ...lock.packages[""], engines: { ...lock.packages[""].engines, node: ">=24.16.0 <25" } } } }));
    await put("docs/PUBLIC-STATE.md", nextDocument);
    const nodeHead = commit(`Node actual boundary: ${variant}`);
    cli(repo, ["--base", merged, "--head", nodeHead], {}, expected);
  }

  // Ordinary governance maintenance needs a review explanation, never a forced state edit.
  for (const [i, filename] of [".github/workflows/ci.yml", "scripts/check-project-state.mjs", "tests/project-state-fixture.test.mjs"].entries()) {
    git("switch", "-c", `governance-${i}`, merged);
    await put(filename, "# Isolated governance maintenance fixture\n");
    const governanceHead = commit("ordinary governance maintenance");
    const explanation = body("Only documents gate maintenance; capability facts, Contract standards and all existing formal verification gates stay unchanged.").replace("- tools:", "- governance:");
    await writeFile(path.join(root, "governance-body.md"), explanation);
    cli(repo, ["--base", merged, "--head", governanceHead], {}, 1);
    cli(repo, ["--base", merged, "--head", governanceHead, "--pr-body-file", path.join(root, "governance-body.md")]);
    await put("docs/PUBLIC-STATE.md", describeRow(featureDocument, "provider-contract", "Reviewed existing interface guidance."));
    const withState = commit("governance plus state edit still needs review reason");
    assert.throws(() => checkPullRequest({ root: repo, base: merged, head: withState, body: "## Project state impact\n- [x] Updated current project state\n" }), /required for governance/u);
    checkPullRequest({ root: repo, base: merged, head: withState, body: explanation.replace("- [ ] Updated current project state", "- [x] Updated current project state").replace("- [x] No state update needed", "- [ ] No state update needed") });
  }

  const referencedContract = structuredClone(featureCapabilities);
  referencedContract.supplier.contractId += "#revised-fixture";
  for (const [variant, nextDocument, expected] of [
    ["supplier-only", describeRow(featureDocument, "file-converter-supplier-version", "Isolated fixture revises the referenced canonical Contract ID."), 1],
    ["contract-and-supplier", describeRow(describeRow(featureDocument, "file-converter-supplier-version", "Isolated fixture revises the referenced canonical Contract ID."), "file-converter-contract", "The isolated Supplier manifest references the revised-fixture Contract identifier."), 0],
  ]) {
    git("switch", "-c", `F1-contract-reference-${variant}`, merged);
    await put(capabilityPath, JSON.stringify(referencedContract));
    await put("docs/PUBLIC-STATE.md", nextDocument);
    const referenced = commit("Contract reference requires its current Contract entry");
    cli(repo, ["--base", merged, "--head", referenced], {}, expected);
  }

  git("switch", "-c", "boundary-formatting", merged);
  await put(canonicalPath, JSON.stringify(realContract, null, 2));
  await put(capabilityPath, JSON.stringify(Object.fromEntries(Object.entries(featureCapabilities).reverse()), null, 2));
  await put("src/modules/automations/tools/file-converter/contract.ts", "// comment only\nexport type Protocol = {\n version: 1 };\n");
  const boundaryFormatting = commit("Contract and capability formatting only");
  assert.deepEqual(checkPullRequest({ root: repo, base: merged, head: boundaryFormatting, body: "" }).groups, []);
  cli(repo, ["--base", merged, "--head", boundaryFormatting]);

  git("switch", "-c", "provider-review", merged);
  await put("src/modules/ai/provider.ts", "export const existingProviderMessage = 'clarified';\n");
  const providerHead = commit("ordinary Provider entrypoint change");
  assert.throws(() => checkPullRequest({ root: repo, base: merged, head: providerHead, body: reviewExplanation }), /required for provider/u);
  checkPullRequest({ root: repo, base: merged, head: providerHead, body: reviewExplanation + "- provider: Only clarifies a diagnostic; the supported Provider interface and verification scope remain unchanged.\n" });

  git("switch", "main");
  git("switch", "-c", "unrelated");
  await put("README.md", "Unrelated documentation correction.\n");
  await put("src/app/actions.ts", "export async function executeAutomationToolAction() { return 1; }\nexport async function ordinaryAction() { return 2; }\n");
  const unrelated = commit("ordinary action and unrelated docs");
  assert.deepEqual(checkPullRequest({ root: repo, base: merged, head: unrelated, body: "" }).groups, []);
  cli(repo, ["--base", merged, "--head", unrelated]);
  git("switch", "-c", "action-formatting");
  await put("src/app/actions.ts", "// formatting only\nexport async function executeAutomationToolAction() {\n  return 1;\n}\nexport async function ordinaryAction() { return 2; }\n");
  const formatting = commit("shared Tool Action formatting only");
  assert.deepEqual(checkPullRequest({ root: repo, base: unrelated, head: formatting, body: "" }).groups, []);
  await put("src/app/actions.ts", "export async function executeAutomationToolAction() { return 2; }\nexport async function ordinaryAction() { return 2; }\n");
  const actionChange = commit("Tool Action changed without state");
  assert.throws(() => checkPullRequest({ root: repo, base: formatting, head: actionChange, body: "" }), /explicit no-update/u);
  console.log(`Project state consistency passed: ${cases} CLI exit-code assertions plus document, PR-reason, critical-boundary, unrelated-change and lifecycle assertions.`);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
