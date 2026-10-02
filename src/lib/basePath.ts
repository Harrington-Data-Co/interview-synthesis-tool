/** Where the app sits on its domain: "" locally, "/interview-synthesis" on
 *  tools.harringtondata.com (decided 2026-10-01: the Harrington Tools hub
 *  is the root, each tool a path under it). next.config.ts reads the same
 *  variable, so Link, router.push and redirect() add it themselves; plain
 *  fetch(), <a href> and window.location don't, and go through withBase. */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

/** "/api/projects" → "/interview-synthesis/api/projects". */
export const withBase = (path: string) => `${BASE_PATH}${path}`;
