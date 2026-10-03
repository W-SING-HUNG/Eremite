"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Download, Expand, FileClock, FileText, Info, ListPlus, Maximize2, Minus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import type { RendererControls, ViewerDescriptor, ViewerFailureCode, ViewerMode } from "@/modules/viewer/contracts";
import { normalizeViewerPageInput, resolveViewerControlKey, viewerSessionKey } from "@/modules/viewer/controls";
import { Dialog } from "@/app/_components/ui/dialog";
import { Menu, MenuItem } from "@/app/_components/ui/menu";
import { ActionCreateDialog } from "@/app/_components/action/action-create-dialog";
import { showToast, ToastViewport } from "@/app/_components/ui/toast";
import type { ContentPickerItem } from "@/modules/inbox/service";
import type { Project } from "@/modules/projects/service";
import type { Tag } from "@/modules/tags/service";

const ImageRenderer = dynamic(() => import("@/app/_components/file-viewer/renderers/image-renderer").then((module) => module.ImageRenderer), { ssr: false, loading: ViewerLoading });
const TextRenderer = dynamic(() => import("@/app/_components/file-viewer/renderers/text-renderer").then((module) => module.TextRenderer), { ssr: false, loading: ViewerLoading });
const MarkdownRenderer = dynamic(() => import("@/app/_components/file-viewer/renderers/markdown-renderer").then((module) => module.MarkdownRenderer), { ssr: false, loading: ViewerLoading });
const DocxRenderer = dynamic(() => import("@/app/_components/file-viewer/renderers/docx-renderer").then((module) => module.DocxRenderer), { ssr: false, loading: ViewerLoading });
const PdfRenderer = dynamic(() => import("@/app/_components/file-viewer/renderers/pdf-renderer").then((module) => module.PdfRenderer), { ssr: false, loading: ViewerLoading });
const ArchiveRenderer = dynamic(() => import("@/app/_components/file-viewer/renderers/archive-renderer").then((module) => module.ArchiveRenderer), { ssr: false, loading: ViewerLoading });
const VideoRenderer = dynamic(() => import("@/app/_components/file-viewer/renderers/video-renderer").then((module) => module.VideoRenderer), { ssr: false, loading: ViewerLoading });
const TextEditor = dynamic(() => import("@/app/_components/file-viewer/text-editor").then((module) => module.TextEditor), { ssr: false, loading: ViewerLoading });
const FileLifecycleDrawer = dynamic(() => import("@/app/_components/file-viewer/file-lifecycle-drawer").then((module) => module.FileLifecycleDrawer), { ssr: false });

const failureCopy: Record<ViewerFailureCode, { title: string; detail: string }> = {
  ready: { title: "文件已就绪", detail: "" },
  unsupported: { title: "暂不支持站内预览", detail: "Eremite 会保留原文件，但不会用不可靠的方式强行显示它。" },
  too_large: { title: "文件过大，未启动预览", detail: "为避免浏览器失去响应，请下载原文件后使用专业软件查看。" },
  missing: { title: "本地原文件缺失", detail: "资料记录仍在，但存储文件不存在。请先从备份恢复。" },
  integrity_error: { title: "文件完整性校验失败", detail: "当前文件与保存时的校验值不一致，Eremite 已阻止预览和下载。" },
  corrupted: { title: "文件存在，但无法解析", detail: "完整性校验已通过；文件内容可能损坏、加密或包含暂不支持的结构。" },
  load_failed: { title: "预览加载失败", detail: "读取过程中发生了临时错误，可以重试或下载原文件检查。" },
};

export function ViewerLoading() {
  return <div className="viewer-loading" role="status"><span className="viewer-spinner" /><p>正在准备预览…</p></div>;
}

