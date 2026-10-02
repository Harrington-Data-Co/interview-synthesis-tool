"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/settings", "Members"],
  ["/settings/usage", "Usage"],
  ["/settings/access", "Access log"],
  ["/settings/setup", "Setup"],
] as const;

/** Settings' tabs, in the same segmented style as a project's. */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="seg" style={{ alignSelf: "flex-start" }}>
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
