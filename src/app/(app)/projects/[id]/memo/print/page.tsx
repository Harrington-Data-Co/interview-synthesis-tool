import { notFound, permanentRedirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pathForProjectId, projectHref } from "@/lib/urls";

/** Old print links go to /clients/<client>/<project>/memo/print. */
export default async function OldMemoPrintLink({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { id } = await params;
  const { template } = await searchParams;
  const path = await pathForProjectId(await createClient(), id);
  if (!path) notFound();
  permanentRedirect(`${projectHref(path, "memo")}/print${template ? `?template=${encodeURIComponent(template)}` : ""}`);
}
