const endOfCentralDirectorySignature = 0x06054b50;
const minimumEndRecordSize = 22;
const maximumCommentSize = 0xffff;

export type ZipDirectoryInfo = {
  entryCount: number;
  isMultiDisk: boolean;
  isZip64: boolean;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
};

export type ZipCentralDirectoryEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
};

export function inspectZipDirectory(bytes: ArrayBuffer): ZipDirectoryInfo | null {
  if (bytes.byteLength < minimumEndRecordSize) return null;
  const view = new DataView(bytes);
  const firstCandidate = Math.max(0, bytes.byteLength - minimumEndRecordSize - maximumCommentSize);

  for (let offset = bytes.byteLength - minimumEndRecordSize; offset >= firstCandidate; offset -= 1) {
    if (view.getUint32(offset, true) !== endOfCentralDirectorySignature) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + minimumEndRecordSize + commentLength !== bytes.byteLength) continue;

    const diskNumber = view.getUint16(offset + 4, true);
    const centralDirectoryDisk = view.getUint16(offset + 6, true);
    const entriesOnDisk = view.getUint16(offset + 8, true);
    const entryCount = view.getUint16(offset + 10, true);
    const centralDirectorySize = view.getUint32(offset + 12, true);
    const centralDirectoryOffset = view.getUint32(offset + 16, true);
    return {
      entryCount,
      isMultiDisk: diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount,
      isZip64: entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff,
      centralDirectoryOffset,
      centralDirectorySize,
    };
  }

  return null;
}

export function parseZipCentralDirectory(bytes: ArrayBuffer, expectedEntryCount: number): ZipCentralDirectoryEntry[] | null {
  const view = new DataView(bytes);
  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = 0;

  while (entries.length < expectedEntryCount) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) return null;
    const flags = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (nameLength === 0 || entryEnd > bytes.byteLength || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) return null;

    const nameBytes = new Uint8Array(bytes, offset + 46, nameLength);
    const name = decodeZipName(nameBytes, Boolean(flags & 0x0800));
    if (!name) return null;
    entries.push({ name: name.replaceAll("\\", "/"), compressedSize, uncompressedSize });
    offset = entryEnd;
  }

  return entries;
}

export function isUnsafeArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  return normalized.startsWith("/")
    || /^[a-z]:\//i.test(normalized)
    || normalized.split("/").some((segment) => segment === "..");
}

function decodeZipName(bytes: Uint8Array, isUtf8: boolean) {
  try {
    return new TextDecoder(isUtf8 ? "utf-8" : "gb18030", { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return null; }
  }
}
