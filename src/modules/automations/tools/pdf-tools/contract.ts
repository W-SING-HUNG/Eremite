import {
  PDF_TOOLS_ERROR_CODES,
  PDF_TOOLS_PROTOCOL_VERSION,
  PDF_TOOLS_STAGES,
  PDF_TOOLS_WARNING_CODES,
  type PdfToolsOperation,
} from "@/modules/automations/tools/pdf-tools/authority";

export type PdfToolsPageSelector =
  | { mode: "pages"; pages: number[] }
  | { mode: "ranges"; ranges: Array<{ start: number; end: number }> };

export type PdfToolsParameters =
  | { strategy: { type: "every"; n: number } }
  | { pageSelector: PdfToolsPageSelector }
  | { pages: PdfToolsPageSelector; angle: 90 | 180 | 270; mode: "relative" | "absolute" }
  | { pageOrder: number[] };

export type PdfToolsLimits = {
  maxInputFiles: number;
  maxInputBytesPerFile: number;
  maxTotalInputBytes: number;
  maxOutputFiles: number;
  maxOutputBytesPerFile: number;
  maxTotalOutputBytes: number;
  maxPagesPerInput: number;
  maxTotalPages: number;
  maxWorkspaceBytes: number;
  timeoutMs: number;
};

export type PdfToolsRequest = {
  kind: "pdf.tools.request";
  protocolVersion: 1;
  invocationId: string;
  operation: PdfToolsOperation;
  workspace: { rootPath: string };
  inputs: Array<{
    id: string;
    relativePath: string;
    snapshot: { byteSize: number; sha256: string; displayName: string };
  }>;
  parameters?: PdfToolsParameters;
  limits: PdfToolsLimits;
};

export type PdfToolsOutput = {
  id: string;
  displayName: string;
  byteSize: number;
  sha256: string;
  pageCount: number;
  relativePath: string;
};

export type PdfToolsWarning = { code: string };
export type PdfToolsSuccess = {
  kind: "pdf.tools.response";
  protocolVersion: 1;
  invocationId: string;
  operation: PdfToolsOperation;
  status: "succeeded";
  outputs: PdfToolsOutput[];
  provenance: { coreVersion: string; protocolVersion: 1; operation: PdfToolsOperation };
  warnings: PdfToolsWarning[];
};
export type PdfToolsFailure = {
  kind: "pdf.tools.response";
  protocolVersion: 1;
  invocationId: string;
  operation: PdfToolsOperation;
  status: "failed";
  error: { code: string; stage: string; retryable: boolean };
  warnings: PdfToolsWarning[];
};
export type PdfToolsResponse = PdfToolsSuccess | PdfToolsFailure;

const operations: PdfToolsOperation[] = ["pdf.merge", "pdf.split", "pdf.extract", "pdf.rotate", "pdf.reorder"];

export function assertCanonicalPdfToolsRequest(raw: unknown): asserts raw is PdfToolsRequest {
  const value = object(raw, "request");
  const hasParameters = Object.hasOwn(value, "parameters");
  exact(value, hasParameters
    ? ["kind", "protocolVersion", "invocationId", "operation", "workspace", "inputs", "parameters", "limits"]
    : ["kind", "protocolVersion", "invocationId", "operation", "workspace", "inputs", "limits"], "request");
  if (value.kind !== "pdf.tools.request" || value.protocolVersion !== PDF_TOOLS_PROTOCOL_VERSION || !isUuid(value.invocationId) || !isOperation(value.operation)) invalid("request identity");
  const workspace = object(value.workspace, "workspace");
  exact(workspace, ["rootPath"], "workspace");
  string(workspace.rootPath, 1, Number.MAX_SAFE_INTEGER, "workspace.rootPath");
  if (!Array.isArray(value.inputs) || value.inputs.length < 1) invalid("inputs");
  const inputIds = new Set<string>();
  for (const itemRaw of value.inputs) {
    const item = object(itemRaw, "input");
    exact(item, ["id", "relativePath", "snapshot"], "input");
    string(item.id, 1, Number.MAX_SAFE_INTEGER, "input.id");
    string(item.relativePath, 1, Number.MAX_SAFE_INTEGER, "input.relativePath");
    if (inputIds.has(String(item.id))) invalid("input.id duplicate");
    inputIds.add(String(item.id));
    const snapshot = object(item.snapshot, "snapshot");
    exact(snapshot, ["byteSize", "sha256", "displayName"], "snapshot");
    integer(snapshot.byteSize, 0, Number.MAX_SAFE_INTEGER, "snapshot.byteSize");
    if (typeof snapshot.sha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(snapshot.sha256)) invalid("snapshot.sha256");
    if (typeof snapshot.displayName !== "string") invalid("snapshot.displayName");
  }
  assertOperationParameters(value.operation, hasParameters ? value.parameters : undefined);
  assertLimits(value.limits);
}

