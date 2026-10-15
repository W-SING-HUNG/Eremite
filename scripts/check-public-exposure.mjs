import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import path from "node:path";

// These names are policy examples, not claims about how this project was developed.
// Only this rule definition and its synthetic test may contain those examples.
const policyFiles = new Set(["scripts/check-public-exposure.mjs", "tests/public-exposure.test.mjs"]);
const rules = [
  ["credential", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{25,}|\bAKIA[A-Z0-9]{16}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}/gu],
  ["private-path", /\b[A-Za-z]:[\\/](?:Users[\\/](?!Public(?:[\\/]|\b))[^\s"'<>]+|Codex_program[^\s"'<>]*|豆包[^\s"'<>]*)|\/(?:Users|home)\/(?!runner(?:[\/]|\b))[^\s"'<>]+/gu],
  ["internal-reference", /\bEremite-internal\b|\bPROJECT-STATE\.md\b|docs[\\/](?:evidence|internal)[\\/]|\.codex[\\/](?:sessions|memories|worktrees)|\.agents[\\/]skills/giu],
  ["development-tool", /\b(?:Qoder|Codex|WorkBuddy|ChatGPT|Claude Code|Claude Desktop|Cursor IDE|Cursor AI)\b/giu],
  ["personal-email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu],
];

function publicEmail(value) {
  const lower = value.toLowerCase();
  const domain = lower.slice(lower.lastIndexOf("@") + 1);
  return /(?:^|\.)(?:example\.(?:com|net|org)|invalid|test)$/u.test(domain)
    || domain === "users.noreply.github.com" || lower === "noreply@github.com";
}

function commitPrivacyEmail(value) {
  return /^[^@\s<>]+@users\.noreply\.github\.com$/iu.test(value) || value.toLowerCase() === "noreply@github.com";
}

export function scanPublicText(location, text, { thirdPartyAttribution = false } = {}) {
  const findings = [];
  const policyDefinition = policyFiles.has(location);
  const legalText = /(?:^|\/)(?:LICENSE(?:\.[^/]+)?|NOTICE|THIRD-PARTY-NOTICES(?:\.md)?)$/iu.test(location);
  for (const [rule, regex] of rules) {
    if (policyDefinition && ["development-tool", "internal-reference"].includes(rule)) continue;
    if (rule === "development-tool" && (legalText || thirdPartyAttribution)) continue;
    if (rule === "personal-email" && (legalText || thirdPartyAttribution)) continue;
    const scanned = ["private-path", "internal-reference"].includes(rule) ? text.replace(/\\{2,}/gu, "\\") : text;
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(scanned))) {
      if (rule === "personal-email" && publicEmail(match[0])) continue;
      if (rule === "development-tool") {
        const start = scanned.lastIndexOf("\n", match.index - 1) + 1;
        const end = scanned.indexOf("\n", match.index);
        const line = scanned.slice(start, end < 0 ? undefined : end);
        const column = match.index - start;
        const packageMetadata = /(?:^|\/)package(?:-lock)?\.json$/u.test(location);
        const key = /^\s*"((?:node_modules\/)?(?:@[^"/]+\/)?[a-z0-9._-]+)"\s*:/u.exec(line);
        if (packageMetadata && key && column < key[0].lastIndexOf(":")) continue;
        if (packageMetadata && /^\s*"(?:name|resolved)"\s*:\s*"/u.test(line)) continue;
        // A typed model identifier names a supported product input, not a validation assistant.
        if (/\bmodel(?:Id)?["']?\s*:\s*["'][a-z0-9._/-]+["']\s*[,;}]?\s*$/iu.test(line)) continue;
      }
      findings.push({ location, line: scanned.slice(0, match.index).split("\n").length, rule });
    }
  }
  return findings;
}

function excludedFile(filename) {
  return filename === "docs/PROJECT-STATE.md"
    || /^(?:data|\.qa|\.next(?:-dev)?|node_modules|docs\/(?:internal|evidence))\//u.test(filename)
    || /(?:^|\/)\.env(?:\.|$)/u.test(filename) && filename !== ".env.example"
    || /\.(?:sqlite(?:-wal|-shm)?|db|log|tsbuildinfo)$/iu.test(filename);
}

