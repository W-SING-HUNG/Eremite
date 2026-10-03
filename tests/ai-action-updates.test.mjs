import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const directory = await mkdtemp(path.join(tmpdir(), 'eremite-ai-action-updates-'));
process.env.EREMITE_DATA_DIR = directory;
let database;
try {
  const actions = await import('@/modules/actions/service');
  const projects = await import('@/modules/projects/service');
  const store = await import('@/modules/ai/chat-store');
  const updates = await import('@/app/_services/ask-eremite-action-updates');
  const drafts = await import('@/app/_services/ask-eremite-action-drafts');
  const { createAskEremiteHost } = await import('@/app/_services/ask-eremite-host');
  database = await import('@/platform/db/database');

  const begin = (status = 'completed') => {
    const thread = store.createAIThread();
    const identity = store.beginAIRun({ threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text: 'update this action', model: 'test', deadlineAt: new Date(Date.now() + 60_000).toISOString() });
    const finish = () => store.finishAIRun({ runId: identity.runId, status, ...(status === 'failed' ? { errorCode: 'ai_generation_failed' } : status === 'cancelled' ? { errorCode: 'ai_cancelled' } : {}) });
    return { thread, identity, finish };
  };
  const observe = (run, id, source = true) => ({
    identity: { threadId: run.thread.id, messageId: run.identity.assistantId, runId: run.identity.runId },
    currentContext: { kind: 'actions', id },
    observedSources: source ? [{ module: 'actions', entity: 'action', id, revision: actions.getAction(id).revision, label: 'Action', href: `/actions?selected=${id}` }] : [],
    abortSignal: new AbortController().signal,
  });
  const command = (run, proposal) => ({ threadId: run.thread.id, messageId: run.identity.assistantId, proposalId: proposal.id });
  const make = (title = 'Submit contract') => actions.createAction({ title, priority: 'normal', dueDate: '2026-09-24' });

  for (const value of [{ actionId: randomUUID(), status: 'active' }, { actionId: randomUUID(), projectId: randomUUID() }, { actionId: randomUUID(), revision: 999 }, { actionId: randomUUID(), completedAt: 'now' }, { actionId: randomUUID(), trashedAt: 'now' }, { actionId: randomUUID(), contentItemIds: [] }, { actionId: randomUUID(), transition: 'active' }, { actionId: randomUUID() }]) {
    assert.equal(updates.proposeActionUpdateInputSchema.safeParse(value).success, false);
  }
  assert.equal(updates.proposeActionUpdateInputSchema.safeParse({ actionId: randomUUID(), dueDate: '2026-02-30' }).success, false);
  assert.equal(updates.proposeActionUpdateInputSchema.safeParse({ actionId: randomUUID(), title: 'Rename', transition: 'done' }).success, false);
  assert.equal(updates.proposeActionUpdateInputSchema.safeParse({ actionId: randomUUID(), title: { text: 'Rename' } }).success, false, 'title remains a bounded string');
  assert.equal(updates.proposeActionUpdateInputSchema.safeParse({ actionId: randomUUID(), preserveTitleQuotes: true, priority: 'high' }).success, false, 'literal quote flag requires a title change');
  assert.equal(updates.proposeActionUpdateInputSchema.safeParse({ actionId: randomUUID(), targetName: 'Task', priority: 'high' }).success, false, 'provide one target reference');
  assert.equal(updates.proposeActionUpdateInputSchema.safeParse({ targetName: 'Task', priority: 'high' }).success, true, 'natural-language reference is valid');
  const updateSchema = z.toJSONSchema(updates.proposeActionUpdateInputSchema);
  assert.equal(updateSchema.properties.title.type, 'string');
  assert.equal(updateSchema.properties.preserveTitleQuotes.type, 'boolean');

  const actionId = make();
  const run = begin();
  assert.throws(() => updates.proposeAskEremiteActionUpdate({ actionId, dueDate: '2026-09-27' }, observe(run, actionId, false)), { code: 'ai_action_update_not_allowed' });
  assert.throws(() => updates.proposeAskEremiteActionUpdate({ actionId: randomUUID(), priority: 'high' }, observe(run, actionId)), { code: 'ai_action_update_not_allowed' });
  const proposal = updates.proposeAskEremiteActionUpdate({ actionId, dueDate: '2026-09-27', priority: 'high' }, observe(run, actionId));
  assert.equal(actions.getAction(actionId).due_date, '2026-09-24', 'proposal does not mutate Action');
  assert.equal(proposal.before.dueDate, '2026-09-24');
  assert.equal(proposal.patch.dueDate, '2026-09-27');
  run.finish();
  assert.deepEqual(drafts.getAskEremiteThread(run.thread.id).messages[1].actionUpdates[0], proposal, 'proposal survives refresh');
  const applied = updates.applyAskEremiteActionUpdate(command(run, proposal));
  assert.equal(applied.revision, proposal.actionRevision + 1, 'combined patch increments revision once');
  assert.equal(actions.getAction(actionId).priority, 'high');
  assert.equal(actions.getAction(actionId).due_date, '2026-09-27');
  assert.equal(drafts.getAskEremiteThread(run.thread.id).messages[1].actionUpdates[0].lifecycle, 'applied');
  assert.throws(() => updates.applyAskEremiteActionUpdate(command(run, proposal)), { code: 'ai_action_update_not_pending' });

  for (const [patch, check] of [
    [{ title: 'Renamed task' }, action => assert.equal(action.title, 'Renamed task')],
    [{ transition: 'done' }, action => { assert.equal(action.status, 'done'); assert.ok(action.completed_at); }],
    [{ transition: 'cancelled' }, action => { assert.equal(action.status, 'cancelled'); assert.equal(action.completed_at, null); }],
  ]) {
    const id = make(); const r = begin(); const p = updates.proposeAskEremiteActionUpdate({ actionId: id, ...patch }, observe(r, id)); r.finish();
    updates.applyAskEremiteActionUpdate(command(r, p)); check(actions.getAction(id));
  }

  for (const [request, modelTitle, preserve, expectedTitle] of [
    ['请把“准备 v1.5 发布说明”改名为“准备 v1.5 正式发布说明”。', '“准备 v1.5 正式发布说明”', false, '准备 v1.5 正式发布说明'],
    ['把标题改成：准备 v1.5 正式发布说明', '准备 v1.5 正式发布说明', false, '准备 v1.5 正式发布说明'],
    ['把标题改成《准备 v1.5 正式发布说明》', '《准备 v1.5 正式发布说明》', false, '准备 v1.5 正式发布说明'],
    ['把标题改成包含引号的“准备 v1.5 正式发布说明”，引号也要保留', '“准备 v1.5 正式发布说明”', true, '“准备 v1.5 正式发布说明”'],
    ['保留内部标点', '准备“正式”发布说明', false, '准备“正式”发布说明'],
  ]) {
    const id = make('准备 v1.5 发布说明');
    const r = begin();
    const p = updates.proposeAskEremiteActionUpdate({ actionId: id, title: modelTitle, ...(preserve ? { preserveTitleQuotes: true } : {}) }, observe(r, id));
    assert.equal(p.patch.title, expectedTitle, request);
    assert.equal(actions.getAction(id).title, '准备 v1.5 发布说明', 'proposal remains pending until apply');
    r.finish();
    updates.applyAskEremiteActionUpdate(command(r, p));
    assert.equal(actions.getAction(id).title, expectedTitle, request);
    assert.equal(drafts.getAskEremiteThread(r.thread.id).messages[1].actionUpdates[0].patch.title, expectedTitle, 'refresh preserves exact applied title');
  }

  const rejectedId = make(); const rejectedRun = begin('failed');
  const rejectedProposal = updates.proposeAskEremiteActionUpdate({ actionId: rejectedId, priority: 'high' }, observe(rejectedRun, rejectedId));
  rejectedRun.finish();
  assert.equal(drafts.getAskEremiteThread(rejectedRun.thread.id).messages[1].actionUpdates[0].lifecycle, 'pending', 'Provider failure preserves proposal');
  updates.rejectAskEremiteActionUpdate(command(rejectedRun, rejectedProposal));
  assert.equal(actions.getAction(rejectedId).priority, 'normal');
  assert.equal(drafts.getAskEremiteThread(rejectedRun.thread.id).messages[1].actionUpdates[0].lifecycle, 'rejected');
  assert.throws(() => updates.rejectAskEremiteActionUpdate(command(rejectedRun, rejectedProposal)), { code: 'ai_action_update_not_pending' });

  const staleId = make(); const staleRun = begin('cancelled');
  const staleProposal = updates.proposeAskEremiteActionUpdate({ actionId: staleId, title: 'Overwrite me' }, observe(staleRun, staleId)); staleRun.finish();
  actions.updateActionDetails({ id: staleId, title: 'Newer external edit', priority: 'normal', dueDate: '2026-09-24', projectId: null, expectedRevision: 1 });
  assert.throws(() => updates.applyAskEremiteActionUpdate(command(staleRun, staleProposal)), { code: 'ai_action_update_stale' });
  assert.equal(actions.getAction(staleId).title, 'Newer external edit');
  assert.equal(drafts.getAskEremiteThread(staleRun.thread.id).messages[1].actionUpdates[0].lifecycle, 'stale', 'Stop and stale state survive refresh');
  assert.throws(() => updates.applyAskEremiteActionUpdate({ ...command(run, proposal), proposalId: staleProposal.id }), { code: 'ai_action_update_not_found' });
  assert.throws(() => updates.applyAskEremiteActionUpdate({ ...command(staleRun, staleProposal), messageId: run.identity.assistantId }), { code: 'ai_action_update_not_found' });
  assert.throws(() => updates.applyAskEremiteActionUpdate({ ...command(staleRun, staleProposal), proposalId: randomUUID() }), { code: 'ai_action_update_not_found' });

  const draftRun = begin();
  const draft = actions.createDraftAction ? await import('@/platform/db/database').then(db => db.withUnitOfWork(uow => actions.createDraftAction(uow, { title: 'Draft', priority: 'normal' }))) : null;
  assert.throws(() => updates.proposeAskEremiteActionUpdate({ actionId: draft.actionId, title: 'Bypass' }, observe(draftRun, draft.actionId)), { code: 'ai_action_update_not_allowed' });
  draftRun.finish();

  const boundedId = make(); const boundedRun = begin(); const host = createAskEremiteHost();
  const tool = host.tools.find(item => item.definition.name === 'propose_action_update');
  for (let index = 0; index < 3; index++) await tool.execute({ actionId: boundedId, title: `Bounded ${index}` }, observe(boundedRun, boundedId));
  await assert.rejects(() => tool.execute({ actionId: boundedId, title: 'Overflow' }, observe(boundedRun, boundedId)), /ai_update_proposal_limit/u);
  boundedRun.finish();

  const unavailableId = make(); const unavailableRun = begin();
  const unavailableProposal = updates.proposeAskEremiteActionUpdate({ actionId: unavailableId, priority: 'high' }, observe(unavailableRun, unavailableId)); unavailableRun.finish();
  actions.trashAction(unavailableId, 1);
  assert.equal(drafts.getAskEremiteThread(unavailableRun.thread.id).messages[1].actionUpdates[0].lifecycle, 'unavailable');
  assert.throws(() => updates.applyAskEremiteActionUpdate(command(unavailableRun, unavailableProposal)), { code: 'ai_action_update_not_pending' });

  const globalTarget = (run, id, userRequest, currentContext = { kind: 'actions' }) => ({ ...observe(run, id), currentContext, userRequest });
  const uniqueId = make('唯一精确匹配行动'); const uniqueRun = begin();
  const uniqueProposal = updates.proposeAskEremiteActionUpdate({ targetName: '唯一精确匹配行动', priority: 'high' }, globalTarget(uniqueRun, uniqueId, '请把“唯一精确匹配行动”的优先级改为高。'));
  assert.equal(uniqueProposal.actionId, uniqueId, 'unique exact name may propose');
  uniqueRun.finish();
  const wrongObservedId = make('另一个已观察行动'); const wrongRun = begin();
  assert.throws(() => updates.proposeAskEremiteActionUpdate({ actionId: wrongObservedId, priority: 'high' }, globalTarget(wrongRun, wrongObservedId, '请把“唯一精确匹配行动”的优先级改为高。')), { code: 'ai_action_update_not_allowed' }, 'an observed but mismatched ID is not enough');
  wrongRun.finish();

  const duplicateA = make('完全同名行动'); const duplicateB = make('完全同名行动');
  const duplicateRun = begin();
  const duplicateOutcome = updates.proposeAskEremiteActionUpdate({ targetName: '完全同名行动', priority: 'high' }, globalTarget(duplicateRun, duplicateA, '请把“完全同名行动”的优先级改为高。'));
  assert.equal(duplicateOutcome.kind, 'needs_disambiguation');
  let duplicateDetail = drafts.getAskEremiteThread(duplicateRun.thread.id).messages[1];
  assert.equal(duplicateDetail.actionUpdates.length, 0);
  assert.equal(duplicateDetail.actionDisambiguations[0].candidates.length, 2);
  assert.equal(actions.getAction(duplicateA).priority, 'normal');
  assert.equal(actions.getAction(duplicateB).priority, 'normal');
  duplicateRun.finish();
  assert.throws(() => updates.chooseAskEremiteActionTarget({ threadId: duplicateRun.thread.id, messageId: duplicateRun.identity.assistantId, disambiguationId: duplicateOutcome.disambiguationId, actionId: randomUUID(), expectedRevision: 1 }), { code: 'ai_action_update_not_found' }, 'forged candidate ID cannot be selected');
  const selectedFromOutcome = updates.chooseAskEremiteActionTarget({ threadId: duplicateRun.thread.id, messageId: duplicateRun.identity.assistantId, disambiguationId: duplicateOutcome.disambiguationId, actionId: duplicateB, expectedRevision: 1 });
  assert.equal(selectedFromOutcome.actionId, duplicateB);
  assert.equal(selectedFromOutcome.lifecycle, 'pending', 'user selection creates only a proposal');
  assert.equal(actions.getAction(duplicateB).priority, 'normal', 'Action is unchanged until Apply');
  duplicateDetail = drafts.getAskEremiteThread(duplicateRun.thread.id).messages[1];
  assert.equal(duplicateDetail.actionDisambiguations[0].lifecycle, 'resolved');
  assert.equal(duplicateDetail.actionUpdates.length, 1);
  assert.throws(() => updates.chooseAskEremiteActionTarget({ threadId: duplicateRun.thread.id, messageId: duplicateRun.identity.assistantId, disambiguationId: duplicateOutcome.disambiguationId, actionId: duplicateA, expectedRevision: 1 }), { code: 'ai_action_update_not_pending' }, 'selection is one-shot');
  updates.applyAskEremiteActionUpdate(command(duplicateRun, selectedFromOutcome));
  assert.equal(actions.getAction(duplicateB).priority, 'high');
  assert.equal(actions.getAction(duplicateA).priority, 'normal');
  const ambiguousToolRun = begin();
  const updateTool = createAskEremiteHost().tools.find(item => item.definition.name === 'propose_action_update');
  const toolOutcome = await updateTool.execute({ actionId: duplicateA, priority: 'high' }, globalTarget(ambiguousToolRun, duplicateA, '请把“完全同名行动”的优先级改为高。'));
  assert.equal(toolOutcome.data.kind, 'needs_disambiguation');
  assert.equal((await updateTool.execute({ actionId: duplicateA, priority: 'high' }, globalTarget(ambiguousToolRun, duplicateA, '请把“完全同名行动”的优先级改为高。'))).data.disambiguationId, toolOutcome.data.disambiguationId, 'later model attempts receive the same outcome');
  assert.equal(drafts.getAskEremiteThread(ambiguousToolRun.thread.id).messages[1].actionUpdates.length, 0);
  ambiguousToolRun.finish();

  const quotedId = make('“外围引号同名行动”'); const plainId = make('外围引号同名行动');
  assert.equal(actions.actionReferenceKey(actions.getAction(quotedId).title), actions.actionReferenceKey(actions.getAction(plainId).title));
  const quotedRun = begin();
  const quotedOutcome = updates.proposeAskEremiteActionUpdate({ targetName: '外围引号同名行动', priority: 'high' }, globalTarget(quotedRun, quotedId, '请把“外围引号同名行动”的优先级改为高。'));
  assert.equal(quotedOutcome.kind, 'needs_disambiguation');
  assert.equal(drafts.getAskEremiteThread(quotedRun.thread.id).messages[1].actionUpdates.length, 0);
  quotedRun.finish();

  const manyIds = Array.from({ length: 35 }, () => make('大量候选行动'));
  const manyRun = begin();
  const manyOutcome = updates.proposeAskEremiteActionUpdate({ targetName: '大量候选行动', priority: 'high' },
    globalTarget(manyRun, manyIds[0], '请把“大量候选行动”的优先级改为高。'));
  assert.equal(manyOutcome.kind, 'needs_disambiguation');
  assert.equal(drafts.getAskEremiteThread(manyRun.thread.id).messages[1].actionDisambiguations[0].candidates.length, 35,
    'Host retains all candidates for the bounded searchable picker');
  assert.equal(drafts.getAskEremiteThread(manyRun.thread.id).messages[1].actionUpdates.length, 0);
  manyRun.finish();

  const staleChoiceA = make('选择前变化行动'); const staleChoiceB = make('选择前变化行动');
  const staleChoiceRun = begin();
  const staleChoiceOutcome = updates.proposeAskEremiteActionUpdate({ actionId: staleChoiceA, priority: 'high' }, globalTarget(staleChoiceRun, staleChoiceA, '请把“选择前变化行动”的优先级改为高。'));
  staleChoiceRun.finish();
  actions.updateActionDetails({ id: staleChoiceB, title: '选择前变化行动', priority: 'normal', dueDate: '2026-09-24', projectId: null, expectedRevision: 1 });
  assert.throws(() => updates.chooseAskEremiteActionTarget({ threadId: staleChoiceRun.thread.id, messageId: staleChoiceRun.identity.assistantId, disambiguationId: staleChoiceOutcome.disambiguationId, actionId: staleChoiceB, expectedRevision: 1 }), { code: 'ai_action_update_stale' });
  assert.equal(drafts.getAskEremiteThread(staleChoiceRun.thread.id).messages[1].actionDisambiguations[0].lifecycle, 'stale');
  assert.equal(drafts.getAskEremiteThread(staleChoiceRun.thread.id).messages[1].actionUpdates.length, 0);
  assert.equal(actions.getAction(staleChoiceA).priority, 'normal');
  assert.equal(actions.getAction(staleChoiceB).priority, 'normal');

  const selectedRun = begin();
  const selectedProposal = updates.proposeAskEremiteActionUpdate({ actionId: plainId, priority: 'high' }, globalTarget(selectedRun, plainId, '请把“外围引号同名行动”的优先级改为高。', { kind: 'actions', id: plainId }));
  selectedRun.finish();
  updates.applyAskEremiteActionUpdate(command(selectedRun, selectedProposal));
  assert.equal(actions.getAction(plainId).priority, 'high', 'explicit UI selection identifies one target');
  assert.equal(actions.getAction(quotedId).priority, 'normal');
  const selectedPriorityId = make('UI 已选行动'); const selectedPriorityRun = begin();
  const selectedPriority = updates.proposeAskEremiteActionUpdate({ actionId: selectedPriorityId, priority: 'high' }, globalTarget(selectedPriorityRun, selectedPriorityId, '把当前行动的优先级改为“高”。', { kind: 'actions', id: selectedPriorityId }));
  assert.equal(selectedPriority.actionId, selectedPriorityId, 'quoted priority is not mistaken for another Action title');
  selectedPriorityRun.finish();

  const projectA = projects.createProject({ name: 'QA 区分专案 A' });
  const projectB = projects.createProject({ name: 'QA 区分专案 B' });
  const projectActionA = actions.createAction({ title: '专案同名行动', priority: 'normal', projectId: projectA });
  actions.createAction({ title: '专案同名行动', priority: 'normal', projectId: projectB });
  const projectQualifiedRun = begin();
  const projectQualified = updates.proposeAskEremiteActionUpdate({ targetName: '专案同名行动', priority: 'high' }, globalTarget(projectQualifiedRun, projectActionA, '请把 QA 区分专案 A 中的“专案同名行动”优先级改为高。'));
  assert.equal(projectQualified.actionId, projectActionA, 'explicit Project name disambiguates');
  projectQualifiedRun.finish();
  const conflictingSelectionRun = begin();
  const conflictingSelection = updates.proposeAskEremiteActionUpdate({ targetName: '专案同名行动', priority: 'high' },
    globalTarget(conflictingSelectionRun, projectActionA, '请把 QA 区分专案 A 中的“专案同名行动”优先级改为高。', { kind: 'actions', id: actions.listActiveActionReferenceMatches('专案同名行动').find(item => item.id !== projectActionA).id }));
  assert.equal(conflictingSelection.actionId, projectActionA, 'explicit Project qualifier wins over unrelated UI selection');
  conflictingSelectionRun.finish();

  const dueActionA = actions.createAction({ title: '日期同名行动', priority: 'normal', dueDate: '2026-10-02' });
  actions.createAction({ title: '日期同名行动', priority: 'normal', dueDate: '2026-10-03' });
  const dueQualifiedRun = begin();
  const dueQualified = updates.proposeAskEremiteActionUpdate({ targetName: '日期同名行动', priority: 'high' }, globalTarget(dueQualifiedRun, dueActionA, '请把截止日期 2026-10-02 的“日期同名行动”优先级改为高。'));
  assert.equal(dueQualified.actionId, dueActionA, 'explicit old due date disambiguates');
  dueQualifiedRun.finish();

  const errorId = make(); const errorRun = begin();
  const errorProposal = updates.proposeAskEremiteActionUpdate({ actionId: errorId, title: 'Will fail' }, observe(errorRun, errorId)); errorRun.finish();
  database.db().exec("CREATE TRIGGER ai_update_injected_failure BEFORE UPDATE ON actions WHEN NEW.id = '" + errorId + "' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  assert.throws(() => updates.applyAskEremiteActionUpdate(command(errorRun, errorProposal)), /injected failure/u);
  database.db().exec('DROP TRIGGER ai_update_injected_failure');
  assert.equal(actions.getAction(errorId).title, 'Submit contract');
  assert.equal(drafts.getAskEremiteThread(errorRun.thread.id).messages[1].actionUpdates[0].lifecycle, 'error', 'failed apply is persisted without partial Action write');

  assert.equal(database.db().prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(database.db().prepare('PRAGMA foreign_key_check').all(), []);
  console.log('AI Action Update gate passed: strict schema, observation, persisted diff, apply/reject, CAS, replay, stale, forgery, failure, Stop, bounded writes.');
} finally {
  database?.db().close();
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
