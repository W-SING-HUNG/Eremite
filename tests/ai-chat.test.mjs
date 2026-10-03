import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { DefaultChatTransport, readUIMessageStream } from 'ai';
import { z } from 'zod';
import { createAIRuntime } from '@/modules/ai/runtime';
import { createAITaskRunner, defineAITask } from '@/modules/ai/tasks';

const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined } };
function fakeRuntime(parts, observe = () => {}) {
  return createAIRuntime({ id: 'fake', modelId: 'fake', languageModel: new MockLanguageModelV4({
    doStream: async request => {
      observe(request);
      return { stream: new ReadableStream({ async start(controller) {
        for (const part of parts) {
          if (request.abortSignal?.aborted) { controller.error(request.abortSignal.reason); return; }
          if (typeof part === 'number') { await new Promise(resolve => setTimeout(resolve, part)); continue; }
          controller.enqueue(part);
        }
        controller.close();
      } }) };
    },
  }) });
}
const start = [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }];
const finish = [{ type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop' }, usage }];
async function decode(response) {
  const snapshots = []; let activities = [];
  const transport = new DefaultChatTransport({ fetch: async () => response });
  const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: 'thread', messageId: undefined, messages: [], abortSignal: undefined });
  const errors = [];
  for await (const message of readUIMessageStream({ stream, onError: error => errors.push(error.message) })) {
    snapshots.push(message.parts.filter(part => part.type === 'text').map(part => part.text).join(''));
    activities = message.parts.filter(part => part.type === 'data-activity').map(part => part.data);
  }
  return { snapshots, errors, activities };
}
const toolNames = ['search_content', 'get_content', 'get_project', 'list_project_actions'];
const fakeTools = [...toolNames.map(name => ({ access: 'read', definition: { name, description: `Read-only ${name}`, inputSchema: z.object({}).passthrough() }, async execute() { return { data: {}, sources: [] }; } })), { access: 'draft-write', definition: { name: 'create_action_draft', description: 'Create Draft', inputSchema: z.object({}).strict() }, async execute() { return { data: { status: 'draft' }, sources: [] }; } }, { access: 'update-proposal', definition: { name: 'propose_action_update', description: 'Propose update', inputSchema: z.object({}).strict() }, async execute() { return { data: { lifecycle: 'pending' }, sources: [] }; } }, { access: 'tool-run-proposal', definition: { name: 'propose_tool_run', description: 'Propose Native Tool Run', inputSchema: z.object({}).strict() }, async execute() { return { data: { lifecycle: 'pending' }, sources: [] }; } }];
const request = overrides => ({ messageId: 'assistant-stable', runId: 'run-stable', threadId: 'thread-stable', messages: [{ role: 'user', content: 'hello' }], context: { target: { kind: 'global' }, prompt: 'global', sources: [] }, tools: fakeTools, abortSignal: new AbortController().signal, onCheckpoint() {}, onComplete() {}, ...overrides });

test('stream uses official SDK UI protocol, stable ID, incremental text and safe usage only', async () => {
  let completion; const checkpoints = []; let signal;
  const runtime = fakeRuntime([...start, { type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: 'hidden-do-not-retain' }, { type: 'reasoning-end', id: 'r' }, { type: 'text-delta', id: 't', delta: 'first' }, 25, { type: 'text-delta', id: 't', delta: ' second' }, ...finish], value => { signal = value.abortSignal; });
  const response = runtime.streamChat(request({ onCheckpoint: text => checkpoints.push(text), onComplete: value => { completion = value; } }));
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
  const decoded = await decode(response);
  assert.ok(decoded.snapshots.includes('first'));
  assert.equal(decoded.snapshots.at(-1), 'first second');
  assert.deepEqual(completion, { content: 'first second', status: 'completed', inputTokens: 3, outputTokens: 2, sources: [], activities: [] });
  assert.ok(checkpoints.includes('first'));
  assert.ok(signal instanceof AbortSignal);
  assert.equal(JSON.stringify(decoded).includes('hidden-do-not-retain'), false);
});

