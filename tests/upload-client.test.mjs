import assert from "node:assert/strict";
import { File as WebFile } from "node:buffer";
import { uploadSelectedFile } from "@/app/_lib/file-upload-client";

const originalFileConstructor = globalThis.File;
globalThis.File = WebFile;

try {
  const chosenFile = new globalThis.File(
    [new Uint8Array(2 * 1024 * 1024)],
    "真实 2 MiB.pdf",
    { type: "application/pdf" },
  );
  const browserFormData = new globalThis.FormData();
  browserFormData.set("file", chosenFile);
  const selectedFile = browserFormData.get("file");
  let capturedRequest;

  const success = await uploadSelectedFile({
    selectedFile,
    title: "  浏览器上传回归  ",
    fetcher: async (input, init) => {
      capturedRequest = { input, init };
      return new Response(JSON.stringify({ ok: true, contentId: "client-upload-regression" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.deepEqual(success, { ok: true, contentId: "client-upload-regression" });
  assert.equal(capturedRequest.input, "/uploads/files");
  assert.equal(capturedRequest.init.method, "POST");
  assert.equal(capturedRequest.init.credentials, "same-origin");
  assert.equal(capturedRequest.init.body, selectedFile);
  assert.equal(capturedRequest.init.headers["Content-Type"], "application/pdf");
  assert.equal(capturedRequest.init.headers["X-Eremite-File-Name"], encodeURIComponent("真实 2 MiB.pdf"));
  assert.equal(capturedRequest.init.headers["X-Eremite-File-Title"], encodeURIComponent("浏览器上传回归"));
  assert.equal(capturedRequest.init.headers["X-Eremite-File-Size"], String(2 * 1024 * 1024));

  let invalidSelectionRequested = false;
  const invalidSelection = await uploadSelectedFile({
    selectedFile: "not-a-file",
    title: "无效选择",
    fetcher: async () => {
      invalidSelectionRequested = true;
      throw new Error("must not request");
    },
  });
  assert.equal(invalidSelection.ok, false);
  assert.equal(invalidSelection.code, "empty_file");
  assert.equal(invalidSelectionRequested, false);

  let interrupted;
  await assert.doesNotReject(async () => {
    interrupted = await uploadSelectedFile({
      selectedFile,
      title: "失败保持 UI 可用",
      fetcher: async () => { throw new TypeError("Failed to fetch"); },
    });
  });
  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.code, "upload_interrupted");
  assert.ok(interrupted.message);

  const malformedResponse = await uploadSelectedFile({
    selectedFile,
    title: "响应解析失败",
    fetcher: async () => new Response("not-json", { status: 502 }),
  });
  assert.equal(malformedResponse.ok, false);
  assert.equal(malformedResponse.code, "invalid_request");
  assert.match(malformedResponse.message, /资料库/);

  console.log("Upload client test passed: a real Web File from FormData reaches /uploads/files and failures remain classified UI state.");
} finally {
  if (originalFileConstructor === undefined) delete globalThis.File;
  else globalThis.File = originalFileConstructor;
}
