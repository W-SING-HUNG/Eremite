"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, MoveRight, Pencil, Trash2, X } from "lucide-react";
import type { Folder as FolderRecord } from "@/modules/projects/folders";
import type { Project } from "@/modules/projects/service";
import { createFolderAction, moveFolderResultAction, renameFolderAction, trashFolderAction } from "@/app/resource-actions";
import { AlertDialog, Dialog } from "@/app/_components/ui/dialog";
import { ContextMenu, Menu, MenuItem } from "@/app/_components/ui/menu";
import { nextTreeState } from "@/app/_lib/ui-keyboard";
import { DestinationBrowser } from "@/app/_components/destination-browser";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { showToast } from "@/app/_components/ui/toast";
import type { ResourceDestination } from "@/app/_lib/resource-navigation";

type TreeNode = FolderRecord & { children: TreeNode[]; depth: number };

export function FolderTree({ projectId, projects, folders, selectedFolderId, active, returnTo, onClose, panelRef, modal = false, layerId }: { projectId: string; projects: Project[]; folders: FolderRecord[]; selectedFolderId: string | null; active: boolean; returnTo: string; onClose?: () => void; panelRef?: RefObject<HTMLElement>; modal?: boolean; layerId?: string }) {
  const router = useRouter();
  const roots = useMemo(() => buildTree(folders), [folders]);
  const selectedAncestors = useMemo(() => new Set(findAncestors(folders, selectedFolderId)), [folders, selectedFolderId]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([...roots.map((root) => root.id), ...selectedAncestors]));
  const [focusedId, setFocusedId] = useState(selectedFolderId ?? roots[0]?.id ?? "");
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [renameFolder, setRenameFolder] = useState<FolderRecord | null>(null);
  const [moveFolder, setMoveFolder] = useState<FolderRecord | null>(null);
  const [trashFolder, setTrashFolder] = useState<FolderRecord | null>(null);
  const [moveState, setMoveState] = useState<{ destination: ResourceDestination | null; noOp: boolean }>({ destination: null, noOp: false });
  const visible = flattenVisible(roots, expanded);
  const trashReturnTo = trashFolder && selectedFolderId && selectedAncestors.has(trashFolder.id)
    ? trashFolder.parent_id ? `/projects/${projectId}/folders/${trashFolder.parent_id}` : `/projects/${projectId}`
    : returnTo;
  useEffect(() => {
    if (!selectedFolderId) return;
    requestAnimationFrame(() => document.getElementById(`folder-tree-${selectedFolderId}`)?.scrollIntoView({ block: "nearest" }));
  }, [selectedFolderId]);
  const setFolderExpanded = (id: string, value: boolean) => setExpanded((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; });
  return <aside ref={panelRef} className="folder-tree-panel" role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-label={modal ? "文件夹" : undefined} tabIndex={modal ? -1 : undefined} data-overlay-layer={modal ? layerId : undefined}><header><div><span>文件夹</span><small>{folders.length}</small></div><div>{active && <button className="icon-button" type="button" aria-label="新建文件夹" onClick={() => setCreateParentId(null)}><FolderPlus size={17} /></button>}{onClose && <button data-folder-tree-initial-focus className="icon-button folder-tree-close" type="button" aria-label="关闭文件夹" onClick={onClose}><X size={17} /></button>}</div></header>
    <Link className={!selectedFolderId ? "tree-root active" : "tree-root"} aria-current={!selectedFolderId ? "page" : undefined} href={`/projects/${projectId}`}><FolderOpen size={16} />全部资料</Link>
    <div className="folder-tree" role="tree" aria-label="文件夹树">{visible.map((folder, index) => {
      const hasChildren = folder.children.length > 0; const isExpanded = expanded.has(folder.id); const selected = selectedFolderId === folder.id;
      const parentIndex = folder.parent_id ? visible.findIndex((entry) => entry.id === folder.parent_id) : null;
      const row = <div className={selected ? "tree-row selected" : selectedAncestors.has(folder.id) ? "tree-row ancestor" : "tree-row"} style={{ paddingInlineStart: `${8 + folder.depth * 16}px` }} role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? isExpanded : undefined} aria-level={folder.depth + 1} tabIndex={focusedId === folder.id ? 0 : -1} onFocus={() => setFocusedId(folder.id)} onKeyDown={(event) => {
        if (event.key === "F2" && active) { event.preventDefault(); setRenameFolder(folder); return; }
        const state = nextTreeState({ key: event.key, index, itemCount: visible.length, expanded: hasChildren && isExpanded, hasChildren, parentIndex, firstChildIndex: hasChildren && isExpanded ? index + 1 : null }); if (!state.handled) return;
        event.preventDefault(); if (state.expand !== null) setFolderExpanded(folder.id, state.expand); if (state.activate) location.href = `/projects/${projectId}/folders/${folder.id}`;
        const target = visible[state.index]; if (target) { setFocusedId(target.id); requestAnimationFrame(() => document.getElementById(`folder-tree-${target.id}`)?.focus()); }
      }} id={`folder-tree-${folder.id}`}>
        <button className="tree-expander" type="button" aria-label={isExpanded ? "折叠" : "展开"} disabled={!hasChildren} onClick={() => setFolderExpanded(folder.id, !isExpanded)}>{hasChildren ? isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}</button>
        <Link href={`/projects/${projectId}/folders/${folder.id}`}>{selected ? <FolderOpen size={16} /> : <Folder size={16} />}<span title={folder.name}>{folder.name}</span></Link>
        {active && <Menu label={`${folder.name} 操作`}><FolderMenuItems folder={folder} onCreate={setCreateParentId} onRename={setRenameFolder} onMove={setMoveFolder} onTrash={setTrashFolder} /></Menu>}
      </div>;
      return <ContextMenu label={`${folder.name} 操作`} key={folder.id} trigger={row}>{active && <FolderMenuItems folder={folder} onCreate={setCreateParentId} onRename={setRenameFolder} onMove={setMoveFolder} onTrash={setTrashFolder} />}</ContextMenu>;
    })}{visible.length === 0 && <p className="tree-empty">尚无文件夹</p>}</div>
    <Dialog open={createParentId !== undefined} onClose={() => setCreateParentId(undefined)} title="新建文件夹" description={createParentId ? "创建在所选文件夹内。" : "创建在当前专案中。"}><MutationForm action={createFolderAction} className="drawer-form" onSuccess={(_, form) => { form.reset(); setCreateParentId(undefined); router.refresh(); }}>{({ pending }) => <><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="parentId" value={createParentId ?? ""} /><input type="hidden" name="returnTo" value={returnTo} /><label>名称<input autoFocus name="name" required maxLength={255} disabled={pending} /></label><button className="primary-button" disabled={pending}>{pending ? "正在创建…" : "新建文件夹"}</button></>}</MutationForm></Dialog>
    <Dialog open={Boolean(renameFolder)} onClose={() => setRenameFolder(null)} title="重命名文件夹"><form action={renameFolderAction} className="drawer-form">{renameFolder && <><input type="hidden" name="id" value={renameFolder.id} /><input type="hidden" name="revision" value={renameFolder.revision} /><input type="hidden" name="returnTo" value={returnTo} /><label>名称<input autoFocus name="name" defaultValue={renameFolder.name} required maxLength={255} /></label><button className="primary-button">保存名称</button></>}</form></Dialog>
    <Dialog open={Boolean(moveFolder)} onClose={() => setMoveFolder(null)} title="移动文件夹" description="浏览并选择新的位置；整个文件夹及其中资料会一起移动。" className="destination-dialog">{moveFolder && <><DestinationBrowser projects={projects} excludeFolderId={moveFolder.id} original={{ projectId: moveFolder.project_id, folderId: moveFolder.parent_id }} formId="move-folder-form" onDestinationChange={setMoveState} /><MutationForm id="move-folder-form" action={moveFolderResultAction} className="destination-actions" onSuccess={() => { const label = moveState.destination?.label ?? "所选位置"; setMoveFolder(null); showToast({ title: `文件夹已移到 ${label}`, tone: "success" }); router.refresh(); }} onConflict={() => router.refresh()}>{({ pending }) => <><input type="hidden" name="id" value={moveFolder.id} /><input type="hidden" name="revision" value={moveFolder.revision} /><div className="dialog-actions"><button type="button" className="quiet-button" onClick={() => setMoveFolder(null)}>取消</button><button className="primary-button" disabled={pending || !moveState.destination || moveState.noOp}>{pending ? "正在移动…" : moveState.noOp ? "已在此位置" : "移到这里"}</button></div></>}</MutationForm></>}</Dialog>
    <AlertDialog open={Boolean(trashFolder)} onClose={() => setTrashFolder(null)} title="将文件夹移到回收站？" description="整个文件夹会暂时从专案中隐藏，其中资料可随文件夹一起恢复。" className="danger-dialog">{trashFolder && <form action={trashFolderAction} className="drawer-form"><input type="hidden" name="id" value={trashFolder.id} /><input type="hidden" name="revision" value={trashFolder.revision} /><input type="hidden" name="returnTo" value={trashReturnTo} /><p className="confirmation-name">{trashFolder.name}</p><div className="dialog-actions"><button data-dialog-initial-focus className="quiet-button" type="button" onClick={() => setTrashFolder(null)}>取消</button><button className="danger-button"><Trash2 size={15} />移到回收站</button></div></form>}</AlertDialog>
  </aside>;
}

