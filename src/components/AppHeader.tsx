"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clientLabel, type ClientOption, type ProjectOption } from "@/lib/directory";
import { TOOLS_HOME_URL } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import type { Seat } from "@/lib/seat";
import { clientPath } from "@/lib/urls";

// Top navigation (backlog R8): Sources, then Clients and Templates as menus
// that go straight to a project or a kind of template, then People.
// Transcripts are reached through the library, so they light Sources up;
// old /projects links redirect to /clients.
type Menu = "clients" | "templates" | "account";

const TEMPLATE_KINDS = [
  ["Note templates", "/templates"],
  ["Memo templates", "/templates?kind=memo"],
  ["Deck templates", "/templates?kind=deck"],
] as const;

const roleTag = (r: string) =>
  r === "owner" ? "tag-accent" : r === "editor" ? "tag-outline" : "tag-neutral";

export function AppHeader({ seat, clients, projects }: { seat: Seat; clients: ClientOption[]; projects: ProjectOption[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState<Menu | null>(null);
  const header = useRef<HTMLElement>(null);
  const toggle = (m: Menu) => setOpen((cur) => (cur === m ? null : m));
  const acctOpen = open === "account";
  // Workspace-wide pages are for Harrington's own people; someone invited
  // from outside sees only their projects.
  const staff = !!seat.role;

  // Close on navigation, a click elsewhere, or Escape. A click works on
  // touch too, where a hover menu wouldn't.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(null);
  }
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!header.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const on = (...prefixes: string[]) => prefixes.some((h) => pathname.startsWith(h));
  const navStyle = (lit: boolean, expanded = false) => ({
    background: lit || expanded ? "var(--color-accent-tint)" : "transparent",
    color: lit ? "var(--color-accent-800)" : "var(--color-text)",
    fontWeight: lit ? 700 : 500,
  });

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <header
      ref={header}
      className="no-print"
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
          {/* The brand belongs to the suite; this tool's name goes to its home. */}
          {TOOLS_HOME_URL ? (
            <a href={TOOLS_HOME_URL} className="hdc-brand" style={{ fontSize: 18 }}>
              Harrington <span>Tools</span>
            </a>
          ) : (
            <span className="hdc-brand" style={{ fontSize: 18 }}>
              Harrington <span>Tools</span>
            </span>
          )}
          <span style={{ width: 1, height: 22, background: "var(--line-6)" }} />
          <Link
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
            style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--color-text)", textDecoration: "none" }}
          >
            Interview Synthesis
          </Link>
        </div>

        <nav style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {staff && (
            <Link href="/sources" className="btn" style={navStyle(on("/sources", "/transcripts"))}>
              Sources
            </Link>
          )}

          <div style={{ position: "relative" }}>
            <button
              className="btn"
              aria-expanded={open === "clients"}
              aria-controls="clients-menu"
              onClick={() => toggle("clients")}
              style={navStyle(on("/clients", "/projects"), open === "clients")}
            >
              Clients <Caret />
            </button>
            {open === "clients" && (
              <div id="clients-menu" className="panel" style={{ ...menuStyle, width: "min(380px, calc(100vw - 32px))" }}>
                {!clients.length && (
                  <p className="meta" style={{ margin: 0, padding: "var(--space-2)" }}>
                    {staff ? "No clients yet. Start one with New project on Sources." : "You haven't been added to a project yet."}
                  </p>
                )}
                {clients.map((c) => {
                  const theirs = projects.filter((p) => p.clientId === c.id);
                  // Projects are by membership; only an owner needs the empty clients.
                  if (!theirs.length && seat.role !== "owner") return null;
                  return (
                    <div key={c.id} style={{ display: "flex", flexDirection: "column" }}>
                      <MenuLink href={clientPath(c.slug)} current={pathname === clientPath(c.slug)} strong>
                        {clientLabel(c)}
                      </MenuLink>
                      {theirs.map((p) => (
                        <MenuLink key={p.id} href={p.path} current={pathname === p.path || pathname.startsWith(`${p.path}/`)} indent>
                          {p.name}
                        </MenuLink>
                      ))}
                      {!theirs.length && (
                        <span className="meta" style={{ fontSize: 12, padding: "2px 10px 6px 22px" }}>
                          No projects yet
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {staff && (
            <Link href="/people" className="btn" style={navStyle(on("/people", "/organizations"))}>
              People
            </Link>
          )}

          {staff && (
            <div style={{ position: "relative" }}>
              <button
                className="btn"
                aria-expanded={open === "templates"}
                aria-controls="templates-menu"
                onClick={() => toggle("templates")}
                style={navStyle(on("/templates"), open === "templates")}
              >
                Templates <Caret />
              </button>
              {open === "templates" && (
                <div id="templates-menu" className="panel" style={{ ...menuStyle, width: 220 }}>
                  {TEMPLATE_KINDS.map(([text, href]) => (
                    <MenuLink key={href} href={href}>
                      {text}
                    </MenuLink>
                  ))}
                </div>
              )}
            </div>
          )}

          {seat.role === "owner" && (
            <Link href="/members" className="btn" style={navStyle(on("/members"))}>
              Members
            </Link>
          )}
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
            onClick={() => toggle("account")}
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
                <span className={`tag ${roleTag(seat.role ?? "")}`} style={{ alignSelf: "flex-start", marginTop: 4 }}>
                  {seat.role ?? "Invited to projects"}
                </span>
              </div>
              <Link href="/account" className="btn btn-ghost btn-block">
                Your account
              </Link>
              {seat.role === "owner" && (
                <Link href="/settings" className="btn btn-ghost btn-block">
                  Workspace settings
                </Link>
              )}
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

const menuStyle = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  maxHeight: "70vh",
  overflowY: "auto",
  padding: "var(--space-2)",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  zIndex: 45,
  boxShadow: "var(--shadow-lg)",
} as const;

function Caret() {
  return (
    <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" style={{ marginLeft: 2 }}>
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One line in a header menu: a client (strong), a project under it
 *  (indented), or a kind of template. */
function MenuLink({
  href,
  current = false,
  strong = false,
  indent = false,
  children,
}: {
  href: string;
  current?: boolean;
  strong?: boolean;
  indent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className="menu-link"
      style={{
        padding: `6px 10px 6px ${indent ? 22 : 10}px`,
        borderRadius: "var(--radius)",
        fontSize: 13.5,
        fontWeight: strong || current ? 700 : 500,
        color: current ? "var(--color-accent-800)" : strong ? "var(--color-navy)" : "var(--color-text)",
        background: current ? "var(--color-accent-tint)" : undefined,
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}
