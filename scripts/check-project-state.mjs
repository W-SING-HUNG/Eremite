import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const statePath = "docs/PUBLIC-STATE.md";
const currentTitles = /^(?:Current |Git \/ GitHub Source of Truth$|In Progress$|Not Started$|Known Risks$|File Converter Tool Core$|PDF Tools Core$)/u;
// Match unfinished workflow states with Git objects, not generic engineering verbs.
const pendingWorkflow = new RegExp([
  String.raw`\b(?:git\s+integration\s+(?:(?:remains|is)\s+)?pending|(?:pending|awaiting|awaits?|waiting\s+for)\s+(?:(?:a|the|this)\s+)?(?:git\s+integration|commit|push|merge|PR|CI))\b`,
  String.raw`\b(?:not(?:\s+yet)?\s+(?:merged|integrated|resolved)\s+(?:in|into|to)\s+main(?:\s+yet)?|not(?:\s+yet)?\s+in\s+main|pending\s+integration\s+(?:in|into|to)\s+main|still\s+(?:on|in)\s+(?:(?:the|this)\s+)?feature[- ]branch)\b`,
  String.raw`\b(?:to\s+be\s+(?:squash[- ]?)?merged\s+(?:after|following)\s+(?:the\s+)?CI|(?:needs?|requires?|awaiting|pending)\s+(?:a\s+)?squash\s+merge)\b`,
  String.raw`(?:尚未|还未|仍未|未|待|等待)\s*(?:合入(?:\s*main)?|(?:集成|合并)(?:到|至|入)\s*main|Git\s*集成)`,
  String.raw`(?:待|等待|尚未|仍需|需要|需|下一步(?:是|：|:)?)\s*(?:创建|开|发起)\s*(?:PR|pull\s+request)\b`,
  // Bare terminal commit/push/merge labels are workflow shorthand in this summary.
  String.raw`(?:待|等待)\s*(?:提交|推送|合并)(?=\s*(?:[,，、;；。.]|$))`,
].join("|"), "iu");
const gitAction = /\b(?:push|merge|commit)\s+(?:(?:the|this|current|our)\s+)?(?:branch|PR|pull\s+request|main)\b|\b(?:create|open)\s+(?:(?:a|the|this)\s+)?(?:PR|pull\s+request)\b|(?:push|merge|commit|提交|推送|合并)\s*(?:当前|本次|本轮|这个|这条)?\s*(?:分支|PR\b|main\b)|(?:创建|开|发起)\s*(?:PR|pull\s+request)\b|\bcommit\s+the\s+(?:(?:six|\d+)\s+)?accepted\s+files\b/giu;

// Only a bounded list of prohibited documentation examples is removed. A rule prefix
// never exempts its whole sentence; any appended task remains subject to the checks.
const workflowExample = String.raw`(?:该修复\s*)?(?:${pendingWorkflow.source}|${gitAction.source})`;
const englishExample = String.raw`(?:${workflowExample}|temporary\s+Git\s+(?:workflow|status))`;
const chineseExample = String.raw`(?:${workflowExample}|待(?:提交|推送|合并|合入)|临时\s*Git\s*(?:流程|状态|待办))`;
const documentationProhibition = new RegExp([
  String.raw`\b(?:do\s+not|never)\s+(?:record|write|describe)\s+${englishExample}(?:\s*(?:,\s*|\s+(?:or|and)\s+)${englishExample})*\s+(?:as\s+current\s+project\s+state|in\s+this\s+summary)\b`,
  String.raw`(?:不得|不要|不应)(?:把|将)\s*${chineseExample}(?:\s*(?:[,，、]|或|和|及)\s*${chineseExample})*\s*(?:写成|记录为|作为)(?:当前)?项目状态`,
].join("|"), "giu");

