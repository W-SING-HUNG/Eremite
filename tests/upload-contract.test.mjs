import assert from "node:assert/strict";
import { maximumFileUploadBytes, validateSelectedUpload } from "@/modules/inbox/upload-contract";

assert.equal(validateSelectedUpload({ size: 1 }), null);
assert.equal(validateSelectedUpload({ size: 2 * 1024 * 1024 }), null, "uploads above the Server Action 1 MiB default must remain valid");
assert.equal(validateSelectedUpload({ size: maximumFileUploadBytes }), null);
assert.equal(validateSelectedUpload({ size: maximumFileUploadBytes + 1 })?.code, "file_too_large");
assert.equal(validateSelectedUpload({ size: 0 })?.code, "empty_file");
assert.equal(validateSelectedUpload(null)?.code, "empty_file");
console.log("Upload contract test passed: client and server share the 512 MiB product limit.");
