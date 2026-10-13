import acceptedDocument from "./accepted-capabilities.json" with { type: "json" };
import canonicalContract from "./canonical-tool-contract-v1.1.json" with { type: "json" };

export const FILE_CONVERTER_TOOL_ID = "core.file-converter";
export const FILE_CONVERTER_TOOL_VERSION = 1;
export const FILE_CONVERTER_PACKAGE_NAME = "file-converter-core";
export const FILE_CONVERTER_PACKAGE_VERSION = "1.1.3";
export const FILE_CONVERTER_ARTIFACT_SHA256 = "566d03e5850d0fd966482f55028f136d809ed902801ecdad097abbc1ad2ba1c6";
// SHA-256 of dist/native/bin/fc-movefile.exe from the fixed 1.1.3 archive above.
export const FILE_CONVERTER_NATIVE_HELPER_SHA256 = "9aa5bd91810dc9c643641a2ea4272fabcb1d579340a9cb0b87ea20750f5fb919";
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
    if (conversion.defaultProfile !== (conversion.engine === "sharp" ? "balanced" : "standard")
      || conversion.profiles.length !== 1 || conversion.profiles[0] !== conversion.defaultProfile) throw new Error("file_converter_default_profile_invalid");
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
