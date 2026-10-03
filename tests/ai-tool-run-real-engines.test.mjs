import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { pdfSignatures, writePdfFixture } from './pdf-tools-fixture.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'eremite-ai-tool-real-'));
process.env.EREMITE_DATA_DIR = path.join(root, 'data');
let database;
try {
  database = await import('@/platform/db/database');
  const inbox = await import('@/modules/inbox/service');
  const ai = await import('@/modules/ai/chat-store');
  const host = await import('@/app/_services/ask-eremite-tool-runs');
  const drafts = await import('@/app/_services/ask-eremite-action-drafts');
  const { managedFilePath } = await import('@/platform/files/service');
  const { resolveInstalledPdfTools } = await import('@/modules/automations/tools/pdf-tools/runtime');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ask Eremite Phase 1</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>');
  const docx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  async function upload(bytes, name, mime) { return inbox.createFileContentItemFromStream({ body: new File([bytes], name, { type: mime }).stream(), originalName: name, mimeType: mime, expectedSize: bytes.length }); }
  const docxId = await upload(docx, 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const pdfPathA = path.join(root, 'a.pdf'); const pdfPathB = path.join(root, 'b.pdf');
  await writePdfFixture(pdfPathA, [{ label: 'A', width: 200, height: 300 }, { label: 'B', width: 300, height: 400 }, { label: 'C', width: 400, height: 500 }, { label: 'D', width: 500, height: 600 }, { label: 'E', width: 600, height: 700 }]);
  await writePdfFixture(pdfPathB, [{ label: 'F', width: 700, height: 800 }]);
  const pdfA = await upload(await readFile(pdfPathA), 'a.pdf', 'application/pdf');
  const pdfB = await upload(await readFile(pdfPathB), 'b.pdf', 'application/pdf');
  const qpdf = (await resolveInstalledPdfTools()).qpdfPath;
  async function runProposal(input, ids) {
    const thread = ai.createAIThread();
    const identity = ai.beginAIRun({ threadId: thread.id, expectedRevision: thread.revision, requestId: randomUUID(), text: '执行文件操作', model: 'test', deadlineAt: new Date(Date.now() + 60000).toISOString() });
    const context = { identity: { threadId: thread.id, messageId: identity.assistantId, runId: identity.runId }, currentContext: { kind: 'global' }, observedSources: ids.map(id => ({ module: 'inbox', entity: 'content', id, revision: inbox.getContentItemSummary(id).revision, fileVersionId: inbox.getFileAssetForViewing(id).versionId, label: 'source', href: '/inbox' })), userRequest: '执行文件操作', abortSignal: new AbortController().signal };
    const beforeRuns = database.one('SELECT count(*) AS count FROM automation_runs').count;
    const beforeContent = database.one('SELECT count(*) AS count FROM content_items').count;
    const proposal = await host.proposeAskEremiteToolRun(input, context);
    ai.finishAIRun({ runId: identity.runId, status: 'completed' });
    assert.equal(database.one('SELECT count(*) AS count FROM automation_runs').count, beforeRuns);
    assert.equal(database.one('SELECT count(*) AS count FROM content_items').count, beforeContent);
    const confirmed = await host.confirmAskEremiteToolRun({ threadId: thread.id, messageId: identity.assistantId, proposalId: proposal.id });
    const artifact = drafts.getAskEremiteThread(thread.id).messages[1].toolRunProposals[0];
    assert.equal(artifact.lifecycle, 'accepted'); assert.equal(artifact.run.id, confirmed.runId); assert.equal(artifact.run.status, 'completed');
    return { artifact, run: database.one('SELECT * FROM automation_runs WHERE id = ?', confirmed.runId) };
  }
  const originalDocx = inbox.getFileAssetForViewing(docxId);
  const converted = await runProposal({ kind: 'file_converter', contentItemId: docxId, conversionId: 'docx-to-pdf' }, [docxId]);
  assert.equal(converted.artifact.run.outputs.length, 1);
  assert.equal(inbox.getFileAssetForViewing(converted.artifact.run.outputs[0].contentId).declaredMimeType, 'application/pdf');
  assert.equal(inbox.getFileAssetForViewing(docxId).versionId, originalDocx.versionId);

  const merge = await runProposal({ kind: 'pdf_tools', operation: 'pdf.merge', contentItemIds: [pdfB, pdfA] }, [pdfB, pdfA]);
  assert.deepEqual(merge.artifact.sources.map(source => source.contentId), [pdfB, pdfA]);
  assert.deepEqual(database.all('SELECT content_id FROM automation_run_inputs WHERE run_id = ? ORDER BY ordinal', merge.run.id).map(row => row.content_id), [pdfB, pdfA]);
  assert.equal(merge.artifact.run.outputs.length, 1);
  assert.deepEqual(pdfSignatures(qpdf, managedFilePath(inbox.getFileAssetForViewing(merge.artifact.run.outputs[0].contentId).storageKey)), ['700x800@0', '200x300@0', '300x400@0', '400x500@0', '500x600@0', '600x700@0']);

  const extract = await runProposal({ kind: 'pdf_tools', operation: 'pdf.extract', contentItemIds: [pdfA], pageSelector: '3-5' }, [pdfA]);
  assert.deepEqual(pdfSignatures(qpdf, managedFilePath(inbox.getFileAssetForViewing(extract.artifact.run.outputs[0].contentId).storageKey)), ['400x500@0', '500x600@0', '600x700@0']);
  assert.equal(database.one('PRAGMA integrity_check').integrity_check, 'ok');
  assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
  console.log('AI Tool Run real engines passed: DOCX→PDF, ordered PDF merge, pages 3–5 extract, immutable sources.');
} finally {
  database?.db().close();
  await rm(root, { recursive: true, force: true });
}
