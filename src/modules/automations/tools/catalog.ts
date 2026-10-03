export const CONTENT_TO_ACTION_DRAFTS_TOOL_ID = "core.content-to-action-drafts";
export const FILE_CONVERTER_TOOL_ID = "core.file-converter";
export const PDF_TOOLS_TOOL_ID = "core.pdf-tools";

export type ToolMetadata = {
  id: string;
  version: number;
  name: string;
  description: string;
  category: string;
  keywords: readonly string[];
  iconKey: "wand";
  supportedContexts: readonly ("global" | "project")[];
};

export const toolCatalog = [{
  id: CONTENT_TO_ACTION_DRAFTS_TOOL_ID,
  version: 1,
  name: "从资料生成行动草稿",
  description: "为选中的资料创建可审阅行动草稿。",
  category: "整理",
  keywords: ["资料", "行动", "草稿", "整理", "自动化"],
  iconKey: "wand",
  supportedContexts: ["global", "project"],
}, {
  id: FILE_CONVERTER_TOOL_ID,
  version: 1,
  name: "文件格式转换器",
  description: "将资料库中的文件转换为新的正式文件资料。",
  category: "文件",
  keywords: ["文件", "格式", "转换", "图片", "文档", "PDF"],
  iconKey: "wand",
  supportedContexts: ["global", "project"],
}, {
  id: PDF_TOOLS_TOOL_ID,
  version: 1,
  name: "PDF 工具",
  description: "合并、拆分、提取、旋转或重排 PDF 页面。",
  category: "文件",
  keywords: ["PDF", "合并", "拆分", "提取页面", "旋转", "重排"],
  iconKey: "wand",
  supportedContexts: ["global", "project"],
}] as const satisfies readonly ToolMetadata[];

export type ToolId = (typeof toolCatalog)[number]["id"];

export function getToolMetadata(id: string) {
  return toolCatalog.find((tool) => tool.id === id) ?? null;
}

export function listTools(context: "global" | "project") {
  return toolCatalog.filter((tool) => tool.supportedContexts.includes(context));
}

export function searchToolCommands(query: string, context: "global" | "project") {
  const key = query.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  return listTools(context).filter((tool) => !key || [tool.name, tool.description, tool.category, ...tool.keywords].some((value) => value.toLocaleLowerCase("zh-CN").includes(key)));
}
