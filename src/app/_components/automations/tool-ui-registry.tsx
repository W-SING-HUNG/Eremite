import { ContentToActionDraftsLauncher } from "@/app/_components/automations/content-to-action-drafts-launcher";
import { FileConverterLauncher } from "@/app/_components/automations/file-converter-launcher";
import { FileConverterResultRenderer } from "@/app/_components/automations/file-converter-result-renderer";
import { PdfToolsLauncher } from "@/app/_components/automations/pdf-tools-launcher";
import { PdfToolsResultRenderer } from "@/app/_components/automations/pdf-tools-result-renderer";
import { CONTENT_TO_ACTION_DRAFTS_TOOL_ID, FILE_CONVERTER_TOOL_ID, PDF_TOOLS_TOOL_ID, toolCatalog } from "@/modules/automations/tools/catalog";

export const clientToolRegistry = {
  [CONTENT_TO_ACTION_DRAFTS_TOOL_ID]: { Launcher: ContentToActionDraftsLauncher },
  [FILE_CONVERTER_TOOL_ID]: { Launcher: FileConverterLauncher, ResultRenderer: FileConverterResultRenderer },
  [PDF_TOOLS_TOOL_ID]: { Launcher: PdfToolsLauncher, ResultRenderer: PdfToolsResultRenderer },
} as const;

export function getClientTool(id: string) {
  return id in clientToolRegistry ? clientToolRegistry[id as keyof typeof clientToolRegistry] : null;
}

export function assertClientRegistryParity() {
  const catalogIds = toolCatalog.map((tool) => tool.id).sort();
  const clientIds = Object.keys(clientToolRegistry).sort();
  if (catalogIds.join("\u0000") !== clientIds.join("\u0000")) throw new Error("automation_client_registry_drift");
}

assertClientRegistryParity();
