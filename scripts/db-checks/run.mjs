// Runs every database check against a fresh copy of supabase/schema.sql.
// First, once: npm install --no-save @electric-sql/pglite
// Then:        node scripts/db-checks/run.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
let failed = false;
for (const f of ["access.mjs", "writing-paths.mjs", "settings.mjs"]) {
  try {
    const out = execFileSync(process.execPath, [here + f], { encoding: "utf8" });
    const bad = out.split("\n").filter((l) => l.startsWith("✗"));
    const good = out.split("\n").filter((l) => l.startsWith("✓")).length;
    console.log(`${f}: ${good} passed${bad.length ? `, ${bad.length} failed` : ""}`);
    bad.forEach((l) => console.log("  " + l));
    if (bad.length) failed = true;
  } catch (e) {
    failed = true;
    console.log(`${f}: crashed\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
}
process.exit(failed ? 1 : 0);