function isPendingWorkflow(line) {
  const text = line.replace(/[*`]/gu, "").replace(/^\s*-\s*/u, "").trim().replace(documentationProhibition, "<documentation prohibition>");
  if (pendingWorkflow.test(text)) return true;
  for (const match of text.matchAll(gitAction)) {
    // A direct prohibition of a Git action is a rule, not a pending action.
    if (!/(?:\bnever|\bdo\s+not|\bdon't|\bmust\s+not|不得|不要|禁止)\s*$/iu.test(text.slice(0, match.index))) return true;
  }
  return false;
}

// A small reading interface over the sole maintained summary, not a capability database.
export function currentSections(document) {
  const sections = new Map();
  let title;
  let fenced = false;
  for (const line of document.replaceAll("\r\n", "\n").split("\n")) {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    const heading = !fenced && /^## (.+)$/u.exec(line);
    if (heading) {
      title = currentTitles.test(heading[1]) ? heading[1] : undefined;
      if (title && sections.has(title)) throw new Error(`Duplicate current section: ${title}`);
      if (title) sections.set(title, []);
    } else if (title) sections.get(title).push(line);
  }
  return new Map([...sections].map(([key, lines]) => [key, lines.join("\n")]));
}

function row(section, id) {
  const rows = section.split("\n").filter(line => line.trim().startsWith("|"))
    .map(line => line.split("|").slice(1, -1).map(cell => cell.trim().replaceAll("`", "")))
    .filter(cells => cells[0] === id);
  if (rows.length !== 1 || rows[0].length !== 3) throw new Error(`Expected one three-column current entry: ${id}`);
  return rows[0];
}

const entry = (section, id) => row(section, id)[1];

function currentRow(document, id) {
  const sections = [...currentSections(document).values()].join("\n");
  return row(sections, id);
}

function substantiveRow(cells) {
  // Dates/provenance timestamps and layout do not change an entry's capability or boundary.
  const description = cells[2]
    .replace(/(?:[;；]\s*)?(?:review(?:ed| date)?|verified|updated|checked|recorded|as of|(?:审查|核验|验证|更新|检查)(?:日期|于)?)(?:\s+(?:on|at))?\s*[:：]?\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z| UTC|[+-]\d{2}:\d{2})?)?[.;；。]?/giu, "")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z| UTC|[+-]\d{2}:\d{2})?)?\b/gu, "")
    .replace(/\s+/gu, " ").trim().replace(/[.;；。]+$/u, "");
  return [cells[1], description];
}

export function checkDocument(document, packageJson, lockfile) {
  const sections = currentSections(document);
  const version = sections.get("Current Version");
  const maintenance = [...sections].filter(([title]) => title.startsWith("Current Post-release Maintenance"));
  if (!version || maintenance.length !== 1 || !sections.get("Current Next Step")) throw new Error("Missing required current section");
  const versions = [packageJson.version, lockfile.version, lockfile.packages?.[""]?.version, entry(version, "public-host-package")];
  if (typeof versions[0] !== "string" || versions.some(value => value !== versions[0])) throw new Error("Public Host package/document/lockfile versions disagree");
  if (entry(version, "public-node-range") !== packageJson.engines?.node) throw new Error("Public Node engine/document boundaries disagree");
  for (const tool of ["file-converter", "pdf-tools"]) {
    if (currentRow(document, `${tool}-supplier-version`)[1] !== lockfile.packages?.[`node_modules/${tool}-core`]?.version) throw new Error(`Supplier lockfile/document versions disagree: ${tool}`);
  }
  for (const id of ["file-converter-root-destination", "pdf-tools-root-destination"]) {
    if (entry(maintenance[0][1], id) !== "RESOLVED") throw new Error(`Current implemented destination capability must be RESOLVED: ${id}`);
  }
  for (const [title, content] of sections) {
    if (content.split("\n").some(isPendingWorkflow)) throw new Error(`Temporary Git workflow in current state: ${title}`);
  }
  return sections;
}

function git(root, args, allowMissing = false) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowMissing) throw new Error(`Git inspection failed: ${result.stderr.trim()}`);
  return result.status === 0 ? result.stdout : null;
}

function at(root, revision, filename) {
  return git(root, ["show", `${revision}:${filename}`], true);
}

function jsonAt(root, revision, filename) {
  const text = at(root, revision, filename);
  return text === null ? null : JSON.parse(text);
}

function packageBoundary(pkg) {
  return pkg && { version: pkg.version, node: pkg.engines?.node, fileConverter: pkg.dependencies?.["file-converter-core"], pdfTools: pkg.dependencies?.["pdf-tools-core"] };
}

// Lexical comparison ignores trivia in typed Contracts and two shared Action entrypoints.
// This performs no type checking, symbol resolution or general semantic analysis.
function tokens(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, scanner.getTokenText()]);
  return result;
}

function toolActions(source) {
  const file = ts.createSourceFile("actions.ts", source ?? "", ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) throw new Error("Cannot inspect Tool Actions: invalid TypeScript");
  return file.statements.filter(node => ts.isFunctionDeclaration(node) && ["executeAutomationToolAction", "retryAutomationToolAction"].includes(node.name?.text))
    .map(node => tokens(node.getText(file)));
}

function watchedGroup(filename) {
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(filename) || filename === "scripts/check-project-state.mjs" || /^tests\/project-state-.*\.test\.mjs$/u.test(filename)) return "governance";
  if (/^src\/modules\/automations\/tools\//u.test(filename) || /^src\/modules\/automations\/(?:registry|service|reconciliation)\.ts$/u.test(filename) || /^src\/app\/_services\/ask-eremite-tool-runs\.ts$/u.test(filename)) return "tools";
  if (/^src\/app\/_components\/automations\/(?:.*-launcher|tool-ui-registry)\.tsx$/u.test(filename)) return "tools";
  if (/^src\/modules\/ai\/(?:provider(?:-settings\.server|-probe\.server)?|config|runtime|contracts|chat-contracts|tools)\.ts$/u.test(filename)) return "provider";
  return null;
}

