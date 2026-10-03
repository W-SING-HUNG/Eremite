import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAIChatFixture } from './ai-chat-http-fixture.mjs';

const unconfigured = process.argv.includes('--unconfigured');
const fixture = await startAIChatFixture({ configured: !unconfigured, dev: process.env.EREMITE_HTTP_TEST_USE_BUILD !== '1' });
const headers = { cookie: `eremite_session=${fixture.sessionId}`, origin: fixture.baseURL, 'Content-Type': 'application/json' };
const post = body => fetch(`${fixture.baseURL}/api/ai`, { method: 'POST', headers, body: JSON.stringify(body) });
const detail = async id => (await fetch(`${fixture.baseURL}/api/ai?threadId=${id}`, { headers })).json();
try {
  assert.equal((await fetch(`${fixture.baseURL}/api/ai`)).status, 401);
  assert.equal((await fetch(`${fixture.baseURL}/api/ai`, { method: 'POST', headers: { ...headers, origin: 'https://attacker.invalid' }, body: '{"action":"create"}' })).status, 403);
  assert.equal((await post({ action: 'create', injected: true })).status, 400);
  const status = await (await fetch(`${fixture.baseURL}/api/ai`, { headers })).json();
  if (unconfigured) {
    assert.deepEqual(status.provider, { configured: false, model: null });
    const thread = await (await post({ action: 'create' })).json();
    assert.equal((await post({ action: 'send', threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text: 'unavailable', context: { kind: 'global' } })).status, 503);
    assert.equal((await detail(thread.id)).messages.length, 0);
    assert.equal(fixture.stats.started, 0);
    console.log('AI unavailable HTTP gate passed: safe status, 503, no provider request or partial write.');
  } else {
  assert.deepEqual(status.provider, { configured: true, model: 'mock-model' });
  assert.doesNotMatch(JSON.stringify(status), /fixture-only-key|127\.0\.0\.1|Authorization/u);
  const invalidContextThread = await (await post({ action: 'create' })).json();
  assert.equal((await post({ action: 'send', threadId: invalidContextThread.id, expectedRevision: invalidContextThread.revision, requestId: randomUUID(), text: 'invalid context', context: { kind: 'content', id: '00000000-0000-4000-8000-000000000000' } })).status, 404);
  assert.equal((await detail(invalidContextThread.id)).messages.length, 0, 'invalid context is rejected before message/run persistence');
  let thread = await (await post({ action: 'create' })).json();
  const input = { action: 'send', threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text: 'global question', context: { kind: 'global' } };
  const response = await post(input);
  assert.equal(response.status, 200, await response.clone().text());
  const chunks = []; const reader = response.body.getReader();
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(new TextDecoder().decode(chunk.value)); }
  assert.ok(chunks.filter(chunk => chunk.includes('text-delta')).length > 2);
  assert.match(chunks.join(''), /\[DONE\]/u);
  const saved = await detail(thread.id);
  assert.equal(saved.messages[1].status, 'completed');
  assert.equal(saved.messages[1].content, '这是隔离测试的逐步回答。历史已保存。');
  assert.deepEqual((await detail(thread.id)).messages, saved.messages);
  assert.equal((await post(input)).status, 409);
  assert.equal((await post({ ...input, requestId: randomUUID() })).status, 409);

  const stopping = await post({ ...input, text: 'stop-probe', expectedRevision: saved.thread.revision, requestId: randomUUID() });
  const stopReader = stopping.body.getReader();
  for (;;) { const chunk = await stopReader.read(); if (new TextDecoder().decode(chunk.value).includes('text-delta')) break; }
  const runId = stopping.headers.get('X-Eremite-Run-Id');
  assert.equal((await post({ action: 'stop', threadId: thread.id, runId })).status, 200);
  while (!(await stopReader.read()).done) { /* drain SDK end */ }
  const stopped = await detail(thread.id);
  assert.equal(stopped.messages.at(-1).status, 'cancelled');
  assert.ok(stopped.messages.at(-1).content.length > 0);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fixture.stats.cancelled, 1, 'provider HTTP connection actually closed');

  const contextThread = await (await post({ action: 'create' })).json();
  const contextual = await post({ action: 'send', threadId: contextThread.id, expectedRevision: contextThread.revision, requestId: randomUUID(), text: 'content context', context: { kind: 'content', id: fixture.entities.contentId } });
  await contextual.text();
  const contextualDetail = await detail(contextThread.id);
  assert.equal(contextualDetail.messages[1].sources[0].id, fixture.entities.contentId, 'Host-validated current context becomes provenance');

  const toolThread = await (await post({ action: 'create' })).json();
  const toolResponse = await post({ action: 'send', threadId: toolThread.id, expectedRevision: toolThread.revision, requestId: randomUUID(), text: 'tool-roundtrip', context: { kind: 'project', id: fixture.entities.projectId } });
  const toolStream = await toolResponse.text();
  assert.match(toolStream, /四个工具已完成真实往返/u);
  assert.equal(fixture.stats.toolCalls, 4);
  const toolDetail = await detail(toolThread.id);
  assert.equal(toolDetail.messages[1].status, 'completed');
  assert.deepEqual(toolDetail.messages[1].sources.map(source => `${source.entity}:${source.id}`).sort(), [
    `action:${fixture.entities.actionId}`,
    `action:${fixture.entities.ambiguousQuotedId}`,
    `action:${fixture.entities.ambiguousPlainId}`,
    `content:${fixture.entities.contentId}`,
    `project:${fixture.entities.projectId}`,
  ].sort(), 'sources come from actual current-context and tool reads and are deduplicated');

  const ambiguousThread = await (await post({ action: 'create' })).json();
  const ambiguousResponse = await post({ action: 'send', threadId: ambiguousThread.id, expectedRevision: ambiguousThread.revision,
    requestId: randomUUID(), text: 'ambiguity-roundtrip: change Fixture Ambiguous Action priority to high', context: { kind: 'actions' } });
  assert.equal(ambiguousResponse.status, 200);
  const ambiguousStream = await ambiguousResponse.text();
  assert.match(ambiguousStream, /needs_input/u);
  assert.equal(fixture.stats.updateToolCalls, 1, 'Host outcome stops model retries');
  let ambiguousDetail = await detail(ambiguousThread.id);
  const ambiguousMessage = ambiguousDetail.messages[1];
  assert.equal(ambiguousMessage.status, 'completed');
  assert.equal(ambiguousMessage.actionUpdates.length, 0);
  assert.equal(ambiguousMessage.actionDisambiguations[0].candidates.length, 2);
  const candidate = ambiguousMessage.actionDisambiguations[0].candidates.find(item => item.actionId === fixture.entities.ambiguousPlainId);
  const choice = await post({ action: 'choose_action_target', threadId: ambiguousThread.id, messageId: ambiguousMessage.id,
    disambiguationId: ambiguousMessage.actionDisambiguations[0].id, actionId: candidate.actionId, expectedRevision: candidate.revision });
  assert.equal(choice.status, 200);
  ambiguousDetail = await detail(ambiguousThread.id);
  assert.equal(ambiguousDetail.messages[1].actionDisambiguations[0].lifecycle, 'resolved');
  assert.equal(ambiguousDetail.messages[1].actionUpdates.length, 1);
  assert.equal(ambiguousDetail.messages[1].actionUpdates[0].lifecycle, 'pending');
  assert.equal((await post({ action: 'choose_action_target', threadId: ambiguousThread.id, messageId: ambiguousMessage.id,
    disambiguationId: ambiguousMessage.actionDisambiguations[0].id, actionId: fixture.entities.ambiguousQuotedId, expectedRevision: candidate.revision })).status, 409);
  const proposalId = ambiguousDetail.messages[1].actionUpdates[0].id;
  assert.equal((await post({ action: 'apply_action_update', threadId: ambiguousThread.id, messageId: ambiguousMessage.id, proposalId })).status, 200);
  ambiguousDetail = await detail(ambiguousThread.id);
  assert.equal(ambiguousDetail.messages[1].actionUpdates[0].lifecycle, 'applied');
  const actionDatabase = new DatabaseSync(`${fixture.directory}/app.sqlite`, { readOnly: true });
  try {
    assert.equal(actionDatabase.prepare('SELECT priority FROM actions WHERE id = ?').get(fixture.entities.ambiguousPlainId).priority, 'high');
    assert.equal(actionDatabase.prepare('SELECT priority FROM actions WHERE id = ?').get(fixture.entities.ambiguousQuotedId).priority, 'normal');
  } finally { actionDatabase.close(); }

  const draftThread = await (await post({ action: 'create' })).json();
  const draftResponse = await post({ action: 'send', threadId: draftThread.id, expectedRevision: draftThread.revision, requestId: randomUUID(), text: 'draft-roundtrip', context: { kind: 'content', id: fixture.entities.contentId } });
  const draftStream = await draftResponse.text();
  assert.match(draftStream, /待确认的行动草稿/u);
  assert.equal(fixture.stats.draftToolCalls, 1);
  assert.equal(fixture.stats.draftRoundTrips, 1, 'Provider receives the committed structured Tool result');
  let draftDetail = await detail(draftThread.id);
  const artifact = draftDetail.messages[1].actionDrafts[0];
  assert.equal(artifact.lifecycle, 'pending');
  assert.equal(artifact.title, 'HTTP Draft');
  assert.equal(artifact.priority, 'high');
  assert.equal(artifact.project.id, fixture.entities.projectId);
  assert.equal(artifact.linkedContent[0].id, fixture.entities.contentId);
  const providerCallsBeforeConfirm = fixture.stats.started;
  assert.equal((await post({ action: 'confirm_action_draft', threadId: draftThread.id, messageId: draftDetail.messages[1].id, actionId: artifact.actionId, expectedRevision: artifact.revision, status: 'active' })).status, 400, 'command schema rejects model-style status injection');
  const confirmResponse = await post({ action: 'confirm_action_draft', threadId: draftThread.id, messageId: draftDetail.messages[1].id, actionId: artifact.actionId, expectedRevision: artifact.revision });
  assert.equal(confirmResponse.status, 200, await confirmResponse.clone().text());
  assert.equal(fixture.stats.started, providerCallsBeforeConfirm, 'confirmation never asks the model');
  draftDetail = await detail(draftThread.id);
  assert.equal(draftDetail.messages[1].actionDrafts[0].lifecycle, 'confirmed');
  assert.equal((await post({ action: 'confirm_action_draft', threadId: draftThread.id, messageId: draftDetail.messages[1].id, actionId: artifact.actionId, expectedRevision: artifact.revision + 1 })).status, 409, 'duplicate confirmation has no second side effect');

  const rejectThread = await (await post({ action: 'create' })).json();
  const rejectResponse = await post({ action: 'send', threadId: rejectThread.id, expectedRevision: rejectThread.revision, requestId: randomUUID(), text: 'draft-roundtrip reject', context: { kind: 'content', id: fixture.entities.contentId } });
  await rejectResponse.text();
  let rejectDetail = await detail(rejectThread.id);
  const rejectArtifact = rejectDetail.messages[1].actionDrafts[0];
  const providerCallsBeforeReject = fixture.stats.started;
  assert.equal((await post({ action: 'reject_action_draft', threadId: rejectThread.id, messageId: rejectDetail.messages[1].id, actionId: rejectArtifact.actionId, expectedRevision: rejectArtifact.revision })).status, 200);
  assert.equal(fixture.stats.started, providerCallsBeforeReject, 'rejection never asks the model');
  rejectDetail = await detail(rejectThread.id);
  assert.equal(rejectDetail.messages[1].actionDrafts[0].lifecycle, 'rejected');
  assert.equal((await post({ action: 'reject_action_draft', threadId: rejectThread.id, messageId: rejectDetail.messages[1].id, actionId: rejectArtifact.actionId, expectedRevision: rejectArtifact.revision + 1 })).status, 409);

  fixture.stats.mode = 'after-draft-error';
  const partialThread = await (await post({ action: 'create' })).json();
  const partialResponse = await post({ action: 'send', threadId: partialThread.id, expectedRevision: partialThread.revision, requestId: randomUUID(), text: '请创建任务 draft-roundtrip', context: { kind: 'content', id: fixture.entities.contentId } });
  await partialResponse.text();
  const partialDetail = await detail(partialThread.id);
  assert.equal(partialDetail.messages[1].status, 'failed');
  assert.equal(partialDetail.messages[1].actionDrafts[0].lifecycle, 'pending', 'committed Draft remains visible after provider failure');
  assert.equal(partialDetail.messages[1].sources[0].id, fixture.entities.contentId, 'Host provenance survives the failed text response');

  fixture.stats.mode = 'error';
  const failed = await post({ ...input, expectedRevision: stopped.thread.revision, requestId: randomUUID(), text: 'failure' });
  const safeStream = await failed.text();
  assert.doesNotMatch(safeStream, /fixture-only-key|mock-provider-secret-body|Authorization/u);
  assert.match(safeStream, /ai_generation_failed/u);
  const failedDetail = await detail(thread.id);
  assert.equal(failedDetail.messages.at(-1).status, 'failed');
  const db = new DatabaseSync(`${fixture.directory}/app.sqlite`, { readOnly: true });
  try {
    const records = ['ai_threads', 'ai_messages', 'ai_runs'].flatMap(table => db.prepare(`SELECT * FROM ${table}`).all());
    assert.doesNotMatch(JSON.stringify(records), /fixture-only-key|mock-provider-secret-body|Authorization/u);
  } finally { db.close(); }
  console.log('AI HTTP gate passed: auth/origin, official incremental stream, persistence, CAS/dedup, actual upstream cancel and safe provider errors.');
  }
} finally { await fixture.close(); }
