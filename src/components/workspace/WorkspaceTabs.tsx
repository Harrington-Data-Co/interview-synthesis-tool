"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/workspace", "Members"],
  ["/workspace/activity", "Activity"],
  ["/workspace/settings", "Settings"],
  ["/workspace/setup", "Setup"],
] as const;

/** The Workspace area's tabs, in the same segmented style as a project's. */
export function WorkspaceTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="seg" style={{ alignSelf: "flex-start" }}>
      {TABS.map(([href, label]) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="seg-opt"
            aria-current={current ? "page" : undefined}
            style={{
              textDecoration: "none",
              ...(current ? { background: "var(--color-surface)", color: "var(--color-navy)", boxShadow: "var(--shadow-btn)", fontWeight: 700 } : {}),
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
