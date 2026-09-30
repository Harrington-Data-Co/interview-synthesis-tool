import Link from "next/link";
import { TemplatesEditor, type TemplateRow } from "@/components/templates/TemplatesEditor";
import { loadDirectory } from "@/lib/directory";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Templates: note templates (an interview's note), memo templates (a
 *  project's findings memo) and deck templates (its slide deck), each a
 *  library plus project copies. */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ t?: string; kind?: string }> }) {
  const { t: selectedId, kind: kindParam } = await searchParams;
  const kind = kindParam === "memo" || kindParam === "deck" ? kindParam : "note";
  const supabase = await createClient();
  const [{ data: templates, error }, { data: uses }, directory, seat] = await Promise.all([
    kind !== "note"
      ? supabase
          .from("product_template")
          .select("id,name,scope,project_id,copied_from_id,sections:product_section(id,ordinal,name,requires,note)")
          .eq("kind", kind === "deck" ? "deck" : "report")
          .order("name")
      : supabase
          .from("note_template")
          .select("id,name,scope,project_id,copied_from_id,sections:note_section(id,ordinal,name,requires,note)")
          .order("name"),
    kind !== "note" ? supabase.from("product").select("template_id") : supabase.from("note").select("template_id"),
    loadDirectory(supabase),
    currentSeat(),
  ]);

  const count = new Map<string, number>();
  for (const n of uses ?? []) count.set(n.template_id, (count.get(n.template_id) ?? 0) + 1);
  const rows: TemplateRow[] = (templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    projectId: t.project_id,
    copiedFromId: t.copied_from_id,
    notes: count.get(t.id) ?? 0,
    sections: [...(t.sections ?? [])]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({ id: s.id, name: s.name, requires: s.requires ?? [], note: s.note })),
  }));

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">Templates</span>
        <div className="seg" style={{ alignSelf: "flex-start", marginTop: 4 }}>
          {(
            [
              ["note", "Note templates", "/templates"],
              ["memo", "Memo templates", "/templates?kind=memo"],
              ["deck", "Deck templates", "/templates?kind=deck"],
            ] as const
          ).map(([k, text, href]) => (
            <Link key={k} href={href} className="seg-opt" aria-current={kind === k ? "page" : undefined} style={{ textDecoration: "none" }}>
              <span style={kind === k ? { background: "var(--color-accent-tint)", color: "var(--color-accent-800)", fontWeight: 700 } : undefined}>
                {text}
              </span>
            </Link>
          ))}
        </div>
        <p className="meta" style={{ maxWidth: "74ch" }}>
          {kind === "deck"
            ? "A deck template decides the slide deck's sections, and whether each is filled from confirmed themes or from codes of particular types."
            : kind === "memo"
            ? "A memo template decides the findings memo's sections, and whether each is filled from confirmed themes or from codes of particular types."
            : "A note template decides an interview note's sections and which kinds of codes fill each."}{" "}
          The library holds the originals; adding one to a project gives the project its own copy, so a project&apos;s
          edits never change the library or another project.
        </p>
      </div>
      {error ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">
            Could not read templates: {error.message}. Have the files in <code>supabase/migrations</code> been applied?
          </p>
        </div>
      ) : (
        <TemplatesEditor
          key={kind}
          kind={kind}
          templates={rows}
          selectedId={selectedId ?? null}
          directory={{ clients: directory.clients, projects: directory.projects }}
          editor={canEdit(seat)}
        />
      )}
    </div>
  );
}
