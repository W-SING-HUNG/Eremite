import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeViewerPageInput, resolveViewerControlKey, viewerSessionKey } from "@/modules/viewer/controls";

const all = { close: true, zoomIn: true, zoomOut: true, resetView: true, pagination: true };
assert.equal(resolveViewerControlKey("Escape", all), "close");
assert.equal(resolveViewerControlKey("+", all), "zoom_in");
assert.equal(resolveViewerControlKey("=", all), "zoom_in");
assert.equal(resolveViewerControlKey("-", all), "zoom_out");
assert.equal(resolveViewerControlKey("0", all), "reset_view");
assert.equal(resolveViewerControlKey("PageUp", all), "previous_page");
assert.equal(resolveViewerControlKey("PageDown", all), "next_page");
assert.equal(resolveViewerControlKey("PageDown", { ...all, pagination: false }), null);
assert.equal(resolveViewerControlKey("0", { ...all, resetView: false }), null);
assert.equal(resolveViewerControlKey("ArrowDown", all), null);

assert.equal(normalizeViewerPageInput("2", 5), 2);
assert.equal(normalizeViewerPageInput(" 3 ", 5), 3);
assert.equal(normalizeViewerPageInput("0", 5), 1);
assert.equal(normalizeViewerPageInput("99", 5), 5);
assert.equal(normalizeViewerPageInput("2.5", 5), null);
assert.equal(normalizeViewerPageInput("abc", 5), null);
assert.equal(normalizeViewerPageInput("", 5), null);
assert.equal(viewerSessionKey("file-a", "quick", "version-a"), "quick:file-a:version-a");
assert.equal(viewerSessionKey("file-a", "full", "version-a"), "full:file-a:version-a");
assert.notEqual(viewerSessionKey("file-a", "full", "version-a"), viewerSessionKey("file-b", "full", "version-a"));
assert.notEqual(viewerSessionKey("file-a", "full", "version-a"), viewerSessionKey("file-a", "full", "version-b"));

const viewerRoot = path.join(process.cwd(), "src", "app", "_components", "file-viewer");
const [shell, quickViewer, styles, pdf, image, docx, text, markdown, archive] = await Promise.all([
  readFile(path.join(viewerRoot, "viewer-shell.tsx"), "utf8"),
  readFile(path.join(viewerRoot, "quick-viewer.tsx"), "utf8"),
  readFile(path.join(process.cwd(), "src", "app", "styles.css"), "utf8"),
  readFile(path.join(viewerRoot, "renderers", "pdf-renderer.tsx"), "utf8"),
  readFile(path.join(viewerRoot, "renderers", "image-renderer.tsx"), "utf8"),
  readFile(path.join(viewerRoot, "renderers", "docx-renderer.tsx"), "utf8"),
  readFile(path.join(viewerRoot, "renderers", "text-renderer.tsx"), "utf8"),
  readFile(path.join(viewerRoot, "renderers", "markdown-renderer.tsx"), "utf8"),
  readFile(path.join(viewerRoot, "renderers", "archive-renderer.tsx"), "utf8"),
]);
assert.match(shell, /<ViewerSession key=\{viewerSessionKey\(descriptor\.contentId, mode, descriptor\.versionId\)\}/);
assert.doesNotMatch(shell, /useEffect\(\(\) => \{\s*setControls\(null\);\s*setRuntimeFailure\(null\);\s*\}, \[descriptor\.contentId\]\)/);
assert.match(shell, /setControls\(null\);\s*setRuntimeFailure\(nextFailure\)/);
assert.match(shell, /setControls\(null\); setRuntimeFailure\(null\); setRetryKey/);
assert.doesNotMatch(shell, /onControlsChange:\s*\([^)]*\)\s*=>/);
assert.match(quickViewer, /setDescriptor\(null\); setFailed\(false\)/);
const inboxWorkspace = await readFile(path.join(process.cwd(), "src", "app", "_components", "inbox-workspace.tsx"), "utf8");
assert.match(inboxWorkspace, /<QuickViewer key=\{previewId\} contentId=\{previewId\}/);
assert.match(pdf, /resetViewLabel: "适合宽度"/);
assert.match(pdf, /pageCount, previousPage, nextPage, setPage/);
assert.match(image, /resetViewLabel: "适合窗口"/);
assert.match(docx, /resetViewLabel: "适合宽度"/);
assert.match(docx, /new globalThis\.ResizeObserver/);
assert.match(docx, /horizontalPadding/);
assert.match(docx, /fitModeRef\.current = false/);
assert.match(text, /resetViewLabel: "恢复 100%"/);
assert.match(markdown, /resetViewLabel: "恢复 100%"/);
assert.doesNotMatch(archive, /onControlsChange/);
assert.doesNotMatch(archive, /zoomIn|zoomOut|resetView/);
assert.match(shell, /mode === "full" && actionCreateContext && <MenuItem onClick=\{\(\) => setCreateActionOpen\(true\)\}/);
assert.match(shell, /mode === "quick" && onProcessContent && <div className="quick-viewer-actions"/);
assert.match(shell, /mode === "quick" && !onProcessContent && onCreateAction && <div className="quick-viewer-actions"/);
assert.match(shell, /processingHref.*处理资料/s);
assert.match(shell, /<ListPlus size=\{15\} \/>创建行动/);
assert.doesNotMatch(shell, /router\.push\(`\/actions\?createFor=/);
assert.match(quickViewer, /QuickViewerStatusShell status="loading"/);
assert.match(quickViewer, /QuickViewerStatusShell status="failed"/);
assert.doesNotMatch(styles, /viewer-toolbar-placeholder|viewer-inline-error/);
assert.doesNotMatch([shell, pdf, image, docx, text, markdown, archive].join("\n"), /\bfit\??:/);
assert.match(shell, /旧版 Word 文件暂不支持预览/);
for (const renderer of [pdf, image, docx, text, markdown]) {
  assert.match(renderer, /zoomPercent: zoom/);
  assert.match(renderer, /zoomIn, zoomOut, resetView/);
}
assert.match(pdf, /onControlsChange\(loading \|\| pageCount === 0 \? null : controls\)/);
assert.match(image, /onControlsChange\(loaded \? controls : null\)/);
assert.match(docx, /onControlsChange\(loading \? null : controls\)/);
assert.match(text, /onControlsChange\(encoding \? controls : null\)/);
assert.match(markdown, /onControlsChange\(content === null \? null : controls\)/);
assert.equal([shell, pdf, image, docx, text, markdown, archive].join("\n").match(/className="viewer-controls"/g)?.length, 1);

console.log("Viewer controls test passed: keyed sessions prevent control races across loading, retry, mode and file changes.");
