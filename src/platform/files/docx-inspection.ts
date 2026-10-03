import { open, readFile } from "node:fs/promises";
import JSZip from "jszip";
import { inspectZipDirectory, parseZipCentralDirectory } from "@/platform/files/zip-inspection";

const maximumTailSize = 65_557;

export type DocxContainerInspection = "docx" | "zip" | "corrupted" | "too_complex";

export type DocxInspectionLimits = Readonly<{
  maximumCentralDirectorySize: number;
  maximumEntries: number;
  maximumMetadataPartSize: number;
}>;

export async function inspectDocxContainer(absolutePath: string, size: number, limits: DocxInspectionLimits): Promise<DocxContainerInspection> {
  const file = await open(absolutePath, "r");
  try {
    const tailSize = Math.min(size, maximumTailSize);
    const tail = Buffer.alloc(tailSize);
    await file.read(tail, 0, tail.length, size - tailSize);
    const directory = inspectZipDirectory(asArrayBuffer(tail));
    if (!directory || directory.isMultiDisk || directory.isZip64) return "corrupted";
    if (directory.entryCount > limits.maximumEntries || directory.centralDirectorySize > limits.maximumCentralDirectorySize) return "too_complex";
    if (directory.centralDirectoryOffset + directory.centralDirectorySize > size) return "corrupted";

    const central = Buffer.alloc(directory.centralDirectorySize);
    await file.read(central, 0, central.length, directory.centralDirectoryOffset);
    const entries = parseZipCentralDirectory(asArrayBuffer(central), directory.entryCount);
    if (!entries) return "corrupted";
    const required = new Set(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    if (![...required].every((name) => entries.some((entry) => entry.name === name))) return "zip";
    if (entries.some((entry) => required.has(entry.name) && entry.uncompressedSize > limits.maximumMetadataPartSize)) return "too_complex";
  } finally {
    await file.close();
  }

  try {
    const archive = await JSZip.loadAsync(await readFile(absolutePath), { checkCRC32: false, createFolders: false });
    const contentTypes = await archive.file("[Content_Types].xml")?.async("string");
    const rootRelationships = await archive.file("_rels/.rels")?.async("string");
    if (!contentTypes || !rootRelationships) return "corrupted";
    const hasMainDocumentType = /PartName=["']\/word\/document\.xml["'][^>]*ContentType=["']application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml["']/i.test(contentTypes)
      || /ContentType=["']application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml["'][^>]*PartName=["']\/word\/document\.xml["']/i.test(contentTypes);
    const hasOfficeDocumentRelationship = /Type=["'][^"']*\/officeDocument["'][^>]*Target=["']\/?word\/document\.xml["']/i.test(rootRelationships)
      || /Target=["']\/?word\/document\.xml["'][^>]*Type=["'][^"']*\/officeDocument["']/i.test(rootRelationships);
    return hasMainDocumentType && hasOfficeDocumentRelationship ? "docx" : "zip";
  } catch {
    return "corrupted";
  }
}

const asArrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
