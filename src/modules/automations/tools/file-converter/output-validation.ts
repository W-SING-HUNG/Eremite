import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { inspectDocxContainer, type DocxInspectionLimits } from "@/platform/files/docx-inspection";
import { exceedsImageDimensionLimits, readImageDimensions } from "@/platform/files/image-metadata";
import type { FileConverterSuccess, FormatDescriptor } from "@/modules/automations/tools/file-converter/contract";

const fileConverterDocxInspectionLimits: DocxInspectionLimits = Object.freeze({
  maximumCentralDirectorySize: 16 * 1024 * 1024,
  maximumEntries: 10_000,
  maximumMetadataPartSize: 1024 * 1024,
});
const fileConverterImageDimensionLimits = Object.freeze({ maximumDimension: 32_768, maximumPixels: 50_000_000 });

export type ValidatedSupplierOutput = { path: string; byteSize: number; sha256: string; format: FormatDescriptor };

export async function validateSupplierOutput(input: { outputPath: string; outputDirectory: string; response: FileConverterSuccess; maximumBytes: number }): Promise<ValidatedSupplierOutput> {
  const directoryReal = await realpath(input.outputDirectory); const outputReal = await realpath(input.outputPath);
  const relative = path.relative(directoryReal, outputReal);
  const details = await lstat(input.outputPath);
  if (!details.isFile() || details.isSymbolicLink() || !relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("host_output_not_regular");
  if (details.size < 1 || details.size > input.maximumBytes || details.size !== input.response.output.byteSize) throw new Error("host_output_size_mismatch");
  const actualSha = await hashFile(outputReal);
  if (actualSha !== input.response.output.sha256) throw new Error("host_output_hash_mismatch");
  if (!sameFormat(input.response.target, input.response.output.detectedType)) throw new Error("host_output_supplier_type_mismatch");
  const sample = await readSample(outputReal, Math.min(details.size, 1024 * 1024));
  await assertActualType(outputReal, details.size, sample, input.response.target);
  return { path: outputReal, byteSize: details.size, sha256: actualSha, format: input.response.target };
}

async function assertActualType(filename: string, size: number, bytes: Uint8Array, format: FormatDescriptor) {
  const starts = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  switch (format.formatId) {
    case "png": if (!starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw new Error("host_output_type_mismatch"); break;
    case "jpeg": if (!starts([0xff, 0xd8, 0xff])) throw new Error("host_output_type_mismatch"); break;
    case "webp": if (!starts([0x52, 0x49, 0x46, 0x46]) || Buffer.from(bytes.slice(8, 12)).toString("ascii") !== "WEBP") throw new Error("host_output_type_mismatch"); break;
    case "avif": if (Buffer.from(bytes.slice(4, 8)).toString("ascii") !== "ftyp" || !["avif", "avis"].includes(Buffer.from(bytes.slice(8, 12)).toString("ascii"))) throw new Error("host_output_type_mismatch"); break;
    case "pdf": if (!starts([0x25, 0x50, 0x44, 0x46, 0x2d]) || !Buffer.from(bytes).includes(Buffer.from("obj"))) throw new Error("host_output_type_mismatch"); break;
    case "docx": if (await inspectDocxContainer(filename, size, fileConverterDocxInspectionLimits) !== "docx") throw new Error("host_output_type_mismatch"); break;
    case "markdown": case "html": {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!text.trim() || text.includes("\u0000")) throw new Error("host_output_type_mismatch");
      break;
    }
    default: throw new Error("host_output_type_unsupported");
  }
  if (["png", "jpeg", "webp"].includes(format.formatId)) {
    const dimensions = readImageDimensions(bytes, format.mediaType);
    if (!dimensions || exceedsImageDimensionLimits(dimensions, fileConverterImageDimensionLimits)) throw new Error("host_output_image_unsafe");
  }
}

function sameFormat(left: FormatDescriptor, right: FormatDescriptor) { return left.formatId === right.formatId && left.mediaType === right.mediaType && left.extension === right.extension; }
async function readSample(filename: string, size: number) { const handle = await open(filename, "r"); try { const bytes = Buffer.alloc(size); await handle.read(bytes, 0, size, 0); return bytes; } finally { await handle.close(); } }
async function hashFile(filename: string) { const hash = createHash("sha256"); await pipeline(createReadStream(filename), hash); return hash.digest("hex"); }
