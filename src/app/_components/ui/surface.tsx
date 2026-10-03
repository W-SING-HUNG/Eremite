import { CircleAlert, Inbox as EmptyIcon } from "lucide-react";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="unified-empty"><EmptyIcon size={28} /><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function Notice({ kind, children }: { kind: "success" | "error" | "info"; children: React.ReactNode }) {
  return <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>{kind === "error" && <CircleAlert size={16} />}{children}</div>;
}