export function parseCanonicalPdfToolsResponse(raw: unknown, invocationId?: string, operation?: PdfToolsOperation): PdfToolsResponse {
  const value = object(raw, "response");
  if (value.kind !== "pdf.tools.response" || value.protocolVersion !== PDF_TOOLS_PROTOCOL_VERSION || !isUuid(value.invocationId) || !isOperation(value.operation)) invalid("response identity");
  if (invocationId && value.invocationId !== invocationId) invalid("response invocationId");
  if (operation && value.operation !== operation) invalid("response operation");
  assertWarnings(value.warnings);
  if (value.status === "failed") {
    exact(value, ["kind", "protocolVersion", "invocationId", "operation", "status", "error", "warnings"], "failure response");
    const error = object(value.error, "error");
    exact(error, ["code", "stage", "retryable"], "error");
    if (!PDF_TOOLS_ERROR_CODES.includes(String(error.code)) || !PDF_TOOLS_STAGES.includes(String(error.stage)) || typeof error.retryable !== "boolean") invalid("error");
    return value as PdfToolsFailure;
  }
  if (value.status !== "succeeded") invalid("response status");
  exact(value, ["kind", "protocolVersion", "invocationId", "operation", "status", "outputs", "provenance", "warnings"], "success response");
  if (!Array.isArray(value.outputs) || value.outputs.length < 1) invalid("outputs");
  const outputIds = new Set<string>();
  const outputPaths = new Set<string>();
  for (const outputRaw of value.outputs) {
    const output = object(outputRaw, "output");
    exact(output, ["id", "displayName", "byteSize", "sha256", "pageCount", "relativePath"], "output");
    string(output.id, 1, Number.MAX_SAFE_INTEGER, "output.id");
    if (typeof output.displayName !== "string") invalid("output.displayName");
    integer(output.byteSize, 0, Number.MAX_SAFE_INTEGER, "output.byteSize");
    integer(output.pageCount, 0, Number.MAX_SAFE_INTEGER, "output.pageCount");
    if (typeof output.sha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(output.sha256)) invalid("output.sha256");
    string(output.relativePath, 1, Number.MAX_SAFE_INTEGER, "output.relativePath");
    if (outputIds.has(String(output.id)) || outputPaths.has(String(output.relativePath))) invalid("output duplicate");
    outputIds.add(String(output.id));
    outputPaths.add(String(output.relativePath));
  }
  const provenance = object(value.provenance, "provenance");
  exact(provenance, ["coreVersion", "protocolVersion", "operation"], "provenance");
  string(provenance.coreVersion, 1, Number.MAX_SAFE_INTEGER, "provenance.coreVersion");
  if (provenance.protocolVersion !== PDF_TOOLS_PROTOCOL_VERSION || provenance.operation !== value.operation) invalid("provenance identity");
  return value as PdfToolsSuccess;
}

function assertOperationParameters(operation: PdfToolsOperation, parameters: unknown) {
  if (operation === "pdf.merge") {
    if (parameters !== undefined) invalid("merge parameters");
    return;
  }
  const value = object(parameters, "parameters");
  if (operation === "pdf.split") {
    exact(value, ["strategy"], "split parameters");
    const strategy = object(value.strategy, "strategy");
    exact(strategy, ["type", "n"], "strategy");
    if (strategy.type !== "every") invalid("strategy.type");
    integer(strategy.n, 1, Number.MAX_SAFE_INTEGER, "strategy.n");
  } else if (operation === "pdf.extract") {
    exact(value, ["pageSelector"], "extract parameters");
    assertPageSelector(value.pageSelector);
  } else if (operation === "pdf.rotate") {
    exact(value, ["pages", "angle", "mode"], "rotate parameters");
    assertPageSelector(value.pages);
    if (![90, 180, 270].includes(Number(value.angle)) || !["relative", "absolute"].includes(String(value.mode))) invalid("rotate parameters");
  } else {
    exact(value, ["pageOrder"], "reorder parameters");
    if (!Array.isArray(value.pageOrder) || value.pageOrder.length < 1) invalid("pageOrder");
    for (const page of value.pageOrder) integer(page, 0, Number.MAX_SAFE_INTEGER, "pageOrder item");
  }
}

function assertPageSelector(raw: unknown) {
  const value = object(raw, "pageSelector");
  if (value.mode === "pages") {
    exact(value, ["mode", "pages"], "pageSelector");
    if (!Array.isArray(value.pages) || value.pages.length < 1) invalid("pages");
    for (const page of value.pages) integer(page, 0, Number.MAX_SAFE_INTEGER, "page");
    return;
  }
  if (value.mode !== "ranges") invalid("pageSelector.mode");
  exact(value, ["mode", "ranges"], "pageSelector");
  if (!Array.isArray(value.ranges) || value.ranges.length < 1) invalid("ranges");
  for (const rangeRaw of value.ranges) {
    const range = object(rangeRaw, "range");
    exact(range, ["start", "end"], "range");
    integer(range.start, 0, Number.MAX_SAFE_INTEGER, "range.start");
    integer(range.end, 0, Number.MAX_SAFE_INTEGER, "range.end");
    if (Number(range.start) > Number(range.end)) invalid("range order");
  }
}

function assertLimits(raw: unknown) {
  const value = object(raw, "limits");
  const keys = ["maxInputFiles", "maxInputBytesPerFile", "maxTotalInputBytes", "maxOutputFiles", "maxOutputBytesPerFile", "maxTotalOutputBytes", "maxPagesPerInput", "maxTotalPages", "maxWorkspaceBytes", "timeoutMs"];
  exact(value, keys, "limits");
  for (const key of keys) integer(value[key], 1, Number.MAX_SAFE_INTEGER, `limits.${key}`);
}

function assertWarnings(raw: unknown) {
  if (!Array.isArray(raw)) invalid("warnings");
  const seen = new Set<string>();
  for (const warningRaw of raw) {
    const warning = object(warningRaw, "warning");
    exact(warning, ["code"], "warning");
    const code = String(warning.code);
    if (!PDF_TOOLS_WARNING_CODES.includes(code) || seen.has(code)) invalid("warning");
    seen.add(code);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(`${label} fields`);
}
function string(value: unknown, minimum: number, maximum: number, label: string) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) invalid(label);
}
function integer(value: unknown, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(label);
}
function isOperation(value: unknown): value is PdfToolsOperation {
  return typeof value === "string" && operations.includes(value as PdfToolsOperation);
}
export function isPdfToolsUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
function isUuid(value: unknown) {
  return isPdfToolsUuid(value);
}
function invalid(label: string): never {
  throw new Error(`pdf_tools_contract_invalid:${label}`);
}
