import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Supplemental native Windows/Chrome gate, not a mandatory CI dependency.
const root = process.env.EREMITE_UI_QA_ROOT;
if (!root || !process.env.EREMITE_DATA_DIR || !process.env.EREMITE_TOOL_WORKSPACE_DIR) throw new Error('Isolated QA roots required');
const { url, ids } = JSON.parse(readFileSync(path.join(root, 'runtime.json')));
assert.equal(new URL(url).hostname, '127.0.0.1');
const { chromium } = createRequire(import.meta.url)(process.env.EREMITE_PLAYWRIGHT_MODULE);
const evidence = { viewports: [], animation: {}, legacyEnter: {}, errors: [] };
const output = path.join(root, 'screenshots'); mkdirSync(output, { recursive: true });
for (const width of [1440, 869, 375]) for (const zoom of [1, 1.25, 2]) {
  const profile = path.join(root, `gate-profile-${width}-${zoom}`);
  const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.EREMITE_BROWSER_EXECUTABLE, headless: true, viewport: { width, height: 900 }, deviceScaleFactor: 1, ...(width === 1440 && zoom === 1 ? { recordVideo: { dir: output, size: { width: 1440, height: 900 } } } : {}) });
  let page;
  try {
    const settings = await context.newPage(); await settings.goto('chrome://settings/appearance');
    await settings.locator('select#zoomLevel').selectOption(String(zoom));
    page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.goto(url + '/inbox'); if (page.url().endsWith('/login')) { await page.getByLabel('密码', { exact: true }).fill('isolated-ask-qa-password'); await page.getByRole('button', { name: '进入工作台', exact: true }).click(); }
    await page.locator('.content-row').first().waitFor();
    const fits = async surface => {
      const result = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, overflow: document.documentElement.scrollWidth > innerWidth, cssZoom: getComputedStyle(document.body).zoom }));
      assert.ok(Math.abs(result.dpr - zoom) < .01, 'native browser zoom is active'); assert.equal(result.cssZoom, '1'); assert.equal(result.overflow, false, `${width}/${zoom}: ${surface} fits`); return result;
    };
    const dimensions = await fits('Library');
    const rows = await page.locator('.content-row').evaluateAll(nodes => nodes.map(node => {
      const title = node.querySelector('strong'), time = node.querySelector('time'), location = node.querySelector('.location-text');
      const a = title.getBoundingClientRect(), b = time.getBoundingClientRect();
      return { titleSize: getComputedStyle(title).fontSize, height: node.getBoundingClientRect().height, overlap: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)), alignment: Math.abs(a.x - location.getBoundingClientRect().x - parseFloat(getComputedStyle(location).paddingLeft)) };
    }));
    assert.ok(rows.every(row => row.titleSize === '15px' && row.overlap === 0 && row.height >= 52));
    if (dimensions.width < 840) assert.ok(rows.every(row => row.alignment < 1), 'location starts with the title column');
    const cdp = await context.newCDPSession(page);
    const shot = async name => { const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); writeFileSync(path.join(output, `gate-${width}-${zoom}-${name}.png`), Buffer.from(image.data, 'base64')); };
    await shot('library');
    await page.getByRole('button', { name: '新建资料', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新建资料', exact: true }); await create.waitFor(); await fits('Dialog');
    for (let index = 0; index < 8; index++) { await page.keyboard.press('Tab'); assert.equal(await create.evaluate(node => node.contains(document.activeElement)), true); }
    await shot('dialog'); await page.keyboard.press('Escape'); await page.locator('.ui-dialog-backdrop').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '新建资料', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.getByRole('button', { name: '打开命令面板', exact: true }).click(); await page.getByRole('dialog', { name: '命令面板', exact: true }).waitFor(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); await page.locator('.ui-dialog-backdrop').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '打开 Ask Eremite', exact: true }).click();
    const ask = page.getByRole('dialog', { name: 'Ask Eremite', exact: true }); await page.locator('.ask-context__model').filter({ hasText: 'mock-model' }).waitFor(); await fits('Ask');
    assert.equal(await page.locator('.ask-message-text').first().evaluate(node => getComputedStyle(node).fontSize), '16px');
    const compose = ask.locator('textarea'); await compose.scrollIntoViewIfNeeded(); assert.equal(await compose.isVisible(), true);
    const hit = async locator => { await locator.scrollIntoViewIfNeeded(); return locator.evaluate(node => { const r = node.getBoundingClientRect(); const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return target === node || node.contains(target); }); };
    assert.equal(await hit(compose), true, 'composer is physically reachable');
    assert.equal(await hit(ask.getByRole('button', { name: '发送', exact: true })), true, 'send control is physically reachable');
    assert.equal(await ask.evaluate(node => {
      const transcript = node.querySelector('.ask-transcript').getBoundingClientRect();
      const status = node.querySelector('.ask-status').getBoundingClientRect();
      const compose = node.querySelector('.ask-compose').getBoundingClientRect();
      return transcript.bottom <= status.top && status.bottom <= compose.top;
    }), true, 'messages, status and composer do not overlap');
    await compose.scrollIntoViewIfNeeded(); await shot('ask');
    if (width === 1440 && zoom === 1) {
      await page.evaluate(() => {
        window.ep11Trace = []; let marker; let markerId = 0;
        const status = document.querySelector('.ask-status');
        const sample = () => {
          const dots = status.querySelector('.ask-waiting-dots'); if (dots && dots !== marker) { marker = dots; markerId++; }
          const values = dots ? [...dots.children].map(dot => { const animation = dot.getAnimations()[0]; return { opacity: Number(getComputedStyle(dot).opacity), fill: getComputedStyle(dot).animationFillMode, time: animation?.currentTime, iteration: animation?.effect.getComputedTiming().currentIteration }; }) : [];
          const value = { phase: status.dataset.phase, text: status.textContent, markerId: dots ? markerId : null, x: status.querySelector('.ask-status__indicator').getBoundingClientRect().x, dots: values };
          if (window.ep11Trace.at(-1)?.phase !== value.phase) window.ep11Trace.push(value);
        };
        window.ep11Observer = new MutationObserver(sample); window.ep11Observer.observe(status, { subtree: true, childList: true, attributes: true });
      });
      await compose.fill('验证首轮与后续等待动画'); await compose.press('Enter'); await page.locator('.ask-status[data-phase="waiting"]').waitFor();
      const frames = [];
      for (let n = 0; n < 45; n++) { frames.push(await page.locator('.ask-waiting-dots > i').evaluateAll(nodes => nodes.map(dot => ({ opacity: Number(getComputedStyle(dot).opacity), fill: getComputedStyle(dot).animationFillMode, time: dot.getAnimations()[0]?.currentTime, iteration: dot.getAnimations()[0]?.effect.getComputedTiming().currentIteration })))); await new Promise(resolve => setTimeout(resolve, 40)); }
      assert.ok(frames[0].every(dot => dot.fill === 'backwards')); assert.ok(frames.some(frame => frame.every(dot => dot.iteration >= 1)), 'later full cycles observed');
      const first = await page.evaluate(() => window.ep11Trace.find(value => value.phase === 'waiting'));
      assert.ok(first.dots.slice(1).every(dot => dot.opacity <= .41), 'delayed dots use the first keyframe before starting');
      evidence.animation = { first, frames };
      await page.locator('.ask-status').filter({ hasText: '回复已完成' }).waitFor();
      await ask.getByRole('button', { name: '新对话', exact: true }).click();
      await page.locator('.ask-empty').waitFor();
      await page.getByRole('button', { name: '发送', exact: true }).waitFor();
      await spaceToolEvents(page); await compose.fill('tool-roundtrip'); await page.getByRole('button', { name: '发送', exact: true }).click(); await page.waitForFunction(() => window.ep11Trace.some(value => value.phase === 'tool')); await page.locator('.ask-status').filter({ hasText: '回复已完成' }).waitFor();
      await page.evaluate(() => window.ep11RestoreFetch());
      const trace = await page.evaluate(() => window.ep11Trace); const active = trace.filter(v => v.phase === 'tool' || v.phase === 'waiting');
      const tools = trace.filter(v => v.phase === 'tool'); assert.ok(tools.length >= 4);
      // The first ordinary run and the subsequent Tool run each own one marker.
      const toolStart = trace.findIndex(v => v.phase === 'tool'); const toolMarkers = trace.slice(toolStart).filter(v => v.phase === 'tool' || v.phase === 'waiting');
      assert.equal(new Set(toolMarkers.map(v => v.markerId)).size, 1); assert.equal(new Set(active.map(v => v.x)).size, 1); assert.ok(tools.every(v => /正在/.test(v.text)));
      evidence.animation = { first, frames, trace, toolTransitions: tools.length };
      await page.evaluate(() => window.ep11Observer.disconnect());
    }
    await page.keyboard.press('Escape'); await page.locator('.ui-dialog-backdrop').waitFor({ state: 'detached' });
    await page.goto(url + '/viewer/' + ids.markdown); await page.locator('.markdown-renderer h1').waitFor(); await fits('Viewer');
    assert.ok(await page.locator('.viewer-title-block strong').evaluate(node => node.getBoundingClientRect().width) > 40, 'Viewer retains useful title space'); await shot('viewer');
    await page.goto(url + '/projects/' + ids.emptyProject); await page.locator('.unified-empty').waitFor(); await fits('empty state');
    evidence.viewports.push({ physicalWidth: width, zoom, ...dimensions, rows });
    console.log(`Native UI ${width}/${zoom} passed: ${JSON.stringify(dimensions)}`);
  } catch (error) { console.error(`Gate failure ${width}/${zoom}: ${error.message}`); if (page) { console.error(await page.locator('.ask-status').allTextContents()); console.error(await page.evaluate(() => window.ep11Trace ?? [])); const cdp = await context.newCDPSession(page); const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }); writeFileSync(path.join(output, `failure-${width}-${zoom}.png`), Buffer.from(png.data, 'base64')); } throw error;
  } finally {
    const video = page?.video();
    if (video && width === 1440 && zoom === 1) { const saving = video.saveAs(path.join(output, 'desktop-motion.webm')); await page.close(); await saving; }
    await context.close();
    writeFileSync(path.join(root, 'typography-browser.json'), JSON.stringify(evidence, null, 2));
  }
}
assert.deepEqual(evidence.errors, []);
const legacyBrowser = await chromium.launch({ executablePath: process.env.EREMITE_BROWSER_EXECUTABLE, headless: true });
try {
  const page = await legacyBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url + '/inbox'); await page.getByLabel('密码', { exact: true }).fill('isolated-ask-qa-password'); await page.getByRole('button', { name: '进入工作台', exact: true }).click();
  let sends = 0; page.on('request', request => { if (request.url().includes('/api/ai') && request.method() === 'POST' && request.postDataJSON()?.action === 'send') sends++; });
  await page.route('**/api/ai*', async route => { if (route.request().method() === 'GET') await new Promise(resolve => setTimeout(resolve, 3000)); await route.continue(); });
  await page.getByRole('button', { name: '打开 Ask Eremite', exact: true }).click(); const input = page.locator('.ask-compose textarea'); await input.fill('初始化后立即按 Enter 的旧问题复核'); await input.press('Enter');
  evidence.legacyEnter = { delayedInitializationMs: 3000, sendRequests: sends, retainedText: await input.inputValue(), status: await page.locator('.ask-status').textContent() };
  assert.equal(sends, 0, 'pre-existing initialization guard is recorded, not changed');
  await page.locator('.ask-context__model').filter({ hasText: 'mock-model' }).waitFor();
} finally { await legacyBrowser.close(); }
writeFileSync(path.join(root, 'typography-browser.json'), JSON.stringify(evidence, null, 2));
console.log('Chinese typography native browser gate PASS');

async function spaceToolEvents(page) {
  await page.evaluate(() => {
    const original = window.fetch; window.ep11RestoreFetch = () => window.fetch = original;
    window.fetch = async (input, init) => {
      const response = await original(input, init); if (!String(init?.body).includes('tool-roundtrip') || !response.body) return response;
      const reader = response.body.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
      return new Response(new ReadableStream({ async start(controller) { let pending = ''; try { for (;;) { const { value, done } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); let boundary; while ((boundary = pending.indexOf('\n\n')) >= 0) { controller.enqueue(encoder.encode(pending.slice(0, boundary + 2))); pending = pending.slice(boundary + 2); await new Promise(resolve => setTimeout(resolve, 90)); } } if (pending) controller.enqueue(encoder.encode(pending)); controller.close(); } catch (error) { controller.error(error); } }, cancel() { return reader.cancel(); } }), { status: response.status, headers: response.headers });
    };
  });
}
