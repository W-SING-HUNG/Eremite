import iconv from "iconv-lite";

export const maximumEditableTextBytes = 5 * 1024 * 1024;

export type EditableTextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "gb18030";
export type TextBom = "none" | "utf8" | "utf16le" | "utf16be";
export type TextNewline = "lf" | "crlf" | "cr" | "mixed";

export type DecodedEditableText = {
  text: string;
  encoding: EditableTextEncoding;
  bom: TextBom;
  newline: TextNewline;
  dominantNewline: Exclude<TextNewline, "mixed">;
  trailingNewline: boolean;
  mixedNewlines: boolean;
};

export class TextEditingError extends Error {
  constructor(public readonly code: "unsupported_encoding" | "unrepresentable_text" | "too_large" | "not_editable") {
    super(code);
    this.name = "TextEditingError";
  }
}

export function decodeEditableText(input: Uint8Array): DecodedEditableText {
  if (input.byteLength > maximumEditableTextBytes) throw new TextEditingError("too_large");
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let encoding: EditableTextEncoding;
  let bom: TextBom;
  let body: Buffer;
  let text: string;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    encoding = "utf-8"; bom = "utf8"; body = bytes.subarray(3); text = decodeFatal(body, "utf-8");
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    encoding = "utf-16le"; bom = "utf16le"; body = bytes.subarray(2); text = decodeFatal(body, "utf-16le");
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    encoding = "utf-16be"; bom = "utf16be"; body = bytes.subarray(2); text = decodeFatal(body, "utf-16be");
  } else {
    body = bytes;
    try {
      text = decodeFatal(body, "utf-8");
      encoding = "utf-8";
      bom = "none";
    } catch {
      text = iconv.decode(body, "gb18030");
      if (!iconv.encode(text, "gb18030").equals(body)) throw new TextEditingError("unsupported_encoding");
      encoding = "gb18030";
      bom = "none";
    }
  }
  const newline = analyzeNewlines(text);
  return { text, encoding, bom, ...newline };
}

export function encodeEditedText(text: string, base: DecodedEditableText, convertToUtf8: boolean) {
  const encoding: EditableTextEncoding = convertToUtf8 ? "utf-8" : base.encoding;
  const bom: TextBom = convertToUtf8 ? "none" : base.bom;
  const normalized = normalizeNewlines(text, base.dominantNewline);
  let bytes = iconv.encode(normalized, encoding === "utf-16be" ? "utf16-be" : encoding);
  if (iconv.decode(bytes, encoding === "utf-16be" ? "utf16-be" : encoding) !== normalized) {
    throw new TextEditingError("unrepresentable_text");
  }
  const prefix = bom === "utf8" ? Buffer.from([0xef, 0xbb, 0xbf])
    : bom === "utf16le" ? Buffer.from([0xff, 0xfe])
      : bom === "utf16be" ? Buffer.from([0xfe, 0xff])
        : Buffer.alloc(0);
  bytes = Buffer.concat([prefix, bytes]);
  const resultNewline = analyzeNewlines(normalized);
  return {
    bytes,
    metadata: {
      encoding,
      bom,
      newline: resultNewline.newline,
      trailingNewline: resultNewline.trailingNewline,
    },
  };
}

function decodeFatal(bytes: Buffer, encoding: "utf-8" | "utf-16le" | "utf-16be") {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function analyzeNewlines(text: string) {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const withoutCrlf = text.replace(/\r\n/g, "");
  const lf = withoutCrlf.match(/\n/g)?.length ?? 0;
  const cr = withoutCrlf.match(/\r/g)?.length ?? 0;
  const counts = [{ kind: "crlf" as const, count: crlf }, { kind: "lf" as const, count: lf }, { kind: "cr" as const, count: cr }];
  const present = counts.filter((entry) => entry.count > 0);
  const dominantNewline = counts.sort((a, b) => b.count - a.count || ["crlf", "lf", "cr"].indexOf(a.kind) - ["crlf", "lf", "cr"].indexOf(b.kind))[0]?.kind ?? "lf";
  const newline: TextNewline = present.length > 1 ? "mixed" : present[0]?.kind ?? "lf";
  return {
    newline,
    dominantNewline,
    mixedNewlines: newline === "mixed",
    trailingNewline: /(?:\r\n|\n|\r)$/u.test(text),
  };
}

function normalizeNewlines(text: string, style: Exclude<TextNewline, "mixed">) {
  const lf = text.replace(/\r\n|\r/g, "\n");
  return style === "crlf" ? lf.replace(/\n/g, "\r\n") : style === "cr" ? lf.replace(/\n/g, "\r") : lf;
}