export function QuickViewerStatusShell({ status, onClose, onRetry }: {
  status: "loading" | "failed";
  onClose: () => void;
  onRetry?: () => void;
}) {
  return <section className="viewer-shell viewer-quick" aria-label="文件快速预览">
    <header className="viewer-toolbar">
      <div className="viewer-title-block"><button className="viewer-icon-button" type="button" onClick={onClose} aria-label="关闭快速预览"><X size={18} /></button><span className="viewer-file-icon"><FileText size={18} /></span><span><strong>文件预览</strong><small>{status === "loading" ? "正在读取文件信息" : "文件信息暂时不可用"}</small></span></div>
    </header>
    <div className="viewer-stage">{status === "loading"
      ? <ViewerLoading />
      : <div className="viewer-failure" role="alert"><span><AlertTriangle size={26} /></span><h2>无法读取文件信息</h2><p>读取过程发生了临时错误，资料库仍可继续使用。</p>{onRetry && <div><button className="quiet-button" type="button" onClick={onRetry}><RotateCcw size={16} />重试</button></div>}</div>}
    </div>
  </section>;
}

type ViewerShellProps = {
  descriptor: ViewerDescriptor;
  mode: ViewerMode;
  returnHref?: string;
  onClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCreateAction?: () => void;
  onProcessContent?: () => void;
  processingHref?: string;
  actionCreateContext?: { sourceContent: ContentPickerItem; projects: Project[]; availableTags: Tag[] };
};

export function ViewerShell(props: ViewerShellProps) {
  const { descriptor, mode } = props;
  return <><ViewerSession key={viewerSessionKey(descriptor.contentId, mode, descriptor.versionId)} {...props} />{mode === "full" && <ToastViewport />}</>;
}

