import PptxGenJS from "pptxgenjs";
import { attribution, evidenceLine } from "./evidence";
import type { LoadedDeck } from "./load";

// Brand colours (globals.css), without the leading #.
const NAVY = "1B2A41";
const GREEN = "1F6F5C";
const TEXT = "2B2B2B";
const MUTED = "6B6B6B";
const TINT = "EDF4F1";
const BG = "F7F4EF";
// Inter isn't on every presenter's machine; Arial lays out the same everywhere.
const FONT = "Arial";

/** The deck as an editable PowerPoint file (16:9): a title slide, then each
 *  slide in section order, with the quote in the participant's exact words
 *  and the evidence in the footer and speaker notes. */
/** roleOf: code id → the title of whoever said it (see quoteRoles). */
export async function deckPptx(deck: LoadedDeck, roleOf: Map<string, string | null>): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  pptx.title = deck.product?.title ?? deck.template?.name ?? "Findings";
  pptx.company = "Harrington Data Co";
  const W = 13.33;
  const sectionName = new Map((deck.template?.sections ?? []).map((s) => [s.id, s.name]));
  const codeOf = new Map(deck.codes.map((c) => [c.id, c]));

  // Title slide.
  const t = pptx.addSlide();
  t.background = { color: NAVY };
  t.addText(`${deck.template?.name ?? "Findings"}${deck.project.client ? ` · ${deck.project.client}` : ""}`.toUpperCase(), {
    x: 0.8, y: 1.6, w: W - 1.6, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: "C9D2DE", charSpacing: 2,
  });
  t.addText(deck.product?.title ?? deck.template?.name ?? "Findings", {
    x: 0.8, y: 2.1, w: W - 1.6, h: 2.6, fontFace: FONT, fontSize: 36, bold: true, color: "FFFFFF", valign: "top", fit: "shrink",
  });
  t.addText(`${deck.project.name} · ${deck.interviews.length} interviews`, {
    x: 0.8, y: 6.3, w: W - 1.6, h: 0.4, fontFace: FONT, fontSize: 12, color: "C9D2DE",
  });

  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    const quote = s.quoteCodeId ? codeOf.get(s.quoteCodeId) : undefined;
    const kicker = (sectionName.get(s.sectionId) ?? "").toUpperCase();
    const evidence = evidenceLine(s, deck);
    slide.background = { color: s.layout === "statement" ? BG : "FFFFFF" };
    slide.addText(kicker, { x: 0.6, y: 0.35, w: W - 1.2, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: GREEN, charSpacing: 2 });

    if (s.layout === "statement") {
      slide.addText(s.title, { x: 0.8, y: 1.6, w: W - 1.6, h: 3.6, fontFace: FONT, fontSize: 36, bold: true, color: NAVY, valign: "middle", fit: "shrink" });
    } else if (s.layout === "quote" && quote) {
      slide.addText(s.title, { x: 0.6, y: 0.8, w: W - 1.2, h: 0.9, fontFace: FONT, fontSize: 20, bold: true, color: NAVY, fit: "shrink" });
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.9, w: 0.08, h: 3.6, fill: { color: GREEN }, line: { color: GREEN } });
      slide.addText(`“${quote.verbatim}”`, { x: 0.95, y: 1.9, w: W - 2, h: 3.6, fontFace: FONT, fontSize: 26, italic: true, color: TEXT, valign: "middle", fit: "shrink" });
      slide.addText(attribution(roleOf.get(quote.id)), { x: 0.95, y: 5.6, w: W - 2, h: 0.4, fontFace: FONT, fontSize: 14, color: MUTED });
    } else {
      slide.addText(s.title, { x: 0.6, y: 0.8, w: W - 1.2, h: 1.1, fontFace: FONT, fontSize: 28, bold: true, color: NAVY, valign: "top", fit: "shrink" });
      const textW = quote ? 7.2 : W - 1.2;
      if (s.bullets.length) {
        slide.addText(
          s.bullets.map((b) => ({ text: b, options: { bullet: { indent: 18 }, paraSpaceAfter: 10 } })),
          { x: 0.6, y: 2.1, w: textW, h: 4.3, fontFace: FONT, fontSize: 18, color: TEXT, valign: "top", fit: "shrink" },
        );
      }
      if (quote) {
        slide.addShape(pptx.ShapeType.rect, { x: 8.2, y: 2.1, w: W - 8.8, h: 3.9, fill: { color: TINT }, line: { color: TINT } });
        slide.addText(
          [
            { text: `“${quote.verbatim}”`, options: { italic: true, fontSize: 16, color: TEXT, breakLine: true } },
            { text: attribution(roleOf.get(quote.id)), options: { fontSize: 12, color: MUTED } },
          ],
          { x: 8.45, y: 2.3, w: W - 9.3, h: 3.5, fontFace: FONT, valign: "middle", fit: "shrink" },
        );
      }
    }
    if (evidence) slide.addText(`Evidence: ${evidence}`, { x: 0.6, y: 6.85, w: 9, h: 0.35, fontFace: FONT, fontSize: 10, color: MUTED });
    slide.addText(String(i + 2), { x: W - 1.2, y: 6.85, w: 0.6, h: 0.35, fontFace: FONT, fontSize: 10, color: MUTED, align: "right" });
    slide.addNotes([s.notes, evidence ? `Evidence: ${evidence}.` : null].filter(Boolean).join("\n\n"));
  });

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