function FolderMenuItems({ folder, onCreate, onRename, onMove, onTrash }: {
  folder: FolderRecord;
  onCreate: (id: string) => void;
  onRename: (folder: FolderRecord) => void;
  onMove: (folder: FolderRecord) => void;
  onTrash: (folder: FolderRecord) => void;
}) {
  return <><MenuItem onClick={() => onCreate(folder.id)}><FolderPlus size={15} />新建子文件夹</MenuItem><MenuItem onClick={() => onRename(folder)}><Pencil size={15} />重命名</MenuItem><MenuItem onClick={() => onMove(folder)}><MoveRight size={15} />移动文件夹</MenuItem><MenuItem danger onClick={() => onTrash(folder)}><Trash2 size={15} />移到回收站</MenuItem></>;
}

function buildTree(folders: FolderRecord[]) {
  const nodes = new Map(folders.map((folder) => [folder.id, { ...folder, children: [] as TreeNode[], depth: 0 }]));
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) { const parent = node.parent_id ? nodes.get(node.parent_id) : undefined; if (parent) { node.depth = parent.depth + 1; parent.children.push(node); } else roots.push(node); }
  const sort = (items: TreeNode[], depth = 0) => items.sort((a, b) => a.name_key.localeCompare(b.name_key) || a.id.localeCompare(b.id)).forEach((item) => { item.depth = depth; sort(item.children, depth + 1); });
  sort(roots); return roots;
}

function flattenVisible(roots: TreeNode[], expanded: Set<string>) {
  const result: TreeNode[] = []; const visit = (items: TreeNode[]) => items.forEach((item) => { result.push(item); if (expanded.has(item.id)) visit(item.children); }); visit(roots); return result;
}

function findAncestors(folders: FolderRecord[], id: string | null) {
  const byId = new Map(folders.map((folder) => [folder.id, folder])); const result: string[] = []; let current = id ? byId.get(id) : undefined;
  while (current) { result.push(current.id); current = current.parent_id ? byId.get(current.parent_id) : undefined; } return result;
}
