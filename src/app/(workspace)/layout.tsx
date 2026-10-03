import { WorkspaceShell } from "@/app/_components/workspace-shell";
import { listProjects } from "@/modules/projects/service";
import { requireAuthorized } from "@/platform/auth/service";
import { runScheduledFileMaintenance } from "@/platform/files/maintenance";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAuthorized();
  void runScheduledFileMaintenance().catch(() => undefined);
  const projects = listProjects();
  return <WorkspaceShell projects={projects}>{children}</WorkspaceShell>;
}
