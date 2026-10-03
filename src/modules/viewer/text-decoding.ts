export type DecodedText = { text: string; encoding: "utf-8" | "utf-16le" | "utf-16be" | "gb18030" };

export function decodeViewerText(bytes: ArrayBuffer): DecodedText {
  const view = new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(view.slice(2)), encoding: "utf-16le" };
  if (view[0] === 0xfe && view[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(view.slice(2)), encoding: "utf-16be" };
  const withoutBom = view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf ? view.slice(3) : view;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(withoutBom), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("gb18030").decode(view), encoding: "gb18030" };
  }
}