test('Stop actually aborts provider signal and keeps received text; timeout has safe code', async () => {
  for (const timeout of [false, true]) {
    const controller = new AbortController(); let observedSignal; let completion;
    const runtime = fakeRuntime([...start, { type: 'text-delta', id: 't', delta: 'partial' }, 60, { type: 'text-delta', id: 't', delta: 'must-not-arrive' }, ...finish], value => { observedSignal = value.abortSignal; });
    const response = runtime.streamChat(request({ abortSignal: controller.signal, timeoutMs: timeout ? 25 : 1000, onCheckpoint() { if (!timeout) controller.abort(); }, onComplete: value => { completion = value; } }));
    const decoded = await decode(response);
    assert.equal(observedSignal.aborted, true);
    assert.equal(completion.content, 'partial');
    assert.equal(completion.errorCode, timeout ? 'ai_timeout' : 'ai_cancelled');
    assert.equal(completion.status, timeout ? 'failed' : 'cancelled');
    assert.deepEqual(decoded.errors, [completion.errorCode]);
    assert.equal(JSON.stringify(decoded).includes('must-not-arrive'), false);
  }
});

test('raw provider failure never reaches UI or persisted completion', async () => {
  let completion;
  const runtime = fakeRuntime([{ type: 'error', error: new Error('Authorization Bearer test-secret raw provider response') }]);
  const decoded = await decode(runtime.streamChat(request({ onComplete: value => { completion = value; } })));
  assert.equal(completion.status, 'failed');
  assert.deepEqual(decoded.errors, ['ai_generation_failed']);
  assert.doesNotMatch(JSON.stringify([completion, decoded]), /test-secret|Authorization|raw provider/u);
});

test('tool loop executes only the Host allowlist and stops after five model steps', async () => {
  let calls = 0; let completion;
  const toolStreams = Array.from({ length: 5 }, (_, index) => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'stream-start', warnings: [] });
    controller.enqueue({ type: 'tool-call', toolCallId: `call-${index}`, toolName: 'search_content', input: '{"query":"bounded"}' });
    controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls' }, usage });
    controller.close();
  } }) }));
  const model = new MockLanguageModelV4({ doStream: toolStreams });
  const runtime = createAIRuntime({ id: 'fake', modelId: 'fake', languageModel: model });
  const tools = fakeTools.map(adapter => adapter.definition.name === 'search_content' ? { ...adapter, async execute() { calls++; return { data: [{ id: 'content' }], sources: [{ module: 'inbox', entity: 'content', id: 'content', revision: 2, label: 'Bounded source', href: '/inbox?selected=content' }] }; } } : adapter);
  const decoded = await decode(runtime.streamChat(request({ tools, onComplete: value => { completion = value; } })));
  assert.equal(model.doStreamCalls.length, 5);
  assert.equal(calls, 5);
  assert.equal(completion.status, 'completed');
  assert.equal(completion.errorCode, 'ai_step_limit');
  assert.equal(completion.sources.length, 1, 'repeated reads are deduplicated by stable provenance');
  assert.ok(decoded.activities.some(activity => activity.kind === 'search' && activity.state === 'started'));
  assert.ok(decoded.activities.some(activity => activity.kind === 'search' && activity.state === 'succeeded'));
  assert.match(decoded.snapshots.at(-1), /读取上限/u);
});

test('failed Host Tool reports failure and sends only a safe error to the model', async () => {
  let completion;
  const toolCall = { type: 'tool-call', toolCallId: 'draft-failure', toolName: 'create_action_draft', input: '{}' };
  const model = new MockLanguageModelV4({ doStream: [
    { stream: new ReadableStream({ start(controller) { for (const part of [...start, toolCall, { type: 'finish', finishReason: { unified: 'tool-calls' }, usage }]) controller.enqueue(part); controller.close(); } }) },
    { stream: new ReadableStream({ start(controller) { for (const part of [...start, { type: 'text-delta', id: 't', delta: '草稿未创建。' }, ...finish]) controller.enqueue(part); controller.close(); } }) },
  ] });
  const runtime = createAIRuntime({ id: 'fake', modelId: 'fake', languageModel: model });
  const tools = fakeTools.map(adapter => adapter.definition.name === 'create_action_draft'
    ? { ...adapter, async execute() { throw new Error('Authorization Bearer test-secret raw storage error'); } }
    : adapter);
  const decoded = await decode(runtime.streamChat(request({ tools, onComplete: result => { completion = result; } })));
  assert.ok(decoded.activities.some(activity => activity.kind === 'draft' && activity.state === 'started'));
  assert.ok(decoded.activities.some(activity => activity.kind === 'draft' && activity.state === 'failed' && activity.code === 'ai_tool_execution_failed'));
  assert.equal(decoded.activities.some(activity => activity.kind === 'draft' && activity.state === 'succeeded'), false);
  assert.equal(completion.errorCode, 'ai_tool_call_invalid', 'completed model text cannot hide an uncommitted Draft');
  assert.ok(model.doStreamCalls.length >= 2);
  assert.match(JSON.stringify(model.doStreamCalls[1]), /ai_tool_execution_failed/u);
  assert.doesNotMatch(JSON.stringify([decoded, model.doStreamCalls[1]]), /test-secret|Authorization|raw storage error/u);
});

