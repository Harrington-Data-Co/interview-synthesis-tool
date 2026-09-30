import type { SlideView } from "@/lib/deck/load";

/** One slide at 16:9, drawn like the .pptx: section kicker, assertion
 *  headline, bullets, the quote in the participant's exact words, and the
 *  evidence in the footer. Sizes scale with the frame's width, so the same
 *  slide works as a thumbnail and full size. */
export function SlideFrame({
  slide,
  kicker,
  quote,
  who,
  evidence,
  number,
  titleSlide,
}: {
  slide: Pick<SlideView, "layout" | "title" | "bullets"> | null;
  kicker: string;
  quote?: string | null;
  who?: string;
  evidence?: string;
  number?: number;
  /** The deck's title slide instead of a content slide. */
  titleSlide?: { title: string; sub: string };
}) {
  // The outer box is the size container; the slide is drawn in an inner
  // layer, so its padding (in cqw) is measured against the slide, not the page.
  const frame = (inner: React.CSSProperties, children: React.ReactNode) => (
    <div style={{ containerType: "inline-size", aspectRatio: "16 / 9", width: "100%", position: "relative", borderRadius: 4, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 4, boxSizing: "border-box", ...inner }}>{children}</div>
    </div>
  );
  if (titleSlide)
    return frame(
      { background: "var(--color-navy)", color: "#FFFFFF", padding: "12cqw 6cqw 4cqw" },
      <>
        <div style={{ fontSize: "1.3cqw", fontWeight: 700, letterSpacing: "0.15em", color: "var(--color-navy-muted)" }}>{kicker.toUpperCase()}</div>
        <div style={{ fontSize: "3.9cqw", fontWeight: 700, lineHeight: 1.15, marginTop: "1.5cqw" }}>{titleSlide.title}</div>
        <div style={{ position: "absolute", left: "6cqw", bottom: "5cqw", fontSize: "1.3cqw", color: "var(--color-navy-muted)" }}>{titleSlide.sub}</div>
      </>,
    );
  if (!slide) return null;
  const statement = slide.layout === "statement";
  const quoteLayout = slide.layout === "quote" && quote;
  return frame(
    { background: statement ? "var(--color-bg)" : "#FFFFFF", color: "var(--color-text)", padding: "3cqw 4.5cqw", border: "1px solid var(--line-2)" },
    <>
      <div style={{ fontSize: "1.2cqw", fontWeight: 700, letterSpacing: "0.15em", color: "var(--color-accent)" }}>{kicker.toUpperCase()}</div>
      {statement ? (
        <div style={{ position: "absolute", inset: "10cqw 6cqw 8cqw", display: "flex", alignItems: "center", fontSize: "3.9cqw", fontWeight: 700, lineHeight: 1.15, color: "var(--color-navy)" }}>{slide.title}</div>
      ) : quoteLayout ? (
        <>
          <div style={{ fontSize: "2.2cqw", fontWeight: 700, lineHeight: 1.2, color: "var(--color-navy)", marginTop: "1.2cqw" }}>{slide.title}</div>
          <div style={{ marginTop: "3cqw", borderLeft: "0.6cqw solid var(--color-accent)", paddingLeft: "2.5cqw" }}>
            <div style={{ fontSize: "2.6cqw", fontStyle: "italic", lineHeight: 1.35 }}>“{quote}”</div>
            <div style={{ fontSize: "1.4cqw", color: "#6B6B6B", marginTop: "1.5cqw" }}>{who}</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: "3cqw", fontWeight: 700, lineHeight: 1.15, color: "var(--color-navy)", marginTop: "1.2cqw", maxWidth: quote ? "60%" : undefined }}>{slide.title}</div>
          <div style={{ display: "flex", gap: "3cqw", marginTop: "3cqw" }}>
            <ul style={{ flex: 1, margin: 0, paddingLeft: "2.2cqw", fontSize: "1.9cqw", lineHeight: 1.4 }}>
              {slide.bullets.map((b, i) => (
                <li key={i} style={{ marginBottom: "1cqw" }}>
                  {b}
                </li>
              ))}
            </ul>
            {quote && (
              <div style={{ width: "36%", background: "var(--color-accent-100)", padding: "2cqw", alignSelf: "flex-start", boxSizing: "border-box" }}>
                <div style={{ fontSize: "1.7cqw", fontStyle: "italic", lineHeight: 1.4 }}>“{quote}”</div>
                <div style={{ fontSize: "1.3cqw", color: "#6B6B6B", marginTop: "1.2cqw" }}>{who}</div>
              </div>
            )}
          </div>
        </>
      )}
      {evidence && <div style={{ position: "absolute", left: "4.5cqw", bottom: "2cqw", fontSize: "1.1cqw", color: "#6B6B6B" }}>Evidence: {evidence}</div>}
      {number !== undefined && <div style={{ position: "absolute", right: "4.5cqw", bottom: "2cqw", fontSize: "1.1cqw", color: "#6B6B6B" }}>{number}</div>}
    </>,
  );
}
