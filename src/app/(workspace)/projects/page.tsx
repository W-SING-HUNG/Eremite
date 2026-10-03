import { ProjectsWorkspace } from "@/app/_components/projects-workspace";
import { mutationNoticeMessage } from "@/app/_lib/mutation-result";
import { listProjects } from "@/modules/projects/service";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const params = await searchParams;
  const notice = params.error ? { kind: "error" as const, text: mutationNoticeMessage(params.error) } : params.success ? { kind: "success" as const, text: "操作已完成。" } : undefined;
  return <ProjectsWorkspace projects={listProjects({ includeArchived: true })} notice={notice} />;
}
