import { fileConverterCanonicalContract, type FileConverterEngineId, type FileConverterFormat } from "@/modules/automations/tools/file-converter/authority";

export const fileConverterErrorCodes = Object.freeze([...(fileConverterCanonicalContract as ContractSchema).$defs.error.properties.code.enum]);
export const fileConverterWarningCodes = Object.freeze([...(fileConverterCanonicalContract as ContractSchema).$defs.warning.properties.code.enum]);
export const fileConverterErrorStages = Object.freeze([...(fileConverterCanonicalContract as ContractSchema).$defs.error.properties.stage.enum]);

export type FileConverterErrorCode = (typeof fileConverterErrorCodes)[number];
export type FileConverterWarningCode = (typeof fileConverterWarningCodes)[number];
export type FileConverterErrorStage = (typeof fileConverterErrorStages)[number];

type ContractSchema = {
  $defs: {
    error: { properties: { code: { enum: string[] }; stage: { enum: string[] } } };
    warning: { properties: { code: { enum: string[] } } };
  };
};

export type FormatDescriptor = { formatId: string; mediaType: string; extension: string };
export type FileConverterRequest = {
  kind: "request";
  contractVersion: 1;
  invocationId: string;
  workspace: { rootPath: string; inputPath: string; outputPath: string };
  source: { displayName: string; declaredMediaType: string; byteSize: number; sha256: string };
  conversion: {
    conversionId: string;
    target: FormatDescriptor;
    enginePlan: { primaryEngineId: string; fallbackEngineId: string | null };
  };
  limits: { maxInputBytes: number; maxOutputBytes: number; maxWorkspaceBytes: number; timeoutMs: number };
};

export type FileConverterWarning = { code: FileConverterWarningCode };
export type FileConverterFailure = {
  kind: "response"; contractVersion: 1; invocationId: string; status: "failed"; coreVersion: string;
  durationMs: number; warnings: FileConverterWarning[];
  errors: Array<{ code: FileConverterErrorCode; stage: FileConverterErrorStage; retryable: boolean }>;
};
export type FileConverterSuccess = {
  kind: "response"; contractVersion: 1; invocationId: string; status: "succeeded"; coreVersion: string;
  sourceSha256: string; detectedSource: FormatDescriptor; target: FormatDescriptor;
  output: { byteSize: number; sha256: string; detectedType: FormatDescriptor };
  engine: { id: string; version: string };
  fallback: { used: false } | { used: true; primaryEngineId: string; reasonCode: "PRIMARY_UNAVAILABLE" | "PRIMARY_INCOMPATIBLE" | "PRIMARY_FAILED" };
  durationMs: number; warnings: FileConverterWarning[];
};
export type FileConverterResponse = FileConverterSuccess | FileConverterFailure;

