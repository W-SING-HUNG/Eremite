import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskMessageContent } from '@/app/_components/ask-message-content';

const render = (role, content) => renderToStaticMarkup(createElement(AskMessageContent, { role, content }));

const formatted = render('assistant', '# 标题\n\n**加粗** *斜体*\n\n- 第一项\n- 第二项\n\n[链接](https://example.com/doc) 与 `行内代码`\n\n```js\nconst value = 1;\n```\n\n| 列 | 值 |\n| --- | --- |\n| A | B |');
assert.match(formatted, /<h1>标题<\/h1>/u);
assert.match(formatted, /<strong>加粗<\/strong>/u);
assert.match(formatted, /<em>斜体<\/em>/u);
assert.match(formatted, /<ul>[\s\S]*<li>第一项<\/li>[\s\S]*<li>第二项<\/li>[\s\S]*<\/ul>/u);
assert.match(formatted, /<a href="https:\/\/example\.com\/doc"[^>]*>链接<\/a>/u);
assert.match(formatted, /<code>行内代码<\/code>/u);
assert.match(formatted, /<pre>[\s\S]*const value = 1;[\s\S]*<\/pre>/u);
assert.match(formatted, /<table>[\s\S]*<td>B<\/td>[\s\S]*<\/table>/u);
assert.match(formatted, /<div class="ask-markdown-table-scroll" role="region" aria-label="回答表格，可横向滚动" tabindex="0"><table>/u);

const narrowTable = render('assistant', '| 字段 | 当前状态 | 说明 |\n| --- | --- | --- |\n| 行动 | active | 保留可读列宽 |');
assert.match(narrowTable, /class="ask-markdown-table-scroll"[\s\S]*<table>[\s\S]*当前状态[\s\S]*active[\s\S]*<\/table>/u);

const hostile = render('assistant', '<script>window.__xss = true</script>\n\n<img src="https://example.com/tracker.png" onerror="alert(1)">\n\n[危险](javascript:alert(1))\n\n![远端图片](https://example.com/tracker.png)');
assert.doesNotMatch(hostile, /<script|<img|onerror=|href="javascript:|src="https:\/\/example\.com\/tracker/u);
assert.match(hostile, /图片未加载：远端图片/u);
const user = render('user', '# 用户标题 **不渲染** <script>alert(1)</script>');
assert.match(user, /# 用户标题 \*\*不渲染\*\*/u);
assert.doesNotMatch(user, /<h1>|<strong>|<script>/u);
assert.match(user, /&lt;script&gt;/u);

for (const partial of ['**未完成', '# 当前标题', '- 第一项\n- ', '```js\nconst unfinished =']) {
  const html = render('assistant', partial);
  assert.ok(html.length > 0, 'streaming prefixes remain renderable');
}
const stoppedPartial = '## 已停止\n\n**保留的部分文本';
assert.match(render('assistant', stoppedPartial), /保留的部分文本/u, 'Stop retains visible partial Markdown');

const panel = await readFile('src/app/_components/ask-eremite.tsx', 'utf8');
const styles = await readFile('src/app/styles.css', 'utf8');
assert.match(styles, /\.ask-markdown-table-scroll \{[^}]*width: 100%;[^}]*max-width: 100%;[^}]*overflow-x: auto;/u);
assert.match(styles, /\.ask-markdown-table-scroll table \{[^}]*width: max-content;[^}]*min-width: 100%;/u);
assert.match(styles, /\.ask-markdown-table-scroll :is\(th, td\) \{[^}]*min-width: 8rem;[^}]*word-break: normal;/u);
assert.match(styles, /@media \(max-width: 839px\) \{[\s\S]*?\.ui-dialog\.ask-eremite-panel \{ inset: 0; width: 100%; height: 100dvh;/u, '375px panel stays viewport-width while only table region scrolls');
assert.match(styles, /\.ask-eremite-panel \.ui-dialog__body \{[^}]*overflow: hidden;/u, 'mobile table overflow stays inside the panel body');
assert.match(styles, /\.ask-eremite-panel, \.ask-eremite-panel \* \{ min-width: 0;/u, 'panel children may shrink to the 375px viewport');
assert.match(panel, /<AskMessageContent role=\{message\.role\}/u);
assert.match(panel, /streamed\.text \|\| statusText/u);
assert.match(panel, /message\.content \|\| \(message\.status === 'running'/u);
assert.match(panel, /message\.sources\.map/u);
assert.match(panel, /message\.actionDrafts\.map/u);
assert.match(panel, /message\.actionUpdates\.map/u);
console.log('Ask Eremite Markdown gate passed: GFM table and 375px CSS containment contract, safe HTML and links, plain user text, partial streaming/Stop, and separate Host cards.');
