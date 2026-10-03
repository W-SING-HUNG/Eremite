export function detailFormKey(record: { id: string; revision: number }) {
  return `${record.id}:${record.revision}`;
}
