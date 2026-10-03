import Link from "next/link";
import { Download, ExternalLink, FolderOpen } from "lucide-react";
import type { AutomationRun } from "@/modules/automations/service";

export function FileConverterResultRenderer({ run }: { run: AutomationRun }) {
  if (run.status !== "completed" || !run.output_payload_json) return null;
  let payload: { contentId: string; originalName: string; mimeType: string; byteSize: number; previewable: boolean; supplier: { engine: { id: string; version: string }; warnings: string[] } };
  try { payload = JSON.parse(run.output_payload_json); } catch { return <p className="run-error-copy">运行结果记录无法读取。</p>; }
  return <div className="file-converter-result">
    <dl className="run-facts"><div><dt>文件</dt><dd>{payload.originalName}</dd></div><div><dt>格式</dt><dd>{payload.mimeType}</dd></div><div><dt>大小</dt><dd>{formatBytes(payload.byteSize)}</dd></div><div><dt>引擎</dt><dd>{payload.supplier.engine.id} · {payload.supplier.engine.version}</dd></div></dl>
    {payload.supplier.warnings.length > 0 && <div className="file-converter-warnings"><strong>注意</strong>{payload.supplier.warnings.map((code) => <span key={code}>{warningLabel(code)}</span>)}</div>}
    {!payload.previewable && <p className="file-converter-preview-note">当前查看器暂不支持此格式，可在资料库定位或直接下载。</p>}
    <div className="file-converter-result-actions">
      {payload.previewable && <Link className="quiet-button" href={`/viewer/${encodeURIComponent(payload.contentId)}`}><ExternalLink size={14} />打开查看器</Link>}
      <Link className="quiet-button" href={`/inbox?selected=${encodeURIComponent(payload.contentId)}`}><FolderOpen size={14} />在资料库中显示</Link>
      <a className="quiet-button" href={`/files/${encodeURIComponent(payload.contentId)}/download`}><Download size={14} />下载</a>
    </div>
  </div>;
}

const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const warningLabels: Record<string, string> = {
  FC_DECLARED_TYPE_MISMATCH: "声明的文件类型与实际内容不一致，已按实际内容处理。",
  FC_EXTENSION_MISMATCH: "扩展名与实际类型不一致，已按实际类型处理。",
  FC_FALLBACK_USED: "首选转换方式不可用，已使用受支持的备用方式。",
  FC_METADATA_DROPPED: "部分非核心元数据未保留。",
  FC_OUTPUT_NORMALIZED: "输出已按目标格式规范化。",
  FC_LOSSY_REENCODE: "输出使用有损压缩。",
  FC_CMYK_NO_ICC: "来源缺少 ICC 色彩配置，颜色可能略有差异。",
  FC_ALPHA_FLATTENED: "透明区域已合并到背景。",
};
const warningLabel = (code: string) => warningLabels[code] ?? "转换完成，但包含一项未识别的兼容性提示。";