const formatDescriptors: Record<FileConverterFormat, FormatDescriptor> = {
  png: { formatId: "png", mediaType: "image/png", extension: ".png" },
  jpeg: { formatId: "jpeg", mediaType: "image/jpeg", extension: ".jpg" },
  webp: { formatId: "webp", mediaType: "image/webp", extension: ".webp" },
  avif: { formatId: "avif", mediaType: "image/avif", extension: ".avif" },
  markdown: { formatId: "markdown", mediaType: "text/markdown", extension: ".md" },
  html: { formatId: "html", mediaType: "text/html", extension: ".html" },
  docx: { formatId: "docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" },
  xlsx: { formatId: "xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: ".xlsx" },
  pptx: { formatId: "pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" },
  pdf: { formatId: "pdf", mediaType: "application/pdf", extension: ".pdf" },
};

export function fileConverterFormat(format: FileConverterFormat): FormatDescriptor {
  return { ...formatDescriptors[format] };
}

export function assertCanonicalFileConverterRequest(value: unknown): asserts value is FileConverterRequest {
  const request = record(value, "request");
  exactKeys(request, ["kind", "contractVersion", "invocationId", "workspace", "source", "conversion", "limits"], "request");
  if (request.kind !== "request" || request.contractVersion !== 1 || !isUuid(request.invocationId)) fail("request identity");
  const workspace = record(request.workspace, "workspace"); exactKeys(workspace, ["rootPath", "inputPath", "outputPath"], "workspace");
  for (const key of ["rootPath", "inputPath", "outputPath"] as const) boundedString(workspace[key], 1, Number.MAX_SAFE_INTEGER, `workspace.${key}`);
  const source = record(request.source, "source"); exactKeys(source, ["displayName", "declaredMediaType", "byteSize", "sha256"], "source");
  boundedString(source.displayName, 1, 1024, "source.displayName"); boundedString(source.declaredMediaType, 3, 127, "source.declaredMediaType");
  positiveInteger(source.byteSize, 536870912, "source.byteSize"); sha256(source.sha256, "source.sha256");
  const conversion = record(request.conversion, "conversion"); exactKeys(conversion, ["conversionId", "target", "enginePlan"], "conversion");
  if (typeof conversion.conversionId !== "string" || !/^[a-z0-9][a-z0-9.-]{0,95}$/u.test(conversion.conversionId)) fail("conversionId");
  assertFormat(conversion.target, "conversion.target");
  const plan = record(conversion.enginePlan, "enginePlan"); exactKeys(plan, ["primaryEngineId", "fallbackEngineId"], "enginePlan");
  boundedString(plan.primaryEngineId, 1, 64, "primaryEngineId"); if (plan.fallbackEngineId !== null) boundedString(plan.fallbackEngineId, 1, 64, "fallbackEngineId");
  const limits = record(request.limits, "limits"); exactKeys(limits, ["maxInputBytes", "maxOutputBytes", "maxWorkspaceBytes", "timeoutMs"], "limits");
  positiveInteger(limits.maxInputBytes, 536870912, "maxInputBytes"); positiveInteger(limits.maxOutputBytes, 536870912, "maxOutputBytes");
  positiveInteger(limits.maxWorkspaceBytes, 1073741824, "maxWorkspaceBytes"); positiveInteger(limits.timeoutMs, 900000, "timeoutMs");
}

export function parseCanonicalFileConverterResponse(value: unknown, invocationId?: string): FileConverterResponse {
  const response = record(value, "response");
  if (response.kind !== "response" || response.contractVersion !== 1 || !isUuid(response.invocationId)) fail("response identity");
  if (invocationId && response.invocationId !== invocationId) fail("response invocationId");
  boundedString(response.coreVersion, 1, 80, "coreVersion"); nonNegativeInteger(response.durationMs, "durationMs"); assertWarnings(response.warnings);
  if (response.status === "failed") {
    exactKeys(response, ["kind", "contractVersion", "invocationId", "status", "coreVersion", "durationMs", "warnings", "errors"], "failure response");
    if (!Array.isArray(response.errors) || response.errors.length === 0) fail("errors");
    for (const item of response.errors) {
      const error = record(item, "error"); exactKeys(error, ["code", "stage", "retryable"], "error");
      if (!fileConverterErrorCodes.includes(String(error.code)) || !fileConverterErrorStages.includes(String(error.stage)) || typeof error.retryable !== "boolean") fail("error");
    }
    return response as FileConverterFailure;
  }
  if (response.status !== "succeeded") fail("response status");
  exactKeys(response, ["kind", "contractVersion", "invocationId", "status", "coreVersion", "sourceSha256", "detectedSource", "target", "output", "engine", "fallback", "durationMs", "warnings"], "success response");
  sha256(response.sourceSha256, "sourceSha256"); assertFormat(response.detectedSource, "detectedSource"); assertFormat(response.target, "target");
  const output = record(response.output, "output"); exactKeys(output, ["byteSize", "sha256", "detectedType"], "output"); positiveInteger(output.byteSize, Number.MAX_SAFE_INTEGER, "output.byteSize"); sha256(output.sha256, "output.sha256"); assertFormat(output.detectedType, "output.detectedType");
  const engine = record(response.engine, "engine"); exactKeys(engine, ["id", "version"], "engine"); boundedString(engine.id, 1, 64, "engine.id"); boundedString(engine.version, 1, 80, "engine.version");
  const fallback = record(response.fallback, "fallback");
  if (fallback.used === false) exactKeys(fallback, ["used"], "fallback");
  else {
    exactKeys(fallback, ["used", "primaryEngineId", "reasonCode"], "fallback");
    if (fallback.used !== true || !["PRIMARY_UNAVAILABLE", "PRIMARY_INCOMPATIBLE", "PRIMARY_FAILED"].includes(String(fallback.reasonCode))) fail("fallback");
    boundedString(fallback.primaryEngineId, 1, 64, "fallback.primaryEngineId");
  }
  return response as FileConverterSuccess;
}

export function isFileConverterEngineId(value: string): value is FileConverterEngineId {
  return value === "sharp" || value === "pandoc" || value === "libreoffice";
}

function assertWarnings(value: unknown) {
  if (!Array.isArray(value)) fail("warnings");
  const codes = new Set<string>();
  for (const item of value) { const warning = record(item, "warning"); exactKeys(warning, ["code"], "warning"); if (!fileConverterWarningCodes.includes(String(warning.code)) || codes.has(String(warning.code))) fail("warning"); codes.add(String(warning.code)); }
}
function assertFormat(value: unknown, name: string) { const format = record(value, name); exactKeys(format, ["formatId", "mediaType", "extension"], name); if (typeof format.formatId !== "string" || !/^[a-z0-9][a-z0-9.-]{0,63}$/u.test(format.formatId)) fail(`${name}.formatId`); boundedString(format.mediaType, 3, 127, `${name}.mediaType`); if (typeof format.extension !== "string" || !/^\.[a-z0-9]{1,16}$/u.test(format.extension)) fail(`${name}.extension`); }
function record(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail(name); return value as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string) { const actual = Object.keys(value).sort(); const target = [...expected].sort(); if (actual.length !== target.length || actual.some((key, index) => key !== target[index])) fail(`${name} fields`); }
function boundedString(value: unknown, min: number, max: number, name: string) { if (typeof value !== "string" || value.length < min || value.length > max) fail(name); }
function positiveInteger(value: unknown, max: number, name: string) { if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) fail(name); }
function nonNegativeInteger(value: unknown, name: string) { if (!Number.isSafeInteger(value) || Number(value) < 0) fail(name); }
function sha256(value: unknown, name: string) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) fail(name); }
function isUuid(value: unknown) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }
function fail(field: string): never { throw new Error(`file_converter_contract_invalid:${field}`); }
