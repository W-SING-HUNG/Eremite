import type { AIContextTarget } from '@/modules/ai/chat-contracts';

export function currentAskEremiteContext(pathname: string, params: Pick<URLSearchParams, 'get'>): { target: AIContextTarget; label: string } {
  const selected = params.get('selected');
  const viewer = /^\/viewer\/([^/]+)$/u.exec(pathname)?.[1];
  if (viewer) return { target: { kind: 'content', id: viewer }, label: '当前资料' };
  if (pathname === '/actions') return { target: { kind: 'actions', ...(selected ? { id: selected } : {}) }, label: '行动台' };
  const projectId = /^\/projects\/([^/]+)/u.exec(pathname)?.[1];
  if (projectId && params.get('tab') === 'actions') return { target: { kind: 'actions', projectId, ...(selected ? { id: selected } : {}) }, label: '专案行动' };
  if (selected && (pathname === '/inbox' || Boolean(projectId))) return { target: { kind: 'content', id: selected }, label: '当前资料' };
  if (projectId) return { target: { kind: 'project', id: projectId }, label: '当前专案' };
  return { target: { kind: 'global' }, label: '全局' };
}