test('invalid model Tool arguments fail before Host execution', async () => {
  let executed = false;
  const model = new MockLanguageModelV4({ doStream: [
    { stream: new ReadableStream({ start(controller) {
      for (const part of [...start, { type: 'tool-call', toolCallId: 'invalid-draft', toolName: 'create_action_draft', input: '{"unexpected":true}' }, { type: 'finish', finishReason: { unified: 'tool-calls' }, usage }]) controller.enqueue(part);
      controller.close();
    } }) },
    { stream: new ReadableStream({ start(controller) { for (const part of [...start, { type: 'text-delta', id: 't', delta: '未创建。' }, ...finish]) controller.enqueue(part); controller.close(); } }) },
  ] });
  const runtime = createAIRuntime({ id: 'fake', modelId: 'fake', languageModel: model });
  const tools = fakeTools.map(adapter => adapter.definition.name === 'create_action_draft'
    ? { ...adapter, async execute() { executed = true; return { data: { status: 'draft' }, sources: [] }; } }
    : adapter);
  const decoded = await decode(runtime.streamChat(request({ tools })));
  assert.equal(executed, false);
  assert.ok(decoded.activities.some(activity => activity.kind === 'draft' && activity.state === 'failed' && activity.code === 'ai_tool_invalid_arguments'));
  assert.equal(decoded.activities.some(activity => activity.kind === 'draft' && activity.state === 'succeeded'), false);
});

test('structured Action disambiguation ends the model loop without a retry', async () => {
  let completion;
  let executions = 0;
  const model = new MockLanguageModelV4({ doStream: [
    { stream: new ReadableStream({ start(controller) {
      for (const part of [...start, { type: 'tool-call', toolCallId: 'ambiguous-action', toolName: 'propose_action_update', input: '{}' }, { type: 'finish', finishReason: { unified: 'tool-calls' }, usage }]) controller.enqueue(part);
      controller.close();
    } }) },
    { stream: new ReadableStream({ start(controller) { for (const part of [...start, { type: 'text-delta', id: 't', delta: '已更新任务。' }, ...finish]) controller.enqueue(part); controller.close(); } }) },
  ] });
  const runtime = createAIRuntime({ id: 'fake', modelId: 'fake', languageModel: model });
  const tools = fakeTools.map(adapter => adapter.definition.name === 'propose_action_update'
    ? { ...adapter, async execute() { executions++; return { data: { kind: 'needs_disambiguation', disambiguationId: 'synthetic-outcome' }, sources: [] }; } }
    : adapter);
  const decoded = await decode(runtime.streamChat(request({ tools, onComplete: result => { completion = result; } })));
  assert.ok(decoded.activities.some(activity => activity.kind === 'update' && activity.state === 'needs_input'));
  assert.equal(decoded.activities.some(activity => activity.kind === 'update' && activity.state === 'succeeded'), false);
  assert.equal(executions, 1);
  assert.equal(model.doStreamCalls.length, 1, 'provider never receives a second model step after ambiguity');
  assert.equal(completion.status, 'completed');
  assert.match(completion.content, /请选择要修改的任务/u);
  assert.doesNotMatch(completion.content, /已更新任务/u);
  assert.match(decoded.snapshots.at(-1), /选定后只会创建待应用的修改提案/u);
});

