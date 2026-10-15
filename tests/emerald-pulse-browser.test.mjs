import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { File } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startAIChatFixture } from './ai-chat-http-fixture.mjs';
import { imageFixtures } from './viewer-fixtures.mjs';

// Supplemental production-browser gate. Uses an external Playwright installation,
// a disposable local Provider and data beneath the caller's isolated TEMP.
// Never included in mandatory verify/CI; see the dated UI evidence for invocation.
const baseline = process.argv.includes('--baseline');
const evidenceRoot = process.env.EREMITE_UI_EVIDENCE_DIR;
if (!evidenceRoot || !process.env.EREMITE_DATA_DIR || !process.env.EREMITE_TOOL_WORKSPACE_DIR) throw new Error('Isolated QA directories are required');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.EREMITE_PLAYWRIGHT_MODULE || 'playwright');
await mkdir(evidenceRoot, { recursive: true });
let fixture, browser;
let imageId;
const evidence = { baseline, viewports: [], errors: [], warnings: [] };
try {
  console.log('Starting isolated production fixture');
  fixture = await startAIChatFixture({ configured: true, nativeTool: false, dev: false, responseDelay: baseline ? 0 : 350, prepare: async ({ entities }) => {
  const inbox = await import('@/modules/inbox/service');
  const projects = await import('@/modules/projects/service');
  const db = (await import('@/platform/db/database')).db();
  db.prepare('UPDATE projects SET name = ?, name_key = ?, description = ? WHERE id = ?').run('个人知识库', '个人知识库', '把资料、行动与灵感连在一起', entities.projectId);
  db.prepare('UPDATE content_items SET title = ? WHERE id = ?').run('Local-first 工作流 · 参考资料', entities.contentId);
  projects.createProject({ name: '产品研究', description: '从观察到可执行的想法' });
  projects.createProject({ name: '阅读与灵感', description: '留下值得回看的片段' });
  for (const [title, url] of [
    ['交互设计笔记 · Motion & Meaning', 'https://example.com/interaction'],
    ['本周阅读清单', 'https://example.com/reading'],
    ['Emerald Pulse · 视觉参考', 'https://example.com/emerald'],
    ['项目回顾 — October', 'https://example.com/review'],
    ['灵感收集 / Small details', 'https://example.com/details'],
  ]) inbox.createLinkContentItem({ title, url, projectId: entities.projectId });
  const png = imageFixtures.png;
  imageId = await inbox.createFileContentItem(new File([png], 'emerald-reference.png', { type: 'image/png' }), 'Emerald · 色彩参考');
  db.prepare('UPDATE content_items SET created_at = ?, updated_at = ?').run('2026-10-14T01:00:00.000Z', '2026-10-14T01:00:00.000Z');
  } });
  console.log('Production fixture ready');
  browser = await chromium.launch({ headless: true, ...(process.env.EREMITE_BROWSER_EXECUTABLE ? { executablePath: process.env.EREMITE_BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  console.log('Production Chrome ready');
  evidence.browser = browser.version();
  for (const width of [1440, 869, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, ...(!baseline && width === 375 ? { recordVideo: { dir: evidenceRoot, size: { width, height: 900 } } } : {}) });
    page.on('pageerror', error => evidence.errors.push(`${width}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') evidence.errors.push(`${width}: ${message.text()}`); });
    page.on('console', message => { if (message.type() === 'warning') evidence.warnings.push(`${width}: ${message.text()}`); });
    // The pre-existing application has no favicon route. Browser decoration is
    // outside the UI gate; avoid a known 404 while retaining all app error checks.
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.context().addCookies([{ name: 'eremite_session', value: fixture.sessionId, url: fixture.baseURL }]);
    const shot = async name => page.screenshot({ path: path.join(evidenceRoot, `${baseline ? 'before' : 'after'}-${width}-${name}.png`), animations: 'disabled' });
    const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: no horizontal overflow`);
    await page.goto(`${fixture.baseURL}/inbox`);
    await page.locator('.content-row').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await shot('library');
    let loadingFrame = false;
    if (!baseline) {
      await fits();
      // Exercise the real App Router fallback under a controlled slow navigation.
      await page.route(/\/automations(?:\?|$)/, async route => { await new Promise(resolve => setTimeout(resolve, 1000)); await route.continue(); });
      const loading = page.locator('.loading-view').waitFor({ timeout: 1500 }).then(() => true, () => false);
      await page.locator('.module-nav a[href="/automations"]').click();
      loadingFrame = await loading;
      if (loadingFrame) {
        assert.equal(await page.locator('.skeleton').first().evaluate(span => getComputedStyle(span, '::after').animationName), 'pulse-shimmer');
        await fits();
        await shot('skeleton');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.locator('.skeleton').first().evaluate(span => getComputedStyle(span, '::after').animationName), 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      await page.getByRole('heading', { name: '自动化中心', exact: true }).waitFor();
      await page.unroute(/\/automations(?:\?|$)/);
      await page.goto(`${fixture.baseURL}/inbox`);
      assert.equal(await page.locator('.content-row').first().evaluate(row => getComputedStyle(row).animationName), 'none', 'resource rows do not animate on mount');
      await page.locator('.content-row').first().hover();
      await page.locator('.content-row').first().click();
      assert.equal(await page.locator('.content-row').first().getAttribute('aria-pressed'), 'true');
      await shot('selected');
      await page.getByRole('button', { name: '关闭详情', exact: true }).click();
      await page.getByRole('button', { name: '新建资料', exact: true }).click();
      const create = page.getByRole('dialog', { name: '新建资料', exact: true });
      await create.waitFor();
      await shot('dialog');
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await create.evaluate(panel => panel.contains(document.activeElement)), true, 'Tab remains in the modal');
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.ui-dialog-backdrop'));
      assert.equal(await page.getByRole('button', { name: '新建资料', exact: true }).evaluate(button => document.activeElement === button), true, 'Dialog restores trigger focus');
    }
    await page.getByRole('button', { name: '打开命令面板', exact: true }).click();
    const palette = page.getByRole('dialog', { name: '命令面板', exact: true });
    await palette.waitFor();
    await shot('command');
    if (!baseline) {
      await page.keyboard.press('ArrowDown');
      assert.equal(await palette.locator('[aria-selected="true"]').count(), 1);
      await page.keyboard.press('Enter');
      await page.waitForURL('**/actions');
      await fits();
      await page.getByRole('button', { name: '打开命令面板', exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'hidden' });
    if (!baseline) {
      const exit = await page.locator('.ui-dialog-backdrop[data-state="closed"]').evaluate(surface => ({ inert: surface.inert, hidden: surface.getAttribute('aria-hidden'), pointer: getComputedStyle(surface).pointerEvents }));
      assert.deepEqual(exit, { inert: true, hidden: 'true', pointer: 'none' }, 'exiting surface is not interactive');
      await page.waitForFunction(() => !document.querySelector('.ui-dialog-backdrop'));
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      await page.goto(`${fixture.baseURL}/inbox`);
    }
    await page.getByRole('button', { name: '打开 Ask Eremite', exact: true }).click();
    const ask = page.getByRole('dialog', { name: 'Ask Eremite', exact: true });
    await ask.waitFor();
    await ask.locator('textarea').fill('概括最近的资料');
    await shot('ask');
    if (!baseline) {
      await page.evaluate(() => {
        window.epPhases = [];
        window.epTexts = [];
        window.epObserver = new MutationObserver(() => {
          const phase = document.querySelector('.ask-status')?.dataset.phase;
          if (phase && window.epPhases.at(-1) !== phase) window.epPhases.push(phase);
          const text = [...document.querySelectorAll('.ask-message--assistant .ask-message-text')].at(-1)?.textContent;
          if (text && window.epTexts.at(-1) !== text) window.epTexts.push(text);
        });
        window.epObserver.observe(document.querySelector('.ask-eremite-panel'), { subtree: true, childList: true, characterData: true, attributes: true });
      });
      // Delays belong only to this test transport/Provider, exercising slow real
      // network responses without adding product buffering or changing Runtime.
      await page.route('**/api/ai', async route => {
        const action = route.request().method() === 'POST' ? route.request().postDataJSON()?.action : undefined;
        if (action === 'create' || action === 'stop') await new Promise(resolve => setTimeout(resolve, 350));
        await route.continue();
      });
      await ask.locator('textarea').press('Enter');
      await page.locator('.ask-status[data-phase="sending"]').waitFor();
      assert.equal(await page.locator('.ask-waiting-dots').count(), 0);
      await page.locator('.ask-status[data-phase="waiting"]').waitFor();
      assert.equal(await page.locator('.ask-waiting-dots > i').count(), 3);
      await shot('waiting');
      await page.locator('.ask-status[data-phase="streaming"]').waitFor();
      assert.equal(await page.locator('.ask-waiting-dots').count(), 0);
      await shot('streaming');
      await page.locator('.ask-status').filter({ hasText: '回复已完成' }).waitFor();
      const texts = await page.evaluate(() => window.epTexts.filter(text => text.includes('这是')));
      assert.ok(new Set(texts).size > 2, 'partial Markdown/text appears as chunks arrive');
      await ask.locator('textarea').fill('tool-roundtrip');
      await spaceToolEvents(page);
      await ask.locator('textarea').press('Enter');
      await page.locator('.ask-status[data-phase="tool"]').waitFor();
      assert.equal(await page.locator('.ask-waiting-dots > i').count(), 3, 'Tool retains the same active marker as waiting');
      await shot('tool');
      await page.locator('.ask-status').filter({ hasText: '回复已完成' }).waitFor();
      await page.evaluate(() => window.epRestoreFetch());
      assert.ok(fixture.stats.toolCalls >= 4, 'four real Host read-tool round trips occurred');
      await ask.locator('textarea').fill('stop-probe');
      await ask.locator('textarea').press('Enter');
      await page.locator('.ask-status[data-phase="streaming"]').waitFor();
      await ask.getByRole('button', { name: '停止', exact: true }).click();
      await page.locator('.ask-status[data-phase="stopping"]').waitFor();
      assert.equal(await page.locator('.ask-waiting-dots').count(), 0);
      await shot('stopping');
      await page.locator('.ask-status').filter({ hasText: '已停止，内容已保留' }).waitFor();
      assert.match(await ask.locator('.ask-message--assistant .ask-message-text').last().textContent(), /继续生成/u, 'Stop preserves actual partial response text');
      const phases = await page.evaluate(() => window.epPhases);
      console.log(`${width}: observed Ask phases ${phases.join(', ')}`);
      for (const phase of ['sending', 'waiting', 'tool', 'streaming', 'stopping']) assert.ok(phases.includes(phase), `${width}: ${phase} rendered`);
      evidence.viewports.push({ width, height: 900, phases, partialTextUpdates: new Set(texts).size, toolEventNetworkSpacingMs: 90, loadingFrame });
      await ask.locator('.ask-toolbar .ui-select__trigger').click();
      await page.getByRole('listbox').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await ask.isVisible(), true, 'nested Escape leaves the parent modal open');
      await page.getByRole('listbox').waitFor({ state: 'hidden' });
      await page.unroute('**/api/ai');
      await page.evaluate(() => window.epObserver.disconnect());
    }
    await ask.getByRole('button', { name: '关闭', exact: true }).click();
    await ask.waitFor({ state: 'hidden' });
    if (!baseline) {
      await page.waitForFunction(() => !document.querySelector('.ui-dialog-backdrop'));
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('eremite:toast', { detail: { title: '资料已保存', tone: 'success', duration: 0 } })));
      await page.locator('.ui-toast').waitFor();
      await page.getByRole('button', { name: '关闭通知', exact: true }).click();
      assert.equal(await page.locator('.ui-toast[data-state="closed"]').evaluate(surface => surface.inert), true);
      await page.waitForFunction(() => !document.querySelector('.ui-toast'));
      for (const route of ['/projects', '/automations', '/actions', '/inbox']) {
        await page.goto(fixture.baseURL + route);
        await fits();
      }
      await page.goto(`${fixture.baseURL}/automations?tool=core.file-converter`);
      await page.getByRole('option').filter({ hasText: /Emerald|emerald-reference/u }).click();
      await page.locator('.file-converter-settings').waitFor();
      const primary = page.getByRole('button', { name: '转换文件', exact: true });
      const fab = page.getByRole('button', { name: '打开 Ask Eremite', exact: true });
      const decoration = await fab.evaluate(button => {
        const style = getComputedStyle(button, '::after');
        return { content: style.content, display: style.display, width: Number.parseFloat(style.width), buttonWidth: button.getBoundingClientRect().width, position: getComputedStyle(button).position };
      });
      assert.equal(decoration.position, width === 375 ? 'static' : 'fixed');
      assert.ok(decoration.content === 'none' || decoration.display === 'none' || decoration.width <= decoration.buttonWidth + 1, `${width}: Ask decoration stays inside its button ${JSON.stringify(decoration)}`);
      await primary.evaluate(button => { window.epPrimaryHits = 0; button.addEventListener('click', event => { event.preventDefault(); window.epPrimaryHits++; }, { capture: true }); button.scrollIntoView({ block: 'center' }); });
      const box = await primary.boundingBox();
      for (const x of [box.x + 5, box.x + box.width / 2, box.x + box.width - 5]) for (const y of [box.y + 5, box.y + box.height / 2, box.y + box.height - 5]) {
        assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.tool-run-button')), { x, y }), true);
        await page.mouse.click(x, y);
      }
      assert.equal(await page.evaluate(() => window.epPrimaryHits), 9, 'primary action keeps all nine hit points after scroll');
      evidence.viewports.at(-1).fileConverterPrimaryHits = 9;
      evidence.viewports.at(-1).askPosition = decoration.position;
    }
    let imageRequests = 0;
    const countImage = request => { if (request.url().includes(`/files/${imageId}/`) && /\/content(?:\?|$)/.test(request.url())) imageRequests++; };
    page.on('request', countImage);
    if (!baseline) await page.route('**/files/**/content', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.continue(); });
    await page.goto(`${fixture.baseURL}/viewer/${imageId}`);
    if (!baseline) {
      await page.locator('.viewer-image-placeholder').waitFor();
      await shot('image-loading');
    }
    await page.locator('.image-renderer.loaded').waitFor();
    await shot('viewer');
    if (!baseline) {
      assert.equal(await page.locator('.image-renderer img').count(), 1);
      assert.equal(imageRequests, 1, 'one original image request, without duplicate decoding layers');
      await page.getByRole('button', { name: '放大', exact: true }).click();
      assert.match(await page.locator('.image-renderer img').getAttribute('style'), /scale\(1\.25\)/);
      const stage = await page.locator('.image-renderer').boundingBox();
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
      await page.mouse.down(); await page.mouse.move(stage.x + stage.width / 2 + 20, stage.y + stage.height / 2 + 20); await page.mouse.up();
      assert.match(await page.locator('.image-renderer img').getAttribute('style'), /translate\(20px, 20px\)/);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.image-renderer img').evaluate(image => getComputedStyle(image).transitionDuration), '0s');
      await page.goto(`${fixture.baseURL}/inbox`);
      await page.getByRole('button', { name: '打开 Ask Eremite', exact: true }).click();
      await ask.waitFor();
      const animated = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length);
      assert.equal(animated, 0, 'reduced-motion disables running animations');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ui-dialog-backdrop').count(), 0, 'reduced-motion closes immediately');
      await page.getByRole('button', { name: '打开命令面板', exact: true }).click();
      await palette.waitFor(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ui-dialog-backdrop').count(), 0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.unroute('**/files/**/content');
    } else evidence.viewports.push({ width, height: 900, screenshots: true });
    const video = page.video();
    await page.close();
    if (video) await video.saveAs(path.join(evidenceRoot, `after-${width}-motion.webm`));
  }
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(evidence.warnings, []);
  console.log(`Emerald Pulse ${baseline ? 'baseline screenshots' : 'browser gate'}: ${JSON.stringify(evidence)}`);
} finally {
  await browser?.close();
  await fixture?.close();
  await writeFile(path.join(evidenceRoot, `${baseline ? 'before' : 'after'}-browser.json`), JSON.stringify(evidence, null, 2));
}

async function spaceToolEvents(page) {
  // Preserve the real Host SSE bytes, spacing individual events as a slow
  // network would. Tiny synchronous read tools otherwise arrive in one packet.
  // This affects only the supplemental tool probe, not ordinary streaming/Stop.
  await page.evaluate(() => {
    const original = window.fetch;
    window.epRestoreFetch = () => { window.fetch = original; };
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (!String(input).endsWith('/api/ai') || !String(init?.body).includes('tool-roundtrip') || !response.body) return response;
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); const encoder = new TextEncoder();
      let cancelled = false;
      return new Response(new ReadableStream({
        async start(controller) {
          let pending = '';
          try {
            while (!cancelled) {
              const { value, done } = await reader.read();
              if (done) break;
              pending += decoder.decode(value, { stream: true });
              let boundary;
              while (!cancelled && (boundary = pending.indexOf('\n\n')) >= 0) {
                controller.enqueue(encoder.encode(pending.slice(0, boundary + 2)));
                pending = pending.slice(boundary + 2);
                await new Promise(resolve => setTimeout(resolve, 90));
              }
            }
            if (!cancelled) { if (pending) controller.enqueue(encoder.encode(pending)); controller.close(); }
          } catch (error) { if (!cancelled) controller.error(error); }
        },
        cancel() { cancelled = true; return reader.cancel(); },
      }), { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  });
}
