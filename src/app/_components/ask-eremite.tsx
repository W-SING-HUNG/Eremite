"use client";

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, CalendarDays, Check, Flag, Link2, MessageCircle, Plus, RotateCw, Send, Square, X } from 'lucide-react';
import { Dialog } from './ui/dialog';
import { AskMessageContent } from './ask-message-content';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { consumeAIChat } from '@/modules/ai/chat-client';
import { aiChatErrorMessage, type AIActionDisambiguationArtifact, type AIActionDraftArtifact, type AIActionUpdateArtifact, type AIToolRunProposalArtifact, type AIActivity, type AIChatMessage, type AIProviderStatus, type AIThread, type AIThreadDetail } from '@/modules/ai/chat-contracts';
import { currentAskEremiteContext } from '@/app/_lib/ask-eremite-context';

async function api<T>(query = '', body?: object): Promise<T> {
  const response = await fetch(`/api/ai${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.code ?? 'ai_generation_failed');
  return payload as T;
}

export function AskEremite() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const context = useMemo(() => currentAskEremiteContext(pathname, searchParams), [pathname, searchParams]);
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<AIThread[]>([]);
  const [provider, setProvider] = useState<AIProviderStatus | null>(null);
  const [detail, setDetail] = useState<AIThreadDetail | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'waiting' | 'tool' | 'streaming' | 'stopping'>('idle');
  const [activity, setActivity] = useState<AIActivity | null>(null);
  const [toolTrail, setToolTrail] = useState<AIActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyMore, setHistoryMore] = useState(false);
  const [streamed, setStreamed] = useState<{ id: string; text: string } | null>(null);
  const [draftBusy, setDraftBusy] = useState<{ id: string; action: 'confirm' | 'reject' | 'refresh' } | null>(null);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [updateBusy, setUpdateBusy] = useState<{ id: string; action: 'apply' | 'reject' | 'refresh' } | null>(null);
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});
  const [toolRunBusy, setToolRunBusy] = useState<string | null>(null);
  const [toolRunErrors, setToolRunErrors] = useState<Record<string, string>>({});
  const [targetBusy, setTargetBusy] = useState<string | null>(null);
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const active = useRef<{ controller: AbortController; runId?: string; threadId: string } | null>(null);
  const pending = useRef(false);
  const draftPending = useRef(false);
  const updatePending = useRef(false);
  const targetPending = useRef(false);
  const activityCounts = useRef(new Map<AIActivity['kind'], number>());
  const selection = useRef(0);
  const mounted = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const openFromInspector = () => setOpen(true);
    window.addEventListener('eremite:open-ask-from-inspector', openFromInspector);
    return () => window.removeEventListener('eremite:open-ask-from-inspector', openFromInspector);
  }, []);
  const closeAsk = () => { setOpen(false); window.dispatchEvent(new Event('eremite:ask-closed')); };

  const refreshList = useCallback(async (offset = 0) => {
    const result = await api<{ threads: AIThread[]; provider: AIProviderStatus }>(offset ? `?offset=${offset}` : '');
    if (!mounted.current) return result;
    setThreads(previous => offset ? [...previous, ...result.threads.filter(item => !previous.some(old => old.id === item.id))] : result.threads);
    setHistoryMore(result.threads.length === 40); setProvider(result.provider);
    return result;
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const version = ++selection.current; setLoading(true); setError(''); setStreamed(null); setDraftErrors({}); setUpdateErrors({}); setToolRunErrors({}); setTargetErrors({}); setToolTrail([]); setFollowing(true);
    try {
      const result = await api<AIThreadDetail>(`?threadId=${id}`);
      if (mounted.current && version === selection.current) setDetail(result);
    } catch (failure) { if (mounted.current && version === selection.current) setError(failure instanceof Error ? failure.message : 'ai_generation_failed'); }
    finally { if (mounted.current && version === selection.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.controller.abort(); };
  }, []);

  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const panel = document.querySelector<HTMLElement>('.ask-eremite-panel');
    if (!panel) return;
    const resize = () => {
      panel.style.setProperty('--ask-visible-height', `${viewport.height}px`);
      panel.style.setProperty('--ask-visible-top', `${viewport.offsetTop}px`);
      if (following && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
    };
    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    return () => { viewport.removeEventListener('resize', resize); viewport.removeEventListener('scroll', resize); };
  }, [open, following]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void refreshList().then(async result => {
      if (!cancelled && detail) await loadThread(detail.thread.id);
      else if (!cancelled && result.threads[0]) await loadThread(result.threads[0].id);
    }).catch(() => { if (!cancelled) setError('ai_generation_failed'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Refresh when the panel opens; selection is otherwise explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshList, loadThread]);

  const runningMessage = detail?.messages.find(message => message.status === 'running');
  useEffect(() => {
    if (!open || !detail?.messages.some(message => message.toolRunProposals.some(item => item.lifecycle === 'accepted' && item.run?.status === 'running'))) return;
    const id = detail.thread.id;
    const timer = window.setInterval(() => { void api<AIThreadDetail>(`?threadId=${id}`).then(result => {
      if (mounted.current) setDetail(previous => previous?.thread.id === id ? result : previous);
    }).catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, [open, detail]);
  useEffect(() => {
    if (!busy && !runningMessage && phase === 'stopping') setPhase('idle');
  }, [busy, runningMessage, phase]);
  useEffect(() => {
    if (!open || (!busy && !runningMessage) || !detail) return;
    const timer = window.setInterval(() => {
      void api<AIThreadDetail>(`?threadId=${detail.thread.id}`).then(result => { if (mounted.current) setDetail(result); }).catch(() => setError('ai_generation_failed'));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [open, busy, runningMessage, detail?.thread.id]);

  useEffect(() => {
    const node = transcript.current;
    if (node && following) node.scrollTop = node.scrollHeight;
  }, [following, streamed?.text, detail?.thread.id, detail?.messages.length, detail?.messages.at(-1)?.content, activity?.kind]);

  function trackScroll() {
    const node = transcript.current;
    if (node) setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 56);
  }

  function toLatest() {
    const node = transcript.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    setFollowing(true);
  }

  async function newChat() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try {
      const thread = await api<AIThread>('', { action: 'create' });
      setDetail({ thread, messages: [], hasOlder: false }); setStreamed(null); setToolTrail([]); setFollowing(true); setText('');
      await refreshList();
      inputRef.current?.focus();
    } catch { setError('ai_generation_failed'); }
    finally { pending.current = false; setLoading(false); }
  }

  async function send() {
    if (pending.current || !text.trim() || !provider?.configured || runningMessage) return;
    pending.current = true; activityCounts.current.clear(); setBusy(true); setPhase('sending'); setActivity(null); setToolTrail([]); setError(''); setStreamed(null); setFollowing(true);
    const submitted = text.trim();
    let thread = detail?.thread;
    const controller = new AbortController();
    const current = { controller, threadId: thread?.id ?? '', runId: undefined as string | undefined };
    active.current = current;
    try {
      if (!thread) thread = await api<AIThread>('', { action: 'create' });
      controller.signal.throwIfAborted();
      current.threadId = thread.id;
      setText('');
      const optimistic: AIChatMessage = { id: crypto.randomUUID(), thread_id: thread.id, ordinal: (detail?.messages.at(-1)?.ordinal ?? 0) + 1, role: 'user', content: submitted, created_at: new Date().toISOString(), run_id: null, status: null, error_code: null, model: null, sources: [], activities: [], actionDrafts: [], actionUpdates: [], actionDisambiguations: [], toolRunProposals: [] };
      setDetail(previous => ({ thread: thread!, messages: [...(previous?.messages ?? []), optimistic], hasOlder: previous?.hasOlder ?? false }));
      await consumeAIChat({ threadId: thread.id, expectedRevision: thread.revision, requestId: crypto.randomUUID(), text: submitted, context: context.target, signal: controller.signal,
        onRun: runId => { current.runId = runId; if (mounted.current) setPhase(previous => previous === 'stopping' ? previous : 'waiting'); },
        onText: (id, content) => { if (mounted.current) { setStreamed({ id, text: content }); if (content) setPhase(previous => previous === 'stopping' || previous === 'tool' ? previous : 'streaming'); } },
        onActivity: event => {
          if (!mounted.current) return;
          setToolTrail(previous => {
            if (event.state === 'started') return [...previous, event];
            const next = [...previous];
            let matched = false;
            for (let index = next.length - 1; index >= 0; index--) {
              if (next[index].kind === event.kind && next[index].state === 'started') { next[index] = event; matched = true; break; }
            }
            if (!matched) next.push(event);
            return next;
          });
          const count = activityCounts.current.get(event.kind) ?? 0;
          activityCounts.current.set(event.kind, Math.max(0, count + (event.state === 'started' ? 1 : -1)));
          const activeKind = [...activityCounts.current].find(([, value]) => value > 0)?.[0];
          setActivity(activeKind ? { kind: activeKind, state: 'started' } : null);
          setPhase(previous => previous === 'stopping' ? previous : activeKind ? 'tool' : 'waiting');
        },
        onError: code => { if (mounted.current) setError(code); },
      });
    } catch (failure) {
      if (mounted.current) {
        setError(active.current?.controller.signal.aborted ? 'ai_cancelled' : failure instanceof Error ? failure.message : 'ai_generation_failed');
        if (!active.current?.runId) setText(previous => previous || submitted);
      }
    } finally {
      active.current = null;
      if (mounted.current && thread) {
        try { setDetail(await api<AIThreadDetail>(`?threadId=${thread.id}`)); setStreamed(null); setToolTrail([]); await refreshList(); }
        catch { setError('ai_generation_failed'); }
      }
      pending.current = false;
      if (mounted.current) { setBusy(false); setPhase('idle'); setActivity(null); activityCounts.current.clear(); inputRef.current?.focus(); }
    }
  }

  async function stop() {
    if (phase === 'stopping') return;
    setPhase('stopping');
    const current = active.current;
    const runId = current?.runId ?? runningMessage?.run_id;
    const threadId = current?.threadId ?? detail?.thread.id;
    try {
      if (runId && threadId) await api('', { action: 'stop', threadId, runId });
      else current?.controller.abort();
    } catch { current?.controller.abort(); setError('ai_generation_failed'); setPhase('idle'); }
  }

  async function loadOlder() {
    if (!detail) return; setLoading(true);
    try {
      const older = await api<AIThreadDetail>(`?threadId=${detail.thread.id}&before=${detail.messages[0].ordinal}`);
      setDetail({ ...older, messages: [...older.messages, ...detail.messages] });
    } catch { setError('ai_generation_failed'); }
    finally { setLoading(false); }
  }

  async function updateDraft(messageId: string, draft: AIActionDraftArtifact, action: 'confirm_action_draft' | 'reject_action_draft') {
    if (!detail || draftPending.current) return;
    draftPending.current = true;
    setDraftBusy({ id: draft.actionId, action: action === 'confirm_action_draft' ? 'confirm' : 'reject' });
    setDraftErrors(previous => ({ ...previous, [draft.actionId]: '' }));
    try {
      const result = await api<{ revision: number; lifecycle: 'confirmed' | 'rejected' }>('', { action, threadId: detail.thread.id, messageId, actionId: draft.actionId, expectedRevision: draft.revision });
      setDetail(previous => previous && ({ ...previous, messages: previous.messages.map(message => ({ ...message, actionDrafts: message.actionDrafts.map(item => item.actionId === draft.actionId ? { ...item, revision: result.revision, lifecycle: result.lifecycle, actionStatus: result.lifecycle === 'confirmed' ? 'active' : 'draft' } : item) })) }));
      const refreshed = await api<AIThreadDetail>(`?threadId=${detail.thread.id}`);
      if (mounted.current) setDetail(refreshed);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : 'ai_generation_failed';
      setDraftErrors(previous => ({ ...previous, [draft.actionId]: code }));
    } finally { draftPending.current = false; setDraftBusy(null); }
  }

  async function refreshDrafts(threadId: string, actionId: string) {
    if (draftPending.current) return;
    draftPending.current = true; setDraftBusy({ id: actionId, action: 'refresh' });
    try {
      const refreshed = await api<AIThreadDetail>(`?threadId=${threadId}`);
      setDetail(refreshed);
      setDraftErrors(previous => ({ ...previous, [actionId]: '' }));
    } catch { setDraftErrors(previous => ({ ...previous, [actionId]: 'ai_generation_failed' })); }
    finally { draftPending.current = false; setDraftBusy(null); }
  }

  async function updateActionProposal(messageId: string, proposal: AIActionUpdateArtifact, action: 'apply_action_update' | 'reject_action_update') {
    if (!detail || updatePending.current) return;
    updatePending.current = true;
    setUpdateBusy({ id: proposal.id, action: action === 'apply_action_update' ? 'apply' : 'reject' });
    setUpdateErrors(previous => ({ ...previous, [proposal.id]: '' }));
    try {
      const result = await api<{ lifecycle: 'applied' | 'rejected'; revision?: number }>('', { action, threadId: detail.thread.id, messageId, proposalId: proposal.id });
      setDetail(previous => previous && ({ ...previous, messages: previous.messages.map(message => ({ ...message, actionUpdates: message.actionUpdates.map(item => item.id === proposal.id ? { ...item, lifecycle: result.lifecycle, appliedRevision: result.revision ?? null } : item) })) }));
      const refreshed = await api<AIThreadDetail>(`?threadId=${detail.thread.id}`);
      if (mounted.current) setDetail(refreshed);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : 'ai_generation_failed';
      setUpdateErrors(previous => ({ ...previous, [proposal.id]: code }));
      if (code === 'ai_action_update_stale') {
        setDetail(previous => previous && ({ ...previous, messages: previous.messages.map(message => ({ ...message, actionUpdates: message.actionUpdates.map(item => item.id === proposal.id ? { ...item, lifecycle: 'stale' } : item) })) }));
      }
    } finally { updatePending.current = false; setUpdateBusy(null); }
  }

  async function refreshUpdate(threadId: string, proposalId: string) {
    if (updatePending.current) return;
    updatePending.current = true; setUpdateBusy({ id: proposalId, action: 'refresh' });
    try {
      setDetail(await api<AIThreadDetail>(`?threadId=${threadId}`));
      setUpdateErrors(previous => ({ ...previous, [proposalId]: '' }));
    } catch { setUpdateErrors(previous => ({ ...previous, [proposalId]: 'ai_generation_failed' })); }
    finally { updatePending.current = false; setUpdateBusy(null); }
  }

  async function updateToolRunProposal(messageId: string, proposal: AIToolRunProposalArtifact, action: 'confirm_tool_run_proposal' | 'reject_tool_run_proposal') {
    if (!detail || toolRunBusy) return;
    const threadId = detail.thread.id;
    setToolRunBusy(proposal.id);
    setToolRunErrors(previous => ({ ...previous, [proposal.id]: '' }));
    try {
      await api('', { action, threadId, messageId, proposalId: proposal.id });
      if (mounted.current) setDetail(await api<AIThreadDetail>(`?threadId=${threadId}`));
    } catch (failure) {
      setToolRunErrors(previous => ({ ...previous, [proposal.id]: failure instanceof Error ? failure.message : 'ai_generation_failed' }));
      try { if (mounted.current) setDetail(await api<AIThreadDetail>(`?threadId=${threadId}`)); } catch {}
    } finally { setToolRunBusy(null); }
  }

  async function chooseActionTarget(messageId: string, outcome: AIActionDisambiguationArtifact, candidate: AIActionDisambiguationArtifact['candidates'][number]) {
    if (!detail || targetPending.current) return;
    targetPending.current = true; setTargetBusy(outcome.id); setTargetErrors(previous => ({ ...previous, [outcome.id]: '' }));
    try {
      await api('', { action: 'choose_action_target', threadId: detail.thread.id, messageId, disambiguationId: outcome.id,
        actionId: candidate.actionId, expectedRevision: candidate.revision });
      const refreshed = await api<AIThreadDetail>(`?threadId=${detail.thread.id}`);
      if (mounted.current) setDetail(refreshed);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : 'ai_generation_failed';
      setTargetErrors(previous => ({ ...previous, [outcome.id]: code }));
      if (code === 'ai_action_update_stale' && detail) {
        try { setDetail(await api<AIThreadDetail>(`?threadId=${detail.thread.id}`)); } catch { /* Keep the stale warning. */ }
      }
    } finally { targetPending.current = false; setTargetBusy(null); }
  }

  const running = busy || Boolean(runningMessage);
  const failedDraftInCurrentRun = toolTrail.some(item => item.kind === 'draft' && item.state === 'failed')
    && !toolTrail.some(item => item.kind === 'draft' && item.state === 'succeeded');
  const lastAssistant = detail?.messages.filter(message => message.role === 'assistant').at(-1);
  const statusText = phase === 'stopping' ? '正在停止，已产生的内容会保留'
    : phase === 'sending' ? '正在发送…'
    : phase === 'tool' && activity?.state === 'started' ? activityLabel[activity.kind]
    : phase === 'streaming' ? '正在回复…'
    : running ? '正在思考…'
    : loading ? '正在读取会话…'
    : lastAssistant?.status === 'completed' ? '回复已完成'
    : lastAssistant?.status === 'cancelled' ? '已停止，内容已保留'
    : lastAssistant?.status === 'failed' ? '回复中断，已保留现有内容'
    : '会话保存在本机';
  const suggestions = context.target.kind === 'project' ? ['总结这个专案', '找出这个专案的行动项', '为这个专案创建一个任务']
    : context.target.kind === 'content' ? ['总结这份资料', '这份资料有哪些行动项？', '根据这份资料创建一个任务']
      : context.target.kind === 'actions' ? ['查看待办行动', '总结当前行动', '创建一个任务']
        : ['总结最近的资料', '查找待办行动', '创建一个任务'];

  return <>
    <button className="ask-eremite-trigger ui-button ui-button--secondary" type="button" onClick={() => setOpen(true)} aria-label="打开 Ask Eremite"><MessageCircle size={18} />Ask Eremite</button>
    <Dialog open={open} onClose={closeAsk} title="Ask Eremite" description="可以读取资料并提出待确认的任务或文件操作；只有你确认后才会执行。" className="ask-eremite-panel">
      <div className="ask-toolbar">
        <Select label="历史会话" placeholder="历史会话" value={detail?.thread.id ?? ''} disabled={busy || loading} options={threads.map(thread => ({ value: thread.id, label: thread.title }))} onValueChange={id => void loadThread(id)} />
        <Button onClick={() => void newChat()} disabled={busy || loading}><Plus size={16} />新对话</Button>
      </div>
      {historyMore && <Button size="small" onClick={() => void refreshList(threads.length).catch(() => setError('ai_generation_failed'))} disabled={busy || loading}>更多历史</Button>}
      <div className="ask-context"><span key={context.label} className="ask-context__scope">基于{context.label}</span><span className="ask-context__model">{provider ? provider.configured ? provider.model : 'Provider 未配置' : '正在读取模型状态…'}</span></div>
      {provider && !provider.configured && <p className="ask-notice">AI Provider 尚未配置或需要重新输入 API Key。请前往设置 → AI。历史会话仍可查看。</p>}
      <div className="ask-transcript"><div ref={transcript} className="ask-messages" aria-label="对话消息" tabIndex={0} onScroll={trackScroll}>
        {detail?.hasOlder && <Button disabled={loading || busy} onClick={() => void loadOlder()}>加载更早的消息</Button>}
        {!detail?.messages.length && !busy && <div className="ask-empty"><MessageCircle size={28} /><h3>从{context.label}开始</h3><p>可以先问一个问题，或试试下面的提议。</p><div className="ask-suggestions">{suggestions.map(suggestion => <button type="button" key={suggestion} onClick={() => { setText(suggestion); inputRef.current?.focus(); }}>{suggestion}</button>)}</div></div>}
        {detail?.messages.map(message => <article className={`ask-message ask-message--${message.role}`} key={message.id}>
          <strong>{message.role === 'user' ? '你' : 'Ask Eremite'}</strong>
          <div className="ask-message-text"><AskMessageContent role={message.role} content={message.toolRunProposals.length > 0 ? message.toolRunProposals.some(item => item.lifecycle === 'pending')
            ? '我准备了以下文件操作提案。只有你确认后，Host 才会执行。'
            : '这次文件操作的实际状态如下，以正式运行记录为准。' : message.actionUpdates.length > 0
            ? message.actionUpdates.some(item => item.lifecycle === 'pending' || item.lifecycle === 'applying')
              ? '我准备了以下修改建议。只有你点击应用后，任务才会改变。'
              : '这次修改建议的实际状态如下。'
            : message.actionDisambiguations.length > 0 ? '请选择要修改的任务。选择后会准备修改提案，任务不会立即改变。'
            : message.actionDrafts.length > 0 ? `已创建 ${message.actionDrafts.length} 个待确认的行动草稿。只有你点击创建任务后才会成为正式任务。`
            : message.role === 'assistant' && (message.error_code === 'ai_tool_call_invalid' || message.run_id === active.current?.runId && failedDraftInCurrentRun)
              ? '行动草稿未创建。请检查目标是否已读取，再重新尝试。'
            : streamed?.id === message.id && streamed.text.length >= message.content.length ? streamed.text || statusText : message.content || (message.status === 'running' ? statusText : '未生成回答')} /></div>
          {message.error_code && <small>{aiChatErrorMessage(message.error_code)}</small>}
          {message.activities.length > 0 && <ActivityTrail activities={message.activities} />}
          {message.sources.length > 0 && <details className="ask-sources"><summary>参考来源 · {message.sources.length}</summary><div>{message.sources.map(source => <Link href={source.href} onClick={closeAsk} key={`${source.module}:${source.entity}:${source.id}:${source.revision ?? ''}`}>{source.label}</Link>)}</div></details>}
          {message.actionDrafts.length > 0 && <div className="ask-draft-artifacts"><span>已创建的行动草稿</span>{message.actionDrafts.map(draft => <ActionDraftCard key={draft.actionId} draft={draft} busy={draftBusy?.id === draft.actionId ? draftBusy.action : null} error={draftErrors[draft.actionId]} onRefresh={() => void refreshDrafts(message.thread_id, draft.actionId)} onConfirm={() => void updateDraft(message.id, draft, 'confirm_action_draft')} onReject={() => void updateDraft(message.id, draft, 'reject_action_draft')} />)}</div>}
          {message.actionDisambiguations.length > 0 && <div className="ask-draft-artifacts">{message.actionDisambiguations.map(outcome => <ActionDisambiguationCard key={outcome.id} outcome={outcome} busy={targetBusy === outcome.id} error={targetErrors[outcome.id]} onChoose={candidate => void chooseActionTarget(message.id, outcome, candidate)} />)}</div>}
          {message.actionUpdates.length > 0 && <div className="ask-draft-artifacts"><span>建议修改任务</span>{message.actionUpdates.map(proposal => <ActionUpdateCard key={proposal.id} proposal={proposal} busy={updateBusy?.id === proposal.id ? updateBusy.action : null} error={updateErrors[proposal.id]} onRefresh={() => void refreshUpdate(message.thread_id, proposal.id)} onApply={() => void updateActionProposal(message.id, proposal, 'apply_action_update')} onReject={() => void updateActionProposal(message.id, proposal, 'reject_action_update')} />)}</div>}
          {message.toolRunProposals.length > 0 && <div className="ask-draft-artifacts"><span>文件操作提案</span>{message.toolRunProposals.map(proposal => <ToolRunProposalCard key={proposal.id} proposal={proposal} busy={toolRunBusy === proposal.id} error={toolRunErrors[proposal.id]} onConfirm={() => void updateToolRunProposal(message.id, proposal, 'confirm_tool_run_proposal')} onReject={() => void updateToolRunProposal(message.id, proposal, 'reject_tool_run_proposal')} />)}</div>}
        </article>)}
        {streamed && !detail?.messages.some(message => message.id === streamed.id) && <article className="ask-message ask-message--assistant"><strong>Ask Eremite</strong><div className="ask-message-text"><AskMessageContent role="assistant" content={failedDraftInCurrentRun ? '行动草稿未创建。请检查目标是否已读取，再重新尝试。' : streamed.text || statusText} /></div></article>}
        {running && !streamed && !runningMessage && <article className="ask-message ask-message--assistant ask-message--waiting"><strong>Ask Eremite</strong><div className="ask-message-text">{statusText}</div></article>}
      </div>{!following && <button type="button" className="ask-to-latest" onClick={toLatest}><ArrowDown size={15} />回到最新</button>}</div>
      {running && toolTrail.length > 0 && !detail?.messages.some(message => message.run_id === active.current?.runId && message.activities.length > 0) && <ActivityTrail activities={toolTrail} live />}
      <div className={`ask-status${running ? ' ask-status--running' : ''}`} role="status" aria-live="polite"><span className="ask-status__mark" aria-hidden="true" />{statusText}</div>
      {error && <p className="ask-error" role="alert">{aiChatErrorMessage(error)}</p>}
      <form className="ask-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="ask-message">向 Ask Eremite 提问</label>
        <textarea ref={inputRef} data-overlay-initial-focus id="ask-message" placeholder={running ? '可以先写下一条消息…' : '输入问题…'} value={text} maxLength={8000} onChange={event => setText(event.target.value)} rows={3} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!loading && !running) void send(); } }} />
        <div className="ask-compose-actions"><small>{running ? '完成当前回复后即可发送下一条' : 'Enter 发送 · Shift + Enter 换行'}</small><div className="ask-compose__primary">{running ? <Button type="button" onClick={() => void stop()} disabled={phase === 'stopping'}><Square size={16} />{phase === 'stopping' ? '正在停止…' : '停止'}</Button> : <Button type="submit" variant="primary" disabled={loading || !provider?.configured || !text.trim()}><Send size={16} />发送</Button>}</div></div>
      </form>
    </Dialog>
  </>;
}

const activityLabel: Record<AIActivity['kind'], string> = { search: '正在搜索资料…', content: '正在读取资料…', project: '正在读取专案…', actions: '正在查看行动…', draft: '正在创建行动草稿…', update: '正在准备修改提案…', 'tool-run': '正在准备文件操作提案…' };
const activitySuccessLabel: Record<AIActivity['kind'], string> = { search: '已搜索资料', content: '已读取资料', project: '已读取专案', actions: '已查看行动', draft: '已创建待确认行动草稿', update: '已准备修改提案', 'tool-run': '已准备待确认文件操作' };
function ActivityTrail({ activities, live = false }: { activities: readonly AIActivity[]; live?: boolean }) {
  return <details className="ask-activity" open><summary>{live ? '本次处理过程' : '处理过程'} · {activities.length} 项</summary><div>{activities.map((item, index) => <span key={`${item.kind}-${index}`} className={item.state === 'started' ? 'ask-activity__active' : item.state === 'failed' ? 'ask-activity__failed' : ''}>{item.state === 'started' ? activityLabel[item.kind] : item.state === 'needs_input' ? '请选择要修改的任务' : item.state === 'failed' ? activityFailureLabel(item) : activitySuccessLabel[item.kind]}</span>)}</div></details>;
}
function activityFailureLabel(activity: AIActivity) {
  if (activity.code === 'ai_tool_run_unobserved_source') return '请先读取当前文件后再提出操作';
  if (activity.code === 'ai_tool_run_source_unavailable') return '当前来源文件不可用';
  if (activity.code === 'ai_tool_run_unsupported_capability') return '当前文件不支持这个操作';
  if (activity.code === 'ai_tool_run_invalid_parameters') return '操作参数无效';
  if (activity.code === 'ai_tool_run_unavailable') return '文件工具当前不可用';
  if (activity.code === 'ai_tool_invalid_arguments') return '工具参数无效，未执行';
  if (activity.code === 'ai_tool_ambiguous_target') return '存在多个可能的行动，请明确选择目标';
  if (activity.kind === 'draft') return activity.code === 'ai_tool_unobserved_content' || activity.code === 'ai_tool_unobserved_project'
    ? '目标尚未经过读取验证，未创建行动草稿' : '未能创建行动草稿';
  if (activity.kind === 'update') return '未能准备修改提案';
  if (activity.kind === 'tool-run') return '未能准备文件操作提案';
  return '读取未完成';
}
const lifecycleLabel = { pending: '等待你创建', confirmed: '任务已创建', rejected: '已放弃', unavailable: '状态不可用' } as const;
function ToolRunProposalCard({ proposal, busy, error, onConfirm, onReject }: { proposal: AIToolRunProposalArtifact; busy: boolean; error?: string; onConfirm(): void; onReject(): void }) {
  const status = proposal.lifecycle === 'pending' ? busy ? '正在处理确认…' : '等待确认'
    : proposal.lifecycle === 'rejected' ? '已取消' : proposal.lifecycle === 'stale' ? '来源已变化'
      : !proposal.run ? '运行记录已移除' : proposal.run.status === 'completed' ? '已完成' : proposal.run.status === 'failed' ? '执行失败' : '正在执行…';
  return <section className={`ask-draft-card ask-update-card ask-tool-run-card ask-draft-card--${proposal.lifecycle}`} aria-label={`文件操作提案：${proposal.toolName}`}>
    <div className="ask-draft-card__header"><strong>{proposal.toolName}</strong><span role="status" aria-live="polite">{status}</span></div>
    <dl className="run-facts"><div><dt>操作</dt><dd>{proposal.operationLabel}</dd></div><div><dt>参数</dt><dd>{proposal.parametersLabel}</dd></div><div><dt>输出位置</dt><dd>{proposal.destinationLabel}</dd></div></dl>
    <div><strong>来源文件{proposal.sources.length > 1 ? '（按此顺序）' : ''}</strong><ol>{proposal.sources.map(source => <li key={source.contentId}>{source.originalName}</li>)}</ol></div>
    <p>原文件不会修改；确认后将创建新的正式文件。</p>
    {error && <p className="ask-draft-error" role="alert">{aiChatErrorMessage(error)}</p>}
    {proposal.run?.status === 'failed' && <p className="ask-draft-error" role="alert">{proposal.run.errorMessage ?? '文件操作未能完成。'}</p>}
    {proposal.lifecycle === 'pending' && <div className="ask-draft-card__actions"><Button size="small" onClick={onReject} disabled={busy}><X size={14} />取消</Button><Button size="small" variant="primary" onClick={onConfirm} disabled={busy}><Check size={14} />{busy ? '正在处理…' : '确认执行'}</Button></div>}
    {proposal.run?.status === 'completed' && <div className="ask-draft-card__actions">{proposal.run.outputs.map(output => <span key={output.contentId}>{output.previewable && <Link className="ui-button ui-button--secondary" href={`/viewer/${encodeURIComponent(output.contentId)}`}>查看 {output.originalName}</Link>}<Link className="ui-button ui-button--secondary" href={`/inbox?selected=${encodeURIComponent(output.contentId)}`}>在资料库中显示</Link></span>)}<Link className="ui-button ui-button--secondary" href={`/automations?view=runs&selected=${encodeURIComponent(proposal.run.id)}`}>查看运行记录</Link></div>}
    {proposal.run?.status === 'failed' && <div className="ask-draft-card__actions"><Link className="ui-button ui-button--secondary" href={`/automations?view=runs&selected=${encodeURIComponent(proposal.run.id)}`}>查看运行记录</Link></div>}
  </section>;
}
const priorityLabel = { low: '低', normal: '普通', high: '高' } as const;

function ActionDraftCard({ draft, busy, error, onRefresh, onConfirm, onReject }: { draft: AIActionDraftArtifact; busy: 'confirm' | 'reject' | 'refresh' | null; error?: string; onRefresh(): void; onConfirm(): void; onReject(): void }) {
  const stale = error === 'action_revision_conflict' || error === 'ai_action_draft_not_pending';
  const state = busy === 'confirm' ? '正在创建任务…' : busy === 'reject' ? '正在放弃…' : busy === 'refresh' ? '正在刷新状态…' : stale ? '状态已变化' : lifecycleLabel[draft.lifecycle];
  return <section className={`ask-draft-card ask-draft-card--${stale ? 'stale' : draft.lifecycle}${busy ? ' ask-draft-card--busy' : ''}`} aria-label={`行动草稿：${draft.title}`}>
    <div className="ask-draft-card__header"><strong>{draft.title}</strong><span role="status">{state}</span></div>
    <dl aria-busy={Boolean(busy)}>
      <div><dt><Flag size={13} />优先级</dt><dd>{priorityLabel[draft.priority]}</dd></div>
      <div><dt><CalendarDays size={13} />截止日期</dt><dd>{draft.dueDate ?? '未设置'}</dd></div>
      <div><dt>专案</dt><dd>{draft.project?.name ?? '未归入专案'}</dd></div>
      <div><dt><Link2 size={13} />关联资料</dt><dd>{draft.linkedContent.length ? draft.linkedContent.map(item => item.title).join('、') : '无'}</dd></div>
    </dl>
    {error && <p className="ask-draft-error" role="alert">{aiChatErrorMessage(error)}</p>}
    {(stale || draft.lifecycle === 'unavailable' || (error && !busy)) && <div className="ask-draft-card__actions"><Button size="small" onClick={onRefresh} disabled={Boolean(busy)}><RotateCw size={14} />刷新状态</Button></div>}
    {draft.lifecycle === 'pending' && !stale && <div className="ask-draft-card__actions">
      <Button size="small" onClick={onReject} disabled={Boolean(busy)}><X size={14} />{busy === 'reject' ? '正在放弃…' : '放弃'}</Button>
      <Button size="small" variant="primary" onClick={onConfirm} disabled={Boolean(busy)}><Check size={14} />{busy === 'confirm' ? '正在创建…' : '创建任务'}</Button>
    </div>}
    {draft.lifecycle === 'confirmed' && <div className="ask-draft-card__actions"><Link className="ui-button ui-button--secondary" href={`/actions?selected=${encodeURIComponent(draft.actionId)}`}>查看任务</Link></div>}
  </section>;
}

function ActionDisambiguationCard({ outcome, busy, error, onChoose }: {
  outcome: AIActionDisambiguationArtifact; busy: boolean; error?: string;
  onChoose(candidate: AIActionDisambiguationArtifact['candidates'][number]): void;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const candidates = outcome.candidates;
  const showProject = new Set(candidates.map(item => item.projectName)).size > 1;
  const showDueDate = new Set(candidates.map(item => item.dueDate)).size > 1;
  const showPriority = new Set(candidates.map(item => item.priority)).size > 1;
  const showCreatedAt = !showProject && !showDueDate && !showPriority && new Set(candidates.map(item => item.createdAt.slice(0, 10))).size > 1;
  const distinguishingLabel = (item: typeof candidates[number]) => [item.title, showProject ? item.projectName : '', showDueDate ? item.dueDate : '',
    showPriority ? item.priority : '', showCreatedAt ? item.createdAt.slice(0, 10) : ''].join('|');
  const labelCounts = new Map<string, number>();
  for (const item of candidates) labelCounts.set(distinguishingLabel(item), (labelCounts.get(distinguishingLabel(item)) ?? 0) + 1);
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase();
  const filtered = candidates.filter(item => !normalizedQuery || [item.title, item.projectName ?? '', item.dueDate ?? '', priorityLabel[item.priority], item.actionId.slice(-8)]
    .some(value => value.normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery)));
  const selected = filtered.slice(0, visibleCount).find(item => item.actionId === selectedId);
  if (outcome.lifecycle === 'resolved') return <section className="ask-disambiguation-card" aria-label="已选择目标行动"><strong>已选择目标行动</strong><p>修改提案已准备好。任务只会在你点击“应用修改”后改变。</p></section>;
  if (outcome.lifecycle === 'stale') return <section className="ask-disambiguation-card" aria-label="候选行动已变化"><strong>候选行动已变化</strong><p role="alert">所选行动的状态或版本已变化，不能继续旧选择。请重新发起请求。</p></section>;
  return <section className="ask-disambiguation-card" aria-label="请选择要修改的任务">
    <strong>请选择要修改的任务</strong>
    <p>找到 {candidates.length} 个可能的目标。选择后只会创建待应用的修改提案。</p>
    {candidates.length > 8 && <label className="ask-disambiguation-search">筛选候选<input type="search" value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(30); }} placeholder="按标题、专案或日期筛选" /></label>}
    <fieldset className="ask-disambiguation-list"><legend>候选行动</legend>
      {filtered.slice(0, visibleCount).map(item => <label key={item.actionId} className="ask-disambiguation-option">
        <input type="radio" name={`action-target-${outcome.id}`} checked={selectedId === item.actionId} onChange={() => setSelectedId(item.actionId)} disabled={busy} />
        <span><strong>{item.title}</strong><small>
          {showProject && <span>专案：{item.projectName ?? '未归入专案'}　</span>}
          {showDueDate && <span>截止日期：{item.dueDate ?? '无'}　</span>}
          {showPriority && <span>优先级：{priorityLabel[item.priority]}　</span>}
          {showCreatedAt && <span>创建于：{item.createdAt.slice(0, 10)}　</span>}
          {(labelCounts.get(distinguishingLabel(item)) ?? 0) > 1 && <span>编号：{item.actionId.slice(-8)}</span>}
        </small></span>
      </label>)}
      {filtered.length === 0 && <p>没有匹配的候选。</p>}
    </fieldset>
    {filtered.length > visibleCount && <Button size="small" onClick={() => setVisibleCount(count => count + 30)}>显示更多候选 · 还有 {filtered.length - visibleCount} 项</Button>}
    {error && <p className="ask-draft-error" role="alert">{aiChatErrorMessage(error)}</p>}
    <div className="ask-draft-card__actions"><Button size="small" variant="primary" onClick={() => selected && onChoose(selected)} disabled={!selected || busy}>{busy ? '正在核对…' : '为选中任务准备修改提案'}</Button></div>
  </section>;
}

const updateLifecycleLabel = { pending: '等待你应用', applying: '正在应用…', applied: '✓ 已更新任务', rejected: '已放弃修改', stale: '任务已变化', unavailable: '任务不可用', error: '应用失败' } as const;

function ActionUpdateCard({ proposal, busy, error, onRefresh, onApply, onReject }: { proposal: AIActionUpdateArtifact; busy: 'apply' | 'reject' | 'refresh' | null; error?: string; onRefresh(): void; onApply(): void; onReject(): void }) {
  const { before, patch } = proposal;
  const rows = [
    patch.title !== undefined && { label: '标题', before: before.title, after: patch.title },
    patch.priority !== undefined && { label: '优先级', before: priorityLabel[before.priority], after: priorityLabel[patch.priority] },
    patch.dueDate !== undefined && { label: '截止日期', before: before.dueDate ?? '无', after: patch.dueDate ?? '无' },
    patch.transition !== undefined && { label: '状态', before: '进行中', after: patch.transition === 'done' ? '已完成' : '已取消' },
  ].filter((row): row is { label: string; before: string; after: string } => Boolean(row));
  const label = patch.transition === 'done' ? '标记完成' : patch.transition === 'cancelled' ? '取消任务' : '应用修改';
  const state = busy === 'apply' ? '正在应用…' : busy === 'reject' ? '正在放弃…' : busy === 'refresh' ? '正在刷新…' : updateLifecycleLabel[proposal.lifecycle];
  const canApply = proposal.lifecycle === 'pending' && !error;
  return <section className={`ask-draft-card ask-update-card ask-draft-card--${proposal.lifecycle}${busy ? ' ask-draft-card--busy' : ''}`} aria-label={`任务修改提案：${before.title}`}>
    <div className="ask-draft-card__header"><strong>{before.title}</strong><span role="status">{state}</span></div>
    <dl aria-busy={Boolean(busy)}>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd><span>{row.before}</span><span aria-hidden="true"> → </span><strong>{row.after}</strong></dd></div>)}</dl>
    {proposal.lifecycle === 'pending' && <p className="ask-update-card__notice">你应用后才会生效。</p>}
    {proposal.lifecycle === 'stale' && <p className="ask-draft-error">任务已经发生变化，请刷新后重新确认。</p>}
    {error && !(proposal.lifecycle === 'stale' && error === 'ai_action_update_stale') && <p className="ask-draft-error" role="alert">{aiChatErrorMessage(error)}</p>}
    {canApply && <div className="ask-draft-card__actions"><Button size="small" onClick={onReject} disabled={Boolean(busy)}><X size={14} />放弃</Button><Button size="small" variant="primary" onClick={onApply} disabled={Boolean(busy)}><Check size={14} />{busy === 'apply' ? '正在应用…' : label}</Button></div>}
    {(proposal.lifecycle === 'stale' || proposal.lifecycle === 'unavailable' || proposal.lifecycle === 'error' || error) && <div className="ask-draft-card__actions"><Button size="small" onClick={onRefresh} disabled={Boolean(busy)}><RotateCw size={14} />刷新状态</Button></div>}
    {proposal.lifecycle === 'applied' && <div className="ask-draft-card__actions"><Link className="ui-button ui-button--secondary" href={`/actions?selected=${encodeURIComponent(proposal.actionId)}`}>查看任务</Link></div>}
  </section>;
}