function inspectBytes(filename, bytes, findings, archive = false) {
  if (excludedFile(filename)) findings.push({ location: filename, line: 1, rule: "private-or-generated-file" });
  if (bytes.subarray(0, 16).toString("ascii") === "SQLite format 3\0") findings.push({ location: filename, line: 1, rule: "database-payload" });
  const attribution = archive && /(?:^|\/)node_modules\/[^!]+\/(?:package\.json|licen[sc]e(?:\.[^/]*)?|notice(?:\.[^/]*)?)$/iu.test(filename);
  findings.push(...scanPublicText(filename, bytes.toString("utf8"), { thirdPartyAttribution: attribution }));
  if (/\.(?:exe|dll)$/iu.test(filename)) findings.push(...scanPublicText(filename, bytes.toString("utf16le"), { thirdPartyAttribution: attribution }));
}

function inspectArchive(filename, bytes, findings) {
  const tar = gunzipSync(bytes);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = bytes => bytes.toString("utf8").replace(/\0.*$/su, "");
    const prefix = field(header.subarray(345, 500));
    const entry = (prefix ? prefix + "/" : "") + field(header.subarray(0, 100));
    const size = Number.parseInt(field(header.subarray(124, 136)).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length || entry.split("/").includes("..") || path.posix.isAbsolute(entry)) throw new Error("Invalid archive entry");
    inspectBytes(filename + "!" + entry, tar.subarray(offset + 512, offset + 512 + size), findings, true);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

export function checkPublicExposure({ cwd = process.cwd(), staged = false, textFiles = [], extraFiles = [], base, head = "HEAD" } = {}) {
  const findings = [];
  function git(...args) {
    const result = spawnSync("git", args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0) throw new Error("Cannot inspect public Git snapshot");
    return result.stdout;
  }
  const filenames = git("ls-files", "--cached", "-z").toString("utf8").split("\0").filter(Boolean);
  for (const filename of new Set([...filenames, ...extraFiles])) {
    const bytes = staged ? git("show", ":" + filename) : readFileSync(path.join(cwd, filename));
    if (filename.endsWith(".tgz")) inspectArchive(filename, bytes, findings);
    else inspectBytes(filename, bytes, findings);
  }
  for (const file of textFiles) findings.push(...scanPublicText("submitted metadata", readFileSync(file, "utf8")));
  if (base && !/^0+$/u.test(base)) {
    // Only new commits are checked; historical objects are never silently rewritten.
    const commits = git("rev-list", `${base}..${head}`).toString("utf8").trim().split("\n").filter(Boolean);
    for (const sha of commits) {
      const message = git("show", "-s", "--format=%B", sha).toString("utf8");
      findings.push(...scanPublicText("new commit " + sha.slice(0, 12), message));
      const identity = git("show", "-s", "--format=%an%x00%ae%x00%cn%x00%ce", sha).toString("utf8").trimEnd().split("\0");
      const location = "new commit identity " + sha.slice(0, 12);
      findings.push(...scanPublicText(location, `${identity[0]} <${identity[1]}>\n${identity[2]} <${identity[3]}>`));
      for (const [role, email] of [["author", identity[1]], ["committer", identity[3]]]) {
        if (!email || !commitPrivacyEmail(email)) findings.push({ location, line: 1, rule: "commit-identity", role });
      }
    }
  }
  return { files: filenames.length + extraFiles.length, findings };
}

function main(args) {
  const options = { textFiles: [], extraFiles: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--staged") options.staged = true;
    else if (["--base", "--head", "--text-file", "--extra-file"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing check option value");
      if (arg === "--text-file") options.textFiles.push(value);
      else if (arg === "--extra-file") options.extraFiles.push(value);
      else options[arg.slice(2)] = value;
    } else throw new Error("Unknown public exposure check option");
  }
  if (!options.base && process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (process.env.GITHUB_EVENT_NAME === "pull_request") {
      options.base = event.pull_request.base.sha;
      options.head = event.pull_request.head.sha;
      options.textFiles = [...options.textFiles];
      const metadata = event.pull_request.title + "\n" + (event.pull_request.body ?? "");
      const findings = scanPublicText("pull request metadata", metadata);
      if (findings.length) { console.error(JSON.stringify({ findings })); process.exitCode = 1; return; }
    } else if (process.env.GITHUB_EVENT_NAME === "push") options.base = event.before;
  }
  const result = checkPublicExposure(options);
  if (result.findings.length) { console.error(JSON.stringify(result)); process.exitCode = 1; }
  else console.log(`Public exposure check passed: ${result.files} tracked files, fixed archives and submitted metadata; matched values are never printed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch { console.error("Public exposure check failed: snapshot or metadata could not be inspected."); process.exitCode = 1; }
}
