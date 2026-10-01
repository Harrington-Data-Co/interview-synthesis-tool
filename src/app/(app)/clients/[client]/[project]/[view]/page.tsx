import { notFound } from "next/navigation";
import { ProjectPage, type ProjectQuery } from "@/components/project/ProjectPage";
import { viewForSegment } from "@/lib/urls";

/** Any other tab of a project: /clients/<client>/<project>/process-flows. */
export default async function ProjectViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ client: string; project: string; view: string }>;
  searchParams: Promise<ProjectQuery>;
}) {
  const { client, project, view } = await params;
  const key = viewForSegment(view);
  if (!key) notFound();
  return <ProjectPage clientSlug={client} projectSlug={project} view={key} query={await searchParams} />;
}
