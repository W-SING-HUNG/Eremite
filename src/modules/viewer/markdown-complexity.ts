export const maximumMarkdownCharacters = 250_000;
export const maximumMarkdownLines = 12_000;

export function isMarkdownTooComplex(source: string) {
  if (source.length > maximumMarkdownCharacters) return true;
  let lines = 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10 && ++lines > maximumMarkdownLines) return true;
  }
  return false;
}
