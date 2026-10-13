import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { startAIChatFixture } from "./ai-chat-http-fixture.mjs";

// Standalone supplemental browser gate; not included in npm test, verify or CI.
// Prerequisites, verified external Playwright/Chrome paths, isolated PowerShell
// environment, production-build requirement, command and cleanup are documented
// in docs/tool-runtime.md under "File Converter FAB layout reproduction".
// Real production page, installed browser and actual mouse events; no mocked layout.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.EREMITE_PLAYWRIGHT_MODULE || "playwright");
let fixture, browser;
const evidence = [];
try {
  fixture = await startAIChatFixture({ configured: false, nativeTool: true, dev: false });
  const seed = new DatabaseSync(path.join(fixture.directory, "app.sqlite"));
  try { seed.prepare("UPDATE content_items SET project_id = ? WHERE id = ?").run(fixture.entities.projectId, fixture.entities.nativeFileId); }
  finally { seed.close(); }
  browser = await chromium.launch({ headless: true, ...(process.env.EREMITE_BROWSER_EXECUTABLE ? { executablePath: process.env.EREMITE_BROWSER_EXECUTABLE } : { channel: "chrome" }) });
  for (const width of [375, 869, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 780 }, deviceScaleFactor: 1 });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.context().addCookies([{ name: "eremite_session", value: fixture.sessionId, url: fixture.baseURL }]);
    await page.goto(`${fixture.baseURL}/automations?tool=core.file-converter`);
    await page.getByRole("option", { name: /browser-source\.png/u }).click();
    const primary = page.getByRole("button", { name: "转换文件", exact: true });
    const ask = page.getByRole("button", { name: "打开 Ask Eremite", exact: true });
    await primary.waitFor(); await page.locator(".file-converter-settings").waitFor();
    const before = await measure(page);
    console.log(`FAB layout ${width} initial: ${JSON.stringify(before)}`);
    assert.equal(before.overlap, 0, `${width}: Ask must not overlap the selected File Converter primary action`);
    assert.equal(before.horizontalOverflow, false);

    // Record genuine pointer events and prevent conversion only to keep this layout gate side-effect free.
    await primary.evaluate(button => {
      window.primaryHits = 0;
      button.addEventListener("click", event => { event.preventDefault(); window.primaryHits++; }, { capture: true });
      button.scrollIntoView({ block: "center" });
    });
    const button = await primary.boundingBox();
    const scrolled = await measure(page);
    assert.equal(scrolled.overlap, 0, `${width}: scrolled primary remains separate from Ask`);
    for (const x of [button.x + 5, button.x + button.width / 2, button.x + button.width - 5]) {
      for (const y of [button.y + 5, button.y + button.height / 2, button.y + button.height - 5]) {
        assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".tool-run-button")), { x, y }), true, `${width}: primary hit area ${x},${y}`);
        await page.mouse.click(x, y);
      }
    }
    assert.equal(await page.evaluate(() => window.primaryHits), 9, `${width}: all nine mouse clicks reach primary action`);

    await ask.evaluate(button => button.scrollIntoView({ block: "center" }));
    const askBox = await ask.boundingBox();
    await page.mouse.click(askBox.x + askBox.width / 2, askBox.y + askBox.height / 2);
    const dialog = page.getByRole("dialog", { name: "Ask Eremite", exact: true });
    await dialog.waitFor(); await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const after = await measure(page);
    assert.equal(after.overlap, 0, `${width}: closing Ask preserves separation`);
    if (width === 375) {
      const nav = await page.locator(".app-sidebar").boundingBox();
      assert.equal(Math.round(nav.y + nav.height), 780, "bottom navigation retains its viewport position");
      const askAfter = await ask.boundingBox();
      assert.ok(askAfter.y + askAfter.height <= nav.y, "scrolled Ask stays above bottom navigation");
    }
    for (const route of ["/actions", "/automations?tool=core.pdf-tools"]) {
      await page.goto(fixture.baseURL + route);
      const entry = page.getByRole("button", { name: "打开 Ask Eremite", exact: true });
      await entry.waitFor();
      assert.equal(await entry.evaluate(button => getComputedStyle(button).position), "fixed", `${width}: ${route} keeps floating Ask positioning`);
      await entry.click(); await dialog.waitFor(); await dialog.getByRole("button", { name: "关闭", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, [], `${width}: browser has no uncaught runtime errors`);
    evidence.push({ width, height: 780, initial: before, scrolledPrimary: scrolled, afterAsk: after, primaryMouseHits: 9, askOpenClose: "PASS", otherPages: "PASS" });
    await page.close();
  }
  console.log(`File Converter FAB browser gate PASS: ${JSON.stringify(evidence)}`);
} finally { await browser?.close(); await fixture?.close(); }

async function measure(page) {
  return page.evaluate(() => {
    const primary = document.querySelector(".tool-run-button").getBoundingClientRect();
    const askElement = document.querySelector(".ask-eremite-trigger"); const ask = askElement.getBoundingClientRect();
    const rect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });
    return { primary: rect(primary), ask: rect(ask), askPosition: getComputedStyle(askElement).position,
      overlap: Math.max(0, Math.min(primary.right, ask.right) - Math.max(primary.left, ask.left)) * Math.max(0, Math.min(primary.bottom, ask.bottom) - Math.max(primary.top, ask.top)),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}
