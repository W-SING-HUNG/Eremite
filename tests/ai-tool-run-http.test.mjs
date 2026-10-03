import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startAIChatFixture } from './ai-chat-http-fixture.mjs';

const fixture = await startAIChatFixture({ nativeTool: true, dev: process.env.EREMITE_HTTP_TEST_USE_BUILD !== '1' });
const headers = { cookie: `eremite_session=${fixture.sessionId}`, origin: fixture.baseURL, 'Content-Type': 'application/json' };
const post = body => fetch(`${fixture.baseURL}/api/ai`, { method: 'POST', headers, body: JSON.stringify(body) });
const detail = async id => (await fetch(`${fixture.baseURL}/api/ai?threadId=${id}`, { headers })).json();
const connection = new DatabaseSync(`${fixture.directory}/app.sqlite`, { readOnly: true });
try {
  assert.equal((await fetch(`${fixture.baseURL}/api/ai`, { method: 'POST', headers: { ...headers, origin: 'https://invalid.example' }, body: '{"action":"create"}' })).status, 403);
  async function propose() {
    const thread = await (await post({ action: 'create' })).json();
    const response = await post({ action: 'send', threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text: 'native-tool-roundtrip 把 browser-source.png 转换为 JPEG', context: { kind: 'global' } });
    assert.equal(response.status, 200);
    await response.text();
    const saved = await detail(thread.id);
    assert.equal(saved.messages[1].toolRunProposals.length, 1);
    assert.equal(saved.messages[1].toolRunProposals[0].lifecycle, 'pending');
    return { threadId: thread.id, messageId: saved.messages[1].id, proposalId: saved.messages[1].toolRunProposals[0].id };
  }
  const before = connection.prepare('SELECT count(*) AS count FROM automation_runs').get().count;
  const rejected = await propose();
  assert.equal(connection.prepare('SELECT count(*) AS count FROM automation_runs').get().count, before);
  assert.equal((await post({ action: 'reject_tool_run_proposal', ...rejected })).status, 200);
  assert.equal((await post({ action: 'confirm_tool_run_proposal', ...rejected })).status, 409);
  assert.equal(connection.prepare('SELECT count(*) AS count FROM automation_runs').get().count, before);

  const pending = await propose();
  assert.equal((await post({ action: 'confirm_tool_run_proposal', ...pending, conversionId: 'png-to-pdf' })).status, 400, 'browser cannot resubmit Tool parameters');
  const confirmed = await post({ action: 'confirm_tool_run_proposal', ...pending });
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  const receipt = await confirmed.json();
  const replay = await (await post({ action: 'confirm_tool_run_proposal', ...pending })).json();
  assert.equal(replay.runId, receipt.runId);
  const accepted = (await detail(pending.threadId)).messages[1].toolRunProposals[0];
  assert.equal(accepted.lifecycle, 'accepted');
  assert.equal(accepted.run.status, 'completed');
  assert.equal(accepted.run.outputs.length, 1);
  assert.equal(connection.prepare('SELECT count(*) AS count FROM automation_runs WHERE id = ?').get(receipt.runId).count, 1);
  assert.equal(connection.prepare('SELECT count(*) AS count FROM content_items WHERE id = ?').get(accepted.run.outputs[0].contentId).count, 1);
  assert.equal(connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  console.log('AI Tool Run HTTP gate passed: observed read, pending/reject, strict confirm body, real Run, output and replay.');
} finally {
  connection.close();
  await fixture.close();
}
