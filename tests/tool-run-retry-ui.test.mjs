import assert from "node:assert/strict";
import { File } from "node:buffer";
import { randomUUID, scryptSync, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { tmpdir } from "node:os";
import { writePdfFixture } from "./pdf-tools-fixture.mjs";

// Supplemental real production-page regression. No mocked React, server action or Supplier.
// Requires a production build, external qpdf and an installed Playwright/browser runtime.
const directory = await mkdtemp(path.join(tmpdir(), "eremite-retry-ui-"));
process.env.EREMITE_DATA_DIR = directory;
const database = await import("@/platform/db/database");
const inbox = await import("@/modules/inbox/service");
const projects = await import("@/modules/projects/service");
const folders = await import("@/modules/projects/folders");
const service = await import("@/modules/automations/service");
const { serverToolRegistry } = await import("@/modules/automations/registry");
const sharp = (await import("sharp")).default;
const projectName = "Retry UI QA", projectId = projects.createProject({ name: projectName });
const chains = {};
for (const schema of [1, 2]) {
  chains[schema] = [];
  for (let n = 0; n < 320; n++) chains[schema].push(folders.createFolder({ projectId, parentId: chains[schema].at(-1) ?? null,
    name: schema === 1 ? `d${n}` : String(n).padStart(4, "0") + "x".repeat(251) }));
}
const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#376f99" } }).png().toBuffer();
const pdfPath = path.join(directory, "input.pdf");
await writePdfFixture(pdfPath, [{ width: 200, height: 300, label: "Retry UI A" }, { width: 300, height: 400, label: "Retry UI B" }]);
const pdf = await readFile(pdfPath), cases = [], sources = [];
async function makeFailed(tool, raw, scopeProject, schema) {
  const execute = tool.executeExternal, encode = tool.encodeInputPayload;
  tool.executeExternal = async () => { throw new Error("injected transient failure before Supplier invocation"); };
  if (schema === 1) tool.encodeInputPayload = input => {
    const value = encode(input), d = value.retryEvidence.destination;
    return { ...value, retryEvidence: { schemaVersion: 1, sources: value.retryEvidence.sources, destination: {
      projectId: d.projectId, folderId: d.folderId, projectName: d.projectName,
      folders: d.folderId ? folders.getFolderBreadcrumbs(d.folderId).map(f => ({ id: f.id, name: f.name, parentId: f.parent_id, projectId: f.project_id })) : [],
    }, policy: value.retryEvidence.policy } };
  };
  try {
    const result = await service.executeExternalTool({ operationId: randomUUID(), toolId: tool.toolId, rawInput: raw, projectId: scopeProject });
    assert.equal(result.status, "failed");
    return service.getAutomationRun(result.runId);
  } finally { tool.executeExternal = execute; tool.encodeInputPayload = encode; }
}
for (const toolId of ["core.file-converter", "core.pdf-tools"]) for (const schema of [1, 2]) for (const kind of ["unassigned", "root", "deep"]) {
  const scopeProject = kind === "unassigned" ? null : projectId, folderId = kind === "deep" ? chains[schema].at(-1) : null;
  const bytes = toolId === "core.file-converter" ? png : pdf, name = toolId === "core.file-converter" ? "retry-ui.png" : "retry-ui.pdf";
  const contentId = await inbox.createFileContentItemFromStream({ body: new File([bytes], name).stream(), originalName: name,
    mimeType: toolId === "core.file-converter" ? "image/png" : "application/pdf", projectId: scopeProject });
  sources.push({ contentId, asset: inbox.getFileAssetForViewing(contentId) });
  const raw = toolId === "core.file-converter" ? { contentItemId: contentId, conversionId: "png-to-jpeg", folderId }
    : { operation: "pdf.extract", contentItemIds: [contentId], pageSelector: "2,1", folderId };
  const parent = await makeFailed(serverToolRegistry[toolId], raw, scopeProject, schema);
  assert.ok(parent.input_payload_json.length <= 65_536);
  assert.equal(service.getAutomationRetryEligibility(parent.id).allowed, true);
  const expectedLocation = kind === "unassigned" ? "未归入专案" : schema === 1
    ? [projectName, ...(kind === "deep" ? folders.getFolderBreadcrumbs(folderId).map(f => f.name) : [])].join(" / ")
    : kind === "root" ? `${projectName} / 专案根目录` : `${projectName} · 文件夹：${folders.getFolder(folderId).name}（完整路径未记录）`;
  cases.push({ toolId, schema, kind, parent, folderId, expectedLocation, allowed: true });
}
for (const toolId of ["core.file-converter", "core.pdf-tools"]) for (const schema of [1, 2]) {
  const folderId = folders.createFolder({ projectId, name: `Original ${toolId} ${schema}` });
  const source = sources.find(s => inbox.getContentItemSummary(s.contentId).project_id === projectId && s.asset.originalName.endsWith(toolId === "core.file-converter" ? ".png" : ".pdf"));
  const raw = toolId === "core.file-converter" ? { contentItemId: source.contentId, conversionId: "png-to-jpeg", folderId }
    : { operation: "pdf.extract", contentItemIds: [source.contentId], pageSelector: "2,1", folderId };
  const parent = await makeFailed(serverToolRegistry[toolId], raw, projectId, schema);
  folders.renameFolder({ id: folderId, name: `Changed ${toolId} ${schema}`, expectedRevision: folders.getFolder(folderId).revision });
  assert.equal(service.getAutomationRetryEligibility(parent.id).allowed, false);
  await assert.rejects(service.retryExternalTool(parent.id), error => error.code === "retry_stale_destination");
  cases.push({ toolId, schema, kind: "stale", parent, folderId, allowed: false });
}
const password = "retry-ui-qa-only", salt = "retry-ui-synthetic", sessionId = randomUUID(), stamp = new Date().toISOString();
database.run("INSERT INTO app_settings (key,value,updated_at) VALUES ('auth.password',?,?)", `${salt}:${scryptSync(password,salt,64).toString("hex")}`, stamp);
database.run("INSERT INTO sessions (id,expires_at,created_at) VALUES (?,?,?)", sessionId, new Date(Date.now()+3_600_000).toISOString(), stamp);
database.db().close();
const listener = createServer();await new Promise(resolve => listener.listen(0,"127.0.0.1",resolve));const port = listener.address().port;await new Promise(resolve => listener.close(resolve));
const baseURL = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/run-next.mjs", "start", "-H", "127.0.0.1", "-p", String(port)], { env: { ...process.env, NODE_ENV: "production" }, windowsHide: true, stdio: ["ignore","pipe","pipe"] });
let output = "";server.stdout.on("data",b=>output+=b);server.stderr.on("data",b=>output+=b);
let browser;
const results = [];
const connection = () => new DatabaseSync(path.join(directory,"app.sqlite"), { readOnly: true });
const readRun = id => { const db=connection();try{return db.prepare("SELECT * FROM automation_runs WHERE id=?").get(id);}finally{db.close();} };
async function auditChild(c) {
  const db=connection();try {
    assert.deepEqual({ ...db.prepare("SELECT * FROM automation_runs WHERE id=?").get(c.parent.id) }, c.parent, "parent history remains immutable");
    const children=db.prepare("SELECT * FROM automation_runs WHERE retry_of_run_id=?").all(c.parent.id);
    assert.equal(children.length,c.allowed?1:0);
    if(!c.allowed)return null;
    const child=children[0];assert.equal(child.status,"completed",JSON.stringify(child));assert.equal(child.input_payload_json,c.parent.input_payload_json);
    const value=JSON.parse(child.output_payload_json), outputs=value.outputs??[value];
    for(const item of outputs){assert.equal(db.prepare("SELECT folder_id FROM content_items WHERE id=?").get(item.contentId).folder_id,c.folderId);const blob=db.prepare("SELECT b.* FROM file_blobs b JOIN file_versions v ON v.blob_id=b.id WHERE v.id=?").get(item.versionId);assert.equal(createHash("sha256").update(await readFile(path.join(directory,"files",blob.storage_key))).digest("hex"),item.sha256);}
    assert.equal(db.prepare("SELECT state FROM file_write_operations WHERE idempotency_key=?").get(`automation:${child.id}:output:0`).state,"committed");
    return child.id;
  }finally{db.close();}
}
async function close() {
  await browser?.close();
  if(server.exitCode===null){const exited=new Promise(resolve=>server.once("exit",resolve));if(process.platform==="win32"){const killer=spawn("taskkill",["/PID",String(server.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});await new Promise(resolve=>killer.once("exit",resolve));}else server.kill();await exited;}
  await writeFile(path.join(directory,"server.log"),output);
  if(process.env.EREMITE_UI_EVIDENCE_PATH)await writeFile(process.env.EREMITE_UI_EVIDENCE_PATH,JSON.stringify({ gate:"real production page, server action and Sharp/qpdf",baseURL,cases:results,sourceCount:sources.length,serverStopped:server.exitCode!==null },null,2)+"\n");
  await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:100});
}
try {
  let ready=false;for(let n=0;n<150;n++){if(server.exitCode!==null)throw new Error(output);if((await fetch(`${baseURL}/login`).catch(()=>null))?.ok){ready=true;break;}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,output);
  if(process.argv.includes("--serve")){
    assert.ok(process.env.EREMITE_UI_READY_PATH);
    await writeFile(process.env.EREMITE_UI_READY_PATH,JSON.stringify({baseURL,password,sessionId,directory,cases:cases.map(c=>({toolId:c.toolId,schema:c.schema,kind:c.kind,runId:c.parent.id,expectedLocation:c.expectedLocation,allowed:c.allowed}))},null,2)+"\n");
    console.log(`MANUAL FIXTURE READY ${baseURL}`);
    await new Promise(resolve=>{process.once("SIGINT",resolve);process.once("SIGTERM",resolve);});
    for(const c of cases){const db=connection();const children=db.prepare("SELECT id FROM automation_runs WHERE retry_of_run_id=?").all(c.parent.id);db.close();if(children.length){const childId=await auditChild(c);results.push({toolId:c.toolId,schema:c.schema,kind:c.kind,childId,status:"completed",verifiedReceipt:true});}else if(!c.allowed){await auditChild(c);results.push({toolId:c.toolId,schema:c.schema,kind:c.kind,status:"denied"});}}
  }else{
    const require=createRequire(import.meta.url),{chromium}=require(process.env.EREMITE_PLAYWRIGHT_MODULE||"playwright");
    browser=await chromium.launch({headless:true,...(process.env.EREMITE_BROWSER_EXECUTABLE?{executablePath:process.env.EREMITE_BROWSER_EXECUTABLE}:{channel:"chrome"})});
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.addCookies([{name:"eremite_session",value:sessionId,url:baseURL,httpOnly:true,sameSite:"Lax"}]);
    const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
    for(const c of cases){
      await page.goto(`${baseURL}/automations?view=runs&selected=${c.parent.id}`);
      const trigger=page.getByRole("button",{name:"重试",exact:true});
      await page.getByRole("heading",{name:"运行信息",exact:true}).waitFor();
      if(!c.allowed){assert.equal(await trigger.count(),0);assert.ok((await page.textContent("body")).includes("原输出位置已变化或不可用"));await auditChild(c);results.push({toolId:c.toolId,schema:c.schema,kind:c.kind,status:"denied"});continue;}
      await trigger.waitFor({state:"visible"});
      await page.evaluate(()=>{window.retryClicks=[];document.addEventListener("click",event=>{const b=event.target.closest("button");if(b)window.retryClicks.push({text:b.textContent,trusted:event.isTrusted});},true);});
      await trigger.click();const dialog=page.getByRole("alertdialog",{name:"按原输入重试？"});await dialog.waitFor();
      const display=await dialog.locator(".run-facts dd").allTextContents();assert.equal(display[2],c.expectedLocation);
      await dialog.getByRole("button",{name:"确认重试",exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[role="alertdialog"]'),null,{timeout:30_000});
      let childId;for(let n=0;n<100;n++){const db=connection();const child=db.prepare("SELECT id,status FROM automation_runs WHERE retry_of_run_id=?").get(c.parent.id);db.close();if(child?.status==="completed"){childId=child.id;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(childId,output);
      assert.equal(await auditChild(c),childId);
      const clicks=await page.evaluate(()=>window.retryClicks);assert.ok(clicks.some(e=>e.text==="重试"&&e.trusted));assert.ok(clicks.some(e=>e.text==="确认重试"&&e.trusted));
      results.push({toolId:c.toolId,schema:c.schema,kind:c.kind,location:display[2],childId,status:"completed",trustedClicks:true,verifiedReceipt:true});
      console.log(`UI RETRY PASS ${c.toolId}/v${c.schema}/${c.kind}`);
    }
    assert.deepEqual(errors,[]);
    const db=connection();try{assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);for(const s of sources){const v=db.prepare("SELECT v.*,a.current_version_id,b.sha256,b.storage_key FROM file_versions v JOIN file_assets a ON a.id=v.asset_id JOIN file_blobs b ON b.id=v.blob_id WHERE v.id=?").get(s.asset.versionId);assert.equal(v.current_version_id,s.asset.versionId);assert.equal(v.blob_id,s.asset.blobId);assert.equal(v.sha256,s.asset.sha256);assert.equal(createHash("sha256").update(await readFile(path.join(directory,"files",v.storage_key))).digest("hex"),s.asset.sha256);}}finally{db.close();}
    console.log(`Retry production UI PASS: 12 actual FC/PDF v1/v2 unassigned/root/deep engine retries, 4 stale denials, exact confirmations/history/receipts; browser ${browser.version()}`);
  }
}finally{await close();}
