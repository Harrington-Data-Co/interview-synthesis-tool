import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { currentSeat } from "@/lib/seat";
import { supabaseConfigured } from "@/lib/config";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!supabaseConfigured) return <SetupNeeded />;

  const seat = await currentSeat();
  if (!seat) return <NoSeat />;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg)",
      }}
    >
      <AppHeader seat={seat} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </main>
    </div>
  );
}

/** Shown before anyone has pointed the app at a database. Better than a stack
 *  trace for the first person to clone the repo. */
function SetupNeeded() {
  return (
    <Centered title="Not connected yet">
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-muted)" }}>
        Copy <code>.env.local.example</code> to <code>.env.local</code>, fill in the
        Supabase project URL and anon key, then apply{" "}
        <code>supabase/schema.sql</code> to the database.
      </p>
    </Centered>
  );
}

/** A valid sign-in with no seat row. Authentication succeeded; membership did not. */
function NoSeat() {
  return (
    <Centered title="No seat on this workspace">
      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--color-muted)" }}>
        Your sign-in worked, but this account has no seat here yet. A workspace owner
        can add one from Members.
      </p>
    </Centered>
  );
}

function Centered({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "var(--space-6)" }}>
      <div
        className="panel"
        style={{
          width: "min(460px,100%)",
          padding: "var(--space-8)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <span className="hdc-brand" style={{ fontSize: 18 }}>
          Harrington <span>Tools</span>
        </span>
        <h2 style={{ fontSize: 22 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
