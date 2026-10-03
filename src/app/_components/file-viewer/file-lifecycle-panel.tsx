"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileClock, RotateCcw, Upload, X } from "lucide-react";
import type { ViewerDescriptor } from "@/modules/viewer/contracts";
import { AlertDialog } from "@/app/_components/ui/dialog";
import { Menu, MenuItem } from "@/app/_components/ui/menu";

type Version = { id: string; version_number: number; original_name: string; byte_size: number; sha256: string; change_source: string; created_at: string; is_current: number };
const changeLabels: Record<string, string> = { upload: "首次上传", replace: "替换文件", text_edit: "文本编辑", restore: "历史恢复", migration: "历史迁移" };

export function FileLifecyclePanel({ descriptor, onChanged }: { descriptor: ViewerDescriptor; onChanged: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Version | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/files/${encodeURIComponent(descriptor.contentId)}/versions`);
      if (!response.ok) throw new Error("history_load_failed");
      const payload = await response.json() as { versions: Version[] };
      setVersions(payload.versions); setError("");
    } catch { setError("无法载入版本历史。当前文件没有被修改。"); }
    finally { setLoading(false); }
  }, [descriptor.contentId]);
  useEffect(() => { void load(); }, [descriptor.versionId, load]);

  const replace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const file = new FormData(form).get("file");
    if (!(file instanceof globalThis.File)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/uploads/files/${encodeURIComponent(descriptor.contentId)}`, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "x-eremite-file-name": encodeURIComponent(file.name), "x-eremite-file-size": String(file.size), "if-match": `"${descriptor.versionId}"`, "idempotency-key": crypto.randomUUID() },
        body: file,
      });
      const payload = await response.json();
      if (response.status === 412) setError("当前版本已在此操作期间改变。所选文件没有成为新版本；请刷新后重新选择。");
      else if (!response.ok) setError(payload.code === "file_too_large" ? "文件超过 512 MiB 上限；当前版本保持不变。" : "替换失败；当前版本保持不变，可以重试。");
      else { form.reset(); setSelectedFileName(""); setReplaceOpen(false); setSuccess("替换内容已保存为新的当前版本，原版本仍保留。"); await load(); onChanged(); }
    } catch { setError("替换连接中断；当前版本保持不变，可以重试。"); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    if (!restoreTarget || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/files/${encodeURIComponent(descriptor.contentId)}/versions/${encodeURIComponent(restoreTarget.id)}/restore`, { method: "POST", headers: { "if-match": `"${descriptor.versionId}"`, "idempotency-key": crypto.randomUUID() } });
      if (response.status === 412) { setRestoreTarget(null); setError("当前版本已在此操作期间改变。没有执行恢复；请刷新版本历史后重试。"); }
      else if (!response.ok) { setRestoreTarget(null); setError("恢复失败；当前版本保持不变。"); }
      else { setSuccess(`v${restoreTarget.version_number} 的内容已复制为新的当前版本，原历史没有被改写。`); setRestoreTarget(null); await load(); onChanged(); }
    } catch { setRestoreTarget(null); setError("恢复连接中断；当前版本保持不变。"); }
    finally { setBusy(false); }
  };

  return <div className="file-lifecycle-panel">
    <div className="version-history-heading"><span className="version-count"><FileClock size={15} />{loading ? "正在载入…" : `${versions.length} 个版本`}</span>{descriptor.isCurrent && <button className="quiet-button" type="button" onClick={() => setReplaceOpen((open) => !open)} aria-expanded={replaceOpen}><Upload size={15} />替换文件</button>}</div>
    {replaceOpen && <section className="replace-file-section"><header><div><h4>保存新的当前版本</h4><p>资料身份和稳定链接不会改变，旧内容继续保留在历史中。</p></div><button className="icon-button" type="button" onClick={() => setReplaceOpen(false)} aria-label="关闭替换文件"><X size={15} /></button></header><form onSubmit={replace}><label className="file-drop-control"><input type="file" name="file" required disabled={busy} onChange={(event) => setSelectedFileName(event.target.files?.[0]?.name ?? "")} /><span>{selectedFileName || "选择本地文件"}</span></label><button className="primary-button" disabled={busy || !selectedFileName}>{busy ? "正在保存…" : "保存新版本"}</button></form></section>}
    {!descriptor.isCurrent && <p className="lifecycle-note">你正在查看历史版本。返回当前版本后才能替换或恢复。</p>}
    {error && <div className="lifecycle-feedback error" role="alert"><span>{error}</span><button className="quiet-button" type="button" onClick={() => void load()} disabled={loading}>重试</button></div>}
    {success && <p className="lifecycle-feedback success" role="status">{success}</p>}
    <section className="version-history-content">
      {loading ? <div className="panel-empty" role="status">正在载入版本历史…</div> : versions.length === 0 ? <div className="panel-empty">还没有版本记录。</div> : <ol>{versions.map((version) => <li className={version.is_current ? "current" : ""} key={version.id}>
        <span className="version-marker">v{version.version_number}</span><span className="version-summary"><strong>{version.is_current ? "当前版本" : version.original_name}</strong><small>{new Date(version.created_at).toLocaleString("zh-CN")} · {changeLabels[version.change_source] ?? "文件更新"}</small></span>
        <Menu label={`v${version.version_number} 版本操作`}>
          <Link role="menuitem" tabIndex={-1} className="menu-item" href={`/viewer/${descriptor.contentId}?version=${version.id}`}><Eye size={15} />查看此版本</Link>
          <a role="menuitem" tabIndex={-1} className="menu-item" href={`/files/${descriptor.contentId}/versions/${version.id}/download`}><Download size={15} />下载此版本</a>
          {!version.is_current && descriptor.isCurrent && <MenuItem onClick={() => setRestoreTarget(version)}><RotateCcw size={15} />恢复为当前版本</MenuItem>}
        </Menu>
      </li>)}</ol>}
    </section>
    <AlertDialog open={Boolean(restoreTarget)} onClose={() => setRestoreTarget(null)} title={restoreTarget ? `将 v${restoreTarget.version_number} 恢复为新的当前版本？` : "恢复历史版本"} description="所选内容会复制为新版本；当前版本和全部历史都不会被覆盖或删除。" className="danger-dialog"><div className="dialog-actions"><button data-dialog-initial-focus className="quiet-button" type="button" onClick={() => setRestoreTarget(null)}>取消</button><button className="primary-button" type="button" onClick={restore} disabled={busy}>{busy ? "正在恢复…" : "恢复为新版本"}</button></div></AlertDialog>
  </div>;
}
