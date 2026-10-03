import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  PDF_TOOLS_LIMITS,
  getAcceptedPdfToolsCapability,
  type PdfToolsOperation,
} from "@/modules/automations/tools/pdf-tools/authority";
import {
  assertCanonicalPdfToolsRequest,
  parseCanonicalPdfToolsResponse,
  type PdfToolsFailure,
  type PdfToolsParameters,
  type PdfToolsRequest,
  type PdfToolsSuccess,
} from "@/modules/automations/tools/pdf-tools/contract";
import { validatePdfToolsOutputs, type ValidatedPdfToolsOutput } from "@/modules/automations/tools/pdf-tools/output-validation";
import { resolveInstalledPdfTools } from "@/modules/automations/tools/pdf-tools/runtime";
import {
  createExternalToolWorkspace,
  discardExternalToolWorkspace,
  runExternalTool,
} from "@/platform/external-tools/request-runner";

export class PdfToolsProtocolError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PdfToolsProtocolError";
  }
}

export type PdfToolsAdapterInput = {
  invocationId: string;
  operation: PdfToolsOperation;
  inputs: Array<{
    sourcePath: string;
    displayName: string;
    expectedSize: number;
    expectedSha256: string;
  }>;
  parameters?: PdfToolsParameters;
};

export type PdfToolsAdapterResult<T> =
  | { response: PdfToolsSuccess; outputs: ValidatedPdfToolsOutput[]; value: T }
  | { response: PdfToolsFailure };

export async function withPdfToolsOutputs<T>(
  input: PdfToolsAdapterInput,
  consume: (outputs: ValidatedPdfToolsOutput[], response: PdfToolsSuccess) => Promise<T>,
): Promise<PdfToolsAdapterResult<T>> {
  const capability = getAcceptedPdfToolsCapability(input.operation);
  if (!capability) throw new PdfToolsProtocolError("host_pdf_operation_not_accepted");
  if (input.inputs.length < capability.minimumInputs || input.inputs.length > capability.maximumInputs) throw new PdfToolsProtocolError("host_pdf_input_count_invalid");
  if (input.operation === "pdf.merge" ? input.parameters !== undefined : input.parameters === undefined) throw new PdfToolsProtocolError("host_pdf_parameters_invalid");
  const installed = await resolveInstalledPdfTools();
  const workspace = await createExternalToolWorkspace("eremite-pdf-tools-");
  try {
    const requestInputs: PdfToolsRequest["inputs"] = [];
    let totalInputBytes = 0;
    for (let index = 0; index < input.inputs.length; index += 1) {
      const source = input.inputs[index];
      const destination = path.join(workspace.inputDir, `source-${String(index).padStart(4, "0")}.pdf`);
      const copied = await copyAndHash(source.sourcePath, destination, PDF_TOOLS_LIMITS.maxInputBytesPerFile);
      if (copied.byteSize !== source.expectedSize || copied.sha256 !== source.expectedSha256) throw new PdfToolsProtocolError("host_pdf_source_snapshot_mismatch");
      totalInputBytes += copied.byteSize;
      if (!Number.isSafeInteger(totalInputBytes) || totalInputBytes > PDF_TOOLS_LIMITS.maxTotalInputBytes) throw new PdfToolsProtocolError("host_pdf_input_total_limit");
      requestInputs.push({
        id: `in-${index}`,
        relativePath: path.relative(workspace.root, destination).replace(/\\/gu, "/"),
        snapshot: { byteSize: copied.byteSize, sha256: copied.sha256, displayName: source.displayName },
      });
    }
    const request: PdfToolsRequest = {
      kind: "pdf.tools.request",
      protocolVersion: 1,
      invocationId: input.invocationId,
      operation: input.operation,
      workspace: { rootPath: workspace.root },
      inputs: requestInputs,
      ...(input.parameters === undefined ? {} : { parameters: input.parameters }),
      limits: { ...PDF_TOOLS_LIMITS },
    };
    assertCanonicalPdfToolsRequest(request);
    const processResult = await runExternalTool({
      cliPath: installed.cliPath,
      workspace,
      request,
      timeoutMs: PDF_TOOLS_LIMITS.timeoutMs + 30_000,
    });
    if (processResult.timedOut) throw new PdfToolsProtocolError("host_pdf_core_timeout");
    if (processResult.exitCode !== 0 || !processResult.responseText) throw new PdfToolsProtocolError("host_pdf_core_protocol_failed");
    let raw: unknown;
    try {
      raw = JSON.parse(processResult.responseText);
    } catch {
      throw new PdfToolsProtocolError("host_pdf_core_response_invalid");
    }
    const response = parseCanonicalPdfToolsResponse(raw, input.invocationId, input.operation);
    if (response.status === "failed") return { response };
    const expectedOutputMode = capability.outputMode;
    if ((expectedOutputMode === "single" && response.outputs.length !== 1) || (expectedOutputMode === "multiple" && response.outputs.length < 1)) {
      throw new PdfToolsProtocolError("host_pdf_core_output_count_mismatch");
    }
    response.outputs.forEach((output, index) => {
      if (output.id !== `out-${index}`) throw new PdfToolsProtocolError("host_pdf_core_output_order_invalid");
    });
    const outputs = await validatePdfToolsOutputs({
      workspaceRoot: workspace.root,
      outputDirectory: workspace.outputDir,
      response,
      limits: request.limits,
    });
    const value = await consume(outputs, response);
    return { response, outputs, value };
  } finally {
    await discardExternalToolWorkspace(workspace);
  }
}

async function copyAndHash(source: string, destination: string, maximumBytes: number) {
  const details = await lstat(source);
  if (!details.isFile() || details.isSymbolicLink() || details.size < 1 || details.size > maximumBytes) throw new PdfToolsProtocolError("host_pdf_source_not_regular");
  const hash = createHash("sha256");
  let byteSize = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maximumBytes) callback(new PdfToolsProtocolError("host_pdf_source_too_large"));
      else {
        hash.update(chunk);
        callback(null, chunk);
      }
    },
  });
  await pipeline(createReadStream(source), tap, createWriteStream(destination, { flags: "wx", mode: 0o444 }));
  return { byteSize, sha256: hash.digest("hex") };
}
