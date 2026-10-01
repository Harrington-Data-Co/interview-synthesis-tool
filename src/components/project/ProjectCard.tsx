import Link from "next/link";
import type { Progress } from "@/lib/progress";
import { projectHref, type ViewKey } from "@/lib/urls";

type State = "none" | "partial" | "done";

/** A project as a card: its interviews, then how far each step of the
 *  process has got (Interviews → Themes → Memo) and which outputs exist.
 *  On the home page and a client's page. The card opens the project; each
 *  step and output opens its tab. */
export function ProjectCard({ path, name, progress: p }: { path: string; name: string; progress: Progress }) {
  const steps: [ViewKey, string, State, string][] = [
    [
      "interviews",
      "Interviews",
      !p.interviews ? "none" : p.coded === p.interviews ? "done" : p.coded ? "partial" : "none",
      p.interviews ? `${p.coded}/${p.interviews} coded · ${p.noted} with notes` : "None yet",
    ],
    [
      "themes",
      "Themes",
      p.themesConfirmed && !p.themesProposed ? "done" : p.themesConfirmed || p.themesProposed ? "partial" : "none",
      p.themesConfirmed || p.themesProposed
        ? [p.themesConfirmed && `${p.themesConfirmed} confirmed`, p.themesProposed && `${p.themesProposed} to review`].filter(Boolean).join(" · ")
        : "None yet",
    ],
    ["memo", "Memo", p.memoParagraphs ? "done" : "none", p.memoParagraphs ? `Drafted · ${p.memoParagraphs} paragraph${p.memoParagraphs === 1 ? "" : "s"}` : "Not started"],
  ];
  // The corpus is drawn from confirmed themes, so it's there once they are.
  const outputs: [ViewKey, string, number | boolean][] = [
    ["corpus", "Corpus", p.themesConfirmed > 0],
    ["swimlanes", "Process Flows", p.flows],
    ["architecture", "Architecture", p.archMaps],
    ["deck", "Deck", p.deckSlides],
  ];

  return (
    <div className="card card-stretch" style={{ gap: "var(--space-3)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Link href={path} className="card-stretch-link" style={{ fontWeight: 700, fontSize: 15 }}>
          {name}
        </Link>
        <span className="meta" style={{ fontSize: 12.5 }}>
          {p.interviews} interview{p.interviews === 1 ? "" : "s"}
          {p.minutes ? ` · ${p.minutes} min` : ""}
          {p.latest ? ` · latest ${p.latest}` : ""}
        </span>
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        {steps.map(([view, label, state, detail]) => (
          <li key={view} style={{ display: "flex" }}>
            <Link
              href={projectHref(path, view)}
              className="card-over"
              style={{ display: "grid", gridTemplateColumns: "12px 74px 1fr", alignItems: "center", gap: 6, fontSize: 12.5 }}
            >
              <Dot state={state} />
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span className="meta" style={{ fontSize: 12.5 }}>
                {detail}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker" style={{ fontSize: 10 }}>
          Outputs
        </span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {outputs.map(([view, label, n]) => (
            <Link
              key={view}
              href={projectHref(path, view)}
              className={`tag card-over ${n ? "tag-accent" : "tag-neutral"}`}
              style={n ? undefined : { opacity: 0.65 }}
            >
              {label}
              {typeof n === "number" && n > 0 ? ` · ${n}` : ""}
            </Link>
          ))}
        </span>
      </div>
    </div>
  );
}

/** Filled when a step is done, half-filled when under way, an empty ring
 *  when it hasn't started. */
function Dot({ state }: { state: State }) {
  const label = state === "done" ? "Done" : state === "partial" ? "Under way" : "Not started";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        border: `1.5px solid ${state === "none" ? "var(--line-6)" : "var(--color-accent)"}`,
        background:
          state === "done"
            ? "var(--color-accent)"
            : state === "partial"
              ? "linear-gradient(90deg, var(--color-accent) 50%, transparent 50%)"
              : "transparent",
      }}
    />
  );
}
