import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(), 'eremite-ai-content-snapshot-'));
process.env.EREMITE_DATA_DIR = directory;
let database;
try {
  database = await import('@/platform/db/database');
  const inbox = await import('@/modules/inbox/service');
  const upload = async (text, versionId) => {
    const bytes = Buffer.from(text);
    const body = new File([bytes], 'notes.md', { type: 'text/markdown' }).stream();
    return versionId
      ? inbox.replaceFileContentItemFromStream({ contentId, expectedVersionId: versionId, idempotencyKey: randomUUID(), body, originalName: 'notes.md', mimeType: 'text/markdown', expectedSize: bytes.length })
      : inbox.createFileContentItemFromStream({ body, originalName: 'notes.md', mimeType: 'text/markdown', expectedSize: bytes.length });
  };
  const contentId = await upload('# Version A\nObserved text A.\n');
  const first = await inbox.getContentForAI(contentId);
  assert.match(first.text, /Observed text A/u);
  assert.equal(first.fileVersionId, inbox.getFileAssetForViewing(contentId).versionId);

  await upload('# Version B\nObserved text B.\n', first.fileVersionId);
  const second = await inbox.getContentForAI(contentId);
  assert.notEqual(second.fileVersionId, first.fileVersionId);
  assert.equal(second.revision, first.revision, 'file replacement does not advance Content revision');
  assert.match(second.text, /Observed text B/u);
  assert.doesNotMatch(second.text, /Observed text A/u);

  // Structural contract for the async gap: the text reader receives the same
  // version chosen before its await, and no post-read current-version lookup
  // can silently upgrade the observation to a replacement file.
  const source = await readFile(new URL('../src/modules/inbox/service.ts', import.meta.url), 'utf8');
  const body = source.split('export async function getContentForAI(id: string) {')[1]?.split('/** Inbox-owned write contract')[0];
  assert.ok(body, 'AI read contract is present');
  assert.match(body, /const observedAsset = item\.kind === 'file' \? getFileAssetForViewing\(id\) : null/u);
  assert.match(body, /await getEditableText\(id, observedAsset\.versionId\)/u);
  assert.match(body, /const fileVersionId = observedAsset\?\.versionId/u);
  assert.doesNotMatch(body.slice(body.indexOf('await getEditableText')), /getFileAssetForViewing\(id\)/u);
  assert.equal(database.one('PRAGMA integrity_check').integrity_check, 'ok');
  console.log('AI Content snapshot gate passed: editable text and observation share one pinned file version across the async read.');
} finally {
  database?.db().close();
  await rm(directory, { recursive: true, force: true });
}