test('Phase 0 runner passes cancellation through context and runtime', async () => {
  const abort = new AbortController(); let observed;
  const task = defineAITask({ id: 'test.abort', kind: 'text', contextBuilder: { id: 'host', async build(_, options) { assert.equal(options.abortSignal, abort.signal); return { items: [] }; } }, createRequest: () => ({ prompt: 'hello' }) });
  await createAITaskRunner({ async generateText(value) { observed = value.abortSignal; return { kind: 'text', text: 'ok', finishReason: 'stop' }; } }).run(task, {}, { abortSignal: abort.signal });
  abort.abort(); assert.equal(observed.aborted, true);
  await assert.rejects(() => createAITaskRunner({}).run(task, {}, { abortSignal: abort.signal }), { name: 'AbortError' });
});

test('AI owned persistence: migration, atomic append, CAS, duplicate prevention, safe completion, rollback and recovery', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'eremite-ai-chat-test-'));
  process.env.EREMITE_DATA_DIR = directory;
  const database = await import('@/platform/db/database');
  const store = await import('@/modules/ai/chat-store');
  try {
    const thread = store.createAIThread();
    assert.equal(thread.revision, 1);
    const input = { threadId: thread.id, expectedRevision: 1, requestId: randomUUID(), text: 'Persistent question', model: 'fixture-model', deadlineAt: new Date(Date.now() + 100000).toISOString() };
    const identity = store.beginAIRun(input);
    assert.equal(store.getAIThread(thread.id).messages.length, 2);
    assert.throws(() => store.beginAIRun({ ...input, requestId: randomUUID() }), { code: 'ai_run_active' });
    assert.throws(() => store.beginAIRun(input), { code: 'ai_duplicate_request' });
    store.checkpointAIMessage(identity.runId, 'Partial');
    store.finishAIRun({ runId: identity.runId, status: 'completed', content: 'Persistent answer', inputTokens: 7, outputTokens: 3, sources: [{ module: 'projects', entity: 'project', id: 'project-source', revision: 4, label: 'Project source', href: '/projects/project-source' }], activities: [
      { kind: 'search', state: 'started' }, { kind: 'search', state: 'succeeded', rawInput: 'secret', rawOutput: 'C:\\private\\file', prompt: 'secret' },
      { kind: 'content', state: 'failed', code: 'raw sqlite error /secret/path', stack: 'secret' }, { kind: 'update', state: 'needs_input' },
    ] });
    assert.equal(store.finishAIRun({ runId: identity.runId, status: 'failed' }), false);
    let detail = store.getAIThread(thread.id);
    assert.equal(detail.thread.revision, 3);
    assert.deepEqual(detail.messages.map(message => message.content), ['Persistent question', 'Persistent answer']);
    assert.deepEqual(detail.messages[1].sources, [{ module: 'projects', entity: 'project', id: 'project-source', revision: 4, label: 'Project source', href: '/projects/project-source' }]);
    assert.deepEqual(detail.messages[1].activities, [
      { kind: 'search', state: 'succeeded' }, { kind: 'content', state: 'failed', code: 'ai_tool_execution_failed' }, { kind: 'update', state: 'needs_input' },
    ]);
    assert.equal(detail.messages[0].activities.length, 0, 'user message never receives assistant activity');
    assert.equal(store.getAIThread(thread.id, detail.messages[1].ordinal).messages[0].activities.length, 0, 'pagination does not shift activity to another message');
    assert.equal(store.getAIThread(thread.id).messages[1].activities.length, 3, 'reload retains terminal order');
    assert.equal(database.one('SELECT count(*) AS count FROM ai_message_activities WHERE run_id = ?', identity.runId).count, 3, 'idempotent completion inserts no duplicate');
    const activityRows = database.all('SELECT * FROM ai_message_activities');
    assert.deepEqual(Object.keys(activityRows[0]), ['id', 'message_id', 'run_id', 'ordinal', 'kind', 'state', 'code', 'created_at']);
    assert.doesNotMatch(JSON.stringify(activityRows), /secret|private|rawInput|rawOutput|prompt|stack|sqlite/u);
    const cancelled = store.beginAIRun({ ...input, expectedRevision: 3, requestId: randomUUID() });
    store.finishAIRun({ runId: cancelled.runId, status: 'cancelled', errorCode: 'ai_cancelled', activities: [{ kind: 'project', state: 'succeeded' }, { kind: 'actions', state: 'started' }] });
    assert.deepEqual(store.getAIThread(thread.id).messages.at(-1).activities, [{ kind: 'project', state: 'succeeded' }]);
    const failed = store.beginAIRun({ ...input, expectedRevision: 5, requestId: randomUUID() });
    database.db().exec("CREATE TRIGGER ai_activity_failure BEFORE INSERT ON ai_message_activities BEGIN SELECT RAISE(ABORT, 'injected activity failure'); END;");
    assert.throws(() => store.finishAIRun({ runId: failed.runId, status: 'failed', activities: [{ kind: 'draft', state: 'succeeded' }] }));
    assert.equal(store.getAIRunIdentity(thread.id, failed.runId).status, 'running', 'activity and run completion share one transaction');
    database.db().exec('DROP TRIGGER ai_activity_failure');
    store.finishAIRun({ runId: failed.runId, status: 'failed', errorCode: 'ai_generation_failed', activities: [{ kind: 'draft', state: 'succeeded' }, { kind: 'tool-run', state: 'failed', code: 'ai_tool_run_unavailable' }] });
    assert.deepEqual(store.getAIThread(thread.id).messages.at(-1).activities, [{ kind: 'draft', state: 'succeeded' }, { kind: 'tool-run', state: 'failed', code: 'ai_tool_run_unavailable' }]);
    assert.throws(() => store.beginAIRun({ ...input, requestId: randomUUID() }), { code: 'ai_revision_conflict' });
    const failedThread = store.createAIThread();
    database.db().exec("CREATE TRIGGER ai_test_failure BEFORE INSERT ON ai_runs BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    assert.throws(() => store.beginAIRun({ ...input, threadId: failedThread.id, requestId: randomUUID() }));
    database.db().exec('DROP TRIGGER ai_test_failure');
    assert.equal(store.getAIThread(failedThread.id).messages.length, 0);
    assert.equal(store.getAIThread(failedThread.id).thread.revision, 1);
    const interrupted = store.beginAIRun({ ...input, expectedRevision: 7, requestId: randomUUID(), deadlineAt: '2000-01-01T00:00:00.000Z' });
    store.checkpointAIMessage(interrupted.runId, 'Durable checkpoint');
    detail = store.getAIThread(thread.id);
    assert.equal(detail.messages.at(-1).content, 'Durable checkpoint');
    assert.equal(detail.messages.at(-1).error_code, 'ai_interrupted');
    assert.equal(detail.messages.at(-1).status, 'failed');
    assert.equal(store.listAIThreads().length, 2);
    const boundedThread = store.createAIThread();
    const boundedRun = store.beginAIRun({ ...input, threadId: boundedThread.id, requestId: randomUUID() });
    store.finishAIRun({ runId: boundedRun.runId, status: 'completed', activities: Array.from({ length: 40 }, () => ({ kind: 'search', state: 'succeeded' })) });
    assert.equal(store.getAIThread(boundedThread.id).messages[1].activities.length, 32, 'activity history has a fixed per-run bound');
    assert.equal(database.db().prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(database.db().prepare('PRAGMA foreign_key_check').all(), []);
    const columns = database.db().prepare('PRAGMA table_info(ai_runs)').all().map(value => value.name);
    assert.doesNotMatch(columns.join(','), /key|header|raw|reasoning|body/u);
    assert.ok(columns.includes('input_tokens'));
  } finally { database.db().close(); await rm(directory, { recursive: true, force: true }); }
});

test('HTTP and client boundaries remain authenticated, bounded, allowlisted and protocol-native', async () => {
  const route = await readFile('src/app/api/ai/route.ts', 'utf8');
  assert.match(route, /isAuthorized/u); assert.match(route, /invalid_origin/u);
  assert.match(route, /size > 48_000/u); assert.match(route, /\.strict\(\)/u);
  assert.doesNotMatch(route, /from ['"]ai['"]|modules\/ai\/(provider|runtime)/u);
  const client = await readFile('src/modules/ai/chat-client.ts', 'utf8');
  assert.match(client, /DefaultChatTransport/u); assert.match(client, /readUIMessageStream/u);
  assert.doesNotMatch(client, /process\.env|\.\/service|\.\/provider|\.\/config/u);
});
