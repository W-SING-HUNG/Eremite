export type ByteRange = { start: number; end: number };

export function parseByteRange(value: string | null, size: number): ByteRange | null | "invalid" | "multiple" {
  if (!value) return null;
  if (/^bytes\s*=\s*[^,]+(?:,[^,]+)+$/i.test(value.trim())) return "multiple";
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return "invalid";
  const [, startText, endText] = match;
  if (!startText && !endText) return "invalid";
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export function contentDisposition(disposition: "inline" | "attachment", filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
