import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

// Use a preinstalled browser test runtime; no dependency or browser download.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.EREMITE_PLAYWRIGHT_MODULE || "playwright");
const modules = {};
for (const name of ["app/_lib/overlay-stack", "app/_lib/floating-position", "app/_lib/use-media-query", "app/_lib/automation-retry",
  "app/_components/ui/overlay", "app/_components/ui/dialog", "app/_components/ui/button", "app/_components/ui/responsive-inspector",
  "app/_components/ui/mutation-form", "app/_components/automations-workspace"]) {
  const filename = path.join(process.cwd(), "src", `${name}.${name.includes("_components") ? "tsx" : "ts"}`);
  modules[`@/${name}`] = ts.transpileModule(await readFile(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
}
const scripts = await Promise.all(["react/umd/react.development.js", "react-dom/umd/react-dom.development.js"].map(file => readFile(path.join(process.cwd(), "node_modules", file), "utf8")));
const styles = await readFile(path.join(process.cwd(), "src/app/styles.css"), "utf8");
const browser = await chromium.launch({ headless: true, ...(process.env.EREMITE_BROWSER_EXECUTABLE
  ? { executablePath: process.env.EREMITE_BROWSER_EXECUTABLE } : { channel: "chrome" }) });
const nativeEvidence = [];
try {
  for (const [width, submitKey] of [1440, 869, 375].flatMap(width => ["Enter", "Space"].map(key => [width, key]))) {
    const page = await browser.newPage({ viewport: { width, height: width === 869 ? 617 : width === 375 ? 812 : 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: styles });
    for (const content of scripts) await page.addScriptTag({ content });
    await page.evaluate(sources => {
      const React = window.React;
      const cache = {};
      window.actions = [];
      window.nativeKeys = [];
      document.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.code === "Space") window.nativeKeys.push({ key: event.key, code: event.code, trusted: event.isTrusted, target: event.target.textContent });
      }, true);
      window.navigation = [];
      const router = { replace: url => window.navigation.push(url), refresh() {} };
      const fixtures = {
        react: React, "react-dom": window.ReactDOM,
        "react/jsx-runtime": { Fragment: React.Fragment, jsx: (type, props, key) => React.createElement(type, key === undefined ? props : { ...props, key }), jsxs: (type, props, key) => React.createElement(type, key === undefined ? props : { ...props, key }) },
        "next/navigation": { useRouter: () => router },
        "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
        "lucide-react": new Proxy({}, { get: () => () => React.createElement("svg", { "aria-hidden": true }) }),
        "@/app/_components/workspace-shell": { CommandTrigger: () => null },
        "@/app/_components/automations/tool-ui-registry": { getClientTool: () => null },
        "@/app/_components/tag-picker": { TagPicker: () => React.createElement("button", { type: "button" }, "标签") },
        "@/app/_components/ui/toast": { showToast() {} },
        "@/app/resource-actions": { trashAutomationAction() {} },
        "@/app/actions": { retryAutomationToolAction: data => new Promise(resolve => {
          window.actions.push(data.get("runId"));
          window.finishRetry = () => resolve({ ok: true, value: { objectId: "retry-child", status: "completed" } });
        }) },
      };
      function require(id) {
        if (fixtures[id]) return fixtures[id];
        if (!sources[id]) throw new Error(`Unexpected UI dependency: ${id}`);
        if (!cache[id]) {
          cache[id] = { exports: {} };
          new Function("require", "module", "exports", sources[id])(require, cache[id], cache[id].exports);
        }
        return cache[id].exports;
      }
      const { AutomationsWorkspace } = require("@/app/_components/automations-workspace");
      const run = { id: "failed-parent", status: "failed", target_id: "core.file-converter", target_version: 1, target_name_snapshot: "文件格式转换器",
        input_summary: "source.png → JPEG", input_payload_json: JSON.stringify({ conversionId: "png-to-jpeg", profile: "balanced", retryEvidence: {
          sources: [{ originalName: "source.png" }], destination: { projectName: null, folders: [] } } }), error_message: "原运行失败",
        project_name_snapshot: null, completed_at: "2026-10-08T00:00:01Z", created_at: "2026-10-08T00:00:00Z", retry_of_run_id: null,
        retry: { allowed: true, reason: null, childRunId: null } };
      window.ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(AutomationsWorkspace, {
        tools: [], runs: [run], tagsByRun: {}, availableTags: [], initialView: "runs", initialSelectedId: run.id, compactHeader: true,
      }));
    }, modules);
    const trigger = page.getByRole("button", { name: "重试", exact: true });
    const dialog = page.getByRole("alertdialog", { name: "按原输入重试？" });
    const focusedTrigger = () => page.waitForFunction(() => document.activeElement?.textContent === "重试", null, { timeout: 3000 });
    const dialogReady = async () => {
      await dialog.waitFor();
      await page.waitForFunction(() => document.activeElement?.matches("[data-dialog-initial-focus]"));
      // Let portal/Inspector initial-focus frames finish before testing a boundary.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    for (const activate of ["pointer", "without-trigger-focus"]) {
      for (const keys of [["Tab"], [], ["Tab", "Tab", "Shift+Tab"], ["Shift+Tab", "Tab"]]) {
        if (activate === "pointer") await trigger.click();
        else {
          await page.evaluate(() => document.activeElement?.blur());
          await trigger.evaluate(element => element.click());
        }
        await dialogReady();
        for (const key of keys) {
          await page.keyboard.press(key);
          assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, `${width}: focus stays within confirmation after ${key}`);
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await focusedTrigger();
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true, `${width}: Escape returns to exact trigger after ${keys}`);
        assert.equal(await page.evaluate(() => window.actions.length), 0, "dismissing never confirms");
      }
    }
    // Exercise both wrap boundaries with real keyboard events.
    await trigger.click(); await dialogReady();
    const first = dialog.getByRole("button", { name: "关闭", exact: true });
    const last = dialog.getByRole("button", { name: "确认重试", exact: true });
    await first.focus(); await page.keyboard.press("Shift+Tab");
    assert.equal(await last.evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Tab");
    assert.equal(await first.evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); await focusedTrigger();

    // Qoder may hide its webview: return focus must not depend on a future frame.
    await trigger.click(); await dialogReady(); await page.keyboard.press("Tab");
    await page.evaluate(() => {
      const nativeFrame = window.requestAnimationFrame.bind(window);
      const queued = [];
      window.requestAnimationFrame = callback => { queued.push(callback); return 100000 + queued.length; };
      window.resumeFrames = () => { window.requestAnimationFrame = nativeFrame; for (const callback of queued) nativeFrame(callback); };
    });
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, `${width}: Escape restores trigger even while animation frames are suspended`);
    await page.evaluate(() => window.resumeFrames());

    await trigger.click(); await dialogReady(); await page.keyboard.press("Tab");
    assert.equal(await last.evaluate(element => document.activeElement === element && !element.disabled && element.type === "submit"), true, "native submit key starts on the enabled confirm button");
    await page.keyboard.press(submitKey);
    await page.waitForFunction(() => window.actions.length === 1);
    const nativeKey = await page.evaluate(() => window.nativeKeys.at(-1));
    assert.equal(nativeKey.trusted, true);
    assert.equal(nativeKey.code, submitKey);
    assert.equal(nativeKey.target, "确认重试");
    const evidence = { viewport: page.viewportSize(), submitKey, focusVerified: true, enabledSubmitButton: true, nativeKey, submissions: 1 };
    nativeEvidence.push(evidence);
    console.log(JSON.stringify(evidence));
    assert.equal(await dialog.getByRole("button", { name: "正在重试…", exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByRole("button", { name: "返回", exact: true }).isDisabled(), true);
    for (const key of ["Tab", "Shift+Tab", "Tab"]) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, `${width}: pending focus stays within confirmation after ${key}`);
    }
    await dialog.locator("form").evaluate(form => form.requestSubmit());
    assert.deepEqual(await page.evaluate(() => window.actions), ["failed-parent"], "pending submission stays idempotent");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await focusedTrigger();
    assert.deepEqual(await page.evaluate(() => window.actions), ["failed-parent"], "closing the pending dialog does not start or cancel another request");
    await page.evaluate(() => window.finishRetry());
    await page.waitForFunction(() => window.navigation.some(url => url.includes("selected=retry-child")));
    assert.equal(await page.evaluate(() => window.navigation.some(url => url.includes("selected=retry-child"))), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  if (process.env.EREMITE_FOCUS_EVIDENCE_PATH) await writeFile(process.env.EREMITE_FOCUS_EVIDENCE_PATH, JSON.stringify({
    gate: "production React components in real Chromium", input: "Playwright keyboard.press, not DOM KeyboardEvent dispatch", backend: "controlled fixture", browserVersion: browser.version(), cases: nativeEvidence,
  }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  console.log("Retry focus runtime PASS: native Enter/Space at 1440/869/375, trusted key events on confirm, one submission; Escape/Tab, suspended frames, pending disabled controls and child navigation. Backend action is a controlled fixture, not Supplier acceptance.");
} finally { await browser.close(); }
