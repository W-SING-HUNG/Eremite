"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Info, RotateCcw } from "lucide-react";
import { AlertDialog } from "@/app/_components/ui/dialog";
import { Popover } from "@/app/_components/ui/popover";
import { CheckboxField } from "@/app/_components/ui/field";
import { showToast } from "@/app/_components/ui/toast";
import type { ViewerDescriptor } from "@/modules/viewer/contracts";

type TextDocument = { contentId: string; versionId: string; text: string; encoding: string; newline: string; mixedNewlines: boolean };
type PendingNavigation = "close" | "reload" | string | null;

export function TextEditor({ descriptor, onClose, onSaved }: { descriptor: ViewerDescriptor; onClose: () => void; onSaved: () => void }) {
  const [textDocument, setTextDocument] = useState<TextDocument | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<{ currentVersionId: string; localText: string } | null>(null);
  const [convertToUtf8, setConvertToUtf8] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>(null);
  const baseText = useRef("");
  const dirty = textDocument !== null && text !== baseText.current;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/files/${encodeURIComponent(descriptor.contentId)}/text`);
      if (!response.ok) throw new Error("无法载入可编辑文本。");
      const next = await response.json() as TextDocument;
      setTextDocument(next); setText(next.text); baseText.current = next.text; setConflict(null); setConvertToUtf8(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法载入可编辑文本。"); }
    finally { setLoading(false); }
  }, [descriptor.contentId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    const interceptNavigation = (event: MouseEvent) => {
      if (!dirty || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      event.preventDefault(); event.stopPropagation(); setPendingNavigation(anchor.href);
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", interceptNavigation, true);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("click", interceptNavigation, true); };
  }, [dirty]);

  const requestClose = useCallback(() => { if (dirty) setPendingNavigation("close"); else onClose(); }, [dirty, onClose]);

  const save = useCallback(async () => {
    if (!textDocument || saving || !dirty) return;
    setSaving(true); setError(""); setSavedAt(null); setConflict(null);
    try {
      const response = await fetch(`/files/${encodeURIComponent(textDocument.contentId)}/text`, {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": `"${textDocument.versionId}"`, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ text, convertToUtf8 }),
      });
      const payload = await response.json();
      if (response.status === 412) {
        setConflict({ currentVersionId: payload.currentVersionId, localText: text });
        setError("文件已由另一操作更新。你的本地内容仍保留；请复制本地内容或对照最新版本手动合并。");
        return;
      }
      if (!response.ok) {
        setError(payload.code === "unrepresentable_text" ? "当前编码无法表示新增字符。选择转换为 UTF-8 后再保存。" : "保存失败；编辑内容仍保留，可以重试。");
        return;
      }
      baseText.current = text;
      setTextDocument((current) => current ? { ...current, versionId: payload.versionId } : current);
      setSavedAt(new Date()); showToast({ title: "已保存为新版本", tone: "success" }); onSaved();
    } catch { setError("保存连接中断；编辑内容仍保留，可以重试。"); }
    finally { setSaving(false); }
  }, [convertToUtf8, dirty, onSaved, saving, text, textDocument]);

  const confirmDiscard = async () => {
    const destination = pendingNavigation; setPendingNavigation(null);
    if (destination === "close") { onClose(); return; }
    if (destination === "reload") { await load(); return; }
    if (destination) window.location.assign(destination);
  };

  if (loading && !textDocument) return <div className="viewer-loading" role="status"><span className="viewer-spinner" /><p>正在准备编辑器…</p></div>;
  if (!textDocument) return <div className="viewer-failure" role="alert"><h2>无法打开文本编辑器</h2><p>{error}</p><div><button className="quiet-button" type="button" onClick={onClose}>返回预览</button><button className="primary-button" type="button" onClick={() => void load()}><RotateCcw size={15} />重试</button></div></div>;

  return <section className="text-editor" aria-label="文本编辑器" onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
    if (event.key === "Escape") { event.preventDefault(); requestClose(); }
  }}>
    <header className="text-editor-toolbar"><div><strong>{descriptor.originalName}</strong>{saving ? <span>正在保存…</span> : dirty ? <span className="dirty-state">未保存</span> : savedAt ? <span className="saved-state"><CheckCircle2 size={14} />已保存</span> : <span>未修改</span>}</div><div className="text-editor-actions">
      <Popover label="文本信息" placement="bottom-end" className="text-info-popover" trigger={({ focusTrigger: _focusTrigger, ...props }) => <button {...props} className="icon-button" aria-label="文本信息"><Info size={16} /></button>}><dl><div><dt>编码</dt><dd>{textDocument.encoding.toUpperCase()}</dd></div><div><dt>换行</dt><dd>{textDocument.newline.toUpperCase()}</dd></div><div><dt>编辑基线</dt><dd>v{descriptor.versionNumber}</dd></div></dl>{textDocument.encoding !== "utf-8" && <CheckboxField className="encoding-option" checked={convertToUtf8} onChange={(event) => setConvertToUtf8(event.target.checked)} label="保存时转换为 UTF-8" />}</Popover>
      <button type="button" className="quiet-button" onClick={requestClose}>取消</button><button type="button" className="primary-button" onClick={() => void save()} disabled={saving || !dirty}>{saving ? "保存中…" : "保存新版本"}</button>
    </div></header>
    {textDocument.encoding !== "utf-8" && <p className="editor-encoding-notice"><AlertTriangle size={15} />当前文件使用 {textDocument.encoding.toUpperCase()}；默认保存会保留原编码，可在“文本信息”中选择转换。</p>}
    {textDocument.mixedNewlines && <p className="editor-warning">原文件包含混合换行符；保存时将按主要换行风格统一。</p>}
    {error && <p className="editor-error" role="alert">{error}</p>}
    {conflict && <section className="editor-conflict"><h3>版本冲突</h3><p>文件已由另一次操作保存为更新版本；你的本地内容仍然保留。</p><div><button className="quiet-button" type="button" onClick={() => navigator.clipboard.writeText(conflict.localText).catch(() => setError("无法访问剪贴板，请在编辑区手动复制本地内容。"))}><Copy size={14} />复制本地内容</button><button className="quiet-button" type="button" onClick={() => setPendingNavigation("reload")}><RotateCcw size={14} />放弃本地并载入最新版本</button></div></section>}
    <textarea autoFocus aria-label="文件内容" value={text} onChange={(event) => { setText(event.target.value); setSavedAt(null); }} spellCheck />
    <AlertDialog open={pendingNavigation !== null} onClose={() => setPendingNavigation(null)} title={pendingNavigation === "reload" ? "载入最新版本？" : "放弃未保存修改？"} description="当前编辑内容尚未保存；继续后无法从 Eremite 恢复这些本地修改。"><div className="dialog-actions"><button data-dialog-initial-focus type="button" className="quiet-button" onClick={() => setPendingNavigation(null)}>继续编辑</button><button type="button" className="danger-button" onClick={() => void confirmDiscard()}>{pendingNavigation === "reload" ? "放弃并重新载入" : "放弃修改"}</button></div></AlertDialog>
  </section>;
}
