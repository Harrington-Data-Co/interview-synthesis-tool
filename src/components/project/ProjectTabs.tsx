import Link from "next/link";
import { projectHref, VIEWS, type ViewKey } from "@/lib/urls";

// The tabs in three groups (decided 2026-09-30): the process, which flows
// Interviews → Themes → Memo; Chain, a check that traces a finding back
// through the whole process rather than a step after it; and the outputs.
const TAB_GROUPS: { label: string; keys: ViewKey[]; flow?: boolean; hint: string }[] = [
  { label: "Process", keys: ["interviews", "themes", "memo"], flow: true, hint: "Each step builds on the one before." },
  { label: "Check", keys: ["chain"], hint: "Trace a finding back through every step." },
  { label: "Outputs", keys: ["corpus", "swimlanes", "architecture", "deck"], hint: "What the work produces." },
];

/** A project's tabs, grouped: the process (with arrows, since each step
 *  builds on the last), the check, and the outputs. */
export function ProjectTabs({ path, view, allowed }: { path: string; view: ViewKey; allowed?: ViewKey[] }) {
  // A client on deliverables-only access gets only the deliverables.
  const groups = TAB_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => !allowed || allowed.includes(k)) })).filter((g) => g.keys.length);
  return (
    <nav aria-label="Project views" style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end", flexWrap: "wrap" }}>
      {groups.map((g, gi) => (
        <div key={g.label} style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
          {gi > 0 && <span aria-hidden style={{ width: 1, alignSelf: "stretch", background: "var(--line-3)" }} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker" style={{ fontSize: 10 }} title={g.hint}>
              {g.label}
            </span>
            <div className="seg" style={{ alignItems: "center" }}>
              {g.keys.map((key, i) => {
                const text = VIEWS.find(([k]) => k === key)![1];
                return (
                  <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                    {g.flow && i > 0 && (
                      <span aria-hidden style={{ color: "var(--color-accent-700)", fontSize: 13, padding: "0 2px" }}>
                        →
                      </span>
                    )}
                    <Link
                      href={projectHref(path, key)}
                      className="seg-opt"
                      aria-current={view === key ? "page" : undefined}
                      style={{
                        textDecoration: "none",
                        ...(view === key ? { background: "var(--color-surface)", color: "var(--color-navy)", boxShadow: "var(--shadow-btn)", fontWeight: 700 } : {}),
                      }}
                    >
                      {text}
                    </Link>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </nav>
  );
}
