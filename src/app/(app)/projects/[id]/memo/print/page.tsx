import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/memo/PrintButton";
import { loadMemo } from "@/lib/memo/load";
import { createClient } from "@/lib/supabase/server";

/** The memo laid out for paper: headline, sections, paragraphs with
 *  superscript citations, and the evidence as numbered notes at the end.
 *  The browser's Print → Save as PDF makes the PDF. */
export default async function MemoPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { id } = await params;
  const { template: templateId } = await searchParams;
  const supabase = await createClient();
  const memo = await loadMemo(supabase, id, templateId);
  if (!memo?.template || !memo.product) notFound();
  const { template, product, paragraphs, project } = memo;

  const themeById = new Map(memo.themes.map((t) => [t.id, t]));
  const codeById = new Map(memo.codes.map((c) => [c.id, c]));
  const participant = new Map(memo.interviews.map((i) => [i.id, i.participant ?? i.title]));
  const notes: string[] = [];
  const noteFor = new Map<string, number>();
  const cite = (cid: string, text: string) => {
    if (!noteFor.has(cid)) {
      notes.push(text);
      noteFor.set(cid, notes.length);
    }
    return noteFor.get(cid)!;
  };
  const sections = template.sections
    .map((s) => ({
      ...s,
      paragraphs: paragraphs
        .filter((p) => p.sectionId === s.id)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((p) => ({
          ...p,
          marks: [
            ...p.themeIds.flatMap((tid) => {
              const t = themeById.get(tid);
              return t ? [cite(tid, `${t.ref} — ${t.title}`)] : [];
            }),
            ...p.codeIds.flatMap((cid) => {
              const c = codeById.get(cid);
              return c ? [cite(cid, `${c.key}, ${participant.get(c.transcriptId) ?? "interview"}: “${c.verbatim}”`)] : [];
            }),
          ],
        })),
    }))
    .filter((s) => s.paragraphs.length);

  return (
    <div style={{ background: "#fff", flex: 1 }}>
      <div className="no-print" style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--line-1)" }}>
        <Link href={`/projects/${id}?view=memo&template=${template.id}`} className="meta" style={{ fontSize: 12.5 }}>
          ← Back to the memo
        </Link>
        <span className="meta" style={{ fontSize: 12 }}>
          Choose “Save as PDF” as the printer to make a PDF.
        </span>
        <span style={{ marginLeft: "auto" }}>
          <PrintButton />
        </span>
      </div>
      <article style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", color: "#111", fontFamily: "Georgia, 'Times New Roman', serif" }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#555", fontFamily: "var(--font-sans, sans-serif)" }}>
          {project.name}
          {project.client ? ` · ${project.client}` : ""}
        </p>
        <h1 style={{ fontSize: 28, lineHeight: 1.25, margin: "8px 0 32px" }}>{product.title ?? template.name}</h1>
        {sections.map((s) => (
          <section key={s.id} style={{ marginBottom: 24, breakInside: "avoid-page" }}>
            <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>{s.name}</h2>
            {s.paragraphs.map((p) => (
              <p key={p.id} style={{ fontSize: 14.5, lineHeight: 1.65, margin: "0 0 12px" }}>
                {p.text}
                {p.marks.length > 0 && <sup style={{ fontSize: 10, marginLeft: 1 }}>{p.marks.join(",")}</sup>}
              </p>
            ))}
          </section>
        ))}
        {notes.length > 0 && (
          <section style={{ borderTop: "1px solid #bbb", marginTop: 32, paddingTop: 12 }}>
            <h2 style={{ fontSize: 13, margin: "0 0 8px", fontFamily: "var(--font-sans, sans-serif)" }}>Evidence</h2>
            <ol style={{ margin: 0, paddingLeft: 22, fontSize: 11.5, lineHeight: 1.5, color: "#333" }}>
              {notes.map((n, i) => (
                <li key={i} style={{ marginBottom: 4, breakInside: "avoid" }}>
                  {n}
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>
    </div>
  );
}
