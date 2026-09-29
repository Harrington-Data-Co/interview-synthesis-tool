import { TemplatesEditor, type TemplateRow } from "@/components/templates/TemplatesEditor";
import { loadDirectory } from "@/lib/directory";
import { canEdit, currentSeat } from "@/lib/seat";
import { createClient } from "@/lib/supabase/server";

/** Note templates: the library, and each project's own copies. */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t: selectedId } = await searchParams;
  const supabase = await createClient();
  const [{ data: templates, error }, { data: notes }, directory, seat] = await Promise.all([
    supabase
      .from("note_template")
      .select("id,name,scope,project_id,copied_from_id,sections:note_section(id,ordinal,name,requires,note)")
      .order("name"),
    supabase.from("note").select("template_id"),
    loadDirectory(supabase),
    currentSeat(),
  ]);

  const uses = new Map<string, number>();
  for (const n of notes ?? []) uses.set(n.template_id, (uses.get(n.template_id) ?? 0) + 1);
  const rows: TemplateRow[] = (templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    projectId: t.project_id,
    copiedFromId: t.copied_from_id,
    notes: uses.get(t.id) ?? 0,
    sections: [...(t.sections ?? [])]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({ id: s.id, name: s.name, requires: s.requires ?? [], note: s.note })),
  }));

  return (
    <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 1400 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">Templates</span>
        <h2 style={{ fontSize: 20 }}>Note templates</h2>
        <p className="meta" style={{ maxWidth: "70ch" }}>
          A template decides a note&apos;s sections and which kinds of codes fill each. The library holds the
          originals; adding one to a project gives the project its own copy, so a project&apos;s edits never change
          the library or another project.
        </p>
      </div>
      {error ? (
        <div className="panel" style={{ padding: "var(--space-4)" }}>
          <p className="meta">
            Could not read templates: {error.message}. Has migration <code>20260929b_notes.sql</code> been applied?
          </p>
        </div>
      ) : (
        <TemplatesEditor
          templates={rows}
          selectedId={selectedId ?? null}
          directory={{ clients: directory.clients, projects: directory.projects }}
          editor={canEdit(seat)}
        />
      )}
    </div>
  );
}
