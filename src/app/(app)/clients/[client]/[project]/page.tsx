import { ProjectPage, type ProjectQuery } from "@/components/project/ProjectPage";

/** A project's Interviews tab, its own URL: /clients/<client>/<project>. */
export default async function ProjectInterviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ client: string; project: string }>;
  searchParams: Promise<ProjectQuery>;
}) {
  const { client, project } = await params;
  return <ProjectPage clientSlug={client} projectSlug={project} view="interviews" query={await searchParams} />;
}
