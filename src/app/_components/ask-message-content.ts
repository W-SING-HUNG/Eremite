import { createElement } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownPlugins = [remarkGfm];
const markdownComponents: Components = {
  table: ({ node: _node, ...props }) => createElement('div', {
    className: 'ask-markdown-table-scroll', role: 'region', 'aria-label': '回答表格，可横向滚动', tabIndex: 0,
  }, createElement('table', props)),
  a: ({ href, children }) => {
    const safeHref = safeLink(href);
    const external = Boolean(safeHref && /^(https?:|mailto:)/iu.test(safeHref));
    return createElement('a', { href: safeHref, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, children);
  },
  img: ({ alt }) => createElement('span', { className: 'ask-markdown-image' }, alt ? `图片未加载：${alt}` : '图片未加载'),
};

/** Assistant Markdown is parsed without raw HTML; user messages remain React-escaped text. */
export function AskMessageContent({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  if (role === 'user') return content;
  return createElement(Markdown, { remarkPlugins: markdownPlugins, skipHtml: true, components: markdownComponents }, content);
}

function safeLink(href?: string) {
  if (!href) return undefined;
  if (/^https?:\/\//iu.test(href) || /^mailto:/iu.test(href) || /^\/(?!\/)/u.test(href) || href.startsWith('#')) return href;
  return undefined;
}
