import Link from "next/link";
import { Download, ExternalLink, FolderOpen } from "lucide-react";
import type { AutomationRun } from "@/modules/automations/service";

type Payload = {
  schemaVersion: 1;
  operation: string;
  outputs: Array<{ contentId: string; originalName: string; mimeType: string; byteSize: number; pageCount: number }>;
  supplier: { packageVersion: string; qpdfVersion: string; warnings: string[] };
};

export function PdfToolsResultRenderer({ run }: { run: AutomationRun }) {
  if (run.status !== "completed" || !run.output_payload_json) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(run.output_payload_json);
  } catch {
    return <p className="run-error-copy">运行结果记录无法读取。</p>;
  }
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.outputs) || payload.outputs.length < 1) return <p className="run-error-copy">运行结果记录不完整。</p>;
  return <div className="pdf-tools-result">
    <p className="pdf-tools-result-summary">{operationLabel(payload.operation)}完成 · {payload.outputs.length} 个 PDF · qpdf {payload.supplier.qpdfVersion}</p>
    <ol className="pdf-tools-output-list">
      {payload.outputs.map((output, index) => <li key={output.contentId}>
        <div><b>{index + 1}</b><span><strong>{output.originalName}</strong><small>{output.pageCount} 页 · {formatBytes(output.byteSize)}</small></span></div>
        <span className="pdf-tools-output-actions">
          <Link href={`/viewer/${encodeURIComponent(output.contentId)}`} aria-label={`查看 ${output.originalName}`}><ExternalLink size={14} /></Link>
          <Link href={`/inbox?selected=${encodeURIComponent(output.contentId)}`} aria-label={`在资料库中显示 ${output.originalName}`}><FolderOpen size={14} /></Link>
          <a href={`/files/${encodeURIComponent(output.contentId)}/download`} aria-label={`下载 ${output.originalName}`}><Download size={14} /></a>
        </span>
      </li>)}
    </ol>
    {payload.supplier.warnings.length > 0 && <div className="pdf-tools-warnings"><strong>注意</strong>{payload.supplier.warnings.map((code, index) => <span key={`${code}:${index}`}>{warningLabel(code)}</span>)}</div>}
  </div>;
}

const operationLabel = (operation: string) => ({ "pdf.merge": "合并", "pdf.split": "拆分", "pdf.extract": "提取", "pdf.rotate": "旋转", "pdf.reorder": "重排" })[operation] ?? "PDF 操作";
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const warningLabel = (code: string) => ({
  "w.duplicate_page_emitted": "输出包含按要求重复的页面。",
  "w.document_features_dropped": "拆分可能不会保留部分文档级功能。",
})[code] ?? "操作完成，但包含一项未识别的兼容性提示。";
