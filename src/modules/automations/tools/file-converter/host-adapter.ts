import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getAcceptedFileConversion, type FileConverterFormat } from "@/modules/automations/tools/file-converter/authority";
import { assertCanonicalFileConverterRequest, fileConverterFormat, parseCanonicalFileConverterResponse, type FileConverterFailure, type FileConverterRequest, type FileConverterSuccess } from "@/modules/automations/tools/file-converter/contract";
import { resolveInstalledFileConverter } from "@/modules/automations/tools/file-converter/runtime";
import { validateSupplierOutput, type ValidatedSupplierOutput } from "@/modules/automations/tools/file-converter/output-validation";
import { createExternalToolWorkspace, discardExternalToolWorkspace, runExternalTool } from "@/platform/external-tools/request-runner";

export class FileConverterProtocolError extends Error { constructor(public readonly code: string) { super(code); this.name = "FileConverterProtocolError"; } }

export type FileConverterAdapterInput = {
  invocationId: string;
  sourcePath: string;
  displayName: string;
  declaredMediaType: string;
  expectedSize: number;
  expectedSha256: string;
  sourceFormat: FileConverterFormat;
  conversionId: string;
  profile?: string;
};

export type FileConverterAdapterResult<T> = { response: FileConverterSuccess; output: ValidatedSupplierOutput; value: T } | { response: FileConverterFailure };

export async function withFileConverterOutput<T>(input: FileConverterAdapterInput, consume: (output: ValidatedSupplierOutput, response: FileConverterSuccess) => Promise<T>): Promise<FileConverterAdapterResult<T>> {
  const accepted = getAcceptedFileConversion(input.conversionId);
  if (!accepted || accepted.source !== input.sourceFormat) throw new FileConverterProtocolError("host_conversion_not_accepted");
  const profile = input.profile ?? accepted.defaultProfile;
  if (!accepted.profiles.includes(profile)) throw new FileConverterProtocolError("host_profile_not_accepted");
  const installed = await resolveInstalledFileConverter();
  const workspace = await createExternalToolWorkspace("eremite-file-converter-");
  try {
    const inputPath = path.join(workspace.inputDir, "source");
    const copied = await copyAndHash(input.sourcePath, inputPath, 512 * 1024 * 1024);
    if (copied.byteSize !== input.expectedSize || copied.sha256 !== input.expectedSha256) throw new FileConverterProtocolError("host_source_snapshot_mismatch");
    const target = fileConverterFormat(accepted.target);
    const outputPath = path.join(workspace.outputDir, `result${target.extension}`);
    const timeoutMs = accepted.engine === "libreoffice" ? 180_000 : 60_000;
    const request: FileConverterRequest = {
      kind: "request", contractVersion: 1, invocationId: input.invocationId,
      workspace: { rootPath: workspace.root, inputPath, outputPath },
      source: { displayName: input.displayName, declaredMediaType: input.declaredMediaType, byteSize: copied.byteSize, sha256: copied.sha256 },
      conversion: { conversionId: accepted.id, target, enginePlan: { primaryEngineId: accepted.engine, fallbackEngineId: null } },
      limits: { maxInputBytes: 512 * 1024 * 1024, maxOutputBytes: 512 * 1024 * 1024, maxWorkspaceBytes: 1024 * 1024 * 1024, timeoutMs },
    };
    assertCanonicalFileConverterRequest(request);
    const processResult = await runExternalTool({ cliPath: installed.cliPath, workspace, request, timeoutMs: timeoutMs + 10_000 });
    if (processResult.timedOut) throw new FileConverterProtocolError("host_core_timeout");
    if (processResult.exitCode !== 0 || !processResult.responseText) throw new FileConverterProtocolError("host_core_protocol_failed");
    let raw: unknown; try { raw = JSON.parse(processResult.responseText); } catch { throw new FileConverterProtocolError("host_core_response_invalid"); }
    const response = parseCanonicalFileConverterResponse(raw, input.invocationId);
    if (response.status === "failed") return { response };
    if (response.sourceSha256 !== copied.sha256 || response.engine.id !== accepted.engine || response.target.formatId !== accepted.target) throw new FileConverterProtocolError("host_core_response_mismatch");
    const output = await validateSupplierOutput({ outputPath, outputDirectory: workspace.outputDir, response, maximumBytes: 512 * 1024 * 1024 });
    const value = await consume(output, response);
    return { response, output, value };
  } finally {
    await discardExternalToolWorkspace(workspace);
  }
}

async function copyAndHash(source: string, destination: string, maximumBytes: number) {
  const details = await lstat(source);
  if (!details.isFile() || details.isSymbolicLink() || details.size < 1 || details.size > maximumBytes) throw new FileConverterProtocolError("host_source_not_regular");
  const hash = createHash("sha256"); let byteSize = 0;
  const tap = new Transform({ transform(chunk: Buffer, _encoding, callback) { byteSize += chunk.length; if (byteSize > maximumBytes) callback(new FileConverterProtocolError("host_source_too_large")); else { hash.update(chunk); callback(null, chunk); } } });
  await pipeline(createReadStream(source), tap, createWriteStream(destination, { flags: "wx", mode: 0o444 }));
  return { byteSize, sha256: hash.digest("hex") };
}
