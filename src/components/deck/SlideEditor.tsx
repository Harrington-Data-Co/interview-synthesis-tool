"use client";

import { useState } from "react";
import { Dialog, Field, Notice } from "@/components/ui";
import type { MemoTemplateView, MemoThemeView } from "@/lib/memo/load";
import type { SlideLayout } from "@/lib/deck/gate";
import type { EvidenceCode, EvidenceInterview } from "@/lib/themes/evidence";
import { deckAction } from "./actions";

export type SlideSeed = {
  slideId?: string;
  rejectionId?: string;
  sectionId: string;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  quoteCodeId: string | null;
  notes: string;
  themeIds: string[];
  codeIds: string[];
};

const LAYOUTS: [SlideLayout, string, string][] = [
  ["finding", "Finding", "A headline with bullets, and a quote beside them if you pick one"],
  ["quote", "Quote", "A participant's words carry the slide"],
  ["statement", "Statement", "One big sentence, for the headline or a section opener"],
];

/** Write or edit a slide: its section and layout, an assertion headline,
 *  bullets, an optional quote (from a code it cites), speaker notes, and the
 *  themes and codes it rests on. */
export function SlideEditor({
  title,
  seed,
  productId,
  sections,
  themes,
  interviews,
  codes,
  onClose,
  onSaved,
}: {
  title: string;
  seed: SlideSeed;
  productId: string;
  sections: MemoTemplateView["sections"];
  themes: MemoThemeView[];
  interviews: EvidenceInterview[];
  codes: EvidenceCode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sectionId, setSectionId] = useState(seed.sectionId);
  const [layout, setLayout] = useState(seed.layout);
  const [headline, setHeadline] = useState(seed.title);
  const [bullets, setBullets] = useState(seed.bullets.join("\n"));
  const [quote, setQuote] = useState(seed.quoteCodeId ?? "");
  const [notes, setNotes] = useState(seed.notes);
  const [pickedThemes, setPickedThemes] = useState<Set<string>>(new Set(seed.themeIds));
  const [pickedCodes, setPickedCodes] = useState<Set<string>>(new Set(seed.codeIds));
  const [interview, setInterview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (set: (f: (p: Set<string>) => Set<string>) => void, id: string) =>
    set((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const shownCodes = codes.filter((c) => !interview || c.transcriptId === interview || pickedCodes.has(c.id));
  const bulletList = bullets.split("\n").map((b) => b.trim()).filter(Boolean);
  const codeOf = new Map(codes.map((c) => [c.id, c]));

  async function save() {
    setBusy(true);
    setError("");
    const codeIds = [...pickedCodes];
    // The quote has to be one of the slide's codes.
    if (quote && !pickedCodes.has(quote)) codeIds.push(quote);
    const fields = { sectionId, layout, title: headline, bullets: bulletList, quoteCodeId: quote || null, notes, themeIds: [...pickedThemes], codeIds };
    const { error: err } = seed.slideId
      ? await deckAction(productId, { action: "update", slideId: seed.slideId, changes: fields })
      : await deckAction(productId, { action: "create", ...fields, rejectionId: seed.rejectionId });
    setBusy(false);
    if (err) return setError(err);
    onSaved();
    onClose();
  }

  const row = { display: "grid", gridTemplateColumns: "18px auto 1fr", gap: 8, padding: "5px 12px", alignItems: "start", cursor: "pointer" } as const;
  const quoteChoices = [...new Set([...pickedCodes, ...(quote ? [quote] : [])])].map((id) => codeOf.get(id)).filter((c): c is EvidenceCode => !!c);

  return (
    <Dialog title={title} onClose={busy ? undefined : onClose} width={800}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-3)", alignItems: "end" }}>
        <Field label="Section">
          <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="seg" role="radiogroup" aria-label="Layout">
          {LAYOUTS.map(([k, name, hint]) => (
            <label key={k} className="seg-opt" title={hint}>
              <input type="radio" name="slide-layout" checked={layout === k} onChange={() => setLayout(k)} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>
      <Field label="Headline" hint="A full sentence stating the takeaway, not a topic.">
        <input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} autoFocus />
      </Field>
      {layout !== "statement" && (
        <Field label="Bullets" hint="One per line, at most six. Short phrases.">
          <textarea className="input" rows={4} value={bullets} onChange={(e) => setBullets(e.target.value)} style={{ resize: "vertical" }} />
        </Field>
      )}
      {layout !== "statement" && (
        <Field label="Quote" hint="Shown in the participant's exact words, attributed by role. Pick from the codes the slide cites.">
          <select className="input" value={quote} onChange={(e) => setQuote(e.target.value)}>
            <option value="">No quote</option>
            {quoteChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.key} · “{c.verbatim.length > 90 ? `${c.verbatim.slice(0, 90)}…` : c.verbatim}”
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Speaker notes">
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: "vertical" }} />
      </Field>

      <span className="kicker" style={{ fontSize: 10 }}>
        Themes · {pickedThemes.size}
      </span>
      <div className="panel" style={{ maxHeight: 140, overflow: "auto", padding: "4px 0" }}>
        {themes.map((t) => (
          <label key={t.id} style={row}>
            <input type="checkbox" checked={pickedThemes.has(t.id)} onChange={() => toggle(setPickedThemes, t.id)} />
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              {t.ref}
            </span>
            <span style={{ fontSize: 12.5 }}>
              {t.title}{" "}
              <span className="meta" style={{ fontSize: 11 }}>
                {t.codeIds.length} codes{t.status === "proposed" ? " · not confirmed" : ""}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="kicker" style={{ fontSize: 10 }}>
          Codes · {pickedCodes.size}
        </span>
        <select className="input" value={interview} onChange={(e) => setInterview(e.target.value)} style={{ width: "auto", fontSize: 12, marginLeft: "auto" }}>
          <option value="">All interviews</option>
          {interviews.map((i) => (
            <option key={i.id} value={i.id}>
              {i.key} · {i.participant ?? i.title}
            </option>
          ))}
        </select>
      </div>
      <div className="panel" style={{ maxHeight: 200, overflow: "auto", padding: "4px 0" }}>
        {shownCodes.map((c) => (
          <label key={c.id} style={row}>
            <input type="checkbox" checked={pickedCodes.has(c.id)} onChange={() => toggle(setPickedCodes, c.id)} />
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>
              {c.key}
            </span>
            <span style={{ fontSize: 12.5 }}>
              {c.label}{" "}
              <span className="meta" style={{ fontSize: 11 }}>
                {c.type}
              </span>
            </span>
          </label>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !headline.trim() || pickedThemes.size + pickedCodes.size + (quote ? 1 : 0) === 0 || bulletList.length > 6}>
          {busy ? "Saving…" : seed.slideId ? "Save changes" : "Add slide"}
        </button>
      </div>
    </Dialog>
  );
}
