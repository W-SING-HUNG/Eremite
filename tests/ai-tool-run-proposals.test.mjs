import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { File } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const directory = await mkdtemp(path.join(tmpdir(), 'eremite-ai-tool-run-'));
process.env.EREMITE_DATA_DIR = directory;
let database;
try {
  database = await import('@/platform/db/database');
  const inbox = await import('@/modules/inbox/service');
  const projects = await import('@/modules/projects/service');
  const folders = await import('@/modules/projects/folders');
  const ai = await import('@/modules/ai/chat-store');
  const automations = await import('@/modules/automations/service');
  const host = await import('@/app/_services/ask-eremite-tool-runs');
  const { createAskEremiteHost } = await import('@/app/_services/ask-eremite-host');
  const drafts = await import('@/app/_services/ask-eremite-action-drafts');
  const { toolCatalog } = await import('@/modules/automations/tools/catalog');

  assert.deepEqual(host.AI_NATIVE_TOOL_ALLOWLIST, ['core.file-converter', 'core.pdf-tools']);
  assert.ok(toolCatalog.some(tool => tool.id === 'core.content-to-action-drafts'));
  assert.equal(host.AI_NATIVE_TOOL_ALLOWLIST.includes('core.content-to-action-drafts'), false);
  assert.equal(host.proposeToolRunInputSchema.safeParse({ kind: 'file_converter', contentItemId: randomUUID(), conversionId: 'png-to-jpeg', toolId: 'core.content-to-action-drafts' }).success, false);
  assert.equal(host.proposeToolRunInputSchema.safeParse({ kind: 'pdf_tools', operation: 'pdf.extract', contentItemIds: [randomUUID()], pageSelector: '0', destination: '/' }).success, false);

  const projectId = projects.createProject({ name: 'AI Native Tool 验收' });
  const folderId = folders.createFolder({ projectId, name: '来源' });
  const anotherFolder = folders.createFolder({ projectId, name: '其他' });
  const png = await sharp({ create: { width: 6, height: 5, channels: 3, background: '#2468aa' } }).png().toBuffer();
  async function upload(name) { return inbox.createFileContentItemFromStream({ body: new File([png], name, { type: 'image/png' }).stream(), originalName: name, mimeType: 'image/png', expectedSize: png.length, projectId, folderId }); }
  const sourceId = await upload('source.png');
  const original = inbox.getFileAssetForViewing(sourceId);
  function begin(id = sourceId, observed = true) {
    const thread = ai.createAIThread();
    const identity = ai.beginAIRun({ threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text: '把这个文件转换为 JPEG', model: 'test', deadlineAt: new Date(Date.now() + 60000).toISOString() });
    const context = { identity: { threadId: thread.id, messageId: identity.assistantId, runId: identity.runId }, currentContext: { kind: 'global' }, observedSources: observed ? [{ module: 'inbox', entity: 'content', id, revision: inbox.getContentItemSummary(id).revision, fileVersionId: inbox.getFileAssetForViewing(id).versionId, label: 'source', href: '/inbox' }] : [], userRequest: '把这个文件转换为 JPEG', abortSignal: new AbortController().signal };
    return { thread, identity, context, finish: () => ai.finishAIRun({ runId: identity.runId, status: 'completed' }) };
  }
  const input = id => ({ kind: 'file_converter', contentItemId: id, conversionId: 'png-to-jpeg' });
  const key = (run, proposal) => ({ threadId: run.thread.id, messageId: run.identity.assistantId, proposalId: proposal.id });
  const countRuns = () => database.one('SELECT count(*) AS count FROM automation_runs').count;
  const countContent = () => database.one('SELECT count(*) AS count FROM content_items').count;
  const countProposals = () => database.one('SELECT count(*) AS count FROM ai_tool_run_proposals').count;
  const readContent = createAskEremiteHost().tools.find(tool => tool.definition.name === 'get_content');
  const proposalAdapter = createAskEremiteHost().tools.find(tool => tool.definition.name === 'propose_tool_run');
  assert.throws(() => host.assertAskToolAvailable(false), { code: 'ai_tool_run_unavailable' });
  assert.throws(() => host.assertAskToolAvailable(false, true), { code: 'ai_tool_run_stale_tool' });
  const currentContent = await createAskEremiteHost().resolveContext({ kind: 'content', id: sourceId });
  assert.equal(currentContent.sources[0].revision, inbox.getContentItemSummary(sourceId).revision);
  assert.equal(currentContent.sources[0].fileVersionId, original.versionId, 'current Host context carries a real file-version observation');

  const unseen = begin(sourceId, false);
  await assert.rejects(host.proposeAskEremiteToolRun(input(sourceId), unseen.context), { code: 'ai_tool_run_unobserved_source' });
  await assert.rejects(proposalAdapter.execute(input(sourceId), unseen.context), { code: 'ai_tool_host_rejected', diagnosticCode: 'ai_tool_run_unobserved_source', message: 'ai_tool_host_rejected' }, 'Provider receives only a neutral classification');
  const contextOnly = begin(sourceId, false);
  contextOnly.context.currentContext = { kind: 'content', id: sourceId };
  await assert.rejects(host.proposeAskEremiteToolRun(input(sourceId), contextOnly.context), { code: 'ai_tool_run_unobserved_source' }, 'current Content ID alone is not observation evidence');
  const missingRevision = begin(sourceId, false);
  missingRevision.context.observedSources = [{ module: 'inbox', entity: 'content', id: sourceId, fileVersionId: original.versionId, label: 'source', href: '/inbox' }];
  await assert.rejects(host.proposeAskEremiteToolRun(input(sourceId), missingRevision.context), { code: 'ai_tool_run_unobserved_source' }, 'observation must include revision');
  const missingVersion = begin(sourceId, false);
  missingVersion.context.observedSources = [{ module: 'inbox', entity: 'content', id: sourceId, revision: inbox.getContentItemSummary(sourceId).revision, label: 'source', href: '/inbox' }];
  await assert.rejects(host.proposeAskEremiteToolRun(input(sourceId), missingVersion.context), { code: 'ai_tool_run_unobserved_source' }, 'search-only observation lacks a file-version proof');
  await assert.rejects(host.proposeAskEremiteToolRun(input(randomUUID()), begin().context), { code: 'ai_tool_run_unobserved_source' });
  const unavailableId = randomUUID();
  await assert.rejects(host.proposeAskEremiteToolRun(input(unavailableId), { ...begin().context, observedSources: [{ module: 'inbox', entity: 'content', id: unavailableId, revision: 1, fileVersionId: randomUUID() }] }), { code: 'ai_tool_run_source_unavailable' });
  await assert.rejects(host.proposeAskEremiteToolRun({ ...input(sourceId), conversionId: 'png-to-exe' }, begin().context), { code: 'ai_tool_run_unsupported_capability' });
  await assert.rejects(host.proposeAskEremiteToolRun({ ...input(sourceId), profile: 'invalid-profile' }, begin().context), { code: 'ai_tool_run_invalid_parameters' });
  await assert.rejects(host.proposeAskEremiteToolRun({ kind: 'pdf_tools', operation: 'pdf.delete', contentItemIds: [sourceId] }, begin().context), { code: 'ai_tool_run_unsupported_capability' });
  await assert.rejects(host.proposeAskEremiteToolRun({ kind: 'pdf_tools', operation: 'pdf.merge', contentItemIds: [sourceId], pageOrder: '1' }, begin().context), { code: 'ai_tool_run_invalid_parameters' });
  await assert.rejects(host.proposeAskEremiteToolRun(input(sourceId), { ...begin().context, observedSources: [{ module: 'inbox', entity: 'content', id: randomUUID(), revision: 1, fileVersionId: randomUUID() }] }), { code: 'ai_tool_run_unobserved_source' });

  const changedId = await upload('changed-after-read.png');
  const changedRun = begin(changedId, false);
  const read = await readContent.execute({ id: changedId });
  changedRun.context.observedSources = read.sources;
  const observedRevision = read.sources[0].revision;
  assert.equal(read.sources[0].fileVersionId, inbox.getFileAssetForViewing(changedId).versionId);
  inbox.updateContentItem({ id: changedId, title: 'changed after observation', status: 'inbox', expectedRevision: observedRevision });
  assert.equal(inbox.getContentItemSummary(changedId).revision, observedRevision + 1);
  const beforeChanged = { proposals: countProposals(), runs: countRuns(), content: countContent() };
  await assert.rejects(host.proposeAskEremiteToolRun(input(changedId), changedRun.context), { code: 'ai_tool_run_unobserved_source' });
  assert.deepEqual({ proposals: countProposals(), runs: countRuns(), content: countContent() }, beforeChanged, 'old observed revision cannot authorize a new Content state');

  const replacedId = await upload('replaced-after-read.png');
  const replacedRun = begin(replacedId, false);
  const replacedRead = await readContent.execute({ id: replacedId });
  replacedRun.context.observedSources = replacedRead.sources;
  const priorRevision = replacedRead.sources[0].revision;
  const priorVersion = inbox.getFileAssetForViewing(replacedId).versionId;
  const replacement = await sharp({ create: { width: 9, height: 8, channels: 3, background: '#ba5219' } }).png().toBuffer();
  await inbox.replaceFileContentItemFromStream({ contentId: replacedId, expectedVersionId: priorVersion, idempotencyKey: randomUUID(), body: new File([replacement], 'replaced-after-read.png', { type: 'image/png' }).stream(), originalName: 'replaced-after-read.png', mimeType: 'image/png', expectedSize: replacement.length });
  assert.notEqual(inbox.getFileAssetForViewing(replacedId).versionId, priorVersion);
  assert.equal(inbox.getContentItemSummary(replacedId).revision, priorRevision, 'file replacement changes version without changing Content revision');
  const beforeReplaced = { proposals: countProposals(), runs: countRuns(), content: countContent() };
  await assert.rejects(host.proposeAskEremiteToolRun(input(replacedId), replacedRun.context), { code: 'ai_tool_run_unobserved_source' });
  assert.deepEqual({ proposals: countProposals(), runs: countRuns(), content: countContent() }, beforeReplaced, 'old observation cannot authorize a replacement file version');

  const pendingRun = begin();
  const beforeRuns = countRuns(); const beforeContent = countContent();
  const pending = await host.proposeAskEremiteToolRun(input(sourceId), pendingRun.context);
  assert.equal(pending.lifecycle, 'pending');
  assert.equal(pending.destinationLabel.includes('来源'), true);
  assert.equal(countRuns(), beforeRuns, 'proposal creates no Automation Run');
  assert.equal(countContent(), beforeContent, 'proposal creates no output');
  await assert.rejects(host.proposeAskEremiteToolRun(input(sourceId), pendingRun.context), { code: 'ai_tool_run_limit' });
  pendingRun.finish();
  assert.equal(drafts.getAskEremiteThread(pendingRun.thread.id).messages[1].toolRunProposals[0].id, pending.id, 'pending card survives reload');
  host.rejectAskEremiteToolRun(key(pendingRun, pending));
  assert.equal(host.rejectAskEremiteToolRun(key(pendingRun, pending)).lifecycle, 'rejected');
  assert.equal(countRuns(), beforeRuns); assert.equal(countContent(), beforeContent);
  await assert.rejects(host.confirmAskEremiteToolRun(key(pendingRun, pending)), { code: 'ai_tool_run_not_pending' });
  await assert.rejects(host.confirmAskEremiteToolRun({ ...key(pendingRun, pending), threadId: randomUUID() }), { code: 'ai_tool_run_not_found' });
  await assert.rejects(host.confirmAskEremiteToolRun({ ...key(pendingRun, pending), messageId: randomUUID() }), { code: 'ai_tool_run_not_found' });

  const revisionRun = begin(); const revisionProposal = await host.proposeAskEremiteToolRun(input(sourceId), revisionRun.context); revisionRun.finish();
  inbox.updateContentItem({ id: sourceId, title: 'renamed', status: 'inbox', expectedRevision: inbox.getContentItemSummary(sourceId).revision });
  await assert.rejects(host.confirmAskEremiteToolRun(key(revisionRun, revisionProposal)), { code: 'ai_tool_run_stale_source' });
  assert.equal(drafts.getAskEremiteThread(revisionRun.thread.id).messages[1].toolRunProposals[0].lifecycle, 'stale');

  const versionId = await upload('version.png');
  const versionRun = begin(versionId); const versionProposal = await host.proposeAskEremiteToolRun(input(versionId), versionRun.context); versionRun.finish();
  const newer = await sharp({ create: { width: 8, height: 7, channels: 3, background: '#db6d15' } }).png().toBuffer();
  await inbox.replaceFileContentItemFromStream({ contentId: versionId, expectedVersionId: inbox.getFileAssetForViewing(versionId).versionId, idempotencyKey: randomUUID(), body: new File([newer], 'version.png', { type: 'image/png' }).stream(), originalName: 'version.png', mimeType: 'image/png', expectedSize: newer.length });
  await assert.rejects(host.confirmAskEremiteToolRun(key(versionRun, versionProposal)), { code: 'ai_tool_run_stale_source' });

  const movedId = await upload('moved.png');
  const moveRun = begin(movedId); const moveProposal = await host.proposeAskEremiteToolRun(input(movedId), moveRun.context); moveRun.finish();
  inbox.moveContentItems({ ids: [{ id: movedId, expectedRevision: inbox.getContentItemSummary(movedId).revision }], projectId, folderId: anotherFolder });
  await assert.rejects(host.confirmAskEremiteToolRun(key(moveRun, moveProposal)), { code: 'ai_tool_run_stale_source' });

  const destinationRun = begin(); const destinationProposal = await host.proposeAskEremiteToolRun(input(sourceId), destinationRun.context); destinationRun.finish();
  folders.renameFolder({ id: folderId, name: '已改变的目的地', expectedRevision: folders.getFolder(folderId).revision });
  await assert.rejects(host.confirmAskEremiteToolRun(key(destinationRun, destinationProposal)), { code: 'ai_tool_run_stale_tool' });

  const corrupt = Buffer.from('not a PNG image');
  const corruptId = await inbox.createFileContentItemFromStream({ body: new File([corrupt], 'corrupt.png', { type: 'image/png' }).stream(), originalName: 'corrupt.png', mimeType: 'image/png', expectedSize: corrupt.length });
  const failureRun = begin(corruptId); const failureProposal = await host.proposeAskEremiteToolRun(input(corruptId), failureRun.context); failureRun.finish();
  const contentBeforeFailure = countContent();
  await host.confirmAskEremiteToolRun(key(failureRun, failureProposal));
  const failedArtifact = drafts.getAskEremiteThread(failureRun.thread.id).messages[1].toolRunProposals[0];
  assert.equal(failedArtifact.lifecycle, 'accepted');
  assert.equal(failedArtifact.run.status, 'failed');
  assert.equal(failedArtifact.run.outputs.length, 0);
  assert.equal(countContent(), contentBeforeFailure, 'Supplier failure commits no output');

  const runsBeforeAbort = countRuns();
  await assert.rejects(automations.executeExternalTool({ operationId: randomUUID(), toolId: 'core.file-converter', rawInput: { contentItemId: sourceId, conversionId: 'png-to-jpeg' } },
    { onAccepted() { throw new Error('forced_accept_rollback'); } }), /forced_accept_rollback/);
  assert.equal(countRuns(), runsBeforeAbort, 'failed Host acceptance rolls back Run and input snapshot');

  const successRun = begin(); const success = await host.proposeAskEremiteToolRun(input(sourceId), successRun.context); successRun.finish();
  const [first, second] = await Promise.all([host.confirmAskEremiteToolRun(key(successRun, success)), host.confirmAskEremiteToolRun(key(successRun, success))]);
  assert.equal(first.runId, second.runId, 'concurrent confirmation reuses one Run');
  const accepted = drafts.getAskEremiteThread(successRun.thread.id).messages[1].toolRunProposals[0];
  assert.equal(accepted.lifecycle, 'accepted');
  assert.equal(accepted.run.status, 'completed', accepted.run.errorMessage ?? 'no run error');
  assert.equal(accepted.run.outputs.length, 1);
  assert.equal(database.one('SELECT count(*) AS count FROM automation_runs WHERE operation_id = (SELECT operation_id FROM ai_tool_run_proposals WHERE id = ?)', success.id).count, 1);
  assert.equal(inbox.getFileAssetForViewing(sourceId).versionId, original.versionId, 'source version remains unchanged');
  assert.equal(database.one('PRAGMA integrity_check').integrity_check, 'ok');
  assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
  database.db().exec("CREATE TRIGGER ai_tool_run_storage_failure BEFORE INSERT ON ai_tool_run_proposals BEGIN SELECT RAISE(ABORT, 'private sqlite path /secret'); END;");
  const unexpected = begin();
  await assert.rejects(host.proposeAskEremiteToolRun(input(sourceId), unexpected.context), { code: 'ai_tool_run_internal_failure', message: 'ai_tool_run_internal_failure' });
  database.db().exec('DROP TRIGGER ai_tool_run_storage_failure');
  assert.equal(countRuns(), database.one('SELECT count(*) AS count FROM automation_runs').count, 'storage failure creates no Tool Run');
  console.log('AI Tool Run proposal gate passed: observed revision authorization, zero pre-confirm effects, reload, stale, CAS and one real output.');
} finally {
  database?.db().close();
  await rm(directory, { recursive: true, force: true });
}
