import type { Tag, TagObjectType } from "@/modules/tags/service";

export function tagPickerIdentity(type: TagObjectType, objectId: string, assigned: Array<Pick<Tag, "id" | "revision" | "name">>) {
  const assignment = assigned
    .map((tag) => `${tag.id}:${tag.revision}:${tag.name}`)
    .sort()
    .join("\u001f");
  return `${type}:${objectId}:${assignment}`;
}
