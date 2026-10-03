import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { PdfToolsLimits, PdfToolsSuccess } from "@/modules/automations/tools/pdf-tools/contract";

export type ValidatedPdfToolsOutput = {
  path: string;
  displayName: string;
  byteSize: number;
  sha256: string;
  pageCount: number;
};

export async function validatePdfToolsOutputs(input: {
  workspaceRoot: string;
  outputDirectory: string;
  response: PdfToolsSuccess;
  limits: PdfToolsLimits;
}) {
  if (input.response.outputs.length > input.limits.maxOutputFiles) throw new Error("host_pdf_output_count_limit");
  const rootReal = await realpath(input.workspaceRoot);
  const outputRootReal = await realpath(input.outputDirectory);
  assertInside(rootReal, outputRootReal, "host_pdf_output_root_escape");
  const validated: ValidatedPdfToolsOutput[] = [];
  let totalBytes = 0;
  for (const output of input.response.outputs) {
    if (path.isAbsolute(output.relativePath) || isUnsafeWindowsPath(output.relativePath)) throw new Error("host_pdf_output_path_invalid");
    const candidate = path.resolve(rootReal, output.relativePath);
    const candidateReal = await realpath(candidate);
    assertInside(outputRootReal, candidateReal, "host_pdf_output_escape");
    const details = await lstat(candidate);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error("host_pdf_output_not_regular");
    if (details.size < 1 || details.size > input.limits.maxOutputBytesPerFile || details.size !== output.byteSize) throw new Error("host_pdf_output_size_mismatch");
    totalBytes += details.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > input.limits.maxTotalOutputBytes) throw new Error("host_pdf_output_total_limit");
    const bytes = await readFile(candidateReal);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== output.sha256.toLowerCase()) throw new Error("host_pdf_output_hash_mismatch");
    if (!hasPdfEnvelope(bytes)) throw new Error("host_pdf_output_type_mismatch");
    const pageCount = await readPdfPageCount(bytes);
    if (pageCount < 1 || pageCount !== output.pageCount) throw new Error("host_pdf_output_page_count_mismatch");
    validated.push({
      path: candidateReal,
      displayName: safePdfName(output.displayName, validated.length),
      byteSize: details.size,
      sha256,
      pageCount,
    });
  }
  return validated;
}

async function readPdfPageCount(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: true,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    return document.numPages;
  } catch {
    throw new Error("host_pdf_output_structural_invalid");
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

function hasPdfEnvelope(bytes: Buffer) {
  if (bytes.length < 16 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return false;
  return bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from("%%EOF", "ascii"));
}

function safePdfName(displayName: string, index: number) {
  const base = path.basename(displayName.normalize("NFKC").trim() || `output-${index + 1}.pdf`);
  const stem = path.basename(base, path.extname(base)).replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").slice(0, 180).trim() || `output-${index + 1}`;
  return `${stem}.pdf`;
}

function assertInside(root: string, candidate: string, code: string) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(code);
}

function isUnsafeWindowsPath(value: string) {
  return value.startsWith("\\\\") || value.startsWith("//") || value.startsWith("\\\\?\\") || value.startsWith("//?/") || /(^|[\\/])\.\.([\\/]|$)/u.test(value) || value.includes(":");
}
