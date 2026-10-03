"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Pencil, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { createTagAction, deleteTagAction, mergeTagsAction, renameTagAction } from "@/app/resource-actions";
import { AlertDialog, Dialog } from "@/app/_components/ui/dialog";
import { Menu, MenuItem } from "@/app/_components/ui/menu";
import type { TagWithUsage } from "@/modules/tags/service";
import { MutationForm } from "@/app/_components/ui/mutation-form";
import { Select } from "@/app/_components/ui/select";
import { ControlField } from "@/app/_components/ui/field";

type Operation = { kind: "rename" | "merge" | "delete"; tag: TagWithUsage } | null;

export function TagManager({ tags }: { tags: TagWithUsage[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  return <div className="tag-manager">
    <div className="resource-toolbar"><div><h2>所有标签</h2><p>{tags.length} 个横向分类；不会改变专案或文件夹位置。</p></div><button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} />新建标签</button></div>
    <div className="tag-manager-list">{tags.map((tag) => <article className="tag-manager-row" key={tag.id}><span className="resource-icon"><TagIcon size={16} /></span><span><strong>{tag.name}</strong><small>{tag.content_count} 资料 · {tag.action_count} 行动 · {tag.run_count} 运行记录</small></span><Menu label={`${tag.name} 操作`}><MenuItem onClick={() => setOperation({ kind: "rename", tag })}><Pencil size={15} />重命名</MenuItem><MenuItem onClick={() => setOperation({ kind: "merge", tag })}><GitMerge size={15} />合并到…</MenuItem><MenuItem danger onClick={() => setOperation({ kind: "delete", tag })}><Trash2 size={15} />删除标签</MenuItem></Menu></article>)}{tags.length === 0 && <div className="unified-empty"><TagIcon size={28} /><h2>还没有标签</h2><p>在资料、行动或运行记录的详情中即可创建标签。</p></div>}</div>
    <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="新建标签" description="标签可跨专案使用，不会创建目录层级。"><MutationForm action={createTagAction} className="drawer-form" onSuccess={(_, form) => { form.reset(); setCreateOpen(false); router.refresh(); }}>{({ pending }) => <><input type="hidden" name="returnTo" value="/tags" /><label>名称<input name="name" autoFocus required maxLength={64} disabled={pending} /></label><button className="primary-button" disabled={pending}>{pending ? "正在创建…" : "创建标签"}</button></>}</MutationForm></Dialog>
    <Dialog open={operation?.kind === "rename"} onClose={() => setOperation(null)} title="重命名标签" description="所有已关联对象会同步显示新名称。">{operation?.kind === "rename" && <form action={renameTagAction} className="drawer-form"><input type="hidden" name="id" value={operation.tag.id} /><input type="hidden" name="revision" value={operation.tag.revision} /><input type="hidden" name="returnTo" value="/tags" /><label>名称<input name="name" autoFocus defaultValue={operation.tag.name} required maxLength={64} /></label><button className="primary-button">保存名称</button></form>}</Dialog>
    <Dialog open={operation?.kind === "merge"} onClose={() => setOperation(null)} title="合并标签" description="来源标签的所有关系会并入目标标签，随后删除来源标签。">{operation?.kind === "merge" && <form action={mergeTagsAction} className="drawer-form"><input type="hidden" name="sourceId" value={operation.tag.id} /><input type="hidden" name="returnTo" value="/tags" /><ControlField label={`将“${operation.tag.name}”合并到`}><Select name="targetId" label="目标标签" defaultValue="" placeholder="选择目标标签" options={tags.filter((tag) => tag.id !== operation.tag.id).map((tag) => ({ value: tag.id, label: tag.name }))} /></ControlField><button className="primary-button" disabled={tags.length < 2}>确认合并</button></form>}</Dialog>
    <AlertDialog open={operation?.kind === "delete"} onClose={() => setOperation(null)} title="删除标签" description="只会移除分类关系；资料、行动与运行记录不会被删除。">{operation?.kind === "delete" && <form action={deleteTagAction} className="drawer-form"><input type="hidden" name="id" value={operation.tag.id} /><input type="hidden" name="returnTo" value="/tags" /><p>删除“{operation.tag.name}”？它当前关联 {operation.tag.content_count + operation.tag.action_count + operation.tag.run_count} 个对象。</p><div className="dialog-actions"><button data-dialog-initial-focus type="button" className="quiet-button" onClick={() => setOperation(null)}>取消</button><button className="danger-button">删除标签</button></div></form>}</AlertDialog>
  </div>;
}
