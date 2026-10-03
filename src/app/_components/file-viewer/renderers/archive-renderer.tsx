"use client";

import { File as FileIcon, Folder, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { JSZipObject } from "jszip";
import { archiveEntryLimit, inspectZipDirectory, isUnsafeArchivePath, quickArchiveEntryLimit } from "@/modules/viewer/archive";
import type { RendererProps } from "@/modules/viewer/contracts";

type ArchiveEntry = {
  name: string;
  isDirectory: boolean;
  uncompressedSize: number | null;
  modifiedAt: Date | null;
  unsafePath: boolean;
};

type ZipEntryWithMetadata = JSZipObject & {
  unsafeOriginalName?: string;
  _data?: { uncompressedSize?: number };
};

export function ArchiveRenderer({ sourceUrl, mode, onFailure }: RendererProps) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [totalEntries, setTotalEntries] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setEntries(null);
    fetch(sourceUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Archive response failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then(async (bytes) => {
        const directory = inspectZipDirectory(bytes);
        if (!directory || directory.isMultiDisk) {
          onFailure("corrupted");
          return;
        }
        if (directory.isZip64 || directory.entryCount > archiveEntryLimit) {
          onFailure("too_large");
          return;
        }

        const { default: JSZip } = await import("jszip");
        const archive = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
        const allEntries = Object.values(archive.files)
          .map((entry): ArchiveEntry => {
            const metadata = entry as ZipEntryWithMetadata;
            const originalName = metadata.unsafeOriginalName ?? entry.name;
            return {
              name: entry.name.replaceAll("\\", "/"),
              isDirectory: entry.dir,
              uncompressedSize: typeof metadata._data?.uncompressedSize === "number" ? metadata._data.uncompressedSize : null,
              modifiedAt: entry.date instanceof Date && !Number.isNaN(entry.date.getTime()) ? entry.date : null,
              unsafePath: isUnsafeArchivePath(originalName),
            };
          })
          .sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name, "zh-CN"));
        if (controller.signal.aborted) return;
        const displayLimit = mode === "quick" ? quickArchiveEntryLimit : archiveEntryLimit;
        setTotalEntries(allEntries.length);
        setEntries(allEntries.slice(0, displayLimit));
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (error instanceof Error && /corrupt|zip|signature|central directory/i.test(error.message)) onFailure("corrupted");
        else onFailure("load_failed");
      });
    return () => controller.abort();
  }, [mode, onFailure, sourceUrl]);

  if (!entries) return <div className="viewer-loading" role="status"><span className="viewer-spinner" /><p>正在读取 ZIP 目录…</p></div>;

  const unsafeCount = entries.filter((entry) => entry.unsafePath).length;
  return <div className="archive-renderer">
    <div className="archive-summary">
      <span><strong>{totalEntries}</strong> 个条目 · 只读目录，未解压任何文件</span>
      {unsafeCount > 0 && <span className="archive-warning"><ShieldAlert size={15} />发现 {unsafeCount} 个可疑路径，Eremite 不会解压它们</span>}
    </div>
    <div className="archive-table" role="table" aria-label="压缩包文件目录">
      <div className="archive-row archive-header" role="row">
        <span role="columnheader">名称与路径</span><span role="columnheader">类型</span><span role="columnheader">大小</span><span role="columnheader">修改时间</span>
      </div>
      {entries.length === 0
        ? <div className="archive-empty">这是一个空 ZIP 压缩包。</div>
        : entries.map((entry, index) => <div className={`archive-row${entry.unsafePath ? " is-unsafe" : ""}`} role="row" key={`${entry.name}:${index}`}>
          <span className="archive-name" role="cell" title={entry.name}>{entry.isDirectory ? <Folder size={16} /> : <FileIcon size={16} />}<span>{entry.name}</span></span>
          <span role="cell">{entry.isDirectory ? "文件夹" : "文件"}</span>
          <span role="cell">{entry.isDirectory || entry.uncompressedSize === null ? "—" : formatArchiveBytes(entry.uncompressedSize)}</span>
          <span role="cell">{entry.modifiedAt ? entry.modifiedAt.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
        </div>)}
    </div>
    {totalEntries > entries.length && <div className="archive-truncated">快速预览仅显示前 {entries.length} 项；进入全屏查看可浏览全部目录。</div>}
  </div>;
}

function formatArchiveBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
