"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileOutput, LoaderCircle, Search } from "lucide-react";
import { executeAutomationToolAction } from "@/app/actions";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { showToast } from "@/app/_components/ui/toast";
import { ControlField } from "@/app/_components/ui/field";
import { Select } from "@/app/_components/ui/select";
import { FILE_CONVERTER_TOOL_ID } from "@/modules/automations/tools/catalog";

type Option = { id: string; title: string; project_id: string | null; folder_id: string | null; originalName: string; sourceFormat: string; conversions: string[] };
type Folder = { id: string; path: string };
type Availability = { available: boolean; engines: Array<{ id: string; status: "ready" | "unknown"; version: string | null }> };

export function FileConverterLauncher({ contextProjectId, readOnly, onRun }: { contextProjectId: string | null; readOnly: boolean; onRun: (runId: string) => void }) {
  const router = useRouter(); const [operationId, setOperationId] = useState(""); const [query, setQuery] = useState("");
  const [items, setItems] = useState<Option[]>([]); const [folders, setFolders] = useState<Folder[]>([]); const [selected, setSelected] = useState<Option | null>(null);
  const [conversionId, setConversionId] = useState(""); const [profile, setProfile] = useState("standard"); const [folderId, setFolderId] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null); const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false);
  const lockedProjectId = contextProjectId ?? selected?.project_id ?? null; const constrainProject = contextProjectId !== null || Boolean(selected);
  const conversionEngine = conversionId.includes("-to-pdf") ? "libreoffice" : /markdown|html/u.test(conversionId) ? "pandoc" : "sharp";
  const engine = availability?.engines.find((entry) => entry.id === conversionEngine); const dependencyUnknown = conversionId && engine?.status !== "ready";
  const profiles = useMemo(() => conversionId.endsWith("-to-pdf") ? ["standard", "high_quality"] : /^(png|jpeg|webp|avif)-to-/u.test(conversionId) ? ["balanced", "high_quality", "lossless"] : ["standard"], [conversionId]);

  useEffect(() => { setOperationId(crypto.randomUUID()); fetch(`/api/automations/tools/${encodeURIComponent(FILE_CONVERTER_TOOL_ID)}/availability`).then((response) => response.ok ? response.json() : Promise.reject()).then(setAvailability).catch(() => setAvailability({ available: false, engines: [] })); }, []);
  useEffect(() => {
    const controller = new AbortController(); const timer = window.setTimeout(() => {
      setLoading(true); setFailed(false); const params = new URLSearchParams({ q: query, limit: "50" });
      if (constrainProject) { params.set("constrainProject", "1"); if (lockedProjectId) params.set("projectId", lockedProjectId); }
      fetch(`/api/automations/tools/${encodeURIComponent(FILE_CONVERTER_TOOL_ID)}/options?${params}`, { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject()).then((payload: { items: Option[]; destinationFolders?: Folder[] }) => { setItems(payload.items); setFolders(payload.destinationFolders ?? []); }).catch((error) => { if (error?.name !== "AbortError") { setFailed(true); setItems([]); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180); return () => { clearTimeout(timer); controller.abort(); };
  }, [query, constrainProject, lockedProjectId]);

  const choose = (item: Option) => { setSelected(item); const next = item.conversions[0] ?? ""; setConversionId(next); setProfile(defaultProfile(next)); setFolderId(item.project_id ? item.folder_id ?? "" : ""); };
  if (readOnly) return <p className="lifecycle-banner">当前专案已归档，不能启动新运行。</p>;
  if (availability && !availability.available) return <div className="tool-input-state error" role="alert">本地转换组件未通过运行时身份检查，工具暂不可用。</div>;
  return <MutationForm action={executeAutomationToolAction} className="tool-launcher-form" onSuccess={({ objectId, status }) => {
    setOperationId(crypto.randomUUID()); if (status === "failed") { showToast({ title: "文件转换失败", description: "运行记录已保存，可在详情中查看原因。", tone: "error" }); router.refresh(); return; }
    showToast({ title: "文件转换完成", tone: "success" }); setSelected(null); setConversionId(""); onRun(objectId);
  }}>{({ pending }) => <>
    <input type="hidden" name="operationId" value={operationId} /><input type="hidden" name="toolId" value={FILE_CONVERTER_TOOL_ID} />
    {constrainProject && <input type="hidden" name="projectId" value={lockedProjectId ?? ""} />}
    <input type="hidden" name="contentItemId" value={selected?.id ?? ""} />
    <div className="tool-selection-summary"><span>{selected ? selected.originalName : "选择一个来源文件"}</span><strong>{selected?.sourceFormat.toUpperCase() ?? "—"}</strong></div>
    <label className="tool-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索可转换文件" aria-label="搜索可转换文件" disabled={pending} /></label>
    <div className="tool-input-list" role="listbox" aria-label="可转换文件" aria-busy={loading}>
      {loading && <p className="tool-input-state"><LoaderCircle className="ui-spin" size={17} />正在载入…</p>}
      {!loading && failed && <p className="tool-input-state error" role="alert">文件列表载入失败。</p>}
      {!loading && !failed && !items.length && <p className="tool-input-state">没有符合条件的文件。</p>}
      {!loading && items.map((item) => <button type="button" role="option" aria-selected={selected?.id === item.id} className={selected?.id === item.id ? "tool-input-option selected" : "tool-input-option"} onClick={() => choose(item)} disabled={pending} key={item.id}><span className="tool-option-check">{selected?.id === item.id && <Check size={13} />}</span><FileOutput size={15} /><span><strong>{item.title}</strong><small>{item.originalName}</small></span></button>)}
    </div>
    {selected && <div className="file-converter-settings">
      <ControlField label="目标格式"><Select name="conversionId" label="目标格式" value={conversionId} onValueChange={(next) => { setConversionId(next); setProfile(defaultProfile(next)); }} disabled={pending} options={selected.conversions.map((id) => ({ value: id, label: targetLabel(id) }))} /></ControlField>
      <ControlField label="质量"><Select name="profile" label="质量" value={profile} onValueChange={setProfile} disabled={pending} options={profiles.map((item) => ({ value: item, label: profileLabel(item) }))} /></ControlField>
      {selected.project_id ? <ControlField label="保存位置" className="file-converter-destination"><Select name="folderId" label="保存位置" value={folderId} onValueChange={setFolderId} disabled={pending} options={[{ value: "", label: "专案根目录" }, ...folders.map((folder) => ({ value: folder.id, label: folder.path }))]} /></ControlField> : <><input type="hidden" name="folderId" value="" /><p className="file-converter-location">保存位置：未归入专案</p></>}
      <p className={dependencyUnknown ? "file-converter-dependency warning" : "file-converter-dependency"}>{engine?.status === "ready" ? `${engine.id} ${engine.version ?? ""} 已检测` : "未预检测到依赖；正式运行结果由转换组件确认。"}</p>
    </div>}
    <button className="primary-button tool-run-button" disabled={pending || !operationId || !selected || !conversionId}>{pending ? <><LoaderCircle className="ui-spin" size={16} />正在转换…</> : <><FileOutput size={16} />转换文件</>}</button>
  </>}</MutationForm>;
}

const defaultProfile = (id: string) => /^(png|jpeg|webp|avif)-to-/u.test(id) ? "balanced" : "standard";
const targetLabel = (id: string) => id.split("-to-")[1]?.toUpperCase() ?? id;
const profileLabel = (value: string) => ({ standard: "标准", balanced: "平衡", high_quality: "高质量", lossless: "无损" })[value] ?? value;
