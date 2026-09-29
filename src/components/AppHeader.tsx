"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Seat } from "@/lib/seat";

const VIEWS = [
  // Projects and transcripts are reached through the library, so they light it up.
  { key: "sources", label: "Sources", href: "/sources", also: ["/projects", "/transcripts"] },
  { key: "templates", label: "Templates", href: "/templates", also: [] },
  { key: "study", label: "Study", href: "/study", also: [] },
] as const;

const roleTag = (r: string) =>
  r === "owner" ? "tag-accent" : r === "editor" ? "tag-outline" : "tag-neutral";

export function AppHeader({ seat }: { seat: Seat }) {
  const pathname = usePathname();
  const router = useRouter();
  const [acctOpen, setAcctOpen] = useState(false);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <header
      style={{
        borderBottom: "1px solid var(--line-3)",
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "var(--color-bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--space-6)",
          padding: "var(--space-3) var(--space-6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <Link href="/sources" className="hdc-brand" style={{ fontSize: 18 }}>
            Harrington <span>Tools</span>
          </Link>
          <span style={{ width: 1, height: 22, background: "var(--line-6)" }} />
          <span
            style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            Interview Synthesis
          </span>
        </div>

        <nav style={{ display: "flex", gap: 2 }}>
          {VIEWS.map((v) => {
            const on = [v.href, ...v.also].some((h) => pathname.startsWith(h));
            return (
              <Link
                key={v.key}
                href={v.href}
                className="btn"
                style={{
                  background: on ? "var(--color-accent-tint)" : "transparent",
                  color: on ? "var(--color-accent-800)" : "var(--color-text)",
                  fontWeight: on ? 700 : 500,
                }}
              >
                {v.label}
              </Link>
            );
          })}
        </nav>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            position: "relative",
          }}
        >
          {seat.role === "viewer" && (
            <span className="tag tag-neutral">Read-only session</span>
          )}
          <button
            onClick={() => setAcctOpen((v) => !v)}
            className="btn"
            style={{
              gap: 8,
              border: `1px solid ${acctOpen ? "var(--color-accent)" : "var(--color-divider)"}`,
            }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                fontSize: 10,
                fontWeight: 700,
                background: "var(--color-accent-800)",
                color: "#FFFFFF",
              }}
            >
              {seat.initials}
            </span>
            {seat.name}
          </button>

          {acctOpen && (
            <div
              className="panel"
              style={{
                position: "absolute",
                top: "calc(100% + 12px)",
                right: 0,
                width: 280,
                padding: "var(--space-4)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                zIndex: 45,
                boxShadow: "var(--shadow-lg)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)" }}>
                  {seat.name}
                </span>
                <span className="meta">{seat.email}</span>
                <span className={`tag ${roleTag(seat.role)}`} style={{ alignSelf: "flex-start", marginTop: 4 }}>
                  {seat.role}
                </span>
              </div>
              <button onClick={signOut} className="btn btn-secondary btn-block">
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
