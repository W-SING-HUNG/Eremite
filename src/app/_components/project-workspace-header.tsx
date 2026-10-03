import Link from "next/link";
import { CommandTrigger } from "@/app/_components/workspace-shell";
import { ProjectLifecycleControls } from "@/app/_components/project-lifecycle-controls";
import type { Project } from "@/modules/projects/service";

const tabs = [
  ["content", "资料"],
  ["actions", "行动"],
  ["automations", "自动化"],
] as const;

export function ProjectWorkspaceHeader({
  project,
  activeTab,
}: {
  project: Project;
  activeTab: (typeof tabs)[number][0] | "settings";
}) {
  return <>
    <header className="workspace-toolbar">
      <div className="workspace-title-block">
        <h1 title={project.name}>{project.name}</h1>
        <p>{project.description || "集中管理这项工作的资料、行动与自动化。"}</p>
      </div>
      <div className="toolbar-actions"><CommandTrigger /><ProjectLifecycleControls project={project} /></div>
    </header>
    <nav className="project-tabs" aria-label="专案视图">
      {tabs.map(([key, label]) => <Link className={activeTab === key ? "active" : ""} aria-current={activeTab === key ? "page" : undefined} href={`/projects/${project.id}?tab=${key}`} key={key}>{label}</Link>)}
    </nav>
  </>;
}