function meaningfulCurrent(document) {
  return [...currentSections(document)].map(([title, text]) => [title.replace(/ — \d{4}-\d{2}-\d{2}$/u, ""), text.replace(/\s+/gu, " ").trim()]);
}

function checkReason(body, groups, updated = false) {
  const section = /^## Project state impact\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/mu.exec(body ?? "")?.[1];
  const expected = updated ? /^- \[x\] Updated current project state\s*$/imu : /^- \[x\] No state update needed\s*$/imu;
  const contradictory = updated ? /^- \[x\] No state update needed\s*$/imu : /^- \[x\] Updated current project state\s*$/imu;
  if (!section || !expected.test(section) || contradictory.test(section)) throw new Error("Update current project state or provide the PR's explicit no-update explanation");
  for (const group of groups) {
    const reasons = section.split("\n").map(line => new RegExp(`^- ${group}: (.+)$`, "u").exec(line)).filter(Boolean);
    const reason = reasons[0]?.[1]?.trim();
    if (reasons.length !== 1 || !reason || reason.length < 20 || /[<>]|^(?:n\/?a|none|no impact|无需更新|无影响)[.!。\s]*$/iu.test(reason)) throw new Error(`Concrete review explanation required for ${group}`);
    // Log as JSON data, never shell or GitHub workflow commands. Truth remains a reviewer responsibility.
    console.log(`Project state review explanation: ${JSON.stringify({ group, reason })}`);
  }
}

