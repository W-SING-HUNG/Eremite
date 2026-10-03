import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { decodeEditableText, encodeEditedText, TextEditingError } from "@/modules/inbox/text-editing";

const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("甲\r\n乙\r\n")]);
const decodedUtf8 = decodeEditableText(utf8Bom);
assert.deepEqual({ encoding: decodedUtf8.encoding, bom: decodedUtf8.bom, newline: decodedUtf8.newline, trailing: decodedUtf8.trailingNewline }, { encoding: "utf-8", bom: "utf8", newline: "crlf", trailing: true });
assert.deepEqual(encodeEditedText(decodedUtf8.text, decodedUtf8, false).bytes, utf8Bom);

const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode("甲\r乙", "utf16-le")]);
const decodedUtf16 = decodeEditableText(utf16le);
assert.equal(decodedUtf16.encoding, "utf-16le");
assert.equal(decodedUtf16.newline, "cr");
assert.deepEqual(encodeEditedText(decodedUtf16.text, decodedUtf16, false).bytes, utf16le);

const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode("甲\n乙", "utf16-be")]);
const decodedUtf16be = decodeEditableText(utf16be);
assert.equal(decodedUtf16be.encoding, "utf-16be");
assert.deepEqual(encodeEditedText(decodedUtf16be.text, decodedUtf16be, false).bytes, utf16be);

const gb = iconv.encode("中文\r\n文本", "gb18030");
const decodedGb = decodeEditableText(gb);
assert.equal(decodedGb.encoding, "gb18030");
assert.deepEqual(encodeEditedText(decodedGb.text, decodedGb, false).bytes, gb);
assert.match(iconv.decode(encodeEditedText(`${decodedGb.text}🙂`, decodedGb, false).bytes, "gb18030"), /🙂$/);
assert.equal(encodeEditedText(`${decodedGb.text}🙂`, decodedGb, true).metadata.encoding, "utf-8");

const mixed = decodeEditableText(Buffer.from("a\r\nb\nc\r"));
assert.equal(mixed.newline, "mixed");
assert.equal(mixed.mixedNewlines, true);
assert.match(encodeEditedText(mixed.text, mixed, false).bytes.toString(), /^a\r\nb\r\nc\r\n$/);

const empty = decodeEditableText(Buffer.alloc(0));
assert.equal(encodeEditedText("", empty, false).bytes.length, 0);
console.log("Text editing test passed: UTF BOMs, GB18030, newline fidelity, empty saves and explicit UTF-8 conversion.");
