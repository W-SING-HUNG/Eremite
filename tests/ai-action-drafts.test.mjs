import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const directory = await mkdtemp(path.join(tmpdir(), 'eremite-ai-action-drafts-'));
process.env.EREMITE_DATA_DIR = directory;
let database;

try {
  const projects = await import('@/modules/projects/service');
  const inbox = await import('@/modules/inbox/service');
  const actions = await import('@/modules/actions/service');
  const store = await import('@/modules/ai/chat-store');
  const drafts = await import('@/app/_services/ask-eremite-action-drafts');
  const { createAskEremiteHost } = await import('@/app/_services/ask-eremite-host');
  const { actionViewGroups } = await import('@/app/_lib/action-views');
  database = await import('@/platform/db/database');

  const projectId = projects.createProject({ name: 'Phase 2 Project' });
  const contentId = inbox.createLinkContentItem({ title: 'Phase 2 Content', url: 'https://example.com/phase-2', projectId });
  const trashedContentId = inbox.createLinkContentItem({ title: 'Trashed Content', url: 'https://example.com/trashed' });
  inbox.trashContentItem(trashedContentId, 1);

  const begin = (text = 'create draft') => {
    const thread = store.createAIThread();
    const identity = store.beginAIRun({ threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text, model: 'test-model', deadlineAt: new Date(Date.now() + 60_000).toISOString() });
    return { thread, identity };
  };
  const context = (identity, currentContext, observedSources = []) => ({
    identity: { threadId: identity.threadId, runId: identity.runId, messageId: identity.assistantId },
    currentContext,
    observedSources,
    abortSignal: new AbortController().signal,
  });
  const contentSource = (id = contentId) => ({ module: 'inbox', entity: 'content', id, revision: 1, label: 'Content', href: `/inbox?selected=${id}` });
  const projectSource = (id = projectId) => ({ module: 'projects', entity: 'project', id, revision: 1, label: 'Project', href: `/projects/${id}` });

  assert.equal(drafts.createActionDraftInputSchema.safeParse({ title: 'x', priority: 'high', status: 'active' }).success, false, 'status is not model-controlled');
  assert.equal(drafts.createActionDraftInputSchema.safeParse({ title: 'x', priority: 'high', completedAt: 'now' }).success, false);
  assert.equal(drafts.createActionDraftInputSchema.safeParse({ title: ' '.repeat(3), priority: 'normal' }).success, false);
  const modelSchema = z.toJSONSchema(drafts.createActionDraftInputSchema);
  assert.deepEqual(modelSchema.required, ['title', 'priority']);
  assert.equal(modelSchema.additionalProperties, false);
  assert.equal(modelSchema.properties.title.pattern, '^[\\s\\S]*\\S[\\s\\S]*$');
  for (const title of ['v', '整理 v1.5 发布检查清单', '  ', '\n', '\t', 'a\nb', 'a'.repeat(240), 'a'.repeat(241)]) {
    assert.equal(drafts.createActionDraftInputSchema.safeParse({ title, priority: 'high' }).success,
      title.length >= 1 && title.length <= 240 && /\S/u.test(title), 'anchored model pattern keeps the original Host validator semantics');
  }
  assert.match(modelSchema.properties.projectId.description, /Omit for a current Content/u);
  assert.match(modelSchema.properties.contentItemIds.description, /Host links it automatically/u);

  const firstRun = begin('把这份资料变成高优先级任务');
  const firstDraft = drafts.createAskEremiteActionDraft({ title: '  高优先级任务  ', priority: 'high', dueDate: '2026-09-25' }, context(firstRun.identity, { kind: 'content', id: contentId }, [contentSource()]));
  assert.equal(firstDraft.status, 'draft');
  assert.equal(firstDraft.title, '高优先级任务');
  assert.equal(firstDraft.projectId, projectId, 'Actions infers the available Content project');
  assert.deepEqual(firstDraft.contentItemIds, [contentId]);
  assert.equal(actions.getAction(firstDraft.actionId).status, 'draft');
  assert.equal(actions.actionHasContentItem(firstDraft.actionId, contentId), true);
  assert.equal(inbox.getContentItemSummary(contentId).status, 'inbox', 'AI Draft never processes Content');
  store.finishAIRun({ runId: firstRun.identity.runId, status: 'completed', content: '已生成待确认的行动草稿。' });

  let detail = drafts.getAskEremiteThread(firstRun.thread.id);
  assert.equal(detail.messages[1].actionDrafts.length, 1);
  assert.equal(detail.messages[1].actionDrafts[0].lifecycle, 'pending');
  assert.equal(detail.messages[1].actionDrafts[0].project.name, 'Phase 2 Project');
  assert.equal(detail.messages[1].actionDrafts[0].linkedContent[0].id, contentId);
  assert.deepEqual(drafts.getAskEremiteThread(firstRun.thread.id), detail, 'Draft card persists across refresh reads');

  const grouped = actionViewGroups([
    { status: 'draft', due_date: '2026-09-21', id: 'past' },
    { status: 'draft', due_date: '2026-09-22', id: 'today' },
    { status: 'draft', due_date: '2026-09-23', id: 'future' },
  ], 'open', '2026-09-22');
  assert.deepEqual(grouped.flatMap(group => group.items), [], 'Drafts stay out of normal, today, overdue and upcoming groups');

  const confirmed = drafts.confirmAskEremiteActionDraft({ threadId: firstRun.thread.id, messageId: firstRun.identity.assistantId, actionId: firstDraft.actionId, expectedRevision: firstDraft.revision });
  assert.equal(confirmed.lifecycle, 'confirmed');
  assert.equal(actions.getAction(firstDraft.actionId).status, 'active');
  assert.throws(() => drafts.confirmAskEremiteActionDraft({ threadId: firstRun.thread.id, messageId: firstRun.identity.assistantId, actionId: firstDraft.actionId, expectedRevision: confirmed.revision }), { code: 'ai_action_draft_not_pending' });
  detail = drafts.getAskEremiteThread(firstRun.thread.id);
  assert.equal(detail.messages[1].actionDrafts[0].lifecycle, 'confirmed');

  const rejectedRun = begin('create then provider fails');
  const rejectedDraft = drafts.createAskEremiteActionDraft({ title: 'Reject me', priority: 'normal' }, context(rejectedRun.identity, { kind: 'global' }));
  store.finishAIRun({ runId: rejectedRun.identity.runId, status: 'failed', content: '', errorCode: 'ai_generation_failed' });
  assert.equal(drafts.getAskEremiteThread(rejectedRun.thread.id).messages[1].actionDrafts[0].lifecycle, 'pending', 'Provider failure cannot hide committed Draft');
  const rejected = drafts.rejectAskEremiteActionDraft({ threadId: rejectedRun.thread.id, messageId: rejectedRun.identity.assistantId, actionId: rejectedDraft.actionId, expectedRevision: rejectedDraft.revision });
  assert.equal(rejected.lifecycle, 'rejected');
  assert.ok(actions.getAction(rejectedDraft.actionId).trashed_at);
  assert.equal(drafts.getAskEremiteThread(rejectedRun.thread.id).messages[1].actionDrafts[0].lifecycle, 'rejected');
  assert.throws(() => drafts.rejectAskEremiteActionDraft({ threadId: rejectedRun.thread.id, messageId: rejectedRun.identity.assistantId, actionId: rejectedDraft.actionId, expectedRevision: rejected.revision }), { code: 'ai_action_draft_not_pending' });
  actions.restoreAction(rejectedDraft.actionId, rejected.revision);
  assert.equal(actions.getAction(rejectedDraft.actionId).status, 'draft', 'rejection uses recoverable Trash semantics');

  const staleRun = begin('stale');
  const staleDraft = drafts.createAskEremiteActionDraft({ title: 'Stale', priority: 'low' }, context(staleRun.identity, { kind: 'global' }));
  actions.updateActionDetails({ id: staleDraft.actionId, title: 'Stale changed', priority: 'low', projectId: null, expectedRevision: staleDraft.revision });
  assert.throws(() => drafts.confirmAskEremiteActionDraft({ threadId: staleRun.thread.id, messageId: staleRun.identity.assistantId, actionId: staleDraft.actionId, expectedRevision: staleDraft.revision }), /action_revision_conflict/u);
  store.finishAIRun({ runId: staleRun.identity.runId, status: 'completed', content: 'stale' });

  const validationRun = begin('validation');
  const fakeProject = randomUUID();
  const fakeContent = randomUUID();
  assert.throws(() => drafts.createAskEremiteActionDraft({ title: 'Bad project', priority: 'normal', projectId: fakeProject }, context(validationRun.identity, { kind: 'global' }, [projectSource(fakeProject)])), { code: 'not_found' });
  assert.throws(() => drafts.createAskEremiteActionDraft({ title: 'Bad content', priority: 'normal', contentItemIds: [fakeContent] }, context(validationRun.identity, { kind: 'global' }, [contentSource(fakeContent)])), { code: 'content_unavailable' });
  assert.throws(() => drafts.createAskEremiteActionDraft({ title: 'Trashed content', priority: 'normal', contentItemIds: [trashedContentId] }, context(validationRun.identity, { kind: 'global' }, [contentSource(trashedContentId)])), { code: 'content_unavailable' });
  assert.throws(() => drafts.createAskEremiteActionDraft({ title: 'Forged context', priority: 'normal', contentItemIds: [contentId] }, context(validationRun.identity, { kind: 'global' })), { code: 'ai_action_draft_not_allowed' });
  assert.throws(() => drafts.createAskEremiteActionDraft({ title: 'Bad date', priority: 'normal', dueDate: '2026-02-31' }, context(validationRun.identity, { kind: 'global' })), { code: 'invalid_due_date' });
  store.finishAIRun({ runId: validationRun.identity.runId, status: 'completed', content: 'validation' });

  const globalRun = begin('global');
  const globalDraft = drafts.createAskEremiteActionDraft({ title: 'Global Draft', priority: 'normal' }, context(globalRun.identity, { kind: 'global' }));
  assert.equal(globalDraft.projectId, null);
  store.finishAIRun({ runId: globalRun.identity.runId, status: 'cancelled', errorCode: 'ai_cancelled' });
  assert.equal(drafts.getAskEremiteThread(globalRun.thread.id).messages[1].actionDrafts[0].lifecycle, 'pending', 'client interruption preserves committed Draft');

  const projectRun = begin('project');
  const projectDraft = drafts.createAskEremiteActionDraft({ title: '整理 v1.5 发布检查清单', priority: 'high', dueDate: '2026-09-30' }, context(projectRun.identity, { kind: 'project', id: projectId }, [projectSource()]));
  assert.equal(projectDraft.projectId, projectId);
  store.finishAIRun({ runId: projectRun.identity.runId, status: 'completed', content: 'project draft' });
  assert.equal(actions.getAction(projectDraft.actionId).title, '整理 v1.5 发布检查清单');
  assert.equal(actions.getAction(projectDraft.actionId).status, 'draft');
  const projectArtifact = drafts.getAskEremiteThread(projectRun.thread.id).messages[1].actionDrafts[0];
  assert.equal(projectArtifact.title, '整理 v1.5 发布检查清单');
  assert.equal(projectArtifact.priority, 'high');
  assert.equal(projectArtifact.dueDate, '2026-09-30');
  assert.equal(projectArtifact.project?.id, projectId);
  assert.equal(drafts.getAskEremiteThread(projectRun.thread.id).messages[1].actionDrafts[0].title, projectArtifact.title, 'refresh preserves the complete title');

  const unrelatedAction = actions.createAction({ title: 'Unrelated', priority: 'normal' });
  assert.throws(() => drafts.confirmAskEremiteActionDraft({ threadId: projectRun.thread.id, messageId: projectRun.identity.assistantId, actionId: unrelatedAction, expectedRevision: 1 }), { code: 'ai_action_draft_not_found' });
  assert.throws(() => drafts.confirmAskEremiteActionDraft({ threadId: randomUUID(), messageId: projectRun.identity.assistantId, actionId: projectDraft.actionId, expectedRevision: 1 }), { code: 'ai_action_draft_not_found' });
  assert.throws(() => drafts.confirmAskEremiteActionDraft({ threadId: firstRun.thread.id, messageId: firstRun.identity.assistantId, actionId: projectDraft.actionId, expectedRevision: 1 }), { code: 'ai_action_draft_not_found' }, 'cross-thread relation is rejected');

  const rollbackRun = begin('rollback');
  database.db().exec("CREATE TRIGGER ai_action_draft_failure BEFORE INSERT ON ai_message_action_drafts BEGIN SELECT RAISE(ABORT, 'injected provenance failure'); END;");
  assert.throws(() => drafts.createAskEremiteActionDraft({ title: 'Must Roll Back', priority: 'normal' }, context(rollbackRun.identity, { kind: 'global' })));
  database.db().exec('DROP TRIGGER ai_action_draft_failure');
  assert.equal(actions.listActions().some(action => action.title === 'Must Roll Back'), false, 'Action and provenance roll back atomically');
  store.finishAIRun({ runId: rollbackRun.identity.runId, status: 'failed', errorCode: 'ai_generation_failed' });

  const boundedRun = begin('bounded writes');
  const boundedHost = createAskEremiteHost();
  const writeTool = boundedHost.tools.find(tool => tool.definition.name === 'create_action_draft');
  const [firstBounded, replayBounded] = await Promise.all([
    writeTool.execute({ title: 'Bounded 0', priority: 'normal' }, context(boundedRun.identity, { kind: 'global' })),
    writeTool.execute({ priority: 'normal', title: 'Bounded 0' }, context(boundedRun.identity, { kind: 'global' })),
  ]);
  assert.equal(firstBounded.data.actionId, replayBounded.data.actionId, 'identical model retry receives the committed receipt');
  assert.equal(firstBounded.data.outcome, 'draft_created');
  assert.equal(firstBounded.data.requiresConfirmation, true);
  for (let index = 1; index < 3; index++) await writeTool.execute({ title: `Bounded ${index}`, priority: 'normal' }, context(boundedRun.identity, { kind: 'global' }));
  await assert.rejects(() => writeTool.execute({ title: 'Bounded overflow', priority: 'normal' }, context(boundedRun.identity, { kind: 'global' })), /ai_draft_write_limit/u);
  store.finishAIRun({ runId: boundedRun.identity.runId, status: 'completed', content: 'three drafts' });

  const refusedRun = begin('unobserved project must fail');
  const refusedTool = createAskEremiteHost().tools.find(tool => tool.definition.name === 'create_action_draft');
  const actionsBeforeRefusal = actions.listActions().length;
  await assert.rejects(() => refusedTool.execute({ title: 'Must not exist', priority: 'normal', projectId }, context(refusedRun.identity, { kind: 'content', id: contentId }, [contentSource()])), { code: 'ai_tool_unobserved_project' });
  assert.equal(actions.listActions().length, actionsBeforeRefusal, 'Host rejection commits no Action');
  assert.equal(drafts.getAskEremiteThread(refusedRun.thread.id).messages[1].actionDrafts.length, 0, 'Host rejection commits no Draft artifact');
  store.finishAIRun({ runId: refusedRun.identity.runId, status: 'completed', content: 'No Draft created.' });

  const failedStreamRun = begin('one rejected model call');
  const failedStreamHost = createAskEremiteHost();
  const streamUsage = { inputTokens: { total: 3, noCache: 3 }, outputTokens: { total: 2, text: 2 } };
  const failedStreamModel = new MockLanguageModelV4({ doStream: [
    { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'tool-call', toolCallId: 'rejected-draft', toolName: 'create_action_draft', input: JSON.stringify({ title: 'Rejected model draft', priority: 'normal', projectId }) });
      controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls' }, usage: streamUsage });
      controller.close();
    } }) },
    { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 'final' });
      controller.enqueue({ type: 'text-delta', id: 'final', delta: '草稿未创建。' });
      controller.enqueue({ type: 'text-end', id: 'final' });
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop' }, usage: streamUsage });
      controller.close();
    } }) },
  ] });
  const { createAIRuntime } = await import('@/modules/ai/runtime');
  const failedStreamRuntime = createAIRuntime({ id: 'fixture', modelId: 'fixture', languageModel: failedStreamModel });
  const failedStreamResponse = failedStreamRuntime.streamChat({
    threadId: failedStreamRun.thread.id, runId: failedStreamRun.identity.runId, messageId: failedStreamRun.identity.assistantId,
    messages: [{ role: 'user', content: 'create one synthetic Draft' }],
    context: await failedStreamHost.resolveContext({ kind: 'content', id: contentId }), tools: failedStreamHost.tools,
    abortSignal: new AbortController().signal,
    onCheckpoint: content => store.checkpointAIMessage(failedStreamRun.identity.runId, content),
    onComplete: result => store.finishAIRun({ runId: failedStreamRun.identity.runId, ...result }),
  });
  const failedEvents = (await failedStreamResponse.text()).split(/\r?\n/u).filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  const failedActivities = failedEvents.filter(event => event.type === 'data-activity').map(event => event.data);
  assert.ok(failedActivities.some(activity => activity.kind === 'draft' && activity.state === 'failed' && activity.code === 'ai_tool_unobserved_project'));
  assert.equal(failedActivities.some(activity => activity.kind === 'draft' && activity.state === 'succeeded'), false, 'failed Tool never reports creation');
  assert.equal(drafts.getAskEremiteThread(failedStreamRun.thread.id).messages[1].actionDrafts.length, 0);
  assert.equal(drafts.getAskEremiteThread(failedStreamRun.thread.id).messages[1].error_code, 'ai_tool_call_invalid', 'failed Draft outcome persists across refresh');
  assert.equal(actions.listActions().some(action => action.title === 'Rejected model draft'), false);
  assert.match(JSON.stringify(failedStreamModel.doStreamCalls[1]), /ai_tool_unobserved_project/u, 'model receives only safe Host rejection');

  const host = createAskEremiteHost();
  assert.deepEqual(host.tools.map(tool => `${tool.access}:${tool.definition.name}`), [
    'read:search_content', 'read:get_content', 'read:get_project', 'read:list_project_actions', 'draft-write:create_action_draft', 'update-proposal:propose_action_update', 'tool-run-proposal:propose_tool_run',
  ]);
  const aiFiles = (await readdir('src/modules/ai')).filter(name => name.endsWith('.ts'));
  const aiSource = (await Promise.all(aiFiles.map(name => readFile(path.join('src/modules/ai', name), 'utf8')))).join('\n');
  assert.doesNotMatch(aiSource, /(?:FROM|INSERT INTO|UPDATE|DELETE FROM)\s+actions\b/iu, 'AI module never queries Actions tables');
  const hostSource = await readFile('src/app/_services/ask-eremite-host.ts', 'utf8');
  assert.doesNotMatch(hostSource, /@\/platform\/db|node:sqlite/u);
  assert.match(hostSource, /createAskEremiteActionDraft/u);
  const routeSource = await readFile('src/app/api/ai/route.ts', 'utf8');
  assert.match(routeSource, /confirmAskEremiteActionDraft/u);
  assert.doesNotMatch(routeSource, /runAIChat\([^)]*confirm_action_draft/su, 'confirmation is a Host command, not a model decision');
  const clientSource = await readFile('src/app/_components/ask-eremite.tsx', 'utf8');
  assert.doesNotMatch(clientSource, /process\.env|modules\/ai\/(?:config|provider|service\.server)|UNAPPROVED_PROVIDER_API_KEY/u);
  assert.doesNotMatch(JSON.stringify(database.db().prepare('SELECT * FROM ai_messages').all()), /hidden reasoning/u);
  assert.equal(database.db().prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(database.db().prepare('PRAGMA foreign_key_check').all(), []);
  console.log('AI Action Draft gate passed: strict Draft-only capability, owner validation, atomic provenance, Host confirm/reject, CAS/replay/forgery safety, bounded writes, persistence and architecture guards.');
} finally {
  database?.db().close();
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