export function checkPullRequest({ root, base, head, body }) {
  for (const revision of [base, head]) {
    if (typeof revision !== "string" || revision.startsWith("-")) throw new Error("Missing or invalid comparison revision");
  }
  const baseSha = git(root, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
  const headSha = git(root, ["rev-parse", "--verify", `${head}^{commit}`]).trim();
  const ancestor = git(root, ["merge-base", baseSha, headSha]).trim();
  const files = git(root, ["diff", "--name-only", "-z", "--no-renames", ancestor, headSha]).split("\0").filter(Boolean);
  const groups = new Set();
  const mandatory = [];
  const requiredEntries = new Map();
  const requireEntry = (id, value) => {
    const existing = requiredEntries.get(id);
    if (existing !== undefined && value !== undefined && existing !== value) throw new Error(`Critical boundary sources disagree: ${id}`);
    if (value !== undefined || !requiredEntries.has(id)) requiredEntries.set(id, value);
  };
  for (const filename of files) {
    const capabilityJson = /^src\/modules\/automations\/tools\/[^/]+\/(?:accepted-capabilities|canonical-(?:tool-contract|supplier-protocol)[^/]*)\.json$/u.test(filename);
    const typedContract = /^src\/modules\/(?:automations\/tools\/[^/]+\/contract|ai\/(?:contracts|chat-contracts))\.ts$/u.test(filename);
    if (capabilityJson && isDeepStrictEqual(jsonAt(root, ancestor, filename), jsonAt(root, headSha, filename))) continue;
    if (typedContract && isDeepStrictEqual(tokens(at(root, ancestor, filename) ?? ""), tokens(at(root, headSha, filename) ?? ""))) continue;
    const group = watchedGroup(filename);
    if (group) groups.add(group);
    if (filename === "src/app/actions.ts" && !isDeepStrictEqual(toolActions(at(root, ancestor, filename)), toolActions(at(root, headSha, filename)))) groups.add("tools");
    if (filename === "package.json") {
      const old = packageBoundary(jsonAt(root, ancestor, filename));
      const next = packageBoundary(jsonAt(root, headSha, filename));
      if (!isDeepStrictEqual(old, next)) mandatory.push(filename);
      if (old?.version !== next?.version) requireEntry("public-host-package", next?.version);
      if (old?.node !== next?.node) requireEntry("public-node-range", next?.node);
      if (old?.fileConverter !== next?.fileConverter) requireEntry("file-converter-supplier-version");
      if (old?.pdfTools !== next?.pdfTools) requireEntry("pdf-tools-supplier-version");
    }
    if (capabilityJson) {
      mandatory.push(filename);
      const tool = filename.split("/")[4];
      if (filename.endsWith("accepted-capabilities.json")) {
        const old = jsonAt(root, ancestor, filename);
        const next = jsonAt(root, headSha, filename);
        const { supplier: oldSupplier, ...oldCapabilities } = old ?? {};
        const { supplier: nextSupplier, ...nextCapabilities } = next ?? {};
        if (!isDeepStrictEqual(oldCapabilities, nextCapabilities)) requireEntry(`${tool}-capabilities`);
        if (!isDeepStrictEqual(oldSupplier, nextSupplier)) requireEntry(`${tool}-supplier-version`, nextSupplier?.version);
        if (oldSupplier?.contractId !== nextSupplier?.contractId) requireEntry(`${tool}-contract`);
        if (old?.toolVersion !== next?.toolVersion) requireEntry(`${tool}-tool-version`, next?.toolVersion === undefined ? undefined : String(next.toolVersion));
      } else requireEntry(`${tool}-contract`);
    }
    if (typedContract) {
      mandatory.push(filename);
      requireEntry(filename.startsWith("src/modules/ai/") ? "provider-contract" : `${filename.split("/")[4]}-contract`);
    }
    const artifact = /^vendor\/([^/]+)\/.+\.tgz$/u.exec(filename);
    if (artifact) { mandatory.push(filename); requireEntry(`${artifact[1]}-supplier-version`); }
    if (filename === "package-lock.json") {
      const boundary = lock => lock && [lock.version, lock.packages?.[""]?.version, lock.packages?.["node_modules/file-converter-core"], lock.packages?.["node_modules/pdf-tools-core"]];
      const old = boundary(jsonAt(root, ancestor, filename));
      const next = boundary(jsonAt(root, headSha, filename));
      if (!isDeepStrictEqual(old, next)) mandatory.push(filename);
      if (old?.[0] !== next?.[0] || old?.[1] !== next?.[1]) requireEntry("public-host-package", next?.[0]);
      for (const [index, tool] of [[2, "file-converter"], [3, "pdf-tools"]]) {
        if (!isDeepStrictEqual(old?.[index], next?.[index])) requireEntry(`${tool}-supplier-version`, next?.[index]?.version);
      }
    }
  }
  const before = at(root, ancestor, statePath);
  const after = at(root, headSha, statePath);
  const updated = files.includes(statePath) && after !== null && !isDeepStrictEqual(meaningfulCurrent(before ?? ""), meaningfulCurrent(after));
  if (mandatory.length && !updated) throw new Error(`Critical boundary changes require current state synchronization: ${mandatory.join(", ")}`);
  for (const [id, value] of requiredEntries) {
    const next = currentRow(after ?? "", id);
    let old;
    try { old = currentRow(before ?? "", id); } catch { /* A new capability/version may introduce its first current entry. */ }
    if (old && isDeepStrictEqual(substantiveRow(old), substantiveRow(next))) throw new Error(`Critical change requires substantive synchronization of corresponding current entry: ${id}`);
    if (value !== undefined && next[1] !== value) throw new Error(`Current version/boundary entry does not reflect its actual value: ${id}`);
  }
  if (requiredEntries.has("public-host-package")) checkDocument(after, jsonAt(root, headSha, "package.json"), jsonAt(root, headSha, "package-lock.json"));
  if (groups.size && !updated) checkReason(body, groups);
  if (groups.has("governance") && updated) checkReason(body, ["governance"], true);
  return { files, groups: [...groups], mandatory, updated, requiredEntries: [...requiredEntries.keys()] };
}

export async function main(args = process.argv.slice(2), env = process.env, root = process.cwd()) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--document", "--base", "--head", "--pr-body-file"].includes(args[i]) || !args[i + 1]) throw new Error("Expected --document, --base, --head or --pr-body-file with a value");
    if (options[args[i]]) throw new Error(`Repeated option: ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  const [document, pkg, lock] = await Promise.all([
    readFile(path.resolve(root, options["--document"] ?? statePath), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "package-lock.json"), "utf8"),
  ]);
  checkDocument(document, JSON.parse(pkg), JSON.parse(lock));
  if (options["--base"] || options["--head"] || options["--pr-body-file"]) {
    if (!options["--base"] || !options["--head"]) throw new Error("Local PR inspection requires both --base and --head");
    checkPullRequest({ root, base: options["--base"], head: options["--head"], body: options["--pr-body-file"] ? await readFile(options["--pr-body-file"], "utf8") : "" });
    console.log("Project state PR synchronization passed (local comparison).");
  } else if (env.GITHUB_EVENT_NAME === "pull_request") {
    if (!env.GITHUB_EVENT_PATH) throw new Error("PR context requires GITHUB_EVENT_PATH");
    const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
    const pr = event.pull_request;
    if (!/^[a-f0-9]{40}$/u.test(pr?.base?.sha ?? "") || !/^[a-f0-9]{40}$/u.test(pr?.head?.sha ?? "")) throw new Error("PR context requires base/head commit SHA");
    checkPullRequest({ root, base: pr.base.sha, head: pr.head.sha, body: pr.body });
    console.log("Project state PR synchronization passed.");
  } else console.log("Project state: PR diff not applicable to this execution context.");
  console.log("Current project state content passed; capability behavior is checked by test:project-state and existing integration gates.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Project state check failed: ${error.message}`); process.exitCode = 1; });
}
