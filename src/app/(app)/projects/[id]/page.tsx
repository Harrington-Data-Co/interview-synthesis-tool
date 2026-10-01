import { notFound, permanentRedirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isViewKey, pathForProjectId, projectHref } from "@/lib/urls";

/** Old links (/projects/<uuid>?view=swimlanes&map=…) go to the project's
 *  page under its client, on the same tab with the same settings. */
export default async function OldProjectLink({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { view, ...rest } = await searchParams;
  const path = await pathForProjectId(await createClient(), id);
  if (!path) notFound();
  const query = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  permanentRedirect(projectHref(path, typeof view === "string" && isViewKey(view) ? view : "interviews", query));
}
