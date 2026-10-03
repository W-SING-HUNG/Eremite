import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import { File } from 'node:buffer';

/** Disposable application + real HTTP OpenAI-compatible test double. */
export async function startAIChatFixture({ port = 0, dev = false, configured = true, nativeTool = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'eremite-ai-http-'));
  process.env.EREMITE_DATA_DIR = directory;
  const database = await import('@/platform/db/database');
  const password = 'isolated-ask-qa-password';
  const salt = 'temporary-qa-salt';
  const sessionId = randomUUID();
  const entities = { projectId: randomUUID(), contentId: randomUUID(), actionId: randomUUID(), ambiguousQuotedId: randomUUID(), ambiguousPlainId: randomUUID() };
  const connection = database.db();
  connection.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)').run('auth.password', `${salt}:${scryptSync(password, salt, 64).toString('hex')}`, new Date().toISOString());
  connection.prepare('INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)').run(sessionId, new Date(Date.now() + 3_600_000).toISOString(), new Date().toISOString());
  const stamp = new Date().toISOString();
  connection.prepare('INSERT INTO projects (id, name, name_key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(entities.projectId, 'Fixture Tool Project', 'fixture tool project', 'Project available to read-only AI tools', stamp, stamp);
  connection.prepare("INSERT INTO content_items (id, kind, title, source_url, tags, status, project_id, created_at, updated_at) VALUES (?, 'link', ?, ?, '', 'inbox', ?, ?, ?)").run(entities.contentId, 'Fixture Tool Content', 'https://example.com/fixture-tool', entities.projectId, stamp, stamp);
  connection.prepare("INSERT INTO actions (id, title, status, priority, project_id, created_at, updated_at) VALUES (?, ?, 'active', 'high', ?, ?, ?)").run(entities.actionId, 'Fixture Tool Action', entities.projectId, stamp, stamp);
  connection.prepare("INSERT INTO actions (id, title, status, priority, project_id, created_at, updated_at) VALUES (?, ?, 'active', 'normal', ?, ?, ?)").run(entities.ambiguousQuotedId, '“Fixture Ambiguous Action”', entities.projectId, stamp, stamp);
  connection.prepare("INSERT INTO actions (id, title, status, priority, project_id, created_at, updated_at) VALUES (?, ?, 'active', 'normal', ?, ?, ?)").run(entities.ambiguousPlainId, 'Fixture Ambiguous Action', entities.projectId, stamp, stamp);
  if (nativeTool) {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#346ba8' } }).png().toBuffer();
    const inbox = await import('@/modules/inbox/service');
    entities.nativeFileId = await inbox.createFileContentItemFromStream({ body: new File([png], 'browser-source.png', { type: 'image/png' }).stream(), originalName: 'browser-source.png', mimeType: 'image/png', expectedSize: png.length });
  }
  connection.close();
  const stats = { started: 0, cancelled: 0, completed: 0, toolCalls: 0, draftToolCalls: 0, draftRoundTrips: 0, updateToolCalls: 0, mode: 'normal' };
  const provider = createServer(async (request, response) => {
    if (request.url === '/mode') {
      let body = ''; for await (const chunk of request) body += chunk;
      stats.mode = body; response.end('ok'); return;
    }
    let bytes = ''; for await (const chunk of request) bytes += chunk;
    const parsed = JSON.parse(bytes);
    stats.started++;
    if (parsed.stream !== true) {
      const tool = parsed.tool_choice !== undefined;
      const structured = parsed.response_format !== undefined;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'mock-capability', object: 'chat.completion', created: 1, model: parsed.model, choices: [{ index: 0,
        message: tool
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-probe', type: 'function', function: { name: 'probe_location', arguments: '{"location":"Paris"}' } }] }
          : { role: 'assistant', content: structured ? '{"status":"ok"}' : 'ready' },
        finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    const toolResults = parsed.messages.filter(message => message.role === 'tool').length;
    if (stats.mode === 'error' || (stats.mode === 'after-draft-error' && toolResults > 0)) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'mock-provider-secret-body Authorization fixture-only-key' } })); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const latestUser = [...parsed.messages].reverse().find(message => message.role === 'user');
    const question = typeof latestUser?.content === 'string' ? latestUser.content : JSON.stringify(latestUser?.content ?? '');
    const systemText = parsed.messages.filter(message => message.role === 'system').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
    const contentContext = /Current Eremite Content:\s*\n(\{[^\n]+\})/u.exec(systemText)?.[1];
    const projectContext = /Current Eremite Project:\s*\n(\{[^\n]+\})/u.exec(systemText)?.[1];
    const contextData = JSON.parse(contentContext ?? projectContext ?? 'null');
    const wantsDraft = question.includes('draft-roundtrip');
    if (nativeTool && question.includes('native-tool-roundtrip') && toolResults < 2) {
      const name = toolResults === 0 ? 'get_content' : 'propose_tool_run';
      const argumentsJson = toolResults === 0 ? JSON.stringify({ id: entities.nativeFileId }) : JSON.stringify({ kind: 'file_converter', contentItemId: entities.nativeFileId, conversionId: 'png-to-jpeg' });
      response.write(`data: ${JSON.stringify({ id: 'mock-native-proposal', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call-native-${toolResults}`, type: 'function', function: { name, arguments: argumentsJson } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'mock-native-proposal', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      stats.completed++; response.end(); return;
    }
    if (question.includes('ambiguity-roundtrip') && toolResults === 0) {
      stats.updateToolCalls++;
      response.write(`data: ${JSON.stringify({ id: 'mock-update-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-ambiguous-update', type: 'function', function: { name: 'propose_action_update', arguments: JSON.stringify({ targetName: 'Fixture Ambiguous Action', priority: 'high' }) } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'mock-update-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      stats.completed++; response.end(); return;
    }
    const wantsReadFirst = question.includes('read-then-draft');
    if (wantsDraft && wantsReadFirst && toolResults < 1 && contextData?.id) {
      stats.toolCalls++;
      response.write(`data: ${JSON.stringify({ id: 'mock-read-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-read-before-draft', type: 'function', function: { name: 'get_content', arguments: JSON.stringify({ id: contextData.id }) } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'mock-read-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      stats.completed++; response.end(); return;
    }
    const draftToolResultOffset = wantsReadFirst ? 1 : 0;
    if (wantsDraft && toolResults < draftToolResultOffset + 1) {
      stats.draftToolCalls++;
      const draftInput = { title: question.includes('browser') ? 'Browser Draft' : 'HTTP Draft', priority: question.includes('normal') ? 'normal' : 'high', ...(contentContext && contextData?.id ? { contentItemIds: [contextData.id] } : {}), ...(projectContext && contextData?.id ? { projectId: contextData.id } : {}) };
      response.write(`data: ${JSON.stringify({ id: 'mock-draft-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-draft', type: 'function', function: { name: 'create_action_draft', arguments: JSON.stringify(draftInput) } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'mock-draft-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      stats.completed++; response.end(); return;
    }
    if (wantsDraft && toolResults >= draftToolResultOffset + 1) stats.draftRoundTrips++;
    if (question.includes('tool-roundtrip') && toolResults < 4) {
      const calls = [
        ['search_content', { query: 'Fixture Tool Content', limit: 5 }],
        ['get_content', { id: entities.contentId }],
        ['get_project', { id: entities.projectId }],
        ['list_project_actions', { projectId: entities.projectId, limit: 10 }],
      ];
      const [name, input] = calls[toolResults]; stats.toolCalls++;
      response.write(`data: ${JSON.stringify({ id: 'mock-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call-${toolResults}`, type: 'function', function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'mock-tool', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      stats.completed++; response.end(); return;
    }
    const words = question.includes('stop-probe') ? Array(500).fill('继续生成 ') : ['这是', '隔离', '测试', '的', '逐步', '回答。', '历史', '已保存。'];
    if (question.includes('tool-roundtrip')) words.splice(0, words.length, '四个工具已完成真实往返。');
    if (question.includes('draft-roundtrip')) words.splice(0, words.length, '我已经生成一个待确认的行动草稿，请在卡片中确认或拒绝。');
    if (question.includes('native-tool-roundtrip')) words.splice(0, words.length, '我准备了待确认的文件操作提案。');
    let index = 0; let finished = false;
    const timer = setInterval(() => {
      if (index < words.length) {
        response.write(`data: ${JSON.stringify({ id: 'mock-stream', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { content: words[index++] }, finish_reason: null }] })}\n\n`);
      } else {
        finished = true; stats.completed++;
        response.write(`data: ${JSON.stringify({ id: 'mock-stream', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 8, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`);
        response.end(); clearInterval(timer);
      }
    }, 150);
    response.on('close', () => { clearInterval(timer); if (!finished) stats.cancelled++; });
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerURL = `http://127.0.0.1:${provider.address().port}`;
  if (!port) {
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
  }
  const baseURL = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/run-next.mjs', dev ? 'dev' : 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, EREMITE_DATA_DIR: directory, EREMITE_AI_BASE_URL: configured ? providerURL : '', EREMITE_AI_API_KEY: configured ? 'fixture-only-key' : '', EREMITE_AI_MODEL: configured ? 'mock-model' : '' },
  });
  // Keep server diagnostics in memory; never record provider payloads.
  const output = []; server.stdout.on('data', data => output.push(String(data))); server.stderr.on('data', data => output.push(String(data)));
  let stopped = false;
  async function close() {
    if (stopped) return; stopped = true;
    if (process.platform === 'win32' && server.pid) {
      const killer = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise(resolve => killer.on('exit', resolve));
    } else server.kill();
    provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error('fixture_server_exit');
      const response = await fetch(`${baseURL}/login`).catch(() => null);
      if (response?.ok) return { directory, baseURL, providerURL, sessionId, password, stats, entities, output, close };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('fixture_server_timeout');
  } catch (error) { await close(); throw error; }
}
