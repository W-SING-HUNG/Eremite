export type Probe = { success: boolean; text: boolean; structuredOutput: boolean; toolCalling: boolean };

export function probeDiagnostics(probe: Probe): string[] {
  return [
    ...(!probe.text ? ["Text 未通过：可检查 Base URL、Model ID、凭据和网络连接。"] : []),
    ...(!probe.structuredOutput ? ["Structured Output 未通过：可检查模型是否支持严格结构化输出或工具调用回退。"] : []),
    ...(!probe.toolCalling ? ["Tool Calling 未通过：可检查模型和服务是否支持强制工具调用。"] : []),
  ];
}
