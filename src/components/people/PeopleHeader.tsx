import Link from "next/link";

const TABS = [
  ["people", "People", "/people"],
  ["organizations", "Organizations", "/organizations"],
] as const;

/** The People area's heading and its two tabs: who's in the interviews, and
 *  the organizations they're with. */
export function PeopleHeader({ tab, blurb }: { tab: "people" | "organizations"; blurb: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="kicker">People</span>
        <h2 style={{ fontSize: 20 }}>{tab === "people" ? "Who's in the interviews" : "The organizations they're with"}</h2>
        <p className="meta" style={{ maxWidth: "80ch", margin: 0 }}>
          {blurb}
        </p>
      </div>
      <nav className="seg" style={{ alignSelf: "flex-start" }} aria-label="People or organizations">
        {TABS.map(([key, label, href]) => (
          <Link key={key} href={href} className="seg-opt" style={{ textDecoration: "none" }} aria-current={tab === key ? "page" : undefined}>
            <span style={tab === key ? { background: "var(--color-accent-tint)", color: "var(--color-accent-800)", fontWeight: 700 } : undefined}>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
