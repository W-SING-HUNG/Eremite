import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startAIChatFixture } from './ai-chat-http-fixture.mjs';

// Supplemental production-browser gate; uses an installed Playwright + Chrome.
// node --import ./tests/register-typescript-loader.mjs tests/ask-eremite-initialization.test.mjs
// EREMITE_PLAYWRIGHT_MODULE and EREMITE_BROWSER_EXECUTABLE may specify local installs.
const { chromium } = createRequire(import.meta.url)(process.env.EREMITE_PLAYWRIGHT_MODULE || 'playwright');
const beforeFix = process.argv.includes('--before-fix');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let fixture, browser;
const evidence = [];
try {
  fixture = await startAIChatFixture();
  browser = await chromium.launch({ headless: true, ...(process.env.EREMITE_BROWSER_EXECUTABLE ? { executablePath: process.env.EREMITE_BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  const createThread = async () => {
    const response = await fetch(`${fixture.baseURL}/api/ai`, { method: 'POST', headers: { Cookie: `eremite_session=${fixture.sessionId}`, Origin: fixture.baseURL, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create' }) });
    assert.equal(response.status, 201);
    return response.json();
  };
  const first = await createThread();
  const second = await createThread();

  async function scenario(name, run, { failList = false, failThread = false, unconfigured = false, noHistory = false, staleRunning = false } = {}) {
    const page = await browser.newPage();
    const errors = [], sends = [], creates = [];
    const listArrived = deferred(), releaseList = deferred(), threadArrived = deferred(), releaseThread = deferred();
    let holdList = true, holdThread = true;
    let nextThreadDelay = null, createDelay = null;
    const pauseThread = id => { const delay = { id, arrived: deferred(), release: deferred() }; nextThreadDelay = delay; return delay; };
    const pauseCreate = () => { const delay = { arrived: deferred(), release: deferred() }; createDelay = delay; return delay; };
    page.on('pageerror', error => errors.push(error.message));
    await page.context().addCookies([{ name: 'eremite_session', value: fixture.sessionId, url: fixture.baseURL }]);
    await page.route('**/api/ai*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        if (body.action === 'send') sends.push(body);
        if (body.action === 'create') {
          creates.push(body);
          if (createDelay) { const delay = createDelay; createDelay = null; delay.arrived.resolve(); await delay.release.promise; }
        }
        return route.continue();
      }
      if (url.searchParams.has('threadId')) {
        if (nextThreadDelay?.id === url.searchParams.get('threadId')) {
          const delay = nextThreadDelay; nextThreadDelay = null; delay.arrived.resolve(); await delay.release.promise;
        }
        if (holdThread) { threadArrived.resolve(); await releaseThread.promise; }
        if (failThread) return route.fulfill({ status: 500, json: { code: 'ai_generation_failed' } });
        if (staleRunning) {
          staleRunning = false;
          const response = await route.fetch(), payload = await response.json();
          payload.messages.push({ ...payload.messages.at(-1), id: crypto.randomUUID(), role: 'assistant', status: 'running', run_id: crypto.randomUUID() });
          return route.fulfill({ response, json: payload });
        }
        return route.continue();
      }
      if (holdList) { listArrived.resolve(); await releaseList.promise; }
      if (failList) return route.fulfill({ status: 500, json: { code: 'ai_generation_failed' } });
      const response = await route.fetch();
      const payload = await response.json();
      if (unconfigured) payload.provider = { configured: false, model: null };
      payload.threads = noHistory ? [] : [first, second];
      return route.fulfill({ response, json: payload });
    });
    const dialog = page.getByRole('dialog', { name: 'Ask Eremite', exact: true });
    const input = dialog.locator('textarea');
    const open = async () => { await page.getByRole('button', { name: '打开 Ask Eremite', exact: true }).click(); await input.waitFor(); };
    const ready = () => page.waitForFunction(() => {
      const control = document.querySelector('.ask-toolbar .ui-select__trigger');
      return control && !control.disabled;
    });
    const release = async () => { holdList = false; releaseList.resolve(); if (!failList && !noHistory) await threadArrived.promise; holdThread = false; releaseThread.resolve(); await ready(); };
    try {
      await page.goto(`${fixture.baseURL}/inbox`);
      await open(); await listArrived.promise;
      await run({ page, dialog, input, sends, creates, pauseThread, pauseCreate, open, ready, release, releaseList: () => { holdList = false; releaseList.resolve(); }, threadArrived, bypassThread: () => { holdThread = false; }, releaseThread: () => { holdThread = false; releaseThread.resolve(); } });
      assert.deepEqual(errors, [], `${name}: uncaught browser errors`);
      evidence.push({ name, sends: sends.map(({ threadId, text }) => ({ threadId, text })), result: 'PASS' });
      console.log(`${name}: PASS (${sends.length} sends)`);
    } finally { releaseList.resolve(); releaseThread.resolve(); await page.close(); }
  }

  await scenario('immediate/repeated Enter across list and thread delay', async ({ page, input, sends, releaseList, threadArrived, releaseThread, ready }) => {
    await input.fill('立即发送测试'); await input.press('Enter'); await input.press('Enter');
    assert.equal(sends.length, 0);
    if (!beforeFix) assert.match(await page.locator('.ask-status').innerText(), /已记录发送请求/);
    releaseList(); await threadArrived.promise;
    await input.press('Enter'); assert.equal(sends.length, 0, 'provider ready alone must not send');
    releaseThread(); await ready();
    if (beforeFix) {
      await page.waitForTimeout(400);
      assert.equal(sends.length, 0); assert.equal(await input.inputValue(), '立即发送测试');
      console.log('BEFORE FIX reproduced: Enter intent lost after both initialization responses.');
      return;
    }
    await page.waitForFunction(() => document.querySelectorAll('.ask-message--user').length > 0);
    await page.waitForFunction(() => document.querySelector('.ask-status')?.textContent.includes('回复已完成'));
    assert.equal(sends.length, 1); assert.equal(sends[0].threadId, first.id); assert.equal(sends[0].text, '立即发送测试');
    assert.equal(await input.inputValue(), '');
  });
  if (!beforeFix) {
    for (const options of [{ failList: true }, { failThread: true }, { unconfigured: true }]) {
      await scenario(`initialization failure/unavailable ${JSON.stringify(options)}`, async ({ input, dialog, sends, release }) => {
        await input.fill('失败时保留输入'); await input.press('Enter'); await release();
        assert.equal(sends.length, 0); assert.equal(await input.inputValue(), '失败时保留输入');
        assert.match(await dialog.getByRole('alert').innerText(), options.unconfigured ? /Provider/ : /初始化失败/);
        await input.press('Enter'); assert.equal(sends.length, 0);
      }, options);
    }
    await scenario('close/reopen cancels queued send and stale thread response', async ({ page, dialog, input, sends, open, releaseList, threadArrived, releaseThread, ready }) => {
      await input.fill('关闭后不得发送'); await input.press('Enter'); releaseList(); await threadArrived.promise;
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      releaseThread(); await open(); await ready(); await page.waitForTimeout(250);
      assert.equal(sends.length, 0); assert.equal(await input.inputValue(), '关闭后不得发送');
    });
    await scenario('session selection cancels previous intent and uses selected thread', async ({ page, dialog, input, sends, release, ready }) => {
      await input.fill('取消旧请求'); await input.press('Enter');
      // Editing retracts the queued snapshot before choosing another session.
      await input.fill('切换后的草稿'); await release();
      await dialog.locator('.ask-toolbar .ui-select__trigger').click();
      await page.getByRole('option').nth(1).click(); await ready();
      assert.equal(sends.length, 0);
      await input.press('Enter');
      await page.waitForFunction(() => document.querySelector('.ask-status')?.textContent.includes('回复已完成'));
      assert.equal(sends.length, 1); assert.equal(sends[0].threadId, second.id); assert.equal(sends[0].text, '切换后的草稿');
    });
    await scenario('old initialization cannot send into or overwrite a later selection', async ({ page, dialog, input, sends, open, ready, releaseList, threadArrived, bypassThread, releaseThread }) => {
      await input.fill('旧会话待发请求'); await input.press('Enter'); releaseList(); await threadArrived.promise;
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      bypassThread(); await open(); await ready();
      await dialog.locator('.ask-toolbar .ui-select__trigger').click();
      await page.getByRole('option').nth(1).click(); await ready();
      releaseThread(); await page.waitForTimeout(250);
      assert.equal(sends.length, 0); assert.equal(await input.inputValue(), '旧会话待发请求');
      await input.fill('明确发送到新选择'); await input.press('Enter');
      await page.waitForFunction(() => document.querySelector('.ask-status')?.textContent.includes('回复已完成'));
      assert.equal(sends.length, 1); assert.equal(sends[0].threadId, second.id); assert.equal(sends[0].text, '明确发送到新选择');
    });
    await scenario('Enter during delayed session switch sends only to the selected session', async ({ page, dialog, input, sends, pauseThread, release }) => {
      await release(); const delay = pauseThread(second.id);
      await dialog.locator('.ask-toolbar .ui-select__trigger').click(); await page.getByRole('option').nth(1).click();
      await delay.arrived.promise;
      await input.fill('等待选中会话加载'); await input.press('Enter'); await input.press('Enter');
      assert.equal(sends.length, 0); delay.release.resolve();
      await page.waitForFunction(() => document.querySelector('.ask-status')?.textContent.includes('回复已完成'));
      assert.equal(sends.length, 1); assert.equal(sends[0].threadId, second.id); assert.equal(sends[0].text, '等待选中会话加载');
    });
    await scenario('stale running state on reopen does not discard initialization Enter', async ({ page, dialog, input, sends, pauseThread, release, open }) => {
      await release(); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      const delay = pauseThread(first.id); await open(); await delay.arrived.promise;
      await input.fill('重新加载后发送'); await input.press('Enter'); assert.equal(sends.length, 0);
      delay.release.resolve();
      await page.waitForFunction(() => document.querySelector('.ask-status')?.textContent.includes('回复已完成'));
      assert.equal(sends.length, 1); assert.equal(sends[0].threadId, first.id);
    }, { staleRunning: true });
    await scenario('Shift+Enter and composition never queue; send button and Stop work', async ({ page, dialog, input, sends, release }) => {
      await input.fill('组合输入'); await input.press('Shift+Enter');
      await input.dispatchEvent('compositionstart', { data: '' });
      await input.dispatchEvent('compositionupdate', { data: '中文' });
      await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
      await input.dispatchEvent('compositionend', { data: '中文' });
      await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
      await release(); assert.equal(sends.length, 0); assert.match(await input.inputValue(), /\n/);
      await input.fill('stop-probe'); await dialog.getByRole('button', { name: '发送', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.ask-status')?.dataset.phase === 'streaming');
      await dialog.getByRole('button', { name: '停止', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.ask-status')?.textContent.includes('已停止'));
      assert.equal(sends.length, 1);
    });
    await scenario('empty history creates exactly one conversation', async ({ page, input, sends, creates, release }) => {
      await input.fill('新会话立即发送'); await input.press('Enter'); await input.press('Enter'); await release();
      await page.waitForFunction(() => document.querySelector('.ask-status')?.textContent.includes('回复已完成'));
      assert.equal(sends.length, 1); assert.equal(creates.length, 1); assert.ok(![first.id, second.id].includes(sends[0].threadId));
    }, { noHistory: true });
    await scenario('close during automatic thread creation prevents dispatch', async ({ page, dialog, input, sends, pauseCreate, release, open, ready }) => {
      const delay = pauseCreate(); await input.fill('创建期间关闭'); await input.press('Enter'); await release();
      await delay.arrived.promise; await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      delay.release.resolve(); await open(); await ready(); await page.waitForTimeout(250);
      assert.equal(sends.length, 0); assert.equal(await input.inputValue(), '创建期间关闭');
    }, { noHistory: true });
  }
  console.log(JSON.stringify({ beforeFix, evidence }, null, 2));
} finally { await browser?.close(); await fixture?.close(); }
