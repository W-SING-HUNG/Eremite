import { CONTENT_TO_ACTION_DRAFTS_TOOL_ID, FILE_CONVERTER_TOOL_ID, PDF_TOOLS_TOOL_ID, getToolMetadata, listTools, searchToolCommands, toolCatalog } from "@/modules/automations/tools/catalog";
import { contentToActionDraftsServerTool } from "@/modules/automations/tools/content-to-action-drafts";
import { fileConverterServerTool } from "@/modules/automations/tools/file-converter/server-tool";
import { pdfToolsServerTool } from "@/modules/automations/tools/pdf-tools/server-tool";

export const serverToolRegistry = {
  [CONTENT_TO_ACTION_DRAFTS_TOOL_ID]: contentToActionDraftsServerTool,
  [FILE_CONVERTER_TOOL_ID]: fileConverterServerTool,
  [PDF_TOOLS_TOOL_ID]: pdfToolsServerTool,
} as const;

export type RegisteredToolId = keyof typeof serverToolRegistry;

export function getServerTool(id: string) {
  return id in serverToolRegistry ? serverToolRegistry[id as RegisteredToolId] : null;
}

export function assertServerRegistryParity() {
  const catalogIds = toolCatalog.map((tool) => tool.id).sort();
  const serverIds = Object.keys(serverToolRegistry).sort();
  if (catalogIds.join("\u0000") !== serverIds.join("\u0000")) throw new Error("automation_server_registry_drift");
}

assertServerRegistryParity();

export { getToolMetadata, listTools, searchToolCommands };
