"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Files, LoaderCircle, Search, X } from "lucide-react";
import { executeAutomationToolAction } from "@/app/actions";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { ControlField } from "@/app/_components/ui/field";
import { Select } from "@/app/_components/ui/select";
import { showToast } from "@/app/_components/ui/toast";
import { PDF_TOOLS_TOOL_ID } from "@/modules/automations/tools/catalog";

type Operation = "pdf.merge" | "pdf.split" | "pdf.extract" | "pdf.rotate" | "pdf.reorder";
type Option = { id: string; title: string; project_id: string | null; folder_id: string | null; originalName: string; byteSize: number };
type Folder = { id: string; path: string };
type Availability = {
  available: boolean;
  package: { status: "ready" | "unavailable"; version: string | null };
  qpdf: { status: "ready" | "unavailable"; version: string | null };
};

const operationOptions = [
  { value: "pdf.merge", label: "合并 PDF" },
  { value: "pdf.split", label: "拆分 PDF" },
  { value: "pdf.extract", label: "提取页面" },
  { value: "pdf.rotate", label: "旋转页面" },
  { value: "pdf.reorder", label: "重排页面" },
];

export function PdfToolsLauncher({ contextProjectId, readOnly, onRun }: { contextProjectId: string | null; readOnly: boolean; onRun: (runId: string) => void }) {
  const router = useRouter();
  const [operationId, setOperationId] = useState("");
  const [operation, setOperation] = useState<Operation>("pdf.merge");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Option[]>([]);
  const [selected, setSelected] = useState<Option[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [splitEvery, setSplitEvery] = useState("1");
  const [pageSelector, setPageSelector] = useState("1");
  const [pageOrder, setPageOrder] = useState("1");
  const [rotateAngle, setRotateAngle] = useState("90");
  const [rotateMode, setRotateMode] = useState("relative");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const first = selected[0] ?? null;
  const lockedProjectId = contextProjectId ?? first?.project_id ?? null;
  const constrainProject = contextProjectId !== null || selected.length > 0;
  const minimumInputs = operation === "pdf.merge" ? 2 : 1;
  const canRun = selected.length >= minimumInputs;

  useEffect(() => {
    setOperationId(crypto.randomUUID());
    fetch(`/api/automations/tools/${encodeURIComponent(PDF_TOOLS_TOOL_ID)}/availability`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setAvailability)
      .catch(() => setAvailability({ available: false, package: { status: "unavailable", version: null }, qpdf: { status: "unavailable", version: null } }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      const params = new URLSearchParams({ q: query, limit: "50" });
      if (constrainProject) {
        params.set("constrainProject", "1");
        if (lockedProjectId) params.set("projectId", lockedProjectId);
      }
      fetch(`/api/automations/tools/${encodeURIComponent(PDF_TOOLS_TOOL_ID)}/options?${params}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((payload: { items: Option[]; destinationFolders?: Folder[] }) => {
          setItems(payload.items);
          setFolders(payload.destinationFolders ?? []);
        })
        .catch((error) => {
          if (error?.name !== "AbortError") {
            setFailed(true);
            setItems([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, constrainProject, lockedProjectId]);

  const selectedIds = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);
  const choose = (item: Option) => {
    if (operation === "pdf.merge") {
      if (selectedIds.has(item.id)) {
        setSelected((current) => current.filter((entry) => entry.id !== item.id));
        return;
      }
      if (selected.length >= 32) return;
      setSelected((current) => [...current, item]);
      if (selected.length === 0) setFolderId(item.project_id ? item.folder_id ?? "" : "");
    } else {
      setSelected([item]);
      setFolderId(item.project_id ? item.folder_id ?? "" : "");
    }
  };
  const move = (index: number, direction: -1 | 1) => {
    setSelected((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const changeOperation = (next: string) => {
    setOperation(next as Operation);
    setSelected([]);
    setFolderId("");
  };

  if (readOnly) return <p className="lifecycle-banner">当前专案已归档，不能启动新运行。</p>;
  if (availability && !availability.available) return <div className="tool-input-state error" role="alert">PDF 工具组件未通过运行时身份检查，工具暂不可用。</div>;

  return <MutationForm action={executeAutomationToolAction} className="tool-launcher-form" onSuccess={({ objectId, status }) => {
    setOperationId(crypto.randomUUID());
    if (status === "failed") {
      showToast({ title: "PDF 操作失败", description: "运行记录已保存，可在详情中查看原因。", tone: "error" });
      router.refresh();
      return;
    }
    showToast({ title: "PDF 操作完成", tone: "success" });
    setSelected([]);
    onRun(objectId);
  }}>{({ pending }) => <>
    <input type="hidden" name="operationId" value={operationId} />
    <input type="hidden" name="toolId" value={PDF_TOOLS_TOOL_ID} />
    <input type="hidden" name="operation" value={operation} />
    {constrainProject && <input type="hidden" name="projectId" value={lockedProjectId ?? ""} />}
    {selected.map((item) => <input type="hidden" name="contentItemIds" value={item.id} key={item.id} />)}

    <ControlField label="操作">
      <Select name="pdfOperation" label="操作" value={operation} onValueChange={changeOperation} disabled={pending} options={operationOptions} />
    </ControlField>

    <div className="tool-selection-summary">
      <span>{selected.length ? operation === "pdf.merge" ? `已选择 ${selected.length} 个 PDF` : selected[0].originalName : operation === "pdf.merge" ? "按合并顺序选择 PDF" : "选择一个来源 PDF"}</span>
      <strong>{operationLabel(operation)}</strong>
    </div>
    <label className="tool-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 PDF" aria-label="搜索 PDF" disabled={pending} /></label>
    <div className="tool-input-list" role="listbox" aria-label="可用 PDF" aria-multiselectable={operation === "pdf.merge"} aria-busy={loading}>
      {loading && <p className="tool-input-state"><LoaderCircle className="ui-spin" size={17} />正在载入…</p>}
      {!loading && failed && <p className="tool-input-state error" role="alert">PDF 列表载入失败。</p>}
      {!loading && !failed && !items.length && <p className="tool-input-state">没有符合条件的 PDF。</p>}
      {!loading && items.map((item) => <button type="button" role="option" aria-selected={selectedIds.has(item.id)} className={selectedIds.has(item.id) ? "tool-input-option selected" : "tool-input-option"} onClick={() => choose(item)} disabled={pending} key={item.id}>
        <span className="tool-option-check">{selectedIds.has(item.id) && <Check size={13} />}</span><Files size={15} /><span><strong>{item.title}</strong><small>{item.originalName}</small></span>
      </button>)}
    </div>

    {operation === "pdf.merge" && selected.length > 0 && <ol className="pdf-tools-order" aria-label="PDF 合并顺序">
      {selected.map((item, index) => <li key={item.id}><span><b>{index + 1}</b>{item.originalName}</span><span>
        <button type="button" onClick={() => move(index, -1)} disabled={pending || index === 0} aria-label={`上移 ${item.originalName}`}><ArrowUp size={13} /></button>
        <button type="button" onClick={() => move(index, 1)} disabled={pending || index === selected.length - 1} aria-label={`下移 ${item.originalName}`}><ArrowDown size={13} /></button>
        <button type="button" onClick={() => choose(item)} disabled={pending} aria-label={`移除 ${item.originalName}`}><X size={13} /></button>
      </span></li>)}
    </ol>}

    {selected.length > 0 && <div className="pdf-tools-settings">
      {operation === "pdf.split" && <ControlField label="每份页数"><input name="splitEvery" inputMode="numeric" value={splitEvery} onChange={(event) => setSplitEvery(event.target.value)} disabled={pending} aria-label="每份页数" /></ControlField>}
      {(operation === "pdf.extract" || operation === "pdf.rotate") && <ControlField label="页码"><input name="pageSelector" value={pageSelector} onChange={(event) => setPageSelector(event.target.value)} disabled={pending} aria-label="页码" placeholder="例如 1,3-5" /></ControlField>}
      {operation === "pdf.rotate" && <>
        <ControlField label="角度"><Select name="rotateAngle" label="角度" value={rotateAngle} onValueChange={setRotateAngle} disabled={pending} options={[{ value: "90", label: "90°" }, { value: "180", label: "180°" }, { value: "270", label: "270°" }]} /></ControlField>
        <ControlField label="方式"><Select name="rotateMode" label="方式" value={rotateMode} onValueChange={setRotateMode} disabled={pending} options={[{ value: "relative", label: "相对旋转" }, { value: "absolute", label: "设为固定角度" }]} /></ControlField>
      </>}
      {operation === "pdf.reorder" && <ControlField label="页面顺序"><input name="pageOrder" value={pageOrder} onChange={(event) => setPageOrder(event.target.value)} disabled={pending} aria-label="页面顺序" placeholder="例如 3,1,2" /></ControlField>}
      {first?.project_id ? <ControlField label="保存位置" className="pdf-tools-destination"><Select name="folderId" label="保存位置" value={folderId} onValueChange={setFolderId} disabled={pending} options={[{ value: "", label: "专案根目录" }, ...folders.map((folder) => ({ value: folder.id, label: folder.path }))]} /></ControlField> : <><input type="hidden" name="folderId" value="" /><p className="pdf-tools-location">保存位置：未归入专案</p></>}
      <p className="pdf-tools-dependency">{availability?.qpdf.status === "ready" ? `qpdf ${availability.qpdf.version} 已验证 · PDF Tools ${availability.package.version}` : "运行依赖由正式调用再次确认。"}</p>
      <p className="pdf-tools-page-help">页码使用从 1 开始的用户页码；提交时由 Host 转为结构化协议。</p>
    </div>}

    <button className="primary-button tool-run-button" disabled={pending || !operationId || !canRun}>
      {pending ? <><LoaderCircle className="ui-spin" size={16} />正在处理…</> : <><Files size={16} />运行 PDF 工具</>}
    </button>
  </>}</MutationForm>;
}

const operationLabel = (operation: Operation) => ({ "pdf.merge": "合并", "pdf.split": "拆分", "pdf.extract": "提取", "pdf.rotate": "旋转", "pdf.reorder": "重排" })[operation];
