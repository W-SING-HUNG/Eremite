import assert from "node:assert/strict";
import { classifyDocxFailure, classifyPdfFailure } from "@/modules/viewer/failure-classification";

assert.equal(classifyPdfFailure(Object.assign(new Error("Password required"), { name: "PasswordException" })), "corrupted");
assert.equal(classifyPdfFailure(new TypeError("Failed to fetch")), "load_failed");
assert.equal(classifyDocxFailure(new Error("Corrupted zip: missing central directory")), "corrupted");
assert.equal(classifyDocxFailure(new TypeError("Failed to fetch")), "load_failed");

console.log("Viewer renderer failure classification test passed.");
