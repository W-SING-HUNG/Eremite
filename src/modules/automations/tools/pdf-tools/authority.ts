import acceptedDocument from "./accepted-capabilities.json" with { type: "json" };
import contractDocument from "./canonical-supplier-protocol-v1.json" with { type: "json" };

export const PDF_TOOLS_TOOL_ID = "core.pdf-tools";
export const PDF_TOOLS_TOOL_VERSION = 1;
export const PDF_TOOLS_PACKAGE_NAME = "pdf-tools-core";
export const PDF_TOOLS_PACKAGE_VERSION = "1.0.0-rc5";
export const PDF_TOOLS_ARTIFACT_SHA256 = "4d39776995930e449238272e01bc0e981d84a3ea93835bd40a7e280309dd3e36";
export const PDF_TOOLS_PROTOCOL_VERSION = 1;
export const PDF_TOOLS_QPDF_VERSION = "12.4.0";
export const PDF_TOOLS_SCHEMA_SHA256 = "863662f704b1001fb309741d5b2842a258ac62deba3135534feff4ce6acd38fc";
export const PDF_TOOLS_CONTRACT_ID = "https://pdf-tools-core.supplier/protocol/v1/schema.json";

export type PdfToolsOperation = "pdf.merge" | "pdf.split" | "pdf.extract" | "pdf.rotate" | "pdf.reorder";
export type PdfToolsCapability = {
  id: PdfToolsOperation;
  minimumInputs: number;
  maximumInputs: number;
  outputMode: "single" | "multiple";
};

const expectedOperations: PdfToolsOperation[] = ["pdf.merge", "pdf.split", "pdf.extract", "pdf.rotate", "pdf.reorder"];
if (acceptedDocument.schemaVersion !== 1 || acceptedDocument.toolId !== PDF_TOOLS_TOOL_ID || acceptedDocument.toolVersion !== PDF_TOOLS_TOOL_VERSION) {
  throw new Error("pdf_tools_host_policy_identity_invalid");
}
if (acceptedDocument.operations.length !== expectedOperations.length) throw new Error("pdf_tools_host_policy_count_invalid");
for (const id of expectedOperations) {
  const capability = acceptedDocument.operations.find((entry) => entry.id === id);
  if (!capability || capability.minimumInputs < 1 || capability.maximumInputs < capability.minimumInputs) throw new Error("pdf_tools_host_policy_operation_invalid");
}
if (contractDocument.$id !== PDF_TOOLS_CONTRACT_ID) throw new Error("pdf_tools_contract_identity_invalid");

export const acceptedPdfToolsCapabilities = Object.freeze(
  acceptedDocument.operations.map((entry) => Object.freeze({ ...entry })) as PdfToolsCapability[],
);
export const pdfToolsCanonicalContract = Object.freeze(contractDocument);

export function getAcceptedPdfToolsCapability(id: string) {
  return acceptedPdfToolsCapabilities.find((entry) => entry.id === id) ?? null;
}

export const PDF_TOOLS_LIMITS = Object.freeze({
  maxInputFiles: 32,
  maxInputBytesPerFile: 512 * 1024 * 1024,
  maxTotalInputBytes: 512 * 1024 * 1024,
  maxOutputFiles: 100,
  maxOutputBytesPerFile: 128 * 1024 * 1024,
  maxTotalOutputBytes: 512 * 1024 * 1024,
  maxPagesPerInput: 10_000,
  maxTotalPages: 20_000,
  maxWorkspaceBytes: 1024 * 1024 * 1024,
  timeoutMs: 180_000,
});

export const PDF_TOOLS_ERROR_CODES = Object.freeze([...contractDocument.$defs.errorCode.enum]);
export const PDF_TOOLS_WARNING_CODES = Object.freeze([...contractDocument.$defs.warningCode.enum]);
export const PDF_TOOLS_STAGES = Object.freeze([...contractDocument.$defs.stage.enum]);
