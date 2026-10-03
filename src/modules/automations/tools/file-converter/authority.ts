import acceptedDocument from "./accepted-capabilities.json" with { type: "json" };
import canonicalContract from "./canonical-tool-contract-v1.1.json" with { type: "json" };

export const FILE_CONVERTER_TOOL_ID = "core.file-converter";
export const FILE_CONVERTER_TOOL_VERSION = 1;
export const FILE_CONVERTER_PACKAGE_NAME = "file-converter-core";
export const FILE_CONVERTER_PACKAGE_VERSION = "1.1.2";
export const FILE_CONVERTER_ARTIFACT_SHA256 = "0f287c70d8f5c4b7af1413545dd07cd1aaacf1c4285f2a3e4afc7a0bcb3ac7e7";
export const FILE_CONVERTER_CONTRACT_SHA256 = "8df14f74d6900ca343e4f2c13b938edc5f8e3ce6f2c9d3987289f91dca442de9";
export const FILE_CONVERTER_NATIVE_HELPER_SHA256 = "282d4647cd36842162ee577e2c76686a234abb6a5e37c3b7928f6bcf78075a22";
export const FILE_CONVERTER_CONTRACT_ID = "https://eremite.local/contracts/file-converter/v1.1/canonical-tool-contract-v1.1.json";

export type FileConverterFormat = "png" | "jpeg" | "webp" | "avif" | "markdown" | "html" | "docx" | "xlsx" | "pptx" | "pdf";
export type FileConverterEngineId = "sharp" | "pandoc" | "libreoffice";

export type AcceptedFileConversion = {
  id: string;
  source: FileConverterFormat;
  target: FileConverterFormat;
  engine: FileConverterEngineId;
  profiles: readonly string[];
  defaultProfile: string;
  previewable: boolean;
};

type AcceptedDocument = {
  schemaVersion: number;
  toolId: string;
  toolVersion: number;
  supplier: { package: string; version: string; artifactSha256: string; contractId: string };
  conversions: AcceptedFileConversion[];
};

const document = acceptedDocument as AcceptedDocument;

function assertAuthorityDocument() {
  if (document.schemaVersion !== 1 || document.toolId !== FILE_CONVERTER_TOOL_ID || document.toolVersion !== FILE_CONVERTER_TOOL_VERSION) throw new Error("file_converter_authority_identity_invalid");
  if (document.supplier.package !== FILE_CONVERTER_PACKAGE_NAME || document.supplier.version !== FILE_CONVERTER_PACKAGE_VERSION) throw new Error("file_converter_supplier_identity_invalid");
  if (document.supplier.artifactSha256 !== FILE_CONVERTER_ARTIFACT_SHA256 || document.supplier.contractId !== FILE_CONVERTER_CONTRACT_ID) throw new Error("file_converter_supplier_authority_drift");
  if ((canonicalContract as { $id?: string }).$id !== FILE_CONVERTER_CONTRACT_ID) throw new Error("file_converter_contract_identity_invalid");
  const ids = new Set(document.conversions.map((entry) => entry.id));
  if (document.conversions.length !== 18 || ids.size !== 18) throw new Error("file_converter_allowlist_invalid");
  for (const conversion of document.conversions) {
    if (!conversion.profiles.includes(conversion.defaultProfile)) throw new Error("file_converter_default_profile_invalid");
  }
}

assertAuthorityDocument();

export const acceptedFileConversions = Object.freeze(document.conversions.map((entry) => Object.freeze({ ...entry, profiles: Object.freeze([...entry.profiles]) })));

export function getAcceptedFileConversion(id: string) {
  return acceptedFileConversions.find((entry) => entry.id === id) ?? null;
}

export function listAcceptedFileConversionsForSource(source: FileConverterFormat) {
  return acceptedFileConversions.filter((entry) => entry.source === source);
}

export { canonicalContract as fileConverterCanonicalContract };
