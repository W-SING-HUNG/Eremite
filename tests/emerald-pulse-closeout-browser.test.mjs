import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Supplemental gate using an existing native Chrome and a disposable production fixture.
const root = process.env.EREMITE_UI_QA_ROOT;
if (!root || !process.env.EREMITE_DATA_DIR || !process.env.EREMITE_TOOL_WORKSPACE_DIR) throw new Error('Isolated QA roots required');
const baseline = process.argv.includes('--baseline');
const prefix = baseline ? 'before' : 'after';
const { url, ids } = JSON.parse(readFileSync(path.join(root, 'runtime.json')));
assert.equal(new URL(url).hostname, '127.0.0.1');
const { chromium } = createRequire(import.meta.url)(process.env.EREMITE_PLAYWRIGHT_MODULE);
const output = path.join(root, 'screenshots'); mkdirSync(output, { recursive: true });
const evidence = { baseline, viewports: [], errors: [] };
for (const width of [1440, 375, 187]) {
  const nativeZoom = width === 187 ? 2 : 1;
  const context = await chromium.launchPersistentContext(path.join(root, `${prefix}-profile-${width}`), { executablePath: process.env.EREMITE_BROWSER_EXECUTABLE, headless: true, viewport: { width: width === 187 ? 375 : width, height: 900 }, deviceScaleFactor: 1 });
  try {
    const settings = await context.newPage(); await settings.goto('chrome://settings/appearance'); await settings.locator('select#zoomLevel').selectOption(String(nativeZoom));
    const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
    await page.goto(url + '/inbox'); if (page.url().endsWith('/login')) { await page.getByLabel('密码', { exact: true }).fill('isolated-ask-qa-password'); await page.getByRole('button', { name: '进入工作台', exact: true }).click(); }
    await page.locator('.content-row').first().waitFor();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    assert.equal(dimensions.width, width); assert.equal(dimensions.dpr, nativeZoom);
    const dataset = await page.locator('.content-row').allTextContents();
    const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no page-level horizontal overflow');
    const hit = locator => locator.evaluate(node => { const r = node.getBoundingClientRect(); const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return target === node || node.contains(target); });
    const cdp = await context.newCDPSession(page);
    const shot = async name => {
      await page.mouse.move(0, 0);
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => {}))); });
      const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      writeFileSync(path.join(output, `${prefix}-css${width}-${name}.png`), Buffer.from(image.data, 'base64'));
    };
    const inspector = async (panel, heading, controls) => {
      const value = await panel.evaluate(node => {
        const header = node.querySelector('.inspector-header, .action-inspector-header'); const h2 = header.querySelector('h2'); const close = header.querySelector('[aria-label="关闭详情"]');
        const a = header.getBoundingClientRect(), b = h2.getBoundingClientRect(), c = close.getBoundingClientRect();
        return { title: h2.textContent, tooltip: h2.title, lineHeight: parseFloat(getComputedStyle(h2).lineHeight), titleHeight: b.height, headerHeight: a.height, closeOffset: c.y - a.y };
      });
      // CSS truncation preserves the complete heading in the accessibility tree.
      assert.equal(await panel.getByRole('heading', { name: value.title, exact: true }).count(), 1);
      if (!baseline) {
        await cdp.send('DOM.enable');
        const { root } = await cdp.send('DOM.getDocument');
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: heading === 'inspector' ? '.resource-inspector h2' : '.action-inspector h2' });
        const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId });
        value.chromeAccessibleTitle = nodes.find(node => node.role?.value === 'heading')?.name?.value;
        assert.equal(value.chromeAccessibleTitle, value.title, 'native Chrome exposes the entire title');
        assert.equal(value.tooltip, value.title); assert.ok(value.titleHeight <= value.lineHeight * (width < 840 ? 2 : 3) + 1); assert.ok(value.headerHeight < 160); assert.ok(value.closeOffset >= 0 && value.closeOffset < value.lineHeight, 'close button stays on the first title line');
        for (const control of controls) assert.equal(await hit(control), true, 'Inspector control is actually reachable');
      }
      await shot(heading);
      if (!baseline && width < 840) for (let n = 0; n < 5; n++) { await page.keyboard.press('Tab'); assert.equal(await panel.evaluate(node => node.contains(document.activeElement)), true); }
      await panel.getByRole('button', { name: '关闭详情', exact: true }).click(); await panel.waitFor({ state: 'detached' });
      return value;
    };
    const contentRow = page.locator('.content-row').filter({ hasText: '中文资料归档与长期阅读体验' }); await contentRow.click();
    const resource = page.locator('.resource-inspector'); await resource.waitFor(); await fits();
    const contentInspector = await inspector(resource, 'inspector', [resource.getByRole('button', { name: '关闭详情', exact: true }), resource.getByRole('button', { name: '资料操作', exact: true }), resource.getByRole('button', { name: '基于当前资料打开 Ask Eremite', exact: true })]);
    if (!baseline && width < 840) assert.equal(await contentRow.evaluate(node => node === document.activeElement), true, 'Inspector restores row focus');
    await page.goto(url + '/actions'); await page.locator('.action-row').first().waitFor(); await fits();
    const row = page.locator('.action-row').filter({ hasText: '整理本周中文阅读资料' });
    const actionRow = await row.locator('strong').evaluate(node => ({ title: node.textContent, tooltip: node.title, height: node.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(node).lineHeight) }));
    if (!baseline && width < 840) { assert.equal(actionRow.tooltip, actionRow.title); assert.ok(actionRow.height > actionRow.lineHeight && actionRow.height <= actionRow.lineHeight * 2 + 1); assert.equal(await hit(row.locator('.action-complete-button')), true); }
    await shot('actions'); await row.locator('.action-row-main').focus(); await page.keyboard.press('Enter');
    const action = page.locator('.action-inspector'); await action.waitFor();
    const actionInspector = await inspector(action, 'action-inspector', [action.getByRole('button', { name: '关闭详情', exact: true }), action.getByRole('button', { name: '行动菜单', exact: true })]);
    const viewers = [];
    for (const kind of ['markdown', 'text']) {
      await page.goto(url + '/viewer/' + ids[kind]); const renderer = page.locator(`.${kind}-renderer`); await renderer.waitFor(); await fits();
      const reading = kind === 'text' ? renderer.locator('pre') : renderer.locator('p').first();
      const size = () => reading.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
      const waitSize = expected => page.waitForFunction(({ selector, expected }) => Math.abs(parseFloat(getComputedStyle(document.querySelector(selector)).fontSize) - expected) < .01, { selector: kind === 'text' ? '.text-renderer pre' : '.markdown-renderer p', expected });
      const value = { kind, initialSize: await size(), zoomSizes: [] }; await shot(kind);
      if (!baseline) {
        assert.equal(value.initialSize, 16, '100% uses the reading token');
        if (kind === 'markdown') assert.equal(await renderer.locator('pre code').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), 14, 'code remains proportionate without double scaling');
        await page.getByRole('button', { name: '放大', exact: true }).click();
        await page.waitForFunction(selector => Math.abs(parseFloat(getComputedStyle(document.querySelector(selector)).fontSize) - 17.6) < .01, kind === 'text' ? '.text-renderer pre' : '.markdown-renderer p'); value.zoomSizes.push(await size());
        await page.keyboard.press('0'); await waitSize(16); assert.equal(await size(), 16, 'keyboard reset retains the reading token');
        for (let n = 0; n < 10; n++) await page.getByRole('button', { name: '放大', exact: true }).click(); await page.keyboard.press('+'); await waitSize(32); assert.equal(await size(), 32, '200% maximum is retained'); value.zoomSizes.push(await size());
        if (kind === 'markdown') assert.equal(await renderer.locator('pre code').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), 28, 'code follows user zoom');
        for (let n = 0; n < 14; n++) await page.getByRole('button', { name: '缩小', exact: true }).click(); await page.keyboard.press('-'); await waitSize(9.6); assert.ok(Math.abs(await size() - 9.6) < .01, '60% minimum is retained'); value.zoomSizes.push(await size());
        await page.keyboard.press('0'); await waitSize(16); assert.equal(await size(), 16);
      }
      viewers.push(value);
    }
    evidence.viewports.push({ ...dimensions, nativeZoom, dataset, contentInspector, actionRow, actionInspector, viewers });
    console.log(`${prefix}: CSS ${width}px PASS`);
  } finally { await context.close(); }
}
assert.deepEqual(evidence.errors, []);
if (!baseline) {
  const previous = JSON.parse(readFileSync(path.join(root, 'before-browser.json')));
  for (const item of evidence.viewports) { const old = previous.viewports.find(v => v.width === item.width); assert.deepEqual(item.dataset, old.dataset, 'paired screenshots use the same ordered dataset'); assert.equal(item.actionRow.title, old.actionRow.title); assert.equal(item.height, old.height); assert.equal(item.dpr, old.dpr); }
}
writeFileSync(path.join(root, `${prefix}-browser.json`), JSON.stringify(evidence, null, 2));
console.log(`Emerald Pulse closeout ${prefix} gate PASS`);