function ViewerSession({ descriptor, mode, returnHref, onClose, onPrevious, onNext, onCreateAction, onProcessContent, processingHref, actionCreateContext }: ViewerShellProps) {
  const router = useRouter();
  const [effectiveReturnHref, setEffectiveReturnHref] = useState(returnHref ?? `/inbox?selected=${descriptor.contentId}`);
  const [controls, setControls] = useState<RendererControls | null>(null);
  const [runtimeFailure, setRuntimeFailure] = useState<"corrupted" | "load_failed" | "too_large" | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [fileInfoOpen, setFileInfoOpen] = useState(false);
  const [createActionOpen, setCreateActionOpen] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const failure = runtimeFailure ?? (descriptor.availability === "ready" ? null : descriptor.availability);
  const sourceUrl = descriptor.contentUrl;
  const downloadUrl = descriptor.downloadUrl;
  const canDownload = !["missing", "integrity_error"].includes(descriptor.availability);

  useEffect(() => {
    if (mode !== "full") return;
    const stored = sessionStorage.getItem(`eremite:viewer-return:${descriptor.contentId}`);
    if (stored?.startsWith("/") && !stored.startsWith("//")) setEffectiveReturnHref(stored);
  }, [descriptor.contentId, mode]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || editing || lifecycleOpen) return;
      if (isEditableTarget(event.target)) return;
      const action = resolveViewerControlKey(event.key, {
        close: Boolean(onClose || effectiveReturnHref),
        zoomIn: Boolean(controls?.zoomIn),
        zoomOut: Boolean(controls?.zoomOut),
        resetView: Boolean(controls?.resetView),
        pagination: Boolean(controls?.previousPage && controls?.nextPage),
      });
      if (!action) return;
      event.preventDefault();
      switch (action) {
        case "close": if (onClose) onClose(); else router.push(effectiveReturnHref); break;
        case "zoom_in": controls?.zoomIn?.(); break;
        case "zoom_out": controls?.zoomOut?.(); break;
        case "reset_view": controls?.resetView?.(); break;
        case "previous_page": controls?.previousPage?.(); break;
        case "next_page": controls?.nextPage?.(); break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [controls, editing, effectiveReturnHref, lifecycleOpen, onClose, router]);

  const handleFailure = useCallback((nextFailure: "corrupted" | "load_failed" | "too_large") => {
    setControls(null);
    setRuntimeFailure(nextFailure);
  }, []);
  const renderer = useMemo(() => {
    if (failure) return null;
    const props = { descriptor, mode, sourceUrl, onControlsChange: setControls, onFailure: handleFailure };
    const rendererKey = `${descriptor.contentId}:${descriptor.versionId}:${retryKey}`;
    switch (descriptor.kind) {
      case "pdf": return <PdfRenderer key={rendererKey} {...props} />;
      case "image": return <ImageRenderer key={rendererKey} {...props} />;
      case "text": return <TextRenderer key={rendererKey} {...props} />;
      case "markdown": return <MarkdownRenderer key={rendererKey} {...props} />;
      case "docx": return <DocxRenderer key={rendererKey} {...props} />;
      case "archive": return <ArchiveRenderer key={rendererKey} {...props} />;
      case "video": return <VideoRenderer key={rendererKey} {...props} />;
      default: return null;
    }
  }, [descriptor, failure, handleFailure, mode, retryKey, sourceUrl]);

  const closeControl = mode === "quick"
    ? <button className="viewer-icon-button" type="button" onClick={onClose} aria-label="关闭快速预览"><X size={18} /></button>
    : <Link className="viewer-back" href={effectiveReturnHref}><ArrowLeft size={18} /><span>返回资料</span></Link>;

  return <section className={`viewer-shell viewer-${mode}`} aria-label={`${descriptor.title} 文件查看器`}>
    <header className="viewer-toolbar">
      <div className="viewer-title-block">{closeControl}<span className="viewer-file-icon"><FileText size={18} /></span><span><strong title={descriptor.title}>{descriptor.title}</strong><small title={descriptor.originalName}>{descriptor.originalName} · {formatBytes(descriptor.byteSize)}</small></span></div>
      <div className="viewer-controls" aria-label="查看控制">
        {!editing && controls?.zoomOut && <button type="button" onClick={controls.zoomOut} aria-label="缩小" title="缩小（-）"><Minus size={16} /></button>}
        {!editing && controls?.zoomPercent && <span className="viewer-zoom-label">{controls.zoomPercent}%</span>}
        {!editing && controls?.zoomIn && <button type="button" onClick={controls.zoomIn} aria-label="放大" title="放大（+）"><Plus size={16} /></button>}
        {!editing && controls?.resetView && <button type="button" onClick={controls.resetView} aria-label={controls.resetViewLabel ?? "重置视图"} title={`${controls.resetViewLabel ?? "重置视图"}（0）`}><Maximize2 size={16} /></button>}
        {!editing && controls?.pageCount && <><span className="viewer-control-divider" /><button type="button" onClick={controls.previousPage} disabled={controls.page === 1} aria-label="上一页" title="上一页（Page Up）"><ChevronLeft size={16} /></button><label className="viewer-page-control"><span className="sr-only">页码</span><input key={controls.page} defaultValue={controls.page ?? 1} onBlur={(event) => { const page = normalizeViewerPageInput(event.target.value, controls.pageCount ?? 0); if (page) controls.setPage?.(page); else event.target.value = String(controls.page ?? 1); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} inputMode="numeric" /> / {controls.pageCount}</label><button type="button" onClick={controls.nextPage} disabled={controls.page === controls.pageCount} aria-label="下一页" title="下一页（Page Down）"><ChevronRight size={16} /></button></>}
      </div>
      <div className="viewer-actions">
        {onPrevious && <button className="viewer-icon-button" type="button" onClick={onPrevious} aria-label="上一份资料"><ChevronLeft size={18} /></button>}
        {onNext && <button className="viewer-icon-button" type="button" onClick={onNext} aria-label="下一份资料"><ChevronRight size={18} /></button>}
        {mode === "quick" && <Link className="quiet-button viewer-full-link" href={`/viewer/${descriptor.contentId}`} onClick={() => { if (returnHref) sessionStorage.setItem(`eremite:viewer-return:${descriptor.contentId}`, returnHref); }}><Expand size={16} />全屏查看</Link>}
        {mode === "full" && descriptor.isCurrent && ["text", "markdown"].includes(descriptor.kind) && descriptor.availability === "ready" && !editing && <button ref={editTriggerRef} className="quiet-button viewer-edit-button" type="button" onClick={() => { setLifecycleOpen(false); setEditing(true); }}><Pencil size={15} />编辑</button>}
        {!editing && <Menu label="文件菜单">
          {canDownload && <a role="menuitem" tabIndex={-1} className="menu-item" href={descriptor.isCurrent ? `/files/${descriptor.contentId}/download` : downloadUrl}><Download size={15} />{descriptor.isCurrent ? "下载当前版本" : "下载此版本"}</a>}
          {mode === "full" && <MenuItem onClick={() => setLifecycleOpen(true)}><FileClock size={15} />版本历史</MenuItem>}
          <MenuItem onClick={() => setFileInfoOpen(true)}><Info size={15} />文件信息</MenuItem>
          {mode === "full" && processingHref && <Link role="menuitem" tabIndex={-1} className="menu-item" href={processingHref}><CheckCircle2 size={15} />处理资料</Link>}
          {mode === "full" && actionCreateContext && <MenuItem onClick={() => setCreateActionOpen(true)}><ListPlus size={15} />创建行动</MenuItem>}
        </Menu>}
      </div>
    </header>
    {mode === "quick" && onProcessContent && <div className="quick-viewer-actions"><button type="button" onClick={onProcessContent}>处理资料</button></div>}
    {mode === "quick" && !onProcessContent && onCreateAction && <div className="quick-viewer-actions"><button type="button" onClick={onCreateAction}>创建行动</button></div>}
    <div className="viewer-stage">
      {editing ? <TextEditor descriptor={descriptor} onClose={() => { setEditing(false); window.requestAnimationFrame(() => editTriggerRef.current?.focus()); }} onSaved={() => router.refresh()} /> : failure ? <ViewerFailure descriptor={descriptor} failure={failure} canDownload={canDownload} downloadUrl={downloadUrl} onRetry={runtimeFailure ? () => { setControls(null); setRuntimeFailure(null); setRetryKey((key) => key + 1); } : undefined} /> : renderer}
    </div>
    <FileLifecycleDrawer open={mode === "full" && lifecycleOpen} onClose={() => setLifecycleOpen(false)} descriptor={descriptor} onChanged={() => router.refresh()} />
    <Dialog open={fileInfoOpen} onClose={() => setFileInfoOpen(false)} title="文件信息" className="compact-dialog"><dl className="viewer-file-facts"><div><dt>文件名</dt><dd>{descriptor.originalName}</dd></div><div><dt>类型</dt><dd>{descriptor.detectedMimeType}</dd></div><div><dt>大小</dt><dd>{formatBytes(descriptor.byteSize)}</dd></div><div><dt>当前版本</dt><dd>v{descriptor.versionNumber}</dd></div><div><dt>添加时间</dt><dd>{new Date(descriptor.createdAt).toLocaleString("zh-CN")}</dd></div></dl>{descriptor.formatMismatch && <p className="lifecycle-note">检测到的格式与文件声明不一致，已按实际格式显示。</p>}</Dialog>
    {actionCreateContext && <ActionCreateDialog open={mode === "full" && createActionOpen} onClose={() => setCreateActionOpen(false)} projects={actionCreateContext.projects} availableTags={actionCreateContext.availableTags} sourceContent={actionCreateContext.sourceContent} onCreated={(id) => { setCreateActionOpen(false); showToast({ title: "行动已创建", tone: "success", action: { label: "查看行动", href: `/actions?selected=${encodeURIComponent(id)}` } }); router.refresh(); }} />}
  </section>;
}

function ViewerFailure({ descriptor, failure, canDownload, downloadUrl, onRetry }: { descriptor: ViewerDescriptor; failure: ViewerFailureCode; canDownload: boolean; downloadUrl: string; onRetry?: () => void }) {
  const copy = failure === "unsupported" && /\.doc$/i.test(descriptor.originalName)
    ? { title: "旧版 Word 文件暂不支持预览", detail: "可以下载原文件后使用 Word 打开，或另存为 .docx 后再存入 Eremite。" }
    : failureCopy[failure];
  return <div className="viewer-failure" role="alert"><span><AlertTriangle size={26} /></span><h2>{copy.title}</h2><p>{copy.detail}</p><div>{onRetry && <button className="quiet-button" type="button" onClick={onRetry}><RotateCcw size={16} />重试</button>}{canDownload && <a className="primary-button" href={downloadUrl}><Download size={16} />下载原文件</a>}</div></div>;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || Boolean(target.closest('[role="textbox"]'));
}
